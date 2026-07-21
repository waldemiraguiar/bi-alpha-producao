#!/usr/bin/env python3
"""Robô de nuvem do AGENTE CRM — MATRIZ  (frota "Agentes de IA Alpha").

Reusa build_financeiro.build() (a MESMA consulta ao MySQL operacional) e monta a
visão de MOVIMENTAÇÃO DE CLIENTES *sem nenhum valor R$* — pronta para o time
comercial: reativar, em queda, parados, novos esfriando, em alta, carteira.

Os sparklines são NORMALIZADOS (0..100 = só a forma da tendência), nunca expõem
faturamento. Tier/R$ ficam de fora — a priorização usa recência + magnitude da
variação.  Cifra (AES-256-GCM, senha do time CRM) -> site_crm/data/crm.enc.

Env: MYSQL_*, BI_PWD (exigido por build_financeiro), CRM_PWD (cifra a saída CRM)."""
import os, json, base64, datetime, time
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT_ENC = os.path.join(ROOT, "site_crm", "data", "crm.enc")
ITER = 250_000
CRM_PWD = os.environ.get("CRM_PWD", "")


def spark(sem):
    """semanas (R$) cronológico -> shape 0..100 (esconde o valor, mostra a tendência)."""
    sem = list(sem or [])
    if not sem:
        return [0, 0, 0, 0, 0]
    m = max(sem)
    if m <= 0:
        return [0] * len(sem)
    return [round(100 * v / m) for v in sem]


