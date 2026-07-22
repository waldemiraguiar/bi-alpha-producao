#!/usr/bin/env python3
"""Robô de nuvem do painel FINANCEIRO/ADMIN (com R$).
TODA a agregação é feita NO SERVIDOR (GROUP BY) — devolve resultados pequenos,
evitando streams longas que o servidor derruba pelo link internacional.
Monta os 19 blocos, cifra (AES-256-GCM, senha ADMIN) -> site/data/dashboard.enc."""
import os, json, base64, datetime, time
import pymysql
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT_ENC = os.path.join(ROOT, "site", "data", "dashboard.enc")
ITER = 250_000
SRC = dict(host=os.environ["MYSQL_HOST"], user=os.environ["MYSQL_USER"],
           password=os.environ["MYSQL_PWD"], database=os.environ.get("MYSQL_DB","bi_alpha"),
           connect_timeout=30, read_timeout=900, write_timeout=900, charset="utf8mb4",
           cursorclass=pymysql.cursors.DictCursor,
           init_command="SET SESSION net_write_timeout=3600, net_read_timeout=3600")
BI_PWD = os.environ["BI_PWD"]
EX = "TabExameNumeroSolicitado"
RQ = "`TabExameNumeroRequisiçao`"

# ---- Receita EXTERNA Pet Love (não entra pelo HF) ----
# O HF conta os exames Pet Love (volume correto) mas zera o VALOR. Aqui entram os R$
# reais por competência (Contas Médicas + Recurso de Glosa). Atualizar mês a mês.
PETLOVE = {
    "2025-01": 176150.23, "2025-02": 156908.92, "2025-03": 159632.10, "2025-04": 145423.71,
    "2025-05": 189860.70, "2025-06": 172860.61, "2025-07": 233484.67, "2025-08": 271239.38,
    "2025-09": 261968.80, "2025-10": 257761.96, "2025-11": 272728.27, "2025-12": 295313.79,
    "2026-01": 312785.29, "2026-02": 300037.20, "2026-03": 369282.17, "2026-04": 357062.83,
    "2026-05": 388548.42,   # real (Contas Médicas mai/26, Valor Repasse); antes estimado em 399k
    # 2026-06 fica FORA do dict de propósito: mês parcial não entra na projeção/YTD.
    # Produção parcial de jun (atend.) está em data_petlove/petlove_mensal.json p/ a coluna do quadro.
}

def clinic_details(cods, since_map=None, alias=None):
    """Detalhe por clínica p/ o share-of-wallet do CRM: setores que ela MANDA (L12) + o que NÃO manda
    (white-space) + produção recente (30d/7d) + produção DESDE O MARCO ZERO (since_map). SEM R$.
    alias = {cod_extra: cod_principal} agrega vários códigos do HF numa mesma clínica (ex.: Faro Animal
    tem o cadastro oficial 989898 + o órfão 5724 onde caíram os exames → somam no principal)."""
    since_map = since_map or {}
    alias = {str(k): str(v) for k, v in (alias or {}).items()}
    def prim(cod): return alias.get(str(cod), str(cod))
    cods = [str(x) for x in (cods or []) if x is not None and str(x) != ""]
    if not cods:
        return {"det": {}, "setores": []}
    conn = pymysql.connect(**SRC); c = conn.cursor()
    def q(sql, p=()): c.execute(sql, p); return c.fetchall()
    maxd = datetime.date.today().isoformat()
    tdt = datetime.date.fromisoformat(maxd)
    d365 = (tdt - datetime.timedelta(days=365)).isoformat()
    d30 = (tdt - datetime.timedelta(days=30)).isoformat()
    d7 = (tdt - datetime.timedelta(days=7)).isoformat()
    # usa CATEGORIA (granular: Hematologia, Bioquímica, Histopatologia…) — Setor é grosso demais p/ white-space
    # UNIVERSO de white-space por PENETRAÇÃO (quantas clínicas mandam), NÃO por volume — tira ruído tipo NECRÓPSIA (1%)
    totcli = int(q(f"SELECT COUNT(DISTINCT r.CodCliente) n FROM {EX} s JOIN {RQ} r ON s.CodNumeroSequencialTela=r.CodNumeroSequencialTela "
                   f"WHERE s.DataExame BETWEEN %s AND %s", (d365, maxd))[0]["n"] or 1)
    uni = q(f"SELECT COALESCE(cat.Categoria,'(sem categoria)') setor, COUNT(DISTINCT r.CodCliente) cli FROM {EX} s "
            f"JOIN {RQ} r ON s.CodNumeroSequencialTela=r.CodNumeroSequencialTela "
            f"LEFT JOIN TabCategoria cat ON s.CodCategoria=cat.CodCategoria "
            f"WHERE s.DataExame BETWEEN %s AND %s GROUP BY cat.Categoria ORDER BY cli DESC", (d365, maxd))
    setores = [u["setor"] for u in uni if u["setor"] and u["setor"] != "(sem categoria)" and (u["cli"] / totcli) >= 0.15][:14]
    # CATVAL: share de R$ de cada categoria no lab (12m) → base da SIMULAÇÃO do "deixando na mesa" (agregado, SEM R$ por clínica)
    catrows = q(f"SELECT COALESCE(cat.Categoria,'(sem categoria)') setor, COALESCE(SUM(s.ValorExame),0) fat FROM {EX} s "
                f"LEFT JOIN TabCategoria cat ON s.CodCategoria=cat.CodCategoria "
                f"WHERE r.DataEntrada BETWEEN %s AND %s GROUP BY cat.Categoria", (d365, maxd))
    _totfat = sum(float(x["fat"] or 0) for x in catrows) or 1.0
    catval = {x["setor"]: round(float(x["fat"] or 0) / _totfat, 4) for x in catrows if x["setor"] and x["setor"] != "(sem categoria)"}
    ph = ",".join(["%s"] * len(cods))
    rows = q(f"SELECT r.CodCliente cod, COALESCE(cat.Categoria,'(sem categoria)') setor, COUNT(*) qtd, "
             f"SUM(CASE WHEN r.DataEntrada>=%s THEN 1 ELSE 0 END) p30, SUM(CASE WHEN r.DataEntrada>=%s THEN 1 ELSE 0 END) p7 "
             f"FROM {EX} s JOIN {RQ} r ON s.CodNumeroSequencialTela=r.CodNumeroSequencialTela "
             f"LEFT JOIN TabCategoria cat ON s.CodCategoria=cat.CodCategoria "
             f"WHERE r.CodCliente IN ({ph}) AND r.DataEntrada BETWEEN %s AND %s "
             f"GROUP BY r.CodCliente, cat.Categoria", (d30, d7, *cods, d365, maxd))
    det = {}
    for x in rows:
        cod = str(x["cod"]); d = det.setdefault(cod, {"prod30": 0, "prod7": 0, "cats": {}})
        d["cats"][x["setor"]] = d["cats"].get(x["setor"], 0) + int(x["qtd"] or 0)
        d["prod30"] += int(x["p30"] or 0); d["prod7"] += int(x["p7"] or 0)
    # MARCO ZERO: produção a partir da data de reconquista (cada cod herda o marco do seu PRINCIPAL)
    prod_desde = {}
    for cod in cods:
        dt = str(since_map.get(prim(cod)) or "")[:10]
        if not dt:
            continue
        try:
            datetime.date.fromisoformat(dt)
        except Exception:
            continue
        r = q(f"SELECT COUNT(*) n FROM {EX} s JOIN {RQ} r ON s.CodNumeroSequencialTela=r.CodNumeroSequencialTela "
              f"WHERE r.CodCliente=%s AND r.DataEntrada BETWEEN %s AND %s", (cod, dt, maxd))
        prod_desde[cod] = {"n": int(r[0]["n"] or 0), "desde": dt}
    # DRILL-DOWN exame-a-exame por clínica (dia · exame · categoria · PET · tutor · registro) — desde o marco zero, senão 180d
    d180 = (tdt - datetime.timedelta(days=180)).isoformat()
    recent = {}
    CAP = 260   # máx linhas por clínica (as mais recentes)
    for cod in cods:
        desde = str(since_map.get(prim(cod)) or "")[:10] or d180
        try:
            datetime.date.fromisoformat(desde)
        except Exception:
            desde = d180
        rows = q(f"SELECT r.DataEntrada d, s.Exame ex, COALESCE(cat.Categoria,'') cat, r.Animal pet, r.Proprietario tut, "
                 f"r.NumeroSequencial req FROM {EX} s JOIN {RQ} r ON s.CodNumeroSequencialTela=r.CodNumeroSequencialTela "
                 f"LEFT JOIN TabCategoria cat ON s.CodCategoria=cat.CodCategoria "
                 f"WHERE r.CodCliente=%s AND r.DataEntrada BETWEEN %s AND %s "
                 f"ORDER BY r.DataEntrada DESC, r.NumeroSequencial DESC LIMIT %s", (cod, desde, maxd, CAP + 1))
        lst = [{"d": str(x["d"])[:10], "ex": (x["ex"] or "")[:60], "cat": (x["cat"] or "")[:40],
                "pet": (x["pet"] or "")[:40], "tut": (x["tut"] or "")[:40], "req": x["req"]} for x in rows[:CAP]]
        recent[cod] = {"lst": lst, "desde": desde, "mais": len(rows) > CAP}
    conn.close()
    # AGREGA por código PRINCIPAL (soma os códigos-extra na mesma clínica)
    mdet, mpd, mrec = {}, {}, {}
    for cod, d in det.items():
        p = prim(cod); m = mdet.setdefault(p, {"prod30": 0, "prod7": 0, "cats": {}})
        m["prod30"] += d["prod30"]; m["prod7"] += d["prod7"]
        for s, qn in d["cats"].items(): m["cats"][s] = m["cats"].get(s, 0) + qn
    for cod, pd in prod_desde.items():
        p = prim(cod); e = mpd.setdefault(p, {"n": 0, "desde": pd["desde"]}); e["n"] += pd["n"]
    for cod in cods:
        if cod not in recent: continue
        p = prim(cod); e = mrec.setdefault(p, {"lst": [], "desde": recent[cod]["desde"], "mais": False})
        e["lst"].extend(recent[cod]["lst"]); e["mais"] = e["mais"] or recent[cod]["mais"]
    for p, e in mrec.items():
        e["lst"].sort(key=lambda x: x["d"], reverse=True)
        if len(e["lst"]) > CAP: e["mais"] = True; e["lst"] = e["lst"][:CAP]
    prims = set([prim(c) for c in cods])
    out = {}
    for p in prims:
        d = mdet.get(p, {"prod30": 0, "prod7": 0, "cats": {}})
        cats = sorted(d["cats"].items(), key=lambda kv: -kv[1])
        prod12 = sum(qn for s, qn in d["cats"].items() if s != "(sem categoria)")
        row = {"prod30": d["prod30"], "prod7": d["prod7"], "prod12": prod12,
               "cats": [{"setor": s, "qtd": qn} for s, qn in cats if s != "(sem categoria)"],
               "falta": [s for s in setores if s not in d["cats"]]}
        if p in mpd:
            row["prod_desde"] = mpd[p]["n"]; row["marco"] = mpd[p]["desde"]
        if p in mrec:
            row["recent"] = mrec[p]["lst"]; row["recent_desde"] = mrec[p]["desde"]; row["recent_mais"] = mrec[p]["mais"]
        out[p] = row
    return {"det": out, "setores": setores, "catval": catval}

