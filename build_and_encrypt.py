#!/usr/bin/env python3
"""Robô de nuvem (GitHub Actions): consulta o MySQL operacional, monta o dataset
de PRODUÇÃO (somente volume, zero R$), cifra (AES-256-GCM) e grava site_prod/data/producao.enc.
Sem estado local: usa poucas leituras (janela de ~13 meses + 1 agregado histórico).
Credenciais vêm de variáveis de ambiente (GitHub Secrets)."""
import os, json, base64, sqlite3, datetime, calendar, sys
import pymysql
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT_ENC = os.path.join(ROOT, "site_prod", "data", "producao.enc")
ITER = 250_000

SRC = dict(host=os.environ["MYSQL_HOST"], user=os.environ["MYSQL_USER"],
           password=os.environ["MYSQL_PWD"], database=os.environ.get("MYSQL_DB", "bi_alpha"),
           connect_timeout=20, read_timeout=300, charset="utf8mb4")
PROD_PWD = os.environ["PROD_PWD"]

# ---------- 1) puxa do MySQL para SQLite em memória (poucas leituras) ----------
def load_memory():
    mem = sqlite3.connect(":memory:"); mc = mem.cursor()
    mc.executescript("""
      CREATE TABLE exame(tela INT, cat INT, exame TEXT, d TEXT, urg INT);
      CREATE TABLE req(tela INT PRIMARY KEY, cli INT, clinome TEXT, esp TEXT);
      CREATE TABLE cliente(cod INT PRIMARY KEY, nome TEXT, cidade TEXT);
      CREATE TABLE categoria(cod INT PRIMARY KEY, categoria TEXT, setor TEXT);
      CREATE TABLE histmensal(ym TEXT, q INT, reqs INT);
    """)
    src = pymysql.connect(**SRC)
    # janela: hoje - 400 dias (cobre 12m + mês atual + 45 dias)
    cutoff = (datetime.date.today() - datetime.timedelta(days=400)).isoformat()
    cur = src.cursor(pymysql.cursors.SSCursor)
    # scan 1: exames da janela
    cur.execute("""SELECT CodNumeroSequencialTela,CodCategoria,Exame,DataExame,Urgencia
                   FROM TabExameNumeroSolicitado
                   WHERE DataExame >= %s AND DataExame <= '2026-12-31'""", (cutoff,))
    while True:
        rows = cur.fetchmany(20000)
        if not rows: break
        mc.executemany("INSERT INTO exame VALUES(?,?,?,?,?)",
                       [(r[0], r[1], r[2], str(r[3]) if r[3] else None, r[4]) for r in rows])
    cur.close()
    # scan 2: requisições da janela (para espécie/cliente)
    cur = src.cursor(pymysql.cursors.SSCursor)
    cur.execute("""SELECT CodNumeroSequencialTela,CodCliente,Cliente,Especie
                   FROM `TabExameNumeroRequisiçao`
                   WHERE DataEntrada >= %s""", ((datetime.date.today()-datetime.timedelta(days=460)).isoformat(),))
    while True:
        rows = cur.fetchmany(20000)
        if not rows: break
        mc.executemany("INSERT OR REPLACE INTO req VALUES(?,?,?,?)", rows)
    cur.close()
    # dims
    c2 = src.cursor()
    c2.execute("SELECT CodCliente,Cliente,Cidade FROM TabCliente")
    mc.executemany("INSERT OR REPLACE INTO cliente VALUES(?,?,?)", c2.fetchall())
    c2.execute("SELECT CodCategoria,Categoria,Setor FROM TabCategoria")
    mc.executemany("INSERT OR REPLACE INTO categoria VALUES(?,?,?)", c2.fetchall())
    # scan 3: histórico mensal (volume) desde 2014
    c2.execute("SELECT DATE_FORMAT(DataExame,'%Y-%m') ym, COUNT(*) q, "
               "COUNT(DISTINCT CodNumeroSequencialTela) reqs "
               "FROM TabExameNumeroSolicitado "
               "WHERE DataExame >= '2014-01-01' AND DataExame <= '2026-12-31' GROUP BY ym")
    mc.executemany("INSERT INTO histmensal VALUES(?,?,?)", c2.fetchall())
    mem.commit()
    mc.executescript("CREATE INDEX ix1 ON exame(tela); CREATE INDEX ix2 ON exame(d); CREATE INDEX ix3 ON exame(cat);")
    src.close()
    return mem