def crm_from(D):
    """Transforma o dataset financeiro (com R$) na visão CRM (sem R$)."""
    radar = D.get("radar", []) or []
    perd = D.get("perdidos", {}) or {}
    nv = D.get("novos", {}) or {}
    tiers = D.get("tiers", []) or []

    sumidos = perd.get("sumidos", []) or []
    queda_forte_src = perd.get("queda", []) or []
    down = [x for x in radar if x.get("flag") == "down"]
    up = [x for x in radar if x.get("flag") == "up"]
    novos_all = (nv.get("recem", []) or []) + (nv.get("maturando", []) or [])
    esfri = sorted([x for x in novos_all if x.get("esfriando")],
                   key=lambda x: -(x.get("dias_inativo") or 0))
    novos_ok = sorted([x for x in novos_all if not x.get("esfriando")],
                      key=lambda x: -(x.get("dias_cad") or 0))

    def base(x):
        return {"cod": x.get("cod"), "nome": x.get("nome") or ("#" + str(x.get("cod"))),
                "cidade": x.get("cidade") or "—", "uf": x.get("uf")}

    def mov(x):  # item tipo radar
        b = base(x)
        b.update({"delta": x.get("delta"), "flag": x.get("flag"),
                  "spark": spark(x.get("semanas")), "dias_inativo": x.get("dias_inativo")})
        return b

    def calc_delta(x, existing, stop=False):
        """Garante um % útil para a fila. Se já há variação significativa, mantém.
        Senão, calcula a queda vs as semanas anteriores; cliente zerado que tinha
        histórico (parado/esfriando) = parou totalmente -> -100%."""
        if existing not in (None, 0):
            return existing
        sem = x.get("semanas") or []
        if len(sem) >= 2:
            atual = sem[-1]; base = sum(sem[:-1]) / max(1, len(sem) - 1)
            if base > 0:
                return round(100 * (atual - base) / base, 1)
        return -100.0 if stop else existing

    em_queda = [{**mov(x), "motivo": "queda"} for x in down]
    em_alta = [{**mov(x), "motivo": "alta"} for x in up]
    parados = [{**base(x), "dias_inativo": x.get("dias_inativo"), "ultima": x.get("ultima"),
                "delta": calc_delta(x, x.get("delta"), stop=True), "spark": spark(x.get("semanas")), "motivo": "parado"}
               for x in sumidos]
    qforte = [{**base(x), "delta": x.get("delta"), "dias_inativo": x.get("dias_inativo"),
               "ultima": x.get("ultima"), "spark": spark(x.get("semanas")), "motivo": "queda_forte"}
              for x in queda_forte_src]
    novos_esfri = [{**base(x), "dias_inativo": x.get("dias_inativo"), "dias_cad": x.get("dias_cad"),
                    "delta": calc_delta(x, None, stop=True), "spark": spark(x.get("semanas")), "motivo": "novo_esfriando"} for x in esfri]
    novos = [{**base(x), "dias_cad": x.get("dias_cad"), "spark": spark(x.get("semanas")),
              "motivo": "novo"} for x in novos_ok[:40]]

    # ---- REATIVAR: fila acionável única (dedupe por cliente, ordenada por prioridade) ----
    RANK = {"parado": 0, "queda_forte": 1, "queda": 2, "novo_esfriando": 3}
    LABEL = {"parado": "Parado", "queda_forte": "Queda forte",
             "queda": "Em queda", "novo_esfriando": "Novo esfriando"}
    pool = parados + qforte + em_queda + novos_esfri
    seen = set(); reativar = []
    for x in sorted(pool, key=lambda x: (RANK.get(x["motivo"], 9),
                                         -(x.get("dias_inativo") or 0),
                                         -abs(x.get("delta") or 0))):
        if x["cod"] in seen:
            continue
        seen.add(x["cod"])
        di = x.get("dias_inativo"); dl = abs(x.get("delta") or 0)
        m = x["motivo"]
        if m == "parado":
            acao = f"Ligar — sem enviar há {di}d" if di is not None else "Ligar — cliente parado"
        elif m == "queda_forte":
            acao = f"Contato urgente — caiu {round(dl)}%"
        elif m == "queda":
            acao = f"Acompanhar — caiu {round(dl)}%"
        else:
            acao = f"Engajar novo — parou há {di}d" if di is not None else "Engajar cliente novo"
        reativar.append({**x, "prioridade": LABEL[m], "acao": acao})

    # ---- CARTEIRA ativa (sem R$): nome/cidade/variação/tendência/situação ----
    paradoset = {p["cod"] for p in parados}
    carteira = []
    for x in tiers:
        sit = ("parado" if x.get("cod") in paradoset else
               "alta" if x.get("flag") == "up" else
               "queda" if x.get("flag") == "down" else "estável")
        carteira.append({**base(x), "delta": x.get("delta"), "flag": x.get("flag"),
                         "spark": spark(x.get("semanas")), "situacao": sit})

    resumo = {"reativar": len(reativar), "em_queda": len(em_queda), "em_alta": len(em_alta),
              "parados": len(parados), "queda_forte": len(qforte),
              "novos_esfriando": len(novos_esfri), "novos": len(novos),
              "carteira": len(carteira),
              "ativos": (D.get("kpis", {}) or {}).get("clientes_ativos_l12")}

    meta = D.get("meta", {}) or {}
    return {
        "meta": {"gerado_em": meta.get("gerado_em"), "max_data": meta.get("max_data"),
                 "fonte": "MySQL bi_alpha (nuvem) · Agente CRM",
                 "periodo": "última semana vs média das 4 anteriores (±10%)"},
        "resumo": resumo, "reativar": reativar, "em_queda": em_queda, "em_alta": em_alta,
        "parados": parados, "queda_forte": qforte, "novos_esfriando": novos_esfri,
        "novos": novos, "carteira": carteira,
    }


def _jdef(o):
    import decimal, datetime as _dt
    if isinstance(o, decimal.Decimal):
        return float(o)
    if isinstance(o, (_dt.date, _dt.datetime)):
        return str(o)
    raise TypeError(str(type(o)))


