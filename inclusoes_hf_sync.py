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
TOKEN = os.environ.get("HISTO_INTAKE_TOKEN", "")
ANON = "sb_publishable_fcodHc3AxR_HQ-aduMGzlg_CTBALng8"   # chave pública; quem autoriza a escrita é o token
SRC = dict(host=os.environ["MYSQL_HOST"], user=os.environ["MYSQL_USER"], password=os.environ["MYSQL_PWD"],
           database=os.environ.get("MYSQL_DB", "bi_alpha"), connect_timeout=20, read_timeout=180, charset="utf8mb4")
BRT = datetime.timezone(datetime.timedelta(hours=-3))
# ⛔ O HF grava hora do SERVIDOR em UTC (provado 16/09: Piter aberto 15h57 BRT → HF "18:59"; Pandora pedida
# 15h27 → lançada "18:59"). Então as horas do HF são lidas como UTC, NÃO como Brasília.
HF_TZ = datetime.timezone.utc


def iso(d, hora=None):
    """data (date/datetime) + hora opcional ('HH:MM:SS') → ISO com fuso de Brasília."""
    if not d:
        return None
    if isinstance(d, datetime.datetime):
        return d.replace(tzinfo=HF_TZ).isoformat()
    h = (0, 0, 0)
    m = re.match(r"(\d{1,2}):(\d{2})(?::(\d{2}))?", str(hora or ""))
    if m:
        h = (int(m.group(1)), int(m.group(2)), int(m.group(3) or 0))
    return datetime.datetime(d.year, d.month, d.day, *h, tzinfo=HF_TZ).isoformat()


def entrada_maquina(txt):
    """'2026-09-15 - 23:43:44 - DESKTOP…' → ISO"""
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})\s*-\s*(\d{2}):(\d{2}):(\d{2})", str(txt or ""))
    if not m:
        return None
    return datetime.datetime(*map(int, m.groups()), tzinfo=HF_TZ).isoformat()


