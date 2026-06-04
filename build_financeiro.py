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
    D["mensal"] = [{"ym":h["ym"],"qtd":h["qtd"],"fat":round(h["fat"] or 0,2),"reqs":h["reqs"]} for h in hist if h["ym"]>='2019-01']
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