def encrypt(D2, pwd=None, out=OUT_ENC):
    pwd = pwd or CRM_PWD
    if not pwd:
        raise SystemExit("CRM_PWD não definido (senha do time CRM para cifrar).")
    data = json.dumps(D2, ensure_ascii=False, separators=(",", ":"), default=_jdef).encode()
    salt, iv = os.urandom(16), os.urandom(12)
    key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITER).derive(pwd.encode())
    ct = AESGCM(key).encrypt(iv, data, None)
    env = {"v": 1, "kdf": "PBKDF2-SHA256", "iter": ITER, "salt": base64.b64encode(salt).decode(),
           "iv": base64.b64encode(iv).decode(), "ct": base64.b64encode(ct).decode()}
    os.makedirs(os.path.dirname(out), exist_ok=True)
    json.dump(env, open(out, "w"), separators=(",", ":"))
    r = D2["resumo"]
    print(f"OK -> {os.path.basename(out)} ({round(os.path.getsize(out)/1024,1)} KB) · "
          f"reativar={r['reativar']} · parados={r['parados']} · em_queda={r['em_queda']} · "
          f"em_alta={r['em_alta']} · novos_esfriando={r['novos_esfriando']}")


def post_snapshot(D2):
    """Grava a foto da semana ISO no histórico (/api/crm-history) — upsert idempotente por semana.
    Resolve o dado vivo: a cada 6h regrava a semana corrente; quando ela fecha, congela."""
    import urllib.request, time, datetime
    pwd = CRM_PWD
    if not pwd:
        return
    base = os.environ.get("CRM_BASE", "https://agente-crm-matriz.netlify.app").rstrip("/")
    iso = (datetime.date.today() - datetime.timedelta(days=7)).isocalendar()  # última semana completa
    week = f"{iso[0]}-W{int(iso[1]):02d}"
    flagged, seen = [], set()
    for x in D2.get("reativar", []):
        flagged.append({"cod": x.get("cod"), "nome": x.get("nome"), "cidade": x.get("cidade"),
                        "motivo": x.get("motivo"), "delta": x.get("delta")})
        seen.add(x.get("cod"))
    for x in D2.get("em_alta", []):
        if x.get("cod") not in seen:
            flagged.append({"cod": x.get("cod"), "nome": x.get("nome"), "cidade": x.get("cidade"),
                            "motivo": "alta", "delta": x.get("delta")})
    snap = {"week": week, "ts": int(time.time() * 1000),
            "label": datetime.date.fromisocalendar(iso[0], int(iso[1]), 1).isoformat(),
            "counts": D2.get("resumo", {}), "flagged": flagged}
    try:
        payload = json.dumps({"week": week, "snapshot": snap, "senha": pwd}).encode()
        r = urllib.request.urlopen(urllib.request.Request(
            base + "/api/crm-history", data=payload, headers={"Content-Type": "application/json"}), timeout=30)
        print(f"snapshot {week} -> HTTP {r.status} ({len(flagged)} clientes)")
    except Exception as e:
        print(f"snapshot {week} falhou (ok, tenta no próximo ciclo): {e}")


