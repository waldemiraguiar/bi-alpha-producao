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

# Cortes diários (horas) p/ a "baixa" da separação — editar aqui muda os dois cortes
CORTES = [15, 21]
# Cofre de separação de amostras (CodExame -> "interno"|"apoio"); fora do cofre = não separa
COFRE_PATH = os.path.join(ROOT, "cofre_separacao.json")
def load_cofre():
    try:
        d = json.load(open(COFRE_PATH, encoding="utf-8"))
        m = {int(i["codex"]): i["classe"] for i in d.get("itens", []) if i.get("classe") in ("interno", "apoio")}
        print(f"[cofre] {len(m)} exames exigem separação"); return m
    except Exception as e:
        print(f"[cofre] AVISO: não carregou ({e}); separação ficará vazia"); return {}
COFRE = load_cofre()

def build():
    conn = pymysql.connect(**SRC); c = conn.cursor()
    def q(sql,p=()): c.execute(sql,p); return c.fetchall()
    def q1(sql,p=()):
        c.execute(sql,p); r=c.fetchone(); return list(r.values())[0] if r else None
    cats = {r["CodCategoria"]:(r["Categoria"] or f"Cat {r['CodCategoria']}") for r in q("SELECT CodCategoria,Categoria FROM TabCategoria")}
    def nome(cod): return cats.get(cod, f"Cat {cod}")
    def sla(cod): return SLA.get(cod, SLA_DEFAULT)


    # --- FILA EM ABERTO (DataExame NULL) por categoria x EXAME(derivação) x dias-em-aberto ---
    abertos = q(f"""SELECT s.CodCategoria cod, s.Exame exame, DATEDIFF(CURDATE(), r.DataEntrada) dias, COUNT(*) n
        FROM {EX} s JOIN {RQ} r ON s.CodNumeroSequencialTela=r.CodNumeroSequencialTela
        WHERE s.DataExame IS NULL AND r.DataEntrada>=DATE_SUB(CURDATE(),INTERVAL 10 DAY)
        GROUP BY s.CodCategoria, s.Exame, dias""")
    # --- DETALHE dos abertos (com paciente + nº de registro) p/ a equipe rastrear ---
    abertos_det = q(f"""SELECT s.CodCategoria cod, s.Exame exame,
        r.NumeroSequencial registro, r.Animal paciente, r.Proprietario dono, s.Urgencia urg,
        r.DataEntrada entrada, DATEDIFF(CURDATE(), r.DataEntrada) dias
        FROM {EX} s JOIN {RQ} r ON s.CodNumeroSequencialTela=r.CodNumeroSequencialTela
        WHERE s.DataExame IS NULL AND r.DataEntrada>=DATE_SUB(CURDATE(),INTERVAL 10 DAY)
        ORDER BY (s.Urgencia=1) DESC, dias DESC LIMIT 500""")
    # --- URGENTES em processo (marcados pelo operacional) — todos, p/ o alerta ---
    urg_det = q(f"""SELECT s.CodCategoria cod, s.Exame exame, r.NumeroSequencial registro,
        r.Animal paciente, DATEDIFF(CURDATE(), r.DataEntrada) dias
        FROM {EX} s JOIN {RQ} r ON s.CodNumeroSequencialTela=r.CodNumeroSequencialTela
        WHERE s.DataExame IS NULL AND s.Urgencia=1 AND r.DataEntrada>=DATE_SUB(CURDATE(),INTERVAL 10 DAY)
        ORDER BY dias DESC""")
    # --- TAT médio dos concluídos recentes (qualidade operacional, 30d) ---
    tatmed = q(f"""SELECT s.CodCategoria cod, ROUND(AVG(DATEDIFF(s.DataExame,r.DataEntrada)),1) tat
        FROM {EX} s JOIN {RQ} r ON s.CodNumeroSequencialTela=r.CodNumeroSequencialTela
        WHERE s.DataExame>=DATE_SUB(CURDATE(),INTERVAL 30 DAY) AND s.DataExame IS NOT NULL
          AND DATEDIFF(s.DataExame,r.DataEntrada)>=0
        GROUP BY s.CodCategoria""")

    # --- SEPARAÇÃO DE AMOSTRA: exames abertos que exigem separar (cruzado com o cofre) ---
    sep_itens = []
    if COFRE:
        codes = ",".join(str(k) for k in COFRE)
        sep_rows = q(f"""SELECT s.CodCategoria cod, s.CodExame codex, s.Exame exame,
            r.NumeroSequencial req, r.AnoRequisiçao ano,
            r.Animal paciente, r.Proprietario tutor, r.Requisitante vet, r.Cliente clinica,
            r.DataEntrada entrada, r.UsuarioDataEntrada udata, r.UsuarioHoraEntrada uhora,
            s.Urgencia urg, DATEDIFF(CURDATE(), r.DataEntrada) dias
            FROM {EX} s JOIN {RQ} r ON s.CodNumeroSequencialTela=r.CodNumeroSequencialTela
            WHERE s.DataExame IS NULL AND s.CodExame IN ({codes})
              AND r.DataEntrada>=DATE_SUB(CURDATE(),INTERVAL 5 DAY)
            ORDER BY r.DataEntrada DESC, r.NumeroSequencial DESC LIMIT 1500""")
        for r in sep_rows:
            if r["cod"] in JUNK: continue
            classe = COFRE.get(r["codex"])
            if not classe: continue
            ud = r["udata"] or r["entrada"]; uh = r["uhora"]   # uhora vem como timedelta
            ent_dt = None
            if ud is not None:
                base = datetime.datetime(ud.year, ud.month, ud.day)
                if isinstance(uh, datetime.timedelta): base = base + uh
                ent_dt = base.strftime("%Y-%m-%dT%H:%M:%S")
            sep_itens.append({
                "req": r["req"], "ano": r["ano"], "codex": r["codex"],
                "exame": r["exame"], "cat": nome(r["cod"]), "cod": r["cod"],
                "paciente": (r["paciente"] or "").strip() or "—",
                "tutor": (r["tutor"] or "").strip(),
                "vet": (r["vet"] or "").strip(),
                "clinica": (r["clinica"] or "").strip(),
                "entrada": str(r["entrada"]) if r["entrada"] else None,
                "entrada_dt": ent_dt, "classe": classe,
                "urgente": (r["urg"] == 1), "dias": r["dias"] or 0,
            })

    # --- HISTÓRICO: universo cofre dos últimos N dias (p/ ver separados E NÃO-separados por setor) ---
    HIST_DIAS = 7
    hist_itens = []
    if COFRE:
        codes_h = ",".join(str(k) for k in COFRE)
        hist_rows = q(f"""SELECT s.CodCategoria cod, s.CodExame codex, s.Exame exame,
            r.NumeroSequencial req, r.AnoRequisiçao ano, r.Animal paciente, r.DataEntrada entrada
            FROM {EX} s JOIN {RQ} r ON s.CodNumeroSequencialTela=r.CodNumeroSequencialTela
            WHERE s.CodExame IN ({codes_h}) AND r.DataEntrada>=DATE_SUB(CURDATE(),INTERVAL {HIST_DIAS} DAY)
            ORDER BY r.DataEntrada DESC, r.NumeroSequencial DESC LIMIT 3000""")
        for r in hist_rows:
            if r["cod"] in JUNK or r["codex"] not in COFRE: continue
            hist_itens.append({"req": r["req"], "ano": r["ano"], "codex": r["codex"],
                "exame": r["exame"], "cat": nome(r["cod"]), "cod": r["cod"],
                "paciente": (r["paciente"] or "").strip() or "—",
                "dt": str(r["entrada"]) if r["entrada"] else None})

    # --- CLIENTES (clínicas): lista p/ busca + requisições recentes p/ acender alerta ---
    cli_lista = q("""SELECT CodCliente cod, MAX(Cliente) nome
        FROM `TabExameNumeroRequisiçao`
        WHERE Cliente IS NOT NULL AND TRIM(Cliente)<>'' AND DataEntrada>=DATE_SUB(CURDATE(),INTERVAL 365 DAY)
        GROUP BY CodCliente ORDER BY nome""")
    cli_lista = [{"cod": r["cod"], "nome": (r["nome"] or "").strip()} for r in cli_lista if r["nome"]]
    # Clínicas VIGIADAS (flags do app) → janela LONGA p/ o alerta persistir até alguém dar baixa.
    # Como são poucas clínicas, isso até reduz o payload. Fallback = 2 dias (todas) se não ler as flags.
    CLI_DIAS = 14
    flagged_cods = set()
    try:
        import urllib.request
        _SK = "sb_publishable_fcodHc3AxR_HQ-aduMGzlg_CTBALng8"
        _rq = urllib.request.Request("https://lrwjcdvporaivxvfuiwt.supabase.co/rest/v1/cli_flags?select=cod",
                                     headers={"apikey": _SK, "Authorization": "Bearer " + _SK})
        for f in json.loads(urllib.request.urlopen(_rq, timeout=20).read().decode()):
            try: flagged_cods.add(int(f["cod"]))   # cods de teste (texto) são ignorados
            except Exception: pass
        print(f"[clientes] {len(flagged_cods)} clínicas vigiadas no Supabase (janela {CLI_DIAS}d)")
    except Exception as e:
        print(f"[clientes] aviso: não leu flags do Supabase ({e}); fallback 2 dias")
    if flagged_cods:
        _where = f"CodCliente IN ({','.join(str(c) for c in flagged_cods)}) AND DataEntrada>=DATE_SUB(CURDATE(),INTERVAL {CLI_DIAS} DAY)"
    else:
        _where = "DataEntrada>=DATE_SUB(CURDATE(),INTERVAL 2 DAY)"
    cli_reqs_raw = q(f"""SELECT CodCliente cod, Cliente cliente, NumeroSequencial req, AnoRequisiçao ano,
        Animal paciente, Requisitante vet, DataEntrada entrada, UsuarioDataEntrada udata, UsuarioHoraEntrada uhora
        FROM `TabExameNumeroRequisiçao`
        WHERE {_where}
        ORDER BY DataEntrada DESC, NumeroSequencial DESC LIMIT 2000""")
    cli_reqs = []
    for r in cli_reqs_raw:
        ud = r["udata"] or r["entrada"]; uh = r["uhora"]; dt = None
        if ud is not None:
            base = datetime.datetime(ud.year, ud.month, ud.day)
            if isinstance(uh, datetime.timedelta): base = base + uh
            dt = base.strftime("%Y-%m-%dT%H:%M:%S")
        cli_reqs.append({"cod": r["cod"], "cliente": (r["cliente"] or "").strip(),
                         "req": r["req"], "ano": r["ano"], "paciente": (r["paciente"] or "").strip() or "—",
                         "vet": (r["vet"] or "").strip(), "dt": dt})

    cat = {}
    def C(cod):
        if cod not in cat:
            cat[cod]={"cod":cod,"categoria":nome(cod),"sla":sla(cod),
                      "em_processo":0,"no_prazo":0,"atrasado":0,"tat_medio":None,
                      "urgentes":0,"urgentes_list":[],"_der":{}}
        return cat[cod]
    for r in abertos:
        if r["cod"] in JUNK: continue
        x=C(r["cod"]); dias=r["dias"] or 0; n=r["n"]; exm=(r["exame"] or "—").strip() or "—"
        late = dias > x["sla"]
        x["em_processo"]+=n
        if late: x["atrasado"]+=n
        else: x["no_prazo"]+=n
        d=x["_der"].setdefault(exm,{"exame":exm,"em_processo":0,"atrasado":0})
        d["em_processo"]+=n
        if late: d["atrasado"]+=n
    for r in urg_det:
        if r["cod"] in JUNK: continue
        x=C(r["cod"]); x["urgentes"]+=1
        if len(x["urgentes_list"])<10:
            x["urgentes_list"].append({"registro":r["registro"],
                "paciente":(r["paciente"] or "").strip() or "—","exame":r["exame"],"dias":r["dias"] or 0})
    for r in tatmed:
        if r["cod"] in JUNK: continue
        C(r["cod"])["tat_medio"]=float(r["tat"]) if r["tat"] is not None else None

    categorias = sorted(cat.values(), key=lambda x:-(x["atrasado"]*1000+x["em_processo"]))
    for x in categorias:
        tot=x["em_processo"]; x["pct_no_prazo"]=round(100*x["no_prazo"]/tot) if tot else 100
        x["exames"]=[]   # lista detalhada com paciente + registro (preenchida abaixo)
        ders=sorted(x["_der"].values(), key=lambda d:-d["em_processo"])
        for d in ders:
            d["no_prazo"]=d["em_processo"]-d["atrasado"]
            d["pct"]=round(100*d["no_prazo"]/d["em_processo"]) if d["em_processo"] else 100
        x["derivacoes"]=ders; del x["_der"]

    # exames em processo por categoria (com paciente + nº de registro) — atrasados primeiro
    CAP=30
    atrasados=[]
    for r in abertos_det:
        if r["cod"] in JUNK or r["cod"] not in cat: continue
        s=sla(r["cod"]); dias=r["dias"] or 0; atras=dias>s
        lim = (r["entrada"]+datetime.timedelta(days=s)).isoformat() if r["entrada"] else None
        item={"registro":r["registro"],"paciente":(r["paciente"] or "").strip() or "—",
              "dono":(r["dono"] or "").strip(),"exame":r["exame"],
              "entrada":str(r["entrada"]) if r["entrada"] else None,"limite":lim,
              "urgente":(r["urg"]==1),
              "dias":dias,"sla":s,"atrasado":atras,"atraso":max(0,dias-s)}
        lst=cat[r["cod"]]["exames"]
        if len(lst)<CAP: lst.append(item)
        if atras:
            atrasados.append({**item,"categoria":nome(r["cod"])})
    atrasados.sort(key=lambda a:-a["atraso"]); atrasados=atrasados[:40]

    resumo={"em_processo":sum(x["em_processo"] for x in categorias),
            "no_prazo":sum(x["no_prazo"] for x in categorias),
            "atrasado":sum(x["atrasado"] for x in categorias)}
    resumo["pct_no_prazo"]=round(100*resumo["no_prazo"]/resumo["em_processo"]) if resumo["em_processo"] else 100

    D={"meta":{"gerado_em":datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M")+" UTC",
               "obs":"Painel operacional — fila e prazos (últimos 10 dias). Sem valores e sem volumes."},
       "resumo":resumo,"categorias":categorias,"atrasados":atrasados,
       "separacao":{"cutoffs":CORTES,
                    "gerado_em":datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M")+" UTC",
                    "itens":sep_itens,"historico":hist_itens},
       "clientes":{"lista":cli_lista,"reqs":cli_reqs}}
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
    print(f"OK -> producao.enc ({round(os.path.getsize(OUT_ENC)/1024,1)} KB) · em_processo={D['resumo']['em_processo']} atrasado={D['resumo']['atrasado']} cats={len(D['categorias'])} atrasados_list={len(D['atrasados'])} separacao={len(D.get('separacao',{}).get('itens',[]))} historico={len(D.get('separacao',{}).get('historico',[]))} clientes_lista={len(D.get('clientes',{}).get('lista',[]))} clientes_reqs={len(D.get('clientes',{}).get('reqs',[]))}")

if __name__=="__main__":
    last=None
    for attempt in range(1,4):
        try: encrypt(build()); break
        except pymysql.err.OperationalError as e:
            last=e; print(f"tentativa {attempt} falhou ({e}); retry 20s"); time.sleep(20)
    else: raise last