# ---------- 2) monta blocos (igual ao painel local) ----------
def build(mem):
    mem.row_factory = sqlite3.Row; c = mem.cursor()
    def rows(sql,p=()): return [dict(r) for r in c.execute(sql,p).fetchall()]
    def one(sql,p=()):
        r=c.execute(sql,p).fetchone(); return r[0] if r else None
    SYS_TODAY = datetime.date.today().isoformat()
    today = one("SELECT MAX(d) FROM exame WHERE d <= ?", (SYS_TODAY,)) or SYS_TODAY
    tdt = datetime.date.fromisoformat(today)
    mes_ini = tdt.replace(day=1).isoformat()
    ref = tdt.replace(day=1)
    L12i = (ref-datetime.timedelta(days=365)).isoformat(); L12f=(ref-datetime.timedelta(days=1)).isoformat()
    ontem = (tdt-datetime.timedelta(days=1)).isoformat()
    d45 = (tdt-datetime.timedelta(days=44)).isoformat()

    D={"meta":{"gerado_em":datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")+" UTC","hoje":today,
               "obs":"Painel de produção — somente volume. Sem valores financeiros."}}
    ex_hoje=one("SELECT COUNT(*) FROM exame WHERE d=?",(today,))
    req_hoje=one("SELECT COUNT(DISTINCT tela) FROM exame WHERE d=?",(today,))
    ex_ontem=one("SELECT COUNT(*) FROM exame WHERE d=?",(ontem,))
    mday=rows("SELECT d, COUNT(*) q FROM exame WHERE d BETWEEN ? AND ? GROUP BY d",((tdt-datetime.timedelta(days=90)).isoformat(),ontem))
    media_dia=round(sum(x["q"] for x in mday)/len(mday)) if mday else 0
    ex_mes=one("SELECT COUNT(*) FROM exame WHERE d BETWEEN ? AND ?",(mes_ini,today))
    req_mes=one("SELECT COUNT(DISTINCT tela) FROM exame WHERE d BETWEEN ? AND ?",(mes_ini,today))
    # mês passado via histórico
    mp=(ref-datetime.timedelta(days=1)); mp_ym=mp.strftime("%Y-%m")
    ex_mespass=one("SELECT q FROM histmensal WHERE ym=?",(mp_ym,)) or 0
    dia_mes=tdt.day; dias=calendar.monthrange(tdt.year,tdt.month)[1]
    proj=round(ex_mes/dia_mes*dias) if dia_mes else ex_mes
    ex_l12=one("SELECT COUNT(*) FROM exame WHERE d BETWEEN ? AND ?",(L12i,L12f))
    req_l12=one("SELECT COUNT(DISTINCT tela) FROM exame WHERE d BETWEEN ? AND ?",(L12i,L12f))
    ex_total=one("SELECT SUM(q) FROM histmensal")
    cli_ativos=one("SELECT COUNT(DISTINCT r.cli) FROM exame e JOIN req r ON e.tela=r.tela WHERE e.d BETWEEN ? AND ?",(L12i,L12f))
    D["live"]={"exames_hoje":ex_hoje,"requisicoes_hoje":req_hoje,"exames_ontem":ex_ontem,"media_dia":media_dia,
      "vs_media_pct":round(100*(ex_hoje-media_dia)/media_dia,1) if media_dia else 0,
      "exames_mes":ex_mes,"requisicoes_mes":req_mes,"exames_mes_passado":ex_mespass,
      "projecao_mes":proj,"dia_do_mes":dia_mes,"dias_no_mes":dias,
      "exames_l12":ex_l12,"exames_total":ex_total,"clientes_ativos":cli_ativos,
      "exames_por_req":round(ex_l12/req_l12,2) if req_l12 else 0}
    D["diario"]=rows("SELECT d, COUNT(*) q FROM exame WHERE d BETWEEN ? AND ? GROUP BY d ORDER BY d",(d45,today))
    D["mensal"]=rows("SELECT ym, q, reqs FROM histmensal WHERE ym>='2019-01' ORDER BY ym")
    # anual a partir do histórico mensal
    an={}
    for h in rows("SELECT ym,q FROM histmensal"):
        if not h["ym"]: continue
        y=h["ym"][:4]; an[y]=an.get(y,0)+h["q"]
    anual=[{"ano":y,"q":an[y]} for y in sorted(an) if y>='2014']
    prev=None
    for a in anual:
        a["yoy"]=round(100*(a["q"]-prev["q"])/prev["q"],1) if prev and prev["q"] else None; prev=a
    D["anual"]=anual
    D["setores"]=rows("""SELECT COALESCE(cat.setor,'(sem setor)') setor, COUNT(*) q
      FROM exame e LEFT JOIN categoria cat ON e.cat=cat.cod WHERE e.d BETWEEN ? AND ?
      GROUP BY cat.setor ORDER BY q DESC""",(L12i,L12f))
    D["categorias"]=rows("""SELECT COALESCE(cat.categoria,'(sem)') categoria, COUNT(*) q
      FROM exame e LEFT JOIN categoria cat ON e.cat=cat.cod WHERE e.d BETWEEN ? AND ?
      GROUP BY e.cat ORDER BY q DESC LIMIT 12""",(L12i,L12f))
    D["top_exames"]=rows("""SELECT exame Exame, COUNT(*) q FROM exame
      WHERE d BETWEEN ? AND ? AND exame IS NOT NULL AND exame<>'' GROUP BY exame ORDER BY q DESC LIMIT 15""",(L12i,L12f))
    D["especies"]=rows("""SELECT UPPER(TRIM(COALESCE(r.esp,'(n/i)'))) especie, COUNT(*) q
      FROM exame e JOIN req r ON e.tela=r.tela WHERE e.d BETWEEN ? AND ?
      GROUP BY especie ORDER BY q DESC LIMIT 12""",(L12i,L12f))
    D["top_clientes"]=rows("""SELECT COALESCE(cl.nome,r.clinome) nome, cl.cidade Cidade, COUNT(*) q
      FROM exame e JOIN req r ON e.tela=r.tela LEFT JOIN cliente cl ON r.cli=cl.cod
      WHERE e.d BETWEEN ? AND ? GROUP BY r.cli ORDER BY q DESC LIMIT 15""",(L12i,L12f))
    D["dia_semana"]=rows("SELECT strftime('%w',d) dow, COUNT(*) q FROM exame WHERE d BETWEEN ? AND ? GROUP BY dow ORDER BY dow",(L12i,L12f))
    urg=one("SELECT COUNT(*) FROM exame WHERE d BETWEEN ? AND ? AND urg=1",(L12i,L12f))
    D["urgencia"]={"l12":urg,"pct":round(100*urg/ex_l12,2) if ex_l12 else 0,
                   "hoje":one("SELECT COUNT(*) FROM exame WHERE d=? AND urg=1",(today,))}
    return D

