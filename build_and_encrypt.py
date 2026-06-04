#!/usr/bin/env python3
"""Robô de nuvem do painel de PRODUÇÃO (TV, operacional).
Foco: fila em aberto por categoria, STATUS por prazo (No prazo/Atrasado/Adiantado),
exames entrando/saindo (fluxo do dia) e lista de atrasados. SEM R$, SEM totais acumulados.
Sinal de conclusão = DataExame preenchida (NULL = em processo). Tudo server-side (leve)."""
import os, json, base64, datetime, time
import pymysql
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT_ENC = os.path.join(ROOT, "site_prod", "data", "producao.enc")
ITER = 250_000
SRC = dict(host=os.environ["MYSQL_HOST"], user=os.environ["MYSQL_USER"],
           password=os.environ["MYSQL_PWD"], database=os.environ.get("MYSQL_DB","bi_alpha"),
           connect_timeout=30, read_timeout=900, write_timeout=900, charset="utf8mb4",
           cursorclass=pymysql.cursors.DictCursor,
           init_command="SET SESSION net_write_timeout=3600, net_read_timeout=3600")
PROD_PWD = os.environ["PROD_PWD"]
EX = "TabExameNumeroSolicitado"; RQ = "`TabExameNumeroRequisiçao`"

# Prazo (SLA) em dias por código de categoria  (definido pelo lab)
SLA = {16:1, 1:1, 9:2, 15:1, 34:2, 31:3, 4:5, 7:1, 2:1, 58:30, 62:15}
SLA_DEFAULT = 3
JUNK = {55,56,60,24,25,35,36,37,50,52,54}   # CANCELADO/DINHEIRO/FAKE/Z NAO UTILIZAR

