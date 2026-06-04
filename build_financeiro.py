#!/usr/bin/env python3
"""Robô de nuvem do painel FINANCEIRO/ADMIN (com R$). Consulta o MySQL,
monta os 19 blocos, cifra (AES-256-GCM, senha ADMIN) e grava site/data/dashboard.enc.
Sem estado: janela de ~13 meses + agregados históricos. Credenciais via env (Secrets)."""
import os, json, base64, sqlite3, datetime
import pymysql
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT_ENC = os.path.join(ROOT, "site", "data", "dashboard.enc")
ITER = 250_000
SRC = dict(host=os.environ["MYSQL_HOST"], user=os.environ["MYSQL_USER"],
           password=os.environ["MYSQL_PWD"], database=os.environ.get("MYSQL_DB","bi_alpha"),
           connect_timeout=20, read_timeout=400, charset="utf8mb4")
BI_PWD = os.environ["BI_PWD"]

def load():
    mem = sqlite3.connect(":memory:"); mc = mem.cursor()
    mc.executescript("""
      CREATE TABLE exame(tela INT,cat INT,exame TEXT,d TEXT,val REAL,desc REAL,urg INT,terc INT);
      CREATE TABLE req(tela INT PRIMARY KEY,cli INT,clinome TEXT,esp TEXT,sexo TEXT,raca TEXT);
      CREATE TABLE cliente(cod INT PRIMARY KEY,nome TEXT,cidade TEXT,uf TEXT);
      CREATE TABLE categoria(cod INT PRIMARY KEY,categoria TEXT,setor TEXT);
      CREATE TABLE histmensal(ym TEXT,qtd INT,fat REAL,reqs INT);
      CREATE TABLE clientelife(cod INT,primeira TEXT,ultima TEXT,fat_recente REAL);
    """)
    src = pymysql.connect(**SRC)
    cutoff = (datetime.date.today()-datetime.timedelta(days=400)).isoformat()
    # scan 1: exames janela (com R$)
    cur = src.cursor(pymysql.cursors.SSCursor)
    cur.execute("""SELECT CodNumeroSequencialTela,CodCategoria,Exame,DataExame,ValorExame,Desconto,Urgencia,Terceirizado
                   FROM TabExameNumeroSolicitado WHERE DataExame>=%s AND DataExame<='2026-12-31'""",(cutoff,))
    while True:
        rows=cur.fetchmany(20000)
        if not rows: break
        mc.executemany("INSERT INTO exame VALUES(?,?,?,?,?,?,?,?)",
                       [(r[0],r[1],r[2],str(r[3]) if r[3] else None,r[4] or 0,r[5] or 0,r[6],r[7]) for r in rows])
    cur.close()
    # scan 2: requisições janela
    cur = src.cursor(pymysql.cursors.SSCursor)
    cur.execute("""SELECT CodNumeroSequencialTela,CodCliente,Cliente,Especie,Sexo,Raça
                   FROM `TabExameNumeroRequisiçao` WHERE DataEntrada>=%s""",
                ((datetime.date.today()-datetime.timedelta(days=460)).isoformat(),))
    while True:
        rows=cur.fetchmany(20000)
        if not rows: break
        mc.executemany("INSERT OR REPLACE INTO req VALUES(?,?,?,?,?,?)",rows)
    cur.close()
    c2 = src.cursor()
    c2.execute("SELECT CodCliente,Cliente,Cidade,Uf FROM TabCliente")
    mc.executemany("INSERT OR REPLACE INTO cliente VALUES(?,?,?,?)",c2.fetchall())
    c2.execute("SELECT CodCategoria,Categoria,Setor FROM TabCategoria")
    mc.executemany("INSERT OR REPLACE INTO categoria VALUES(?,?,?)",c2.fetchall())
    # scan 3: histórico mensal (qtd, faturamento)
    c2.execute("SELECT DATE_FORMAT(DataExame,'%Y-%m') ym, COUNT(*) qtd, SUM(ValorExame) fat, "
               "COUNT(DISTINCT CodNumeroSequencialTela) reqs FROM TabExameNumeroSolicitado "
               "WHERE DataExame>='2014-01-01' AND DataExame<='2026-12-31' GROUP BY ym")
    mc.executemany("INSERT INTO histmensal VALUES(?,?,?,?)",c2.fetchall())
    # scan 4: vida do cliente (primeira/última/fat recente) — para novos e churn
    d548 = (datetime.date.today()-datetime.timedelta(days=548)).isoformat()
    c2.execute("SELECT r.CodCliente, MIN(s.DataExame), MAX(s.DataExame), "
               "SUM(CASE WHEN s.DataExame>=%s THEN s.ValorExame ELSE 0 END) "
               "FROM TabExameNumeroSolicitado s JOIN `TabExameNumeroRequisiçao` r "
               "ON s.CodNumeroSequencialTela=r.CodNumeroSequencialTela "
               "WHERE s.DataExame>='2014-01-01' AND s.DataExame<='2026-12-31' GROUP BY r.CodCliente",(d548,))
    mc.executemany("INSERT INTO clientelife VALUES(?,?,?,?)",
                   [(r[0],str(r[1]) if r[1] else None,str(r[2]) if r[2] else None,r[3] or 0) for r in c2.fetchall()])
    mem.commit()
    mc.executescript("CREATE INDEX ix1 ON exame(tela);CREATE INDEX ix2 ON exame(d);CREATE INDEX ix3 ON exame(cat);")
    src.close()
    return mem