def clinic_fat_12m(cods):
    """R$ 12m (SUM ValorExame) de códigos arbitrários — inclusive ÓRFÃOS que não estão em TabCliente
    (ex.: 5724 do Faro). Usado p/ somar os códigos-extra no principal no fluxo cifrado."""
    cods = [str(x) for x in (cods or []) if x is not None and str(x) != ""]
    if not cods:
        return {}
    conn = pymysql.connect(**SRC); c = conn.cursor()
    def q(sql, p=()): c.execute(sql, p); return c.fetchall()
    maxd = datetime.date.today().isoformat()
    d365 = (datetime.date.fromisoformat(maxd) - datetime.timedelta(days=365)).isoformat()
    ph = ",".join(["%s"] * len(cods))
    rows = q(f"SELECT r.CodCliente cod, COALESCE(SUM(s.ValorExame),0) f FROM {EX} s JOIN {RQ} r ON s.CodNumeroSequencialTela=r.CodNumeroSequencialTela "
             f"WHERE r.CodCliente IN ({ph}) AND r.DataEntrada BETWEEN %s AND %s GROUP BY r.CodCliente", (*cods, d365, maxd))
    conn.close()
    return {str(x["cod"]): round(float(x["f"] or 0), 2) for x in rows}

def clinic_fat_since(since_map, alias=None):
    """R$ (SUM ValorExame) por clínica DESDE o marco zero. alias={cod_extra:cod_principal} soma os
    códigos-extra no principal (Faro Animal: 989898 + 5724). Usado SÓ no fluxo CIFRADO (diretoria)."""
    since_map = {str(k): str(v or "")[:10] for k, v in (since_map or {}).items() if k is not None and str(v or "")}
    alias = {str(k): str(v) for k, v in (alias or {}).items()}
    if not since_map:
        return {}
    def prim(cod): return alias.get(str(cod), str(cod))
    # cada cod (principal + extras) herda o marco do seu principal
    todo = {}
    for cod in set(list(since_map.keys()) + list(alias.keys())):
        dt = since_map.get(prim(cod))
        if dt: todo[str(cod)] = dt
    if not todo:
        return {}
    conn = pymysql.connect(**SRC); c = conn.cursor()
    def q(sql, p=()): c.execute(sql, p); return c.fetchall()
    maxd = datetime.date.today().isoformat()
    out = {}
    for cod, dt in todo.items():
        try:
            datetime.date.fromisoformat(dt)
        except Exception:
            continue
        r = q(f"SELECT COALESCE(SUM(s.ValorExame),0) f FROM {EX} s JOIN {RQ} r ON s.CodNumeroSequencialTela=r.CodNumeroSequencialTela "
              f"WHERE r.CodCliente=%s AND r.DataEntrada BETWEEN %s AND %s", (cod, dt, maxd))
        out[prim(cod)] = round(out.get(prim(cod), 0) + float(r[0]["f"] or 0), 2)
    conn.close()
    return out