def post_clinicas_rs(D):
    """R$ por clínica CIFRADO só p/ diretoria: cifra {cod: fat} com a chave derivada do CÓDIGO DA DIRETORIA
    (AES-256-GCM + PBKDF2-SHA256) e manda o env pro /api/crm-clinicas-rs. Reps não têm o código → nunca veem R$."""
    import urllib.request
    pwd = CRM_PWD
    dir_code = os.environ.get("FIN_KEY", "")   # SENHA FINANCEIRA (só diretoria) — separada do código do desmarcou
    full = (D or {}).get("clinicas_full") or []
    if not pwd or not dir_code or not full:
        print("post_clinicas_rs: pulado (falta CRM_PWD/FIN_KEY/dados)")
        return
    rsmap = {str(c.get("cod")): round(c.get("fat") or 0, 2) for c in full if c.get("cod") is not None}
    # R$ da carteira: marco zero (desde) + soma dos CÓDIGOS-EXTRA no principal (Faro: 989898 + 5724)
    desde = {}; fatmes = {}
    try:
        import urllib.request as _u
        base0 = os.environ.get("CRM_BASE", "https://agente-crm-matriz.netlify.app").rstrip("/")
        cart = json.loads(_u.urlopen(_u.Request(base0 + "/api/crm-carteira?_=" + str(int(time.time())), headers={"User-Agent": "robo"}), timeout=30).read().decode()).get("carteira", [])
        since_map, alias, extras = {}, {}, []
        for c in cart:
            p = c.get("cod")
            if not p: continue
            if c.get("reconq_data"): since_map[str(p)] = c.get("reconq_data")
            for e in (c.get("cods_extra") or []):
                e = str(e).strip()
                if e: alias[e] = str(p); extras.append(e)
        from build_financeiro import clinic_fat_since, clinic_fat_12m, clinic_fat_mensal
        if since_map:
            desde = clinic_fat_since(since_map, alias)
            fatmes = clinic_fat_mensal(since_map, alias)   # dinheiro mês a mês desde o marco zero (cifrado, diretoria)
        # soma o 12m dos códigos-extra (órfãos) no principal, pra o R$ 12m também ficar certo
        if extras:
            ex12 = clinic_fat_12m(extras)
            for e, p in alias.items():
                if ex12.get(e):
                    rsmap[p] = round(rsmap.get(p, 0) + ex12[e], 2)
    except Exception as e:
        print(f"post_clinicas_rs: R$ desde/extra pulado ({e})")
    data = json.dumps({"fat": rsmap, "desde": desde, "fatmes": fatmes}, ensure_ascii=False, separators=(",", ":")).encode()
    salt, iv = os.urandom(16), os.urandom(12)
    key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITER).derive(dir_code.encode())
    ct = AESGCM(key).encrypt(iv, data, None)
    env = {"v": 1, "kdf": "PBKDF2-SHA256", "iter": ITER, "salt": base64.b64encode(salt).decode(),
           "iv": base64.b64encode(iv).decode(), "ct": base64.b64encode(ct).decode()}
    base = os.environ.get("CRM_BASE", "https://agente-crm-matriz.netlify.app").rstrip("/")
    try:
        payload = json.dumps({"acao": "set", "env": env, "senha": pwd}).encode()
        r = urllib.request.urlopen(urllib.request.Request(
            base + "/api/crm-clinicas-rs", data=payload, headers={"Content-Type": "application/json"}), timeout=45)
        print(f"clinicas R$ (cifrado) -> HTTP {r.status} ({len(rsmap)} clínicas)")
    except Exception as e:
        print(f"post_clinicas_rs falhou (ok, tenta no próximo ciclo): {e}")

def post_clinicas_det():
    """Detalhe (setores/white-space + produção 30d/7d) SÓ das clínicas da carteira → /api/crm-clinicas-det.
    SEM R$. Puxa a carteira (função pública) e consulta o MySQL só p/ esses CodCliente."""
    import urllib.request
    pwd = CRM_PWD
    if not pwd:
        return
    base = os.environ.get("CRM_BASE", "https://agente-crm-matriz.netlify.app").rstrip("/")
    try:
        req = urllib.request.Request(base + "/api/crm-carteira?_=" + str(int(time.time())), headers={"User-Agent": "robo"})
        carteira = json.loads(urllib.request.urlopen(req, timeout=30).read().decode()).get("carteira", [])
    except Exception as e:
        print(f"post_clinicas_det: não li a carteira ({e})"); return
    # códigos: principal + CÓDIGOS-EXTRA (mesma clínica com mais de um cadastro no HF, ex.: Faro Animal 989898+5724)
    cods, alias = [], {}
    for c in carteira:
        p = c.get("cod")
        if not p: continue
        cods.append(str(p))
        for e in (c.get("cods_extra") or []):
            e = str(e).strip()
            if e: cods.append(e); alias[e] = str(p)
    if not cods:
        print("post_clinicas_det: carteira sem clínicas vinculadas — pulado"); return
    # MARCO ZERO por clínica: produção conta a partir da data de reconquista (reconq_data) — não do começo
    since_map = {c.get("cod"): c.get("reconq_data") for c in carteira if c.get("cod") and c.get("reconq_data")}
    from build_financeiro import clinic_details
    res = clinic_details(cods, since_map, alias)
    try:
        payload = json.dumps({"acao": "set", "det": res["det"], "setores": res["setores"], "senha": pwd}).encode()
        r = urllib.request.urlopen(urllib.request.Request(
            base + "/api/crm-clinicas-det", data=payload, headers={"Content-Type": "application/json"}), timeout=45)
        print(f"clinicas detalhe -> HTTP {r.status} ({len(res['det'])} clínicas · {len(res['setores'])} setores)")
    except Exception as e:
        print(f"post_clinicas_det falhou (ok, tenta no próximo ciclo): {e}")