def build(mem):
    mem.row_factory=sqlite3.Row; c=mem.cursor()
    def rows(sql,p=()): return [dict(r) for r in c.execute(sql,p).fetchall()]
    def one(sql,p=()):
        r=c.execute(sql,p).fetchone(); return r[0] if r else None
    SYS=datetime.date.today().isoformat()
    maxd=one("SELECT MAX(d) FROM exame WHERE d<=?",(SYS,)) or SYS
    tdt=datetime.date.fromisoformat(maxd); ref=tdt.replace(day=1)
    L12i=(ref-datetime.timedelta(days=365)).isoformat(); L12f=(ref-datetime.timedelta(days=1)).isoformat()
    seis=(ref-datetime.timedelta(days=183)).isoformat()

    D={"meta":{"gerado_em":datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M")+" UTC",
       "fonte":"MySQL bi_alpha (nuvem)","max_data":maxd,"janela12_ini":L12i,"janela12_fim":L12f,
       "obs_financeiro":"Recebimento, custo e status de pagamento NÃO disponíveis nesta réplica — valores referem-se a FATURAMENTO (valor cobrado)."}}

    # KPIs
    tot_fat=one("SELECT SUM(fat) FROM histmensal"); tot_ex=one("SELECT SUM(qtd) FROM histmensal")
    ex25=one("SELECT SUM(qtd) FROM histmensal WHERE ym LIKE '2025-%'"); fat25=one("SELECT SUM(fat) FROM histmensal WHERE ym LIKE '2025-%'")
    ex_l12=one("SELECT COUNT(*) FROM exame WHERE d BETWEEN ? AND ?",(L12i,L12f))
    fat_l12=one("SELECT SUM(val) FROM exame WHERE d BETWEEN ? AND ?",(L12i,L12f))
    req_l12=one("SELECT COUNT(DISTINCT tela) FROM exame WHERE d BETWEEN ? AND ?",(L12i,L12f))
    cli_ativos=one("SELECT COUNT(DISTINCT r.cli) FROM exame e JOIN req r ON e.tela=r.tela WHERE e.d BETWEEN ? AND ?",(L12i,L12f))
    cli_total=one("SELECT COUNT(*) FROM cliente")
    D["kpis"]={"total_exames":tot_ex,"total_faturamento":round(tot_fat or 0,2),
      "ticket_medio_exame":round((tot_fat or 0)/tot_ex,2) if tot_ex else 0,
      "exames_2025":ex25,"faturamento_2025":round(fat25 or 0,2),
      "exames_l12":ex_l12,"faturamento_l12":round(fat_l12 or 0,2),
      "clientes_ativos_l12":cli_ativos,"clientes_total":cli_total,"requisicoes_l12":req_l12,
      "exames_por_req_l12":round(ex_l12/req_l12,2) if req_l12 else 0,
      "ticket_medio_req_l12":round((fat_l12 or 0)/req_l12,2) if req_l12 else 0}

    D["mensal"]=rows("SELECT ym, qtd, ROUND(fat,2) fat, reqs FROM histmensal WHERE ym>='2019-01' ORDER BY ym")
    # anual + yoy
    agg={}
    for h in rows("SELECT ym,qtd,fat FROM histmensal"):
        if not h["ym"]: continue
        y=h["ym"][:4]; a=agg.setdefault(y,{"ano":y,"qtd":0,"fat":0.0}); a["qtd"]+=h["qtd"]; a["fat"]+=h["fat"] or 0
    anual=[{"ano":y,"qtd":agg[y]["qtd"],"fat":round(agg[y]["fat"],2)} for y in sorted(agg) if y>='2014']
    prev=None
    for a in anual:
        a["yoy_fat"]=round(100*(a["fat"]-prev["fat"])/prev["fat"],1) if prev and prev["fat"] else None
        a["yoy_qtd"]=round(100*(a["qtd"]-prev["qtd"])/prev["qtd"],1) if prev and prev["qtd"] else None
        prev=a
    D["anual"]=anual
    # sazonalidade (2022-2025) a partir do histórico mensal
    saz={}
    for h in rows("SELECT ym,qtd,fat FROM histmensal WHERE ym>='2022-01' AND ym<='2025-12'"):
        if not h["ym"]: continue
        m=h["ym"][5:7]; s=saz.setdefault(m,{"mes":m,"qs":[],"fs":[]}); s["qs"].append(h["qtd"]); s["fs"].append(h["fat"] or 0)
    D["sazonalidade"]=[{"mes":m,"media_qtd":round(sum(saz[m]["qs"])/len(saz[m]["qs"])),
                        "media_fat":round(sum(saz[m]["fs"])/len(saz[m]["fs"]),2)} for m in sorted(saz)]

    # top clientes 12m
    tc=rows("""SELECT r.cli cod, COALESCE(cl.nome,r.clinome) nome, cl.cidade Cidade, cl.uf Uf,
      COUNT(*) qtd, ROUND(SUM(e.val),2) fat FROM exame e JOIN req r ON e.tela=r.tela
      LEFT JOIN cliente cl ON r.cli=cl.cod WHERE e.d BETWEEN ? AND ? GROUP BY r.cli ORDER BY fat DESC LIMIT 30""",(L12i,L12f))
    for i,t in enumerate(tc,1): t["rank"]=i; t["ticket"]=round(t["fat"]/t["qtd"],2) if t["qtd"] else 0
    D["top_clientes"]=tc
    # concentração
    allc=rows("""SELECT r.cli cod, SUM(e.val) fat FROM exame e JOIN req r ON e.tela=r.tela
      WHERE e.d BETWEEN ? AND ? GROUP BY r.cli ORDER BY fat DESC""",(L12i,L12f))
    totc=sum(x["fat"] or 0 for x in allc) or 1
    sh=lambda n: round(100*sum((x["fat"] or 0) for x in allc[:n])/totc,1)
    step=max(1,len(allc)//40)
    D["concentracao"]={"n_clientes":len(allc),"fat_total":round(totc,2),
      "top10_pct":sh(10),"top20_pct":sh(20),"top50_pct":sh(50),"top100_pct":sh(100),
      "pareto":[{"cliente_pct":round(100*(i+1)/len(allc),1),
                 "fat_acum_pct":round(100*sum((x["fat"] or 0) for x in allc[:i+1])/totc,1)}
                for i in range(0,len(allc),step)][:41]}
    # novos clientes por mês (primeira requisição) desde 2021
    nv={}
    for r in rows("SELECT primeira FROM clientelife WHERE primeira>='2021-01-01'"):
        ym=r["primeira"][:7]; nv[ym]=nv.get(ym,0)+1
    D["novos_clientes"]=[{"ym":k,"novos":nv[k]} for k in sorted(nv)]
    # churn
    cl_by={r["cod"]:r for r in rows("SELECT cod,nome,cidade,uf FROM cliente")}
    churn=[]
    for r in rows("SELECT cod,ultima,fat_recente FROM clientelife WHERE ultima<? AND fat_recente>0 ORDER BY fat_recente DESC LIMIT 40",(seis,)):
        info=cl_by.get(r["cod"],{})
        churn.append({"cod":r["cod"],"nome":info.get("nome"),"Cidade":info.get("cidade"),"Uf":info.get("uf"),
                      "ultima":r["ultima"],"fat_ult_ano":round(r["fat_recente"],2)})
    D["churn"]={"corte_inatividade":seis,"clientes":churn,"total_sumidos":len(churn)}

    D["mix_exames_fat"]=rows("""SELECT exame Exame, COUNT(*) qtd, ROUND(SUM(val),2) fat, ROUND(AVG(val),2) ticket
      FROM exame WHERE d BETWEEN ? AND ? AND exame IS NOT NULL AND exame<>'' GROUP BY exame ORDER BY fat DESC LIMIT 25""",(L12i,L12f))
    D["mix_exames_vol"]=rows("""SELECT exame Exame, COUNT(*) qtd, ROUND(SUM(val),2) fat
      FROM exame WHERE d BETWEEN ? AND ? AND exame IS NOT NULL AND exame<>'' GROUP BY exame ORDER BY qtd DESC LIMIT 25""",(L12i,L12f))
    D["categorias"]=rows("""SELECT COALESCE(cat.categoria,'(sem categoria)') categoria, COALESCE(cat.setor,'-') setor,
      COUNT(*) qtd, ROUND(SUM(e.val),2) fat FROM exame e LEFT JOIN categoria cat ON e.cat=cat.cod
      WHERE e.d BETWEEN ? AND ? GROUP BY e.cat ORDER BY fat DESC""",(L12i,L12f))
    D["setores"]=rows("""SELECT COALESCE(cat.setor,'(sem setor)') setor, COUNT(*) qtd, ROUND(SUM(e.val),2) fat
      FROM exame e LEFT JOIN categoria cat ON e.cat=cat.cod WHERE e.d BETWEEN ? AND ? GROUP BY cat.setor ORDER BY fat DESC""",(L12i,L12f))
    D["especies"]=rows("""SELECT UPPER(TRIM(COALESCE(r.esp,'(não informado)'))) especie, COUNT(*) qtd, ROUND(SUM(e.val),2) fat
      FROM exame e JOIN req r ON e.tela=r.tela WHERE e.d BETWEEN ? AND ? GROUP BY especie ORDER BY qtd DESC LIMIT 15""",(L12i,L12f))
    D["sexos"]=rows("""SELECT UPPER(TRIM(COALESCE(r.sexo,'(n/i)'))) sexo, COUNT(*) qtd
      FROM exame e JOIN req r ON e.tela=r.tela WHERE e.d BETWEEN ? AND ? GROUP BY sexo ORDER BY qtd DESC LIMIT 8""",(L12i,L12f))
    D["racas"]=rows("""SELECT UPPER(TRIM(COALESCE(r.raca,'(n/i)'))) raca, COUNT(*) qtd
      FROM exame e JOIN req r ON e.tela=r.tela WHERE e.d BETWEEN ? AND ? AND r.raca IS NOT NULL AND TRIM(r.raca)<>''
      GROUP BY raca ORDER BY qtd DESC LIMIT 15""",(L12i,L12f))
    D["uf"]=rows("""SELECT UPPER(TRIM(COALESCE(cl.uf,'(n/i)'))) uf, COUNT(*) qtd, ROUND(SUM(e.val),2) fat,
      COUNT(DISTINCT r.cli) clientes FROM exame e JOIN req r ON e.tela=r.tela LEFT JOIN cliente cl ON r.cli=cl.cod
      WHERE e.d BETWEEN ? AND ? GROUP BY uf ORDER BY fat DESC LIMIT 15""",(L12i,L12f))
    D["cidades"]=rows("""SELECT TRIM(COALESCE(cl.cidade,'(n/i)')) cidade, UPPER(TRIM(COALESCE(cl.uf,''))) uf,
      COUNT(*) qtd, ROUND(SUM(e.val),2) fat, COUNT(DISTINCT r.cli) clientes
      FROM exame e JOIN req r ON e.tela=r.tela LEFT JOIN cliente cl ON r.cli=cl.cod
      WHERE e.d BETWEEN ? AND ? GROUP BY cl.cidade, cl.uf ORDER BY fat DESC LIMIT 20""",(L12i,L12f))
    desc_n=one("SELECT COUNT(*) FROM exame WHERE d BETWEEN ? AND ? AND desc>0",(L12i,L12f))
    desc_v=one("SELECT SUM(desc) FROM exame WHERE d BETWEEN ? AND ?",(L12i,L12f))
    urg=one("SELECT COUNT(*) FROM exame WHERE d BETWEEN ? AND ? AND urg=1",(L12i,L12f))
    terc=one("SELECT COUNT(*) FROM exame WHERE d BETWEEN ? AND ? AND terc=1",(L12i,L12f))
    D["operacional"]={"exames_com_desconto":desc_n,"valor_desconto_total":round(desc_v or 0,2),
      "pct_com_desconto":round(100*desc_n/ex_l12,2) if ex_l12 else 0,
      "exames_urgencia":urg,"pct_urgencia":round(100*urg/ex_l12,2) if ex_l12 else 0,
      "exames_terceirizados":terc,"pct_terceirizado":round(100*terc/ex_l12,2) if ex_l12 else 0}
    return D

def encrypt(D):
    data=json.dumps(D,ensure_ascii=False,separators=(",",":")).encode()
    salt,iv=os.urandom(16),os.urandom(12)
    key=PBKDF2HMAC(algorithm=hashes.SHA256(),length=32,salt=salt,iterations=ITER).derive(BI_PWD.encode())
    ct=AESGCM(key).encrypt(iv,data,None)
    env={"v":1,"kdf":"PBKDF2-SHA256","iter":ITER,"salt":base64.b64encode(salt).decode(),
         "iv":base64.b64encode(iv).decode(),"ct":base64.b64encode(ct).decode()}
    os.makedirs(os.path.dirname(OUT_ENC),exist_ok=True)
    json.dump(env,open(OUT_ENC,"w"),separators=(",",":"))
    print(f"OK -> dashboard.enc ({round(os.path.getsize(OUT_ENC)/1024,1)} KB) · fat_l12={D['kpis']['faturamento_l12']:.0f} · clientes={D['kpis']['clientes_ativos_l12']}")

if __name__=="__main__":
    encrypt(build(load()))