def build():
    conn = pymysql.connect(**SRC); c = conn.cursor()
    def q(sql,p=()): c.execute(sql,p); return c.fetchall()
    def q1(sql,p=()):
        c.execute(sql,p); r=c.fetchone(); return list(r.values())[0] if r else None
    cats = {r["CodCategoria"]:(r["Categoria"] or f"Cat {r['CodCategoria']}") for r in q("SELECT CodCategoria,Categoria FROM TabCategoria")}
    def nome(cod): return cats.get(cod, f"Cat {cod}")
    def sla(cod): return SLA.get(cod, SLA_DEFAULT)

    ref_ent = str(q1(f"SELECT MAX(DataEntrada) m FROM {RQ}") or datetime.date.today())
    ref_sai = str(q1(f"SELECT MAX(DataExame) m FROM {EX} WHERE DataExame<=CURDATE()") or datetime.date.today())

    # --- FILA EM ABERTO (DataExame NULL) por categoria x dias-em-aberto (entrada últimos 60d) ---
    abertos = q(f"""SELECT s.CodCategoria cod, DATEDIFF(CURDATE(), r.DataEntrada) dias, COUNT(*) n
        FROM {EX} s JOIN {RQ} r ON s.CodNumeroSequencialTela=r.CodNumeroSequencialTela
        WHERE s.DataExame IS NULL AND r.DataEntrada>=DATE_SUB(CURDATE(),INTERVAL 30 DAY)
        GROUP BY s.CodCategoria, dias""")
    # --- ATRASADOS detalhados (abertos, ordenados por dias) ---
    abertos_det = q(f"""SELECT s.CodCategoria cod, s.Exame exame, r.DataEntrada entrada,
        DATEDIFF(CURDATE(), r.DataEntrada) dias
        FROM {EX} s JOIN {RQ} r ON s.CodNumeroSequencialTela=r.CodNumeroSequencialTela
        WHERE s.DataExame IS NULL AND r.DataEntrada>=DATE_SUB(CURDATE(),INTERVAL 30 DAY)
        ORDER BY dias DESC LIMIT 250""")
    # --- SAINDO (concluídos na última data) por categoria + turnaround ---
    saindo = q(f"""SELECT s.CodCategoria cod, DATEDIFF(s.DataExame, r.DataEntrada) tat, COUNT(*) n
        FROM {EX} s JOIN {RQ} r ON s.CodNumeroSequencialTela=r.CodNumeroSequencialTela
        WHERE s.DataExame=%s GROUP BY s.CodCategoria, tat""",(ref_sai,))
    # --- ENTRANDO (última data de entrada) por categoria ---
    entrando = q(f"""SELECT s.CodCategoria cod, COUNT(*) n
        FROM {EX} s JOIN {RQ} r ON s.CodNumeroSequencialTela=r.CodNumeroSequencialTela
        WHERE r.DataEntrada=%s GROUP BY s.CodCategoria""",(ref_ent,))
    # --- TAT médio dos concluídos recentes (qualidade operacional, 30d) ---
    tatmed = q(f"""SELECT s.CodCategoria cod, ROUND(AVG(DATEDIFF(s.DataExame,r.DataEntrada)),1) tat
        FROM {EX} s JOIN {RQ} r ON s.CodNumeroSequencialTela=r.CodNumeroSequencialTela
        WHERE s.DataExame>=DATE_SUB(CURDATE(),INTERVAL 30 DAY) AND s.DataExame IS NOT NULL
          AND DATEDIFF(s.DataExame,r.DataEntrada)>=0
        GROUP BY s.CodCategoria""")

    cat = {}
    def C(cod):
        if cod not in cat:
            cat[cod]={"cod":cod,"categoria":nome(cod),"sla":sla(cod),
                      "em_processo":0,"no_prazo":0,"atrasado":0,"entrando":0,"saindo":0,
                      "saiu_no_prazo":0,"saiu_atrasado":0,"tat_medio":None}
        return cat[cod]
    for r in abertos:
        if r["cod"] in JUNK: continue
        x=C(r["cod"]); dias=r["dias"] or 0; n=r["n"]
        x["em_processo"]+=n
        if dias > x["sla"]: x["atrasado"]+=n
        else: x["no_prazo"]+=n
    for r in saindo:
        if r["cod"] in JUNK: continue
        x=C(r["cod"]); tat=r["tat"]; n=r["n"]; x["saindo"]+=n
        if tat is not None and tat>x["sla"]: x["saiu_atrasado"]+=n
        else: x["saiu_no_prazo"]+=n
    for r in entrando:
        if r["cod"] in JUNK: continue
        C(r["cod"])["entrando"]+=r["n"]
    for r in tatmed:
        if r["cod"] in JUNK: continue
        C(r["cod"])["tat_medio"]=float(r["tat"]) if r["tat"] is not None else None

    categorias = sorted(cat.values(), key=lambda x:-(x["atrasado"]*1000+x["em_processo"]))
    for x in categorias:
        tot=x["em_processo"]; x["pct_no_prazo"]=round(100*x["no_prazo"]/tot) if tot else 100

    atrasados=[]
    for r in abertos_det:
        if r["cod"] in JUNK: continue
        s=sla(r["cod"]); dias=r["dias"] or 0
        if dias>s:
            atrasados.append({"categoria":nome(r["cod"]),"exame":r["exame"],
                              "dias":dias,"sla":s,"atraso":dias-s,
                              "entrada":str(r["entrada"]) if r["entrada"] else None})
    atrasados.sort(key=lambda a:-a["atraso"]); atrasados=atrasados[:40]

    resumo={"em_processo":sum(x["em_processo"] for x in categorias),
            "no_prazo":sum(x["no_prazo"] for x in categorias),
            "atrasado":sum(x["atrasado"] for x in categorias),
            "entrando":sum(x["entrando"] for x in categorias),
            "saindo":sum(x["saindo"] for x in categorias)}
    resumo["pct_no_prazo"]=round(100*resumo["no_prazo"]/resumo["em_processo"]) if resumo["em_processo"] else 100

    D={"meta":{"gerado_em":datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M")+" UTC",
               "ref_entrada":ref_ent,"ref_saida":ref_sai,
               "obs":"Painel operacional — fila, prazos e fluxo. Sem valores e sem volumes acumulados."},
       "resumo":resumo,"categorias":categorias,"atrasados":atrasados}
    conn.close()
    return D

def _jdef(o):
    import decimal, datetime as _dt
    if isinstance(o, decimal.Decimal): return float(o)
    if isinstance(o,(_dt.date,_dt.datetime)): return str(o)
    raise TypeError(str(type(o)))

def encrypt(D):
    data=json.dumps(D,ensure_ascii=False,separators=(",",":"),default=_jdef).encode()
    salt,iv=os.urandom(16),os.urandom(12)
    key=PBKDF2HMAC(algorithm=hashes.SHA256(),length=32,salt=salt,iterations=ITER).derive(PROD_PWD.encode())
    ct=AESGCM(key).encrypt(iv,data,None)
    env={"v":1,"kdf":"PBKDF2-SHA256","iter":ITER,"salt":base64.b64encode(salt).decode(),
         "iv":base64.b64encode(iv).decode(),"ct":base64.b64encode(ct).decode()}
    os.makedirs(os.path.dirname(OUT_ENC),exist_ok=True)
    json.dump(env,open(OUT_ENC,"w"),separators=(",",":"))
    print(f"OK -> producao.enc ({round(os.path.getsize(OUT_ENC)/1024,1)} KB) · em_processo={D['resumo']['em_processo']} atrasado={D['resumo']['atrasado']} cats={len(D['categorias'])} atrasados_list={len(D['atrasados'])}")

if __name__=="__main__":
    last=None
    for attempt in range(1,4):
        try: encrypt(build()); break
        except pymysql.err.OperationalError as e:
            last=e; print(f"tentativa {attempt} falhou ({e}); retry 20s"); time.sleep(20)
    else: raise last