# ---------- 3) cifra ----------
def encrypt(D):
    data=json.dumps(D,ensure_ascii=False,separators=(",",":")).encode()
    salt,iv=os.urandom(16),os.urandom(12)
    key=PBKDF2HMAC(algorithm=hashes.SHA256(),length=32,salt=salt,iterations=ITER).derive(PROD_PWD.encode())
    ct=AESGCM(key).encrypt(iv,data,None)
    env={"v":1,"kdf":"PBKDF2-SHA256","iter":ITER,
         "salt":base64.b64encode(salt).decode(),"iv":base64.b64encode(iv).decode(),"ct":base64.b64encode(ct).decode()}
    os.makedirs(os.path.dirname(OUT_ENC),exist_ok=True)
    json.dump(env,open(OUT_ENC,"w"),separators=(",",":"))
    print(f"OK -> producao.enc ({round(os.path.getsize(OUT_ENC)/1024,1)} KB) · hoje={D['meta']['hoje']} · exames_hoje={D['live']['exames_hoje']} · mes={D['live']['exames_mes']}")

if __name__ == "__main__":
    import time
    last = None
    for attempt in range(1, 4):
        try:
            encrypt(build(load_memory())); break
        except pymysql.err.OperationalError as e:
            last = e; print(f"tentativa {attempt} falhou ({e}); retry em 15s"); time.sleep(15)
    else:
        raise last