def post_aaa(D):
    """CLÍNICAS TRIPLO A: top faturamento 12m (curva A) + share-of-wallet 12m → /api/crm-aaa. SEM R$ no payload
    (só qtd + categorias; o R$ 12m já vai no cifrado da diretoria). Traz sozinho — sem input manual."""
    import urllib.request
    pwd = CRM_PWD
    full = (D or {}).get("clinicas_full") or []
    if not pwd or not full:
        print("post_aaa: pulado (falta CRM_PWD/clinicas_full)"); return
    try:
        from build_financeiro import clinics_aaa
        res = clinics_aaa(full, corte_a=0.80, corte_b=0.95, cap=180)   # curva A (80%) + B (80–95%)
    except Exception as e:
        print(f"post_aaa: cálculo falhou ({e})"); return
    base = os.environ.get("CRM_BASE", "https://agente-crm-matriz.netlify.app").rstrip("/")
    try:
        payload = json.dumps({"acao": "set", "aaa": res["aaa"], "setores": res["setores"], "pct": res["pct"], "senha": pwd}, ensure_ascii=False).encode()
        r = urllib.request.urlopen(urllib.request.Request(
            base + "/api/crm-aaa", data=payload, headers={"Content-Type": "application/json"}), timeout=45)
        print(f"clinicas curva ABC -> HTTP {r.status} (A={res.get('nA')} · B={res.get('nB')} · {len(res['setores'])} setores)")
    except Exception as e:
        print(f"post_aaa falhou (ok, tenta no próximo ciclo): {e}")