def clinic_fat_mensal(since_map, alias=None):
    """Faturamento REAL mês a mês por clínica DESDE o marco zero → {cod_principal: [{ym, n, fat}, ...]} ordenado.
    Soma código-extra no principal (alias). CIFRADO (diretoria) — dinheiro entrando por mês p/ estimular a equipe."""
    since_map = {str(k): str(v or "")[:10] for k, v in (since_map or {}).items() if k is not None and str(v or "")}
    alias = {str(k): str(v) for k, v in (alias or {}).items()}
    if not since_map:
        return {}
    def prim(cod): return alias.get(str(cod), str(cod))
    todo = {}
    for cod in set(list(since_map.keys()) + list(alias.keys())):
        dt = since_map.get(prim(cod))
        if dt: todo[str(cod)] = dt
    if not todo:
        return {}
    conn = pymysql.connect(**SRC); c = conn.cursor()
    def q(sql, p=()): c.execute(sql, p); return c.fetchall()
    maxd = datetime.date.today().isoformat()
    acc = {}   # {prim: {ym: [n, fat]}}
    for cod, dt in todo.items():
        try:
            datetime.date.fromisoformat(dt)
        except Exception:
            continue
        dt = dt[:7] + "-01"   # MÊS CHEIO da entrada (escolha do Wal): entrou 26/05 → conta maio inteiro
        rows = q(f"SELECT DATE_FORMAT(r.DataEntrada,'%%Y-%%m') ym, COUNT(*) n, COALESCE(SUM(s.ValorExame),0) f "
                 f"FROM {EX} s JOIN {RQ} r ON s.CodNumeroSequencialTela=r.CodNumeroSequencialTela "
                 f"WHERE r.CodCliente=%s AND r.DataEntrada BETWEEN %s AND %s GROUP BY ym", (cod, dt, maxd))
        p = prim(cod); m = acc.setdefault(p, {})
        for x in rows:
            ym = x["ym"]; cur = m.setdefault(ym, [0, 0.0])
            cur[0] += int(x["n"] or 0); cur[1] += float(x["f"] or 0)
    conn.close()
    out = {}
    for p, m in acc.items():
        out[p] = [{"ym": ym, "n": m[ym][0], "fat": round(m[ym][1], 2)} for ym in sorted(m)]
    return out

def clinics_aaa(full, nA=40, nB=60, nC=100, nD=150):
    """Clínicas por CURVA (ranking de FATURAMENTO 12m): A = as `nA` MAIORES; B/C/D = as faixas seguintes; cauda = fora.
    Faturamento do lab é cauda-longa (Pareto 80% pegaria ~190 clínicas → inútil), então o corte é por POSIÇÃO no ranking.
    Cada clínica leva `curva` (A|B|C|D) + share-of-wallet 12m (categorias que MANDA + white-space que NÃO manda).
    Payload SEM R$ (só qtd) — o R$ 12m já vai no cifrado da diretoria (clinicas_rs). `full`=D['clinicas_full']."""
    rows = sorted([c for c in (full or []) if (c.get("fat") or 0) > 0 and c.get("cod") is not None], key=lambda c: -(c.get("fat") or 0))
    if not rows:
        return {"aaa": [], "setores": [], "pct": 0, "n": 0, "nA": 0, "nB": 0, "nC": 0, "nD": 0}
    bandas = [("A", nA), ("B", nB), ("C", nC), ("D", nD)]
    sel = rows[:nA + nB + nC + nD]
    i = 0
    for cv, qtd in bandas:
        for c in sel[i:i + qtd]:
            c["_curva"] = cv
        i += qtd
    cods = [str(c["cod"]) for c in sel]
    conn = pymysql.connect(**SRC); c = conn.cursor()
    def q(sql, p=()): c.execute(sql, p); return c.fetchall()
    maxd = str((q(f"SELECT MAX(DataExame) m FROM {EX} WHERE DataExame<=%s", (datetime.date.today().isoformat(),))[0]["m"]) or datetime.date.today().isoformat())[:10]
    d365 = (datetime.date.fromisoformat(maxd) - datetime.timedelta(days=365)).isoformat()
    # UNIVERSO de white-space por PENETRAÇÃO (quantas clínicas mandam), NÃO por volume — tira ruído tipo NECRÓPSIA (1%)
    totcli = int(q(f"SELECT COUNT(DISTINCT r.CodCliente) n FROM {EX} s JOIN {RQ} r ON s.CodNumeroSequencialTela=r.CodNumeroSequencialTela "
                   f"WHERE s.DataExame BETWEEN %s AND %s", (d365, maxd))[0]["n"] or 1)
    uni = q(f"SELECT COALESCE(cat.Categoria,'(sem categoria)') setor, COUNT(DISTINCT r.CodCliente) cli FROM {EX} s "
            f"JOIN {RQ} r ON s.CodNumeroSequencialTela=r.CodNumeroSequencialTela "
            f"LEFT JOIN TabCategoria cat ON s.CodCategoria=cat.CodCategoria "
            f"WHERE s.DataExame BETWEEN %s AND %s GROUP BY cat.Categoria ORDER BY cli DESC", (d365, maxd))
    setores = [u["setor"] for u in uni if u["setor"] and u["setor"] != "(sem categoria)" and (u["cli"] / totcli) >= 0.15][:14]
    ph = ",".join(["%s"] * len(cods))
    crows = q(f"SELECT r.CodCliente cod, COALESCE(cat.Categoria,'(sem categoria)') setor, COUNT(*) qtd "
              f"FROM {EX} s JOIN {RQ} r ON s.CodNumeroSequencialTela=r.CodNumeroSequencialTela "
              f"LEFT JOIN TabCategoria cat ON s.CodCategoria=cat.CodCategoria "
              f"WHERE r.CodCliente IN ({ph}) AND s.DataExame BETWEEN %s AND %s "
              f"GROUP BY r.CodCliente, cat.Categoria", (*cods, d365, maxd))
    conn.close()
    bycod = {}
    for x in crows:
        bycod.setdefault(str(x["cod"]), {})[x["setor"]] = int(x["qtd"] or 0)
    out = []
    for cc in sel:
        cod = str(cc["cod"]); catd = bycod.get(cod, {})
        cats = sorted([(s, n) for s, n in catd.items() if s != "(sem categoria)"], key=lambda kv: -kv[1])
        out.append({"cod": cod, "nome": cc.get("nome", ""), "cidade": cc.get("cidade", ""),
                    "qtd": int(cc.get("qtd") or 0), "curva": cc.get("_curva", "A"),
                    "cats": [{"setor": s, "qtd": n} for s, n in cats],
                    "falta": [s for s in setores if s not in catd]})
    cnt = lambda cv: sum(1 for o in out if o["curva"] == cv)
    return {"aaa": out, "setores": setores, "pct": 0, "n": len(out),
            "nA": cnt("A"), "nB": cnt("B"), "nC": cnt("C"), "nD": cnt("D")}

def divide_conversion(since_map, setores=None):
    """CONQUISTA DE CATEGORIA (aba 'Dividem material'): a partir do MARCO ZERO de cada clínica, detecta as
    categorias que ela NÃO mandava antes (baseline = 12m antes do marco) e COMEÇOU a mandar depois → prova real
    do trabalho comercial. Retorna {cod: {base:[setores], conq:[{setor, desde, n, fat}]}}. `setores`=universo
    relevante (>=15% penetração) p/ não celebrar categoria-ruído. fat é R$ (vai cifrado; público leva só n/desde)."""
    since_map = {str(k): str(v or "")[:10] for k, v in (since_map or {}).items() if k is not None and str(v or "")}
    if not since_map:
        return {}
    uni = set(setores or [])
    conn = pymysql.connect(**SRC); c = conn.cursor()
    def q(sql, p=()): c.execute(sql, p); return c.fetchall()
    out = {}
    for cod, marco in since_map.items():
        try:
            datetime.date.fromisoformat(marco)
        except Exception:
            continue
        base_ini = (datetime.date.fromisoformat(marco) - datetime.timedelta(days=365)).isoformat()
        base = {x["setor"] for x in q(
            f"SELECT COALESCE(cat.Categoria,'?') setor FROM {EX} s JOIN {RQ} r ON s.CodNumeroSequencialTela=r.CodNumeroSequencialTela "
            f"LEFT JOIN TabCategoria cat ON s.CodCategoria=cat.CodCategoria "
            f"WHERE r.CodCliente=%s AND r.DataEntrada>=%s AND r.DataEntrada<%s GROUP BY cat.Categoria", (cod, base_ini, marco))}
        depois = q(f"SELECT COALESCE(cat.Categoria,'?') setor, MIN(r.DataEntrada) desde, COUNT(*) n, COALESCE(SUM(s.ValorExame),0) fat "
                   f"FROM {EX} s JOIN {RQ} r ON s.CodNumeroSequencialTela=r.CodNumeroSequencialTela "
                   f"LEFT JOIN TabCategoria cat ON s.CodCategoria=cat.CodCategoria "
                   f"WHERE r.CodCliente=%s AND r.DataEntrada>=%s GROUP BY cat.Categoria", (cod, marco))
        conq = [{"setor": x["setor"], "desde": str(x["desde"])[:10], "n": int(x["n"] or 0), "fat": round(float(x["fat"] or 0), 2)}
                for x in depois if x["setor"] and x["setor"] != "?" and x["setor"] not in base and (not uni or x["setor"] in uni)]
        conq.sort(key=lambda z: -z["n"])
        out[cod] = {"base": sorted(base), "conq": conq}
    conn.close()
    return out

