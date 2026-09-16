#!/usr/bin/env python3
"""Quadro de Inclusões — espelho do HF (só leitura no MySQL bi_alpha) → Supabase.
inc_hf_req    : cabeçalho das requisições dos últimos DIAS (nº, clínica, pet, espécie, entrada)
inc_hf_exames : cada exame dessas requisições (quando foi lançado e por quem, se já foi digitado)
Usado pelo botão "+ Nova inclusão" (puxa pet/clínica pelo nº) e, na Fase 2, para o quadro perceber
sozinho "escritório lançou" e "exame liberado".
Env: MYSQL_HOST, MYSQL_USER, MYSQL_PWD, MYSQL_DB(bi_alpha), SUPABASE_URL, SUPABASE_SERVICE_KEY, DIAS(opc)."""
import os, re, json, datetime, urllib.request, pymysql

DIAS = int(os.environ.get("DIAS", "10"))
JANELA_REQ = int(os.environ.get("JANELA_REQ", "12000"))    # últimas requisições (≈ 2-3 semanas)
JANELA_EXA = int(os.environ.get("JANELA_EXA", "40000"))    # últimas linhas de exame
SB_URL = os.environ.get("SUPABASE_URL", "https://lrwjcdvporaivxvfuiwt.supabase.co").rstrip("/")
SB_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
SRC = dict(host=os.environ["MYSQL_HOST"], user=os.environ["MYSQL_USER"], password=os.environ["MYSQL_PWD"],
           database=os.environ.get("MYSQL_DB", "bi_alpha"), connect_timeout=20, read_timeout=180, charset="utf8mb4")
BRT = datetime.timezone(datetime.timedelta(hours=-3))


def iso(d, hora=None):
    """data (date/datetime) + hora opcional ('HH:MM:SS') → ISO com fuso de Brasília."""
    if not d:
        return None
    if isinstance(d, datetime.datetime):
        return d.replace(tzinfo=BRT).isoformat()
    h = (0, 0, 0)
    m = re.match(r"(\d{1,2}):(\d{2})(?::(\d{2}))?", str(hora or ""))
    if m:
        h = (int(m.group(1)), int(m.group(2)), int(m.group(3) or 0))
    return datetime.datetime(d.year, d.month, d.day, *h, tzinfo=BRT).isoformat()


def entrada_maquina(txt):
    """'2026-09-15 - 23:43:44 - DESKTOP…' → ISO"""
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})\s*-\s*(\d{2}):(\d{2}):(\d{2})", str(txt or ""))
    if not m:
        return None
    return datetime.datetime(*map(int, m.groups()), tzinfo=BRT).isoformat()


def ler():
    """⚠ As tabelas do HF NÃO têm índice além da chave primária (auto-incremento). Filtrar por data
    varre ~500 mil / 2,8 milhões de linhas e trava o banco que a equipe usa → filtra por FAIXA DA CHAVE
    (as últimas N linhas) e só depois pela data, aqui no script."""
    ini = datetime.date.today() - datetime.timedelta(days=DIAS)
    con = pymysql.connect(**SRC)
    c = con.cursor()
    c.execute("SELECT MAX(CodNumeroSequencialTela) FROM `TabExameNumeroRequisiçao`")
    topo_r = c.fetchone()[0] or 0
    c.execute("SELECT NumeroSequencial, Cliente, Animal, Especie, DataEntrada, UsuarioHoraEntrada "
              "FROM `TabExameNumeroRequisiçao` WHERE CodNumeroSequencialTela > %s", (topo_r - JANELA_REQ,))
    reqs = [{"numero": str(r[0]), "cliente": r[1], "animal": r[2], "especie": r[3], "entrada": iso(r[4], r[5]),
             "atualizado": datetime.datetime.now(BRT).isoformat()}
            for r in c.fetchall() if r[0] and r[4] and r[4] >= ini]
    nums = {r["numero"] for r in reqs}
    c.execute("SELECT MAX(CodExameSolicitado) FROM TabExameNumeroSolicitado")
    topo_e = c.fetchone()[0] or 0
    c.execute("SELECT CodExameSolicitado, NumeroSequencial, Exame, CodCategoria, EntradaMaquina, EntradaUsuario, "
              "Digitado, DataExame, DataModificacao FROM TabExameNumeroSolicitado WHERE CodExameSolicitado > %s",
              (topo_e - JANELA_EXA,))
    exames = [{"id": int(r[0]), "numero": str(r[1]), "exame": r[2], "categoria": r[3], "entrada_ts": entrada_maquina(r[4]),
               "entrada_usuario": r[5], "digitado": bool(r[6]) if r[6] is not None else None,
               "data_exame": r[7].isoformat() if r[7] else None, "modificado": iso(r[8]) if r[8] else None}
              for r in c.fetchall() if str(r[1]) in nums]
    con.close()
    return reqs, exames


def up(tab, rows, conf):
    if not SB_KEY:
        print("SEM SUPABASE_SERVICE_KEY — não enviei", tab)
        return
    for i in range(0, len(rows), 1000):
        b = rows[i:i + 1000]
        req = urllib.request.Request(f"{SB_URL}/rest/v1/{tab}?on_conflict={conf}", data=json.dumps(b, default=str).encode(),
                                     method="POST", headers={"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}",
                                                             "Content-Type": "application/json",
                                                             "Prefer": "resolution=merge-duplicates,return=minimal"})
        urllib.request.urlopen(req, timeout=90)
        print(f"{tab}: +{len(b)}")


if __name__ == "__main__":
    r, e = ler()
    print("requisições:", len(r), "· exames:", len(e))
    up("inc_hf_req", r, "numero")
    up("inc_hf_exames", e, "id")
    print("OK")