def post_relatorio(D):
    """AUTOMÁTICO: grava a FOTO semanal do relatório de clínicas (SEM R$) a cada ciclo do robô — o histórico
    fica sempre atual sem ninguém pedir. Upsert por semana ISO. O e-mail com R$ continua saindo sexta 9h."""
    import urllib.request, datetime as _dt
    pwd = CRM_PWD
    if not pwd:
        return
    base = os.environ.get("CRM_BASE", "https://agente-crm-matriz.netlify.app").rstrip("/")
    def _get(path):
        req = urllib.request.Request(base + path + "?_=" + str(int(time.time())), headers={"User-Agent": "robo"})
        return json.loads(urllib.request.urlopen(req, timeout=30).read().decode())
    try:
        carteira = _get("/api/crm-carteira").get("carteira", [])
        DET = _get("/api/crm-clinicas-det").get("det", {}) or {}
    except Exception as e:
        print(f"post_relatorio: não li carteira/det ({e})"); return
    master = {str(c.get("cod")): int(c.get("qtd") or 0) for c in ((D or {}).get("clinicas_full") or [])}
    PORTE_BAIXA = 40
    nov = [x for x in carteira if x.get("tipo") != "reconquistada"]
    rec = [x for x in carteira if x.get("tipo") == "reconquistada"]
    flags, zerados, prod_total = [], [], 0
    for x in carteira:
        cod = str(x.get("cod")) if x.get("cod") else None
        prod = master.get(cod) if cod else None
        d = DET.get(cod) if cod else None
        falta = (d or {}).get("falta", []) or []
        recent = (d or {}).get("recent")
        prod_total += (prod or 0)
        concentrada = bool(d and len((d.get("cats") or [])) <= 1 and len(falta) >= 2)
        if (x.get("porte") == "G" and prod is not None and prod < PORTE_BAIXA) or concentrada:
            flags.append({"nome": x.get("nome", ""), "porte": x.get("porte", ""), "prod": prod})
        if cod and master.get(cod) is not None and isinstance(recent, list) and len(recent) == 0 and not (d or {}).get("prod30"):
            zerados.append({"nome": x.get("nome", ""), "cidade": x.get("cidade", ""), "porte": x.get("porte", ""), "marco": x.get("reconq_data", "")})
    hoje = _dt.date.today(); iso = hoje.isocalendar()
    item = {"id": f"{iso[0]}-W{int(iso[1]):02d}", "semana": f"{iso[0]}-W{int(iso[1]):02d}", "label": hoje.strftime("%d/%m/%Y"),
            "n_novas": len(nov), "n_reconq": len(rec), "prod_total": prod_total, "flags": flags, "zerados": zerados,
            "linhas": [{"nome": x.get("nome",""), "cidade": x.get("cidade",""), "tipo": x.get("tipo","nova"), "porte": x.get("porte","")} for x in carteira],
            "ts": int(time.time()) * 1000}
    try:
        payload = json.dumps({"acao": "save", "item": item, "senha": pwd}).encode()
        r = urllib.request.urlopen(urllib.request.Request(base + "/api/crm-relatorios", data=payload,
            headers={"Content-Type": "application/json"}), timeout=30)
        print(f"relatorio semanal (auto) {item['id']} -> HTTP {r.status} · {len(rec)}rec {len(nov)}nov {len(flags)}flags {len(zerados)}zeradas")
    except Exception as e:
        print(f"post_relatorio falhou (ok, tenta no próximo ciclo): {e}")

def post_clinicas(D):
    """Manda o MASTER de clínicas do HF (nome+cod+cidade+produção, SEM R$) p/ o autocomplete das abas
    Novas/Reconquistadas (/api/crm-clinicas). O R$ (fat) NÃO vai — fica gated p/ diretoria (Fase 3b)."""
    import urllib.request
    pwd = CRM_PWD
    full = (D or {}).get("clinicas_full") or []
    if not pwd or not full:
        return
    base = os.environ.get("CRM_BASE", "https://agente-crm-matriz.netlify.app").rstrip("/")
    clis = [{"cod": c.get("cod"), "nome": c.get("nome"), "cidade": c.get("cidade"), "prod": int(c.get("qtd") or 0)} for c in full]
    try:
        payload = json.dumps({"acao": "set", "clinicas": clis, "senha": pwd}).encode()
        r = urllib.request.urlopen(urllib.request.Request(
            base + "/api/crm-clinicas", data=payload, headers={"Content-Type": "application/json"}), timeout=45)
        print(f"clinicas master -> HTTP {r.status} ({len(clis)} clínicas)")
    except Exception as e:
        print(f"post_clinicas falhou (ok, tenta no próximo ciclo): {e}")

if __name__ == "__main__":
    from build_financeiro import build  # importado só na nuvem (precisa do MySQL)
    last = None
    for attempt in range(1, 4):
        try:
            D0 = build(); D2 = crm_from(D0); encrypt(D2); post_snapshot(D2); post_clinicas(D0); post_clinicas_rs(D0); post_clinicas_det(); post_aaa(D0); post_relatorio(D0); break
        except Exception as e:
            import pymysql
            if isinstance(e, pymysql.err.OperationalError):
                last = e; print(f"tentativa {attempt} falhou ({e}); retry em 20s"); time.sleep(20)
            else:
                raise
    else:
        raise last