def ler():
    """⚠ As tabelas do HF NÃO têm índice além da chave primária (auto-incremento). Filtrar por data
    varre ~500 mil / 2,8 milhões de linhas e trava o banco que a equipe usa → filtra por FAIXA DA CHAVE
    (as últimas N linhas) e só depois pela data, aqui no script."""
    ini = datetime.date.today() - datetime.timedelta(days=DIAS)
    con = pymysql.connect(**SRC)
    c = con.cursor()
    c.execute("SELECT MAX(CodNumeroSequencialTela) FROM `TabExameNumeroRequisiçao`")
    topo_r = c.fetchone()[0] or 0
    # 28/set (Fúlvio, testando o cancelamento): o TUTOR existe no HF e o espelho não trazia.
    # A coluna é Proprietario — build_cito_intake / build_histo_intake / build_imuno_intake
    # já a leem desta mesma tabela. Eu tinha dito que "o HF não traz esse campo": estava errado.
    c.execute("SELECT NumeroSequencial, Cliente, Animal, Especie, DataEntrada, UsuarioHoraEntrada, DataTransmissao, Proprietario "
              "FROM `TabExameNumeroRequisiçao` WHERE CodNumeroSequencialTela > %s", (topo_r - JANELA_REQ,))
    reqs = [{"numero": str(r[0]), "cliente": r[1], "animal": r[2], "especie": r[3], "entrada": iso(r[4], r[5]),
             "transmitido": r[6].isoformat() if r[6] else None, "tutor": r[7],
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


def pedidos_abertos():
    """Requisições que alguém procurou no painel e não estavam no espelho.
    Fúlvio, 25/set: ele testou a 626526, de 29/07, e o sistema não achou. Não era busca
    ruim — o espelho guarda ~20 dias. Agora o painel registra o pedido e o sync vai
    buscar essa requisição específica no HF, sem janela de data."""
    if not TOKEN:
        return []
    try:
        body = json.dumps({"p_token": TOKEN}).encode()
        r = urllib.request.Request(f"{SB_URL}/rest/v1/rpc/inc_hf_pedidos_abertos", data=body, method="POST",
                                   headers={"apikey": ANON, "Authorization": f"Bearer {ANON}", "Content-Type": "application/json"})
        return [str(x) for x in (json.loads(urllib.request.urlopen(r, timeout=60).read() or "[]") or [])]
    except Exception as e:
        print("pedidos: não consegui ler —", type(e).__name__)
        return []


def ler_avulsas(numeros):
    """Busca requisições específicas pelo NÚMERO, sem filtro de data. É um IN sobre a
    chave, então não varre a tabela — não trava o banco que a equipe usa."""
    if not numeros:
        return [], []
    con = pymysql.connect(**SRC)
    c = con.cursor()
    marcas = ",".join(["%s"] * len(numeros))
    c.execute("SELECT NumeroSequencial, Cliente, Animal, Especie, DataEntrada, UsuarioHoraEntrada, DataTransmissao, Proprietario "
              f"FROM `TabExameNumeroRequisiçao` WHERE NumeroSequencial IN ({marcas})", numeros)
    reqs = [{"numero": str(r[0]), "cliente": r[1], "animal": r[2], "especie": r[3], "entrada": iso(r[4], r[5]),
             "transmitido": r[6].isoformat() if r[6] else None, "tutor": r[7],
             "atualizado": datetime.datetime.now(BRT).isoformat()}
            for r in c.fetchall() if r[0]]
    achados = [r["numero"] for r in reqs]
    exames = []
    if achados:
        marcas2 = ",".join(["%s"] * len(achados))
        c.execute("SELECT CodExameSolicitado, NumeroSequencial, Exame, CodCategoria, EntradaMaquina, EntradaUsuario, "
                  f"Digitado, DataExame, DataModificacao FROM TabExameNumeroSolicitado WHERE NumeroSequencial IN ({marcas2})", achados)
        exames = [{"id": r[0], "numero": str(r[1]), "exame": r[2], "categoria": r[3], "entrada_ts": iso(r[4], r[5]),
                   "entrada_usuario": r[5], "digitado": bool(r[6]) if r[6] is not None else None,
                   "data_exame": r[7].isoformat() if r[7] else None,
                   "modificado": r[8].isoformat() if r[8] else None} for r in c.fetchall() if r[0]]
    con.close()
    return reqs, exames


def marcar_atendidos(numeros):
    if not TOKEN or not numeros:
        return
    try:
        body = json.dumps({"p_token": TOKEN, "p_nums": numeros}).encode()
        r = urllib.request.Request(f"{SB_URL}/rest/v1/rpc/inc_hf_pedido_ok", data=body, method="POST",
                                   headers={"apikey": ANON, "Authorization": f"Bearer {ANON}", "Content-Type": "application/json"})
        print("pedidos atendidos:", json.loads(urllib.request.urlopen(r, timeout=60).read() or "null"))
    except Exception as e:
        print("pedidos: não consegui marcar —", type(e).__name__)


def enviar(reqs, exames):
    """Grava pelo RPC inc_hf_upsert (validado pelo mesmo token do intake da Histotécnica) — o repo não tem service key."""
    if not TOKEN:
        print("SEM HISTO_INTAKE_TOKEN — não enviei")
        return
    def rpc(p_req, p_exa):
        body = json.dumps({"p_token": TOKEN, "p_req": p_req, "p_exames": p_exa}, default=str).encode()
        r = urllib.request.Request(f"{SB_URL}/rest/v1/rpc/inc_hf_upsert", data=body, method="POST",
                                   headers={"apikey": ANON, "Authorization": f"Bearer {ANON}", "Content-Type": "application/json"})
        return json.loads(urllib.request.urlopen(r, timeout=120).read() or "null")
    print("req:", rpc(reqs, []))
    for i in range(0, len(exames), 3000):
        print("exames:", rpc([], exames[i:i + 3000]))


if __name__ == "__main__":
    r, e = ler()
    print("requisições:", len(r), "· exames:", len(e))
    enviar(r, e)
    # requisições antigas que alguém procurou no painel e não estavam no espelho
    pend = pedidos_abertos()
    if pend:
        ra, ea = ler_avulsas(pend)
        print("pedidos avulsos:", len(pend), "· achados:", len(ra), "· exames:", len(ea))
        if ra:
            enviar(ra, ea)
            marcar_atendidos([x["numero"] for x in ra])
    # Fase 2: confere os cartões do Quadro de Inclusões com o HF (avança sozinho / acusa divergência)
    if TOKEN:
        body = json.dumps({"p_token": TOKEN}).encode()
        rq = urllib.request.Request(f"{SB_URL}/rest/v1/rpc/inc_conferir", data=body, method="POST",
                                    headers={"apikey": ANON, "Authorization": f"Bearer {ANON}", "Content-Type": "application/json"})
        print("conferência:", urllib.request.urlopen(rq, timeout=120).read().decode())
        # IA: pedidos de inclusão do WhatsApp ainda sem requisição provável → tenta de novo com a cópia nova do HF
        try:
            rq = urllib.request.Request(f"{SB_URL}/rest/v1/rpc/inc_sugerir_pendentes", data=body, method="POST",
                                        headers={"apikey": ANON, "Authorization": f"Bearer {ANON}", "Content-Type": "application/json"})
            print("sugestões IA:", urllib.request.urlopen(rq, timeout=60).read().decode())
        except Exception as ex:   # banco ainda sem a função (SQL 9 não rodado) — não derruba o sync
            print("sugestões IA: pulado:", ex)
    print("OK")