def build():
    conn = pymysql.connect(**SRC); c = conn.cursor()
    def q(sql, p=()): c.execute(sql, p); return c.fetchall()
    def q1(sql, p=()):
        c.execute(sql, p); r = c.fetchone(); return list(r.values())[0] if r else None

    SYS = datetime.date.today().isoformat()
    maxd = q1(f"SELECT MAX(DataExame) m FROM {EX} WHERE DataExame<=%s", (SYS,)) or SYS
    maxd = str(maxd); tdt = datetime.date.fromisoformat(maxd); ref = tdt.replace(day=1)
    L12i = (ref-datetime.timedelta(days=365)).isoformat(); L12f = (ref-datetime.timedelta(days=1)).isoformat()
    seis = (ref-datetime.timedelta(days=183)).isoformat()
    d548 = (ref-datetime.timedelta(days=548)).isoformat()
    W12 = (L12i, L12f)

    D = {"meta":{"gerado_em":datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M")+" UTC",
        "fonte":"MySQL bi_alpha (nuvem)","max_data":maxd,"janela12_ini":L12i,"janela12_fim":L12f,
        "obs_financeiro":"Recebimento, custo e status de pagamento NÃO disponíveis nesta réplica — valores referem-se a FATURAMENTO (valor cobrado)."}}

    # S1: histórico mensal (qtd, faturamento, reqs)
    hist = q(f"SELECT DATE_FORMAT(DataExame,'%%Y-%%m') ym, COUNT(*) qtd, SUM(ValorExame) fat, "
             f"COUNT(DISTINCT CodNumeroSequencialTela) reqs FROM {EX} "
             f"WHERE DataExame>='2014-01-01' AND DataExame<='2026-12-31' GROUP BY ym ORDER BY ym")
    D["mensal"] = [{"ym":h["ym"],"qtd":h["qtd"],"fat":round(h["fat"] or 0,2),"reqs":h["reqs"],
                    "petlove":round(PETLOVE.get(h["ym"],0.0),2)} for h in hist if h["ym"]>='2019-01']
    # anual + yoy / sazonalidade / totais a partir do histórico
    agg={}; tot_fat=0.0; tot_ex=0
    for h in hist:
        if not h["ym"]: continue
        tot_fat += h["fat"] or 0; tot_ex += h["qtd"]
        y=h["ym"][:4]; a=agg.setdefault(y,{"ano":y,"qtd":0,"fat":0.0}); a["qtd"]+=h["qtd"]; a["fat"]+=h["fat"] or 0
    anual=[{"ano":y,"qtd":agg[y]["qtd"],"fat":round(agg[y]["fat"],2)} for y in sorted(agg) if y>='2014']
    prev=None
    for a in anual:
        a["yoy_fat"]=round(100*(a["fat"]-prev["fat"])/prev["fat"],1) if prev and prev["fat"] else None
        a["yoy_qtd"]=round(100*(a["qtd"]-prev["qtd"])/prev["qtd"],1) if prev and prev["qtd"] else None
        prev=a
    D["anual"]=anual
    saz={}
    for h in hist:
        if not h["ym"] or not('2022-01'<=h["ym"]<='2025-12'): continue
        m=h["ym"][5:7]; s=saz.setdefault(m,{"qs":[],"fs":[]}); s["qs"].append(h["qtd"]); s["fs"].append(h["fat"] or 0)
    D["sazonalidade"]=[{"mes":m,"media_qtd":round(sum(saz[m]["qs"])/len(saz[m]["qs"])),
                        "media_fat":round(sum(saz[m]["fs"])/len(saz[m]["fs"]),2)} for m in sorted(saz)]
    fat25=sum(h["fat"] or 0 for h in hist if h["ym"] and h["ym"].startswith("2025"))
    ex25=sum(h["qtd"] for h in hist if h["ym"] and h["ym"].startswith("2025"))

    # S2: KPIs/operacional da janela 12m (uma linha)
    k = q(f"SELECT COUNT(*) ex, SUM(ValorExame) fat, COUNT(DISTINCT CodNumeroSequencialTela) reqs, "
          f"SUM(CASE WHEN Desconto>0 THEN 1 ELSE 0 END) ndesc, SUM(Desconto) vdesc, "
          f"SUM(CASE WHEN Urgencia=1 THEN 1 ELSE 0 END) nurg, SUM(CASE WHEN Terceirizado=1 THEN 1 ELSE 0 END) nterc "
          f"FROM {EX} WHERE DataExame BETWEEN %s AND %s", W12)[0]
    ex_l12=k["ex"]; fat_l12=k["fat"] or 0; req_l12=k["reqs"]
    cli_total = q1("SELECT COUNT(*) n FROM TabCliente")

    # S3: clientes por faturamento na janela (join req->cliente) — top + concentração + ativos
    cli = q(f"SELECT r.CodCliente cod, COALESCE(cl.Cliente,r.Cliente) nome, cl.Cidade Cidade, cl.Uf Uf, "
            f"COUNT(*) qtd, SUM(s.ValorExame) fat FROM {EX} s "
            f"JOIN {RQ} r ON s.CodNumeroSequencialTela=r.CodNumeroSequencialTela "
            f"LEFT JOIN TabCliente cl ON r.CodCliente=cl.CodCliente "
            f"WHERE s.DataExame BETWEEN %s AND %s GROUP BY r.CodCliente ORDER BY fat DESC", W12)
    cli_ativos=len(cli)
    tc=[]
    for i,r in enumerate(cli[:30],1):
        tc.append({"cod":r["cod"],"nome":r["nome"],"Cidade":r["Cidade"],"Uf":r["Uf"],"qtd":r["qtd"],
                   "fat":round(r["fat"] or 0,2),"rank":i,"ticket":round((r["fat"] or 0)/r["qtd"],2) if r["qtd"] else 0})
    D["top_clientes"]=tc
    totc=sum((r["fat"] or 0) for r in cli) or 1
    sh=lambda n: round(100*sum((r["fat"] or 0) for r in cli[:n])/totc,1)
    step=max(1,len(cli)//40)
    D["concentracao"]={"n_clientes":len(cli),"fat_total":round(totc,2),
        "top10_pct":sh(10),"top20_pct":sh(20),"top50_pct":sh(50),"top100_pct":sh(100),
        "pareto":[{"cliente_pct":round(100*(i+1)/len(cli),1),
                   "fat_acum_pct":round(100*sum((r["fat"] or 0) for r in cli[:i+1])/totc,1)}
                  for i in range(0,len(cli),step)][:41]}

    D["kpis"]={"total_exames":tot_ex,"total_faturamento":round(tot_fat,2),
        "ticket_medio_exame":round(tot_fat/tot_ex,2) if tot_ex else 0,
        "exames_2025":ex25,"faturamento_2025":round(fat25,2),
        "exames_l12":ex_l12,"faturamento_l12":round(fat_l12,2),
        "clientes_ativos_l12":cli_ativos,"clientes_total":cli_total,"requisicoes_l12":req_l12,
        "exames_por_req_l12":round(ex_l12/req_l12,2) if req_l12 else 0,
        "ticket_medio_req_l12":round(fat_l12/req_l12,2) if req_l12 else 0}
    D["operacional"]={"exames_com_desconto":k["ndesc"],"valor_desconto_total":round(k["vdesc"] or 0,2),
        "pct_com_desconto":round(100*k["ndesc"]/ex_l12,2) if ex_l12 else 0,
        "exames_urgencia":k["nurg"],"pct_urgencia":round(100*k["nurg"]/ex_l12,2) if ex_l12 else 0,
        "exames_terceirizados":k["nterc"],"pct_terceirizado":round(100*k["nterc"]/ex_l12,2) if ex_l12 else 0}

    # S4: vida do cliente (só requisições, leve) -> novos + churn
    life = q(f"SELECT CodCliente cod, MIN(DataEntrada) primeira, MAX(DataEntrada) ultima, "
             f"SUM(CASE WHEN DataEntrada>=%s THEN ValorRequisiçao ELSE 0 END) fat_rec FROM {RQ} "
             f"WHERE DataEntrada>='2014-01-01' AND DataEntrada<='2026-12-31' GROUP BY CodCliente", (d548,))
    nv={}
    for r in life:
        if r["primeira"] and str(r["primeira"])>='2021-01-01':
            ym=str(r["primeira"])[:7]; nv[ym]=nv.get(ym,0)+1
    D["novos_clientes"]=[{"ym":k2,"novos":nv[k2]} for k2 in sorted(nv)]
    names={r["cod"]:r for r in q("SELECT CodCliente cod, Cliente nome, Cidade, Uf FROM TabCliente")}
    # MASTER de clínicas p/ o autocomplete do CRM (todas do HF + produção L12; R$ à parte, gated p/ diretoria)
    _prodmap={r["cod"]:r for r in cli}
    D["clinicas_full"]=[{"cod":cod,"nome":(info.get("nome") or ""),"cidade":(info.get("Cidade") or ""),
                         "qtd":int(_prodmap.get(cod,{}).get("qtd") or 0),
                         "fat":round(_prodmap.get(cod,{}).get("fat") or 0,2)}
                        for cod,info in names.items() if (info.get("nome") or "").strip()]
    churn=[]
    for r in sorted([x for x in life if x["ultima"] and str(x["ultima"])<seis and (x["fat_rec"] or 0)>0],
                    key=lambda x:-(x["fat_rec"] or 0))[:40]:
        info=names.get(r["cod"],{})
        churn.append({"cod":r["cod"],"nome":info.get("nome"),"Cidade":info.get("Cidade"),"Uf":info.get("Uf"),
                      "ultima":str(r["ultima"]),"fat_ult_ano":round(r["fat_rec"] or 0,2)})
    D["churn"]={"corte_inatividade":seis,"clientes":churn,"total_sumidos":len(churn)}

    # S5: mix de exames (qtd+fat) -> ordena nos dois sentidos em Python
    mix = q(f"SELECT Exame, COUNT(*) qtd, SUM(ValorExame) fat FROM {EX} "
            f"WHERE DataExame BETWEEN %s AND %s AND Exame IS NOT NULL AND Exame<>'' GROUP BY Exame", W12)
    for m in mix: m["fat"]=round(m["fat"] or 0,2)
    bf=sorted(mix,key=lambda x:-x["fat"])[:25]
    D["mix_exames_fat"]=[{"Exame":m["Exame"],"qtd":m["qtd"],"fat":m["fat"],"ticket":round(m["fat"]/m["qtd"],2) if m["qtd"] else 0} for m in bf]
    D["mix_exames_vol"]=[{"Exame":m["Exame"],"qtd":m["qtd"],"fat":m["fat"]} for m in sorted(mix,key=lambda x:-x["qtd"])[:25]]

    # S6: categorias (join categoria) -> setores derivado em Python
    cat = q(f"SELECT COALESCE(cat.Categoria,'(sem categoria)') categoria, COALESCE(cat.Setor,'-') setor, "
            f"COUNT(*) qtd, SUM(s.ValorExame) fat FROM {EX} s LEFT JOIN TabCategoria cat ON s.CodCategoria=cat.CodCategoria "
            f"WHERE s.DataExame BETWEEN %s AND %s GROUP BY s.CodCategoria ORDER BY fat DESC", W12)
    D["categorias"]=[{"categoria":x["categoria"],"setor":x["setor"],"qtd":x["qtd"],"fat":round(x["fat"] or 0,2)} for x in cat]
    setd={}
    for x in cat:
        s=setd.setdefault(x["setor"] or "(sem setor)",{"setor":x["setor"] or "(sem setor)","qtd":0,"fat":0.0})
        s["qtd"]+=x["qtd"]; s["fat"]+=x["fat"] or 0
    D["setores"]=[{"setor":s["setor"],"qtd":s["qtd"],"fat":round(s["fat"],2)} for s in sorted(setd.values(),key=lambda x:-x["fat"])]

    # S7/8/9: espécie / sexo / raça (join req)
    def joinreq(col, extra=""):
        return q(f"SELECT UPPER(TRIM(COALESCE(r.{col},'(n/i)'))) v, COUNT(*) qtd FROM {EX} s "
                 f"JOIN {RQ} r ON s.CodNumeroSequencialTela=r.CodNumeroSequencialTela "
                 f"WHERE s.DataExame BETWEEN %s AND %s {extra} GROUP BY v ORDER BY qtd DESC", W12)
    esp = q(f"SELECT UPPER(TRIM(COALESCE(r.Especie,'(não informado)'))) v, COUNT(*) qtd, SUM(s.ValorExame) fat FROM {EX} s "
            f"JOIN {RQ} r ON s.CodNumeroSequencialTela=r.CodNumeroSequencialTela "
            f"WHERE s.DataExame BETWEEN %s AND %s GROUP BY v ORDER BY qtd DESC LIMIT 15", W12)
    D["especies"]=[{"especie":x["v"],"qtd":x["qtd"],"fat":round(x["fat"] or 0,2)} for x in esp]
    D["sexos"]=[{"sexo":x["v"],"qtd":x["qtd"]} for x in joinreq("Sexo")[:8]]
    D["racas"]=[{"raca":x["v"],"qtd":x["qtd"]} for x in joinreq("Raça","AND r.Raça IS NOT NULL AND TRIM(r.Raça)<>''")[:15]]

    # S10: cidades (join req+cliente) -> uf derivado em Python
    cid = q(f"SELECT TRIM(COALESCE(cl.Cidade,'(n/i)')) cidade, UPPER(TRIM(COALESCE(cl.Uf,''))) uf, "
            f"COUNT(*) qtd, SUM(s.ValorExame) fat, COUNT(DISTINCT r.CodCliente) clientes FROM {EX} s "
            f"JOIN {RQ} r ON s.CodNumeroSequencialTela=r.CodNumeroSequencialTela "
            f"LEFT JOIN TabCliente cl ON r.CodCliente=cl.CodCliente "
            f"WHERE s.DataExame BETWEEN %s AND %s GROUP BY cl.Cidade, cl.Uf ORDER BY fat DESC", W12)
    D["cidades"]=[{"cidade":x["cidade"],"uf":x["uf"],"qtd":x["qtd"],"fat":round(x["fat"] or 0,2),"clientes":x["clientes"]} for x in cid[:20]]
    ufd={}
    for x in cid:
        u=ufd.setdefault(x["uf"] or "(n/i)",{"uf":x["uf"] or "(n/i)","qtd":0,"fat":0.0,"clientes":0})
        u["qtd"]+=x["qtd"]; u["fat"]+=x["fat"] or 0; u["clientes"]+=x["clientes"]
    D["uf"]=[{"uf":u["uf"],"qtd":u["qtd"],"fat":round(u["fat"],2),"clientes":u["clientes"]} for u in sorted(ufd.values(),key=lambda x:-x["fat"])][:15]

    # ---------- TIERS de clientes + acompanhamento semanal (semana vs média das 4 anteriores) ----------
    def yw3(d): iso=d.isocalendar(); return iso[0]*100+iso[1]
    hoje=datetime.date.today()
    semchaves=[yw3(hoje-datetime.timedelta(days=7*(i+1))) for i in range(5)]  # [última completa, -2,-3,-4,-5]
    sem=q(f"""SELECT r.CodCliente cod, YEARWEEK(s.DataExame,3) wk, SUM(s.ValorExame) fat
        FROM {EX} s JOIN {RQ} r ON s.CodNumeroSequencialTela=r.CodNumeroSequencialTela
        WHERE s.DataExame>=DATE_SUB(CURDATE(),INTERVAL 60 DAY) AND s.DataExame<=CURDATE()
        GROUP BY r.CodCliente, wk""")
    semmap={}
    for r in sem: semmap.setdefault(r["cod"],{})[int(r["wk"])]=float(r["fat"] or 0)
    def tier_of(m): return ("AAA" if m>=10000 else "A" if m>=5000 else "B" if m>=2000 else "C" if m>=800 else "D" if m>=300 else "E")
    tiers=[]; radar=[]
    for cl0 in cli:
        fat12=float(cl0["fat"] or 0)
        if fat12<=0: continue
        mensal=fat12/12.0; t=tier_of(mensal); wk=semmap.get(cl0["cod"],{})
        semanas=[round(wk.get(k,0.0),2) for k in semchaves]   # [atual,-2,-3,-4,-5]
        atual=semanas[0]; base=sum(semanas[1:5])/4.0
        delta=round(100*(atual-base)/base,1) if base>0 else (100.0 if atual>0 else 0.0)
        flag="up" if delta>=10 else "down" if delta<=-10 else None
        item={"cod":cl0["cod"],"nome":cl0["nome"],"cidade":cl0["Cidade"],"uf":cl0["Uf"],"tier":t,
              "fat12m":round(fat12,2),"mensal":round(mensal,2),"semanas":list(reversed(semanas)),
              "atual":round(atual,2),"base":round(base,2),"delta":delta,"flag":flag}
        tiers.append(item)
        if flag and t!="E": radar.append(item)
    tiers.sort(key=lambda x:-x["fat12m"])
    ordem={"AAA":0,"A":1,"B":2,"C":3,"D":4}
    radar.sort(key=lambda x:(ordem.get(x["tier"],9), -abs(x["delta"])))
    D["tiers_resumo"]={t:{"clientes":sum(1 for x in tiers if x["tier"]==t),
        "fat12m":round(sum(x["fat12m"] for x in tiers if x["tier"]==t),2),
        "subiram":sum(1 for x in tiers if x["tier"]==t and x["flag"]=="up"),
        "cairam":sum(1 for x in tiers if x["tier"]==t and x["flag"]=="down")} for t in ["AAA","A","B","C","D","E"]}
    D["radar"]=radar[:50]
    D["tiers"]=[x for x in tiers if x["tier"]!="E"]+[x for x in tiers if x["tier"]=="E"][:40]
    D["meta"]["tiers_faixas"]={"AAA":10000,"A":5000,"B":2000,"C":800,"D":300,"E":0}

    # ---------- NOVOS (maturação: 1ª atividade <= 90 dias) ----------
    climap={c["cod"]:c for c in cli}
    def semanas_de(cod):
        wk=semmap.get(cod,{}); return [round(wk.get(k,0.0),2) for k in semchaves][::-1]  # cronológico
    novos=[]
    for L in life:
        if not L["primeira"]: continue
        dias=(hoje-L["primeira"]).days
        if dias<0 or dias>90: continue
        cl=climap.get(L["cod"]); info=names.get(L["cod"],{})
        fat=float((cl or {}).get("fat") or 0); ult=L["ultima"]; di=(hoje-ult).days if ult else dias
        novos.append({"cod":L["cod"],"nome":(cl or {}).get("nome") or info.get("nome"),
            "cidade":(cl or {}).get("Cidade") or info.get("Cidade"),"primeira":str(L["primeira"]),
            "dias_cad":dias,"dias_inativo":di,"fat":round(fat,2),
            "mensal":round(fat/max(1,dias)*30,2),"semanas":semanas_de(L["cod"]),
            "grupo":"recem" if dias<=30 else "maturando","esfriando":di>=14})
    novos.sort(key=lambda x:-x["fat"])
    D["novos"]={"recem":[x for x in novos if x["grupo"]=="recem"],
                "maturando":[x for x in novos if x["grupo"]=="maturando"],
                "esfriando":sum(1 for x in novos if x["esfriando"]),"total":len(novos)}
    D["meta"]["novos_periodo"]=90

    # ---------- PERDIDOS / RISCO (era relevante: >=R$300/mês) ----------
    perdidos=[]
    for L in life:
        cl=climap.get(L["cod"])
        if not cl: continue
        fat12=float(cl["fat"] or 0); mensal=fat12/12.0
        if mensal<300: continue
        if L["primeira"] and (hoje-L["primeira"]).days<=90: continue   # novo, não perdido
        ult=L["ultima"]; di=(hoje-ult).days if ult else 999
        sem=semmap.get(L["cod"],{}); semanas=[round(sem.get(k,0.0),2) for k in semchaves]
        atual=semanas[0]; base=sum(semanas[1:5])/4.0
        delta=round(100*(atual-base)/base,1) if base>0 else (0.0 if atual==0 else 100.0)
        motivo="sumido" if di>=21 else ("queda" if delta<=-40 else None)
        if not motivo: continue
        perdidos.append({"cod":L["cod"],"nome":cl["nome"],"cidade":cl["Cidade"],"fat12m":round(fat12,2),
            "mensal":round(mensal,2),"ultima":str(ult) if ult else None,"dias_inativo":di,
            "delta":delta,"semanas":semanas[::-1],"motivo":motivo})
    perdidos.sort(key=lambda x:-x["fat12m"])
    D["perdidos"]={"sumidos":[x for x in perdidos if x["motivo"]=="sumido"][:60],
                   "queda":[x for x in perdidos if x["motivo"]=="queda"][:40],
                   "fat_em_risco":round(sum(x["fat12m"] for x in perdidos),2)}

    # ---- Pet Love: resumo da fonte externa (fluxo separado do sistema) ----
    pl_by_year = {}
    for ym, v in PETLOVE.items():
        pl_by_year[ym[:4]] = round(pl_by_year.get(ym[:4], 0.0) + v, 2)
    D["petlove"] = {"mensal": PETLOVE, "por_ano": pl_by_year,
                    "total": round(sum(PETLOVE.values()), 2),
                    "desde": min(PETLOVE) if PETLOVE else None,
                    "obs": "Receita externa Pet Love: o HF conta os exames mas zera o valor. "
                           "Valores reais (Contas Médicas + Recurso de Glosa) informados manualmente por competência. "
                           "Some no faturamento TOTAL; não é rateada nas quebras por cliente/exame."}

    # ---- Pet Love: MARGEM (reembolso PL vs nossa tabela varejo) + exames ----
    # Dados extraídos OFFLINE dos relatórios "Informações do Pagamento" (Contas Médicas)
    # e da Tabela de Preços Alpha Mar/2026. Atualizar rodando os extratores quando vierem
    # novos relatórios. Ver data_petlove/.
    try:
        PLDIR=os.path.join(ROOT,"data_petlove")
        marg=json.load(open(os.path.join(PLDIR,"petlove_margem.json"),encoding="utf-8"))
        plex=json.load(open(os.path.join(PLDIR,"petlove_exames.json"),encoding="utf-8"))
        try: D["petlove"]["atend_mensal"]=json.load(open(os.path.join(PLDIR,"petlove_mensal.json"),encoding="utf-8"))
        except Exception: pass
        try: D["petlove"]["proj_atual"]=json.load(open(os.path.join(PLDIR,"petlove_proj.json"),encoding="utf-8"))
        except Exception: pass
        mt=[r for r in marg if r.get("tabela")]
        rev_pl=sum(r["volume"]*r["petlove"] for r in mt)
        rev_tb=sum(r["volume"]*r["tabela"] for r in mt)
        acima=[r for r in mt if r["delta"]>0]; abaixo=[r for r in mt if r["delta"]<0]
        D["petlove_margem"]={
            "agregado":{"receita_petlove":round(rev_pl,2),"receita_tabela":round(rev_tb,2),
                "premio_pct":round((rev_pl/rev_tb-1)*100,1) if rev_tb else None,
                "n_match":len(mt),"n_total":len(marg),
                "n_acima":len(acima),"n_abaixo":len(abaixo),
                "ganho_acima":round(sum(r["delta"]*r["volume"] for r in acima),2),
                "perda_abaixo":round(sum(-r["delta"]*r["volume"] for r in abaixo),2)},
            "exames":marg,
            "top_exames":sorted(plex,key=lambda x:-x["volume"])[:40],
            "fonte":"Relatórios de pagamento Pet Love (Contas Médicas) jan–nov/2025 · "
                    "Tabela de Preços Alpha Março/2026 · preço unit. PL = mediana de atendimentos avulsos",
            "obs":"Compara o REEMBOLSO que a Pet Love nos paga por exame vs nossa TABELA DE VAREJO. "
                  "Δ>0 = Pet Love paga ACIMA do varejo (favorável). Δ<0 = abaixo (desconto que damos). "
                  "Margem real (com custo do exame) depende do dev liberar custo."}
    except Exception as e:
        D["petlove_margem"]={"erro":str(e)}

    # ---------- ESTUDO Pet Love × Copa (aba admin) ----------
    try:
        PLDIR2=os.path.join(ROOT,"data_petlove")
        est=json.load(open(os.path.join(PLDIR2,"petlove_estudo.json"),encoding="utf-8"))
        PCJOIN=(f"FROM {EX} s JOIN {RQ} r ON s.CodNumeroSequencialTela=r.CodNumeroSequencialTela "
                f"JOIN TabCliente cl ON r.CodCliente=cl.CodCliente WHERE cl.Cliente LIKE 'Pet Carioca%%' ")
        # produção Pet Carioca mensal (volume) desde 2025
        pcm=q("SELECT DATE_FORMAT(s.DataExame,'%%Y-%%m') ym, COUNT(*) ex, "
              "COUNT(DISTINCT r.CodNumeroSequencialTela) at "+PCJOIN+
              f"AND s.DataExame>='2025-01-01' AND s.DataExame<='{maxd}' GROUP BY ym ORDER BY ym")
        est["petcarioca_mensal"]=[{"ym":r["ym"],"ex":r["ex"],"at":r["at"]} for r in pcm if r["ym"]]
        # decomposição da janela 1..N do mês corrente vs mês anterior
        N=int(maxd[8:10]); curYm=maxd[:7]
        yy,mm=int(maxd[:4]),int(maxd[5:7]); pmm=mm-1 or 12; pyy=yy if mm>1 else yy-1; prevYm=f"{pyy}-{pmm:02d}"
        labc=q1(f"SELECT COUNT(*) n FROM {EX} WHERE DataExame BETWEEN '{curYm}-01' AND '{maxd}'") or 0
        labp=q1(f"SELECT COUNT(*) n FROM {EX} WHERE DataExame BETWEEN '{prevYm}-01' AND '{prevYm}-{N:02d}'") or 0
        pcc=q1("SELECT COUNT(*) n "+PCJOIN+f"AND s.DataExame BETWEEN '{curYm}-01' AND '{maxd}'") or 0
        pcp=q1("SELECT COUNT(*) n "+PCJOIN+f"AND s.DataExame BETWEEN '{prevYm}-01' AND '{prevYm}-{N:02d}'") or 0
        rc,rp=labc-pcc,labp-pcp
        copa=(rp-rc)/rp if rp else 0
        pc_exp=pcp*(1-copa); mig=pc_exp-pcc; tot=labp-labc; copa_loss=tot-mig
        est["decomp"]={"cur_ym":curYm,"prev_ym":prevYm,"ate_dia":N,
            "lab_prev":labp,"lab_cur":labc,"lab_pct":round(100*(labc/labp-1),1) if labp else None,
            "resto_pct":round(100*(rc/rp-1),1) if rp else None,
            "pc_prev":pcp,"pc_cur":pcc,"pc_pct":round(100*(pcc/pcp-1),1) if pcp else None,
            "queda_total":round(tot),"mig":round(mig),"copa_loss":round(copa_loss),
            "split_pc_pct":round(100*mig/tot) if tot>0 else None,
            "split_copa_pct":round(100*copa_loss/tot) if tot>0 else None,
            "pc_mig_pct":round(100*mig/(pcp-pcc)) if (pcp-pcc)>0 else None}
        D["estudo"]=est
    except Exception as e:
        D["estudo"]={"erro":str(e)}

    # ---------- ANÁLISE DE CUSTOS — Agentes de IA (aba admin) ----------
    try:
        D["custos"]=json.load(open(os.path.join(ROOT,"data_custos","custos.json"),encoding="utf-8"))
    except Exception as e:
        D["custos"]={"erro":str(e)}

    # ---------- ANÁLISES PONTUAIS (janelas 5/10/15/20 dias + mês a mês) ----------
    import calendar
    serie=q(f"SELECT DataExame d, COUNT(*) q, ROUND(SUM(ValorExame)) f FROM {EX} "
            f"WHERE DataExame>='2014-01-01' AND DataExame<=CURDATE() GROUP BY DataExame")
    daily={str(r["d"]):(r["q"],float(r["f"] or 0)) for r in serie if r["d"]}
    MES3=['','jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez']
    def bsum(y,m,d1,d2):
        if y<2014 or m<1 or m>12: return (0,0.0,d2)
        last=calendar.monthrange(y,m)[1]; e=min(d2,last); qa=0; fa=0.0
        for dd in range(d1,e+1):
            v=daily.get(f"{y:04d}-{m:02d}-{dd:02d}")
            if v: qa+=v[0]; fa+=v[1]
        return (qa,fa,e)
    def blocks(W):
        if W=="mes": return [(1,31)]
        W=int(W); out=[]; d=1
        while d<=31: out.append((d,d+W-1)); d+=W
        return out
    def gpct(cur,base): return round(100*(cur-base)/base,1) if base>0 else None
    hoje=datetime.date.today()
    months=[]; yy,mm=hoje.year,hoje.month
    for _ in range(15):
        months.append((yy,mm)); mm-=1
        if mm==0: mm=12; yy-=1
    analises={}
    for W in ["5","10","15","20","mes"]:
        bls=blocks(W); items=[]
        for (ay,am) in months:
            for bi,(d1,d2) in enumerate(bls):
                if datetime.date(ay,am,min(d1,calendar.monthrange(ay,am)[1]))>hoje: continue
                qc,fc,e=bsum(ay,am,d1,d2)
                pmY,pmM=(ay,am-1) if am>1 else (ay-1,12)
                pq,pf,_=bsum(pmY,pmM,d1,d2); yq,yf,_=bsum(ay-1,am,d1,d2)
                lbl=(f"{d1:02d}–{e:02d} {MES3[am]}/{str(ay)[2:]}" if W!="mes" else f"{MES3[am]}/{ay}")
                items.append({"ym":f"{ay}-{am:02d}","bi":bi,"label":lbl,"ano":ay,
                    "qtd":qc,"fat":round(fc),"parcial":datetime.date(ay,am,e)>=hoje,
                    "mom_fat":gpct(fc,pf),"mom_qtd":gpct(qc,pq),
                    "yoy_fat":gpct(fc,yf),"yoy_qtd":gpct(qc,yq)})
        items.sort(key=lambda x:(x["ym"],x["bi"]),reverse=True)
        analises[W]=items[:24]
    D["analises"]=analises
    # série mensal completa desde 2014 (p/ gráfico didático)
    D["serie_mensal_full"]=[{"ym":h["ym"],"qtd":h["qtd"],"fat":round(h["fat"] or 0)} for h in hist if h["ym"]]
    # série DIÁRIA (desde 2023) para análise por dia + seletor de período manual no front
    D["serie_diaria"]=[{"d":k,"q":daily[k][0],"f":round(daily[k][1])} for k in sorted(daily) if k>='2023-01-01']

    # ---------- ALERTAS & RECOMENDAÇÕES (data-driven) ----------
    MESNOME=['','Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
    seas={}
    for h in hist:
        if not h["ym"]: continue
        yy2,mm2=h["ym"][:4],h["ym"][5:7]
        if '2015'<=yy2<='2025': seas.setdefault(mm2,[0.0,0]); seas[mm2][0]+=h["fat"] or 0; seas[mm2][1]+=1
    avgm={m:(seas[m][0]/seas[m][1]) for m in seas if seas[m][1]}
    sbase=sum(avgm.values())/len(avgm) if avgm else 1
    sidx={m:round(100*avgm[m]/sbase) for m in avgm}
    curm=f"{hoje.month:02d}"; ci=sidx.get(curm,100)
    pico=max(sidx,key=sidx.get) if sidx else "10"; vale=min(sidx,key=sidx.get) if sidx else "02"
    A=[]
    def br(n): return f"R$ {round(n):,}".replace(",",".")
    if ci>=105: A.append({"nivel":"info","icone":"🗓️","titulo":f"{MESNOME[hoje.month]}: alta sazonal (índice {ci}, +{ci-100}% vs média)","texto":f"Período historicamente forte. Garanta capacidade — no pico os atrasados sobem. Pico do ano: {MESNOME[int(pico)]}."})
    elif ci<=95: A.append({"nivel":"warn","icone":"🗓️","titulo":f"{MESNOME[hoje.month]}: baixa sazonal (índice {ci}, {ci-100}% vs média)","texto":f"Período historicamente fraco — bom para campanhas/contratos (concorrência relaxa). Vale: {MESNOME[int(vale)]} · Pico: {MESNOME[int(pico)]}."})
    else: A.append({"nivel":"info","icone":"🗓️","titulo":f"{MESNOME[hoje.month]}: sazonalidade neutra (índice {ci})","texto":f"Pico histórico: {MESNOME[int(pico)]} · Vale: {MESNOME[int(vale)]}."})
    pr=D["perdidos"]; risco=pr.get("fat_em_risco",0); sm=pr.get("sumidos",[])
    if sm: A.append({"nivel":"danger","icone":"🔻","titulo":f"{br(risco)}/ano em risco · {len(sm)} clientes sumidos","texto":f"Maior: {sm[0]['nome']} ({sm[0]['dias_inativo']}d sem envio, ~{br(sm[0]['mensal'])}/mês). Reter 1 grande vale mais que ganhar dezenas pequenos. (Aba Perdidos/Risco)"})
    fats=[(h["qtd"],h["fat"] or 0) for h in hist if h["ym"]]
    if len(fats)>=24:
        l12=fats[-12:]; p12=fats[-24:-12]
        def tk(a): q=sum(x[0] for x in a); return (sum(x[1] for x in a)/q) if q else 0
        t1,t0=tk(l12),tk(p12); dT=(100*(t1-t0)/t0) if t0 else 0
        A.append({"nivel":"info" if dT>=0 else "warn","icone":"🎟️","titulo":f"Ticket médio {br(t1)} por exame ({'+' if dT>=0 else ''}{dT:.1f}% vs 12m anteriores)","texto":("Subindo — mix de valor melhorando, manter o rumo." if dT>=3 else "Crescer por VALOR (exames caros: PCR, painéis, especializados) complementa o volume e tem margem melhor.")})
    esf=D["novos"].get("esfriando",0)
    if esf: A.append({"nivel":"warn","icone":"🌱","titulo":f"{esf} clientes novos esfriando","texto":"Entraram (≤90d) e pararam de enviar (≥14d). Reativar agora aumenta a chance de virarem recorrentes. (Aba Novos)"})
    am=D["analises"]["mes"]; cmp=next((x for x in am if not x["parcial"]),None)
    if cmp and cmp["yoy_fat"] is not None:
        v=cmp["yoy_fat"]; q=cmp["yoy_qtd"]
        A.append({"nivel":"info" if v>=0 else "danger","icone":"📊","titulo":f"{cmp['label']}: faturamento {'+' if v>=0 else ''}{v}% vs ano anterior","texto":f"Produção {('+' if (q or 0)>=0 else '')}{q if q is not None else '—'}% · faturamento {'+' if v>=0 else ''}{v}% no mesmo mês do ano passado."})
    t10=D["concentracao"].get("top10_pct",0)
    if t10>=20: A.append({"nivel":"warn","icone":"⚠️","titulo":f"Concentração: top 10 clientes = {t10}% da receita","texto":"Perder um grande dói: em 2023, perder a Vet Popular (R$240k/ano → zero) ajudou a estagnar o ano. Diversificar reduz risco."})
    D["alertas"]=A; D["meta"]["sazonalidade_idx"]=sidx

    conn.close()
    return D

def _jdef(o):
    import decimal, datetime as _dt
    if isinstance(o, decimal.Decimal): return float(o)
    if isinstance(o, (_dt.date, _dt.datetime)): return str(o)
    raise TypeError(str(type(o)))

def encrypt(D):
    data=json.dumps(D,ensure_ascii=False,separators=(",",":"),default=_jdef).encode()
    salt,iv=os.urandom(16),os.urandom(12)
    key=PBKDF2HMAC(algorithm=hashes.SHA256(),length=32,salt=salt,iterations=ITER).derive(BI_PWD.encode())
    ct=AESGCM(key).encrypt(iv,data,None)
    env={"v":1,"kdf":"PBKDF2-SHA256","iter":ITER,"salt":base64.b64encode(salt).decode(),
         "iv":base64.b64encode(iv).decode(),"ct":base64.b64encode(ct).decode()}
    os.makedirs(os.path.dirname(OUT_ENC),exist_ok=True)
    json.dump(env,open(OUT_ENC,"w"),separators=(",",":"))
    print(f"OK -> dashboard.enc ({round(os.path.getsize(OUT_ENC)/1024,1)} KB) · fat_l12={D['kpis']['faturamento_l12']:.0f} · clientes={D['kpis']['clientes_ativos_l12']} · churn={D['churn']['total_sumidos']}")

if __name__=="__main__":
    last=None
    for attempt in range(1,4):
        try:
            encrypt(build()); break
        except pymysql.err.OperationalError as e:
            last=e; print(f"tentativa {attempt} falhou ({e}); retry em 20s"); time.sleep(20)
    else:
        raise last
