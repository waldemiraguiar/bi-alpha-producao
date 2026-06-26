# -*- coding: utf-8 -*-
"""Robo de intake da Histotecnica.
Le no MySQL (HF) as requisicoes NOVAS de histopatologia (Histologia 1-7 + Cell Block,
categoria 15) e grava no app chamando a funcao SQL public.intake_hf (RPC do Supabase),
que valida um token e insere na etapa 1. Roda a cada 10 min no GitHub Actions.
Idempotente (a funcao ignora numero_hf ja existente).
"""
import os, json, urllib.request, urllib.error, pymysql

HOST = os.environ["MYSQL_HOST"]; USER = os.environ["MYSQL_USER"]
PWD  = os.environ["MYSQL_PWD"];  DB   = os.environ["MYSQL_DB"]
TOKEN  = os.environ["HISTO_INTAKE_TOKEN"]
SUPA_URL = os.environ.get("SUPA_URL", "https://lrwjcdvporaivxvfuiwt.supabase.co")
SUPA_KEY = os.environ.get("SUPA_ANON_KEY", "sb_publishable_fcodHc3AxR_HQ-aduMGzlg_CTBALng8")  # chave publica (anon)
# MARCO: so importa requisicoes criadas a partir daqui (CodNumeroSequencialTela e sempre crescente).
# Definido em 22/06/2026 14:29 para "comecar do zero" sem reimportar as 34 que o Eduardo ja trabalhou.
MIN_ID = int(os.environ.get("HF_MIN_ID", "912749"))

SQL = (
    "SELECT r.NumeroSequencial AS hf, r.Animal AS animal, r.Proprietario AS tutor, "
    "r.Especie AS especie, r.Cliente AS cliente, r.DataEntrada AS entrada, r.Urgencia AS urgencia, "
    "GROUP_CONCAT(DISTINCT s.Exame SEPARATOR ' | ') AS exames "
    "FROM TabExameNumeroSolicitado s "
    "JOIN `TabExameNumeroRequisiçao` r ON r.CodNumeroSequencialTela = s.CodNumeroSequencialTela "
    "WHERE s.CodCategoria = 15 AND (s.Exame LIKE 'Histologia%%' OR s.Exame LIKE '%%Cell Block%%') "
    "AND s.Exame NOT LIKE 'Solicita%%' AND r.CodNumeroSequencialTela > %s "
    "GROUP BY r.CodNumeroSequencialTela"
)

# Liberados no HF (laudo enviado ao cliente): EnviadoParaSite=1 / DataEnvioSite preenchido.
# So a partir do MARCO (os que existem no app). O app finaliza por inteiro -> vai pro Historico.
SQL_LIBERADOS = (
    "SELECT r.NumeroSequencial AS hf "
    "FROM TabExameNumeroSolicitado s "
    "JOIN `TabExameNumeroRequisiçao` r ON r.CodNumeroSequencialTela = s.CodNumeroSequencialTela "
    "WHERE s.CodCategoria = 15 AND (s.Exame LIKE 'Histologia%%' OR s.Exame LIKE '%%Cell Block%%') "
    "AND s.Exame NOT LIKE 'Solicita%%' AND r.CodNumeroSequencialTela > %s "
    "AND (r.EnviadoParaSite = 1 OR r.DataEnvioSite IS NOT NULL) "
    "GROUP BY r.CodNumeroSequencialTela"
)

def rpc(nome, payload):
    url = SUPA_URL.rstrip("/") + "/rest/v1/rpc/" + nome
    req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers={
        "Content-Type": "application/json", "apikey": SUPA_KEY, "Authorization": "Bearer " + SUPA_KEY})
    resp = urllib.request.urlopen(req, timeout=90)
    return resp.read().decode()

def main():
    conn = pymysql.connect(host=HOST, user=USER, password=PWD, database=DB,
                           connect_timeout=20, read_timeout=180, charset="utf8mb4",
                           cursorclass=pymysql.cursors.DictCursor)
    cur = conn.cursor(); cur.execute(SQL, (MIN_ID,)); rows = cur.fetchall()
    cur.execute(SQL_LIBERADOS, (MIN_ID,)); liberados = [str(r["hf"]) for r in cur.fetchall()]; conn.close()
    items = []
    for r in rows:
        cliente = (r.get("cliente") or ""); tutor = (r.get("tutor") or ""); animal = (r.get("animal") or "")
        pet = "petlove" in (cliente + tutor + animal).lower().replace(" ", "")
        ent = r.get("entrada")
        items.append({
            "numero_hf": str(r["hf"]),
            "nome_paciente": animal,
            "tutor": tutor,
            "especie": r.get("especie") or "",
            "tipo_material": r.get("exames") or "",
            "observacoes": ("Cliente: " + cliente) if cliente else "",
            "urgente": (r.get("urgencia") == 1),   # HF: 1=urgente, 2=normal/rotina
            "pet_love": pet,
            # meio-dia para a DATA do HF nao "voltar 1 dia" no fuso do Brasil (senao conta dia 2)
            "data_entrada": (ent.strftime("%Y-%m-%d") + "T12:00:00") if ent else None,
        })
    print("requisicoes encontradas:", len(items))
    try:
        print("intake:", rpc("intake_hf", {"p_token": TOKEN, "p_items": items}))
    except urllib.error.HTTPError as e:
        print("HTTP intake", e.code, e.read().decode()); raise

    # baixa automatica dos liberados no HF (nao-fatal: se a funcao ainda nao existir, segue a vida)
    print("liberados no HF (>marco):", len(liberados))
    try:
        print("finalizar:", rpc("finalizar_hf", {"p_token": TOKEN, "p_numeros": liberados}))
    except urllib.error.HTTPError as e:
        print("HTTP finalizar", e.code, e.read().decode(), "(crie a funcao finalizar_hf no Supabase)")
    except Exception as e:
        print("finalizar falhou (nao-fatal):", e)

if __name__ == "__main__":
    main()
