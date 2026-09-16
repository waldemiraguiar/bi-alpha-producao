#!/usr/bin/env python3
"""Le no MySQL (HF) as CITOLOGIAS NEOPLASICAS novas e manda pro Supabase (tabela citologias, RPC intake_cito).
Idempotente (a funcao ignora numero_hf ja existente). Citologia NAO tem etapas (exame rapido)."""
import os, json, urllib.request, urllib.error
import pymysql

HOST = os.environ["MYSQL_HOST"]; USER = os.environ["MYSQL_USER"]
PWD  = os.environ["MYSQL_PWD"];  DB   = os.environ["MYSQL_DB"]
TOKEN = os.environ["HISTO_INTAKE_TOKEN"]
SUPA_URL = os.environ.get("SUPA_URL", "https://lrwjcdvporaivxvfuiwt.supabase.co")
SUPA_KEY = os.environ.get("SUPA_ANON_KEY", "sb_publishable_fcodHc3AxR_HQ-aduMGzlg_CTBALng8")
# MARCO: comeca das citologias recentes (ultimas ~2 semanas) e novas daqui pra frente. Nao reimporta as antigas.
MIN_ID = int(os.environ.get("CITO_MIN_ID", "935880"))

SQL = (
    "SELECT r.NumeroSequencial AS hf, r.Animal AS animal, r.Proprietario AS tutor, "
    "r.Especie AS especie, r.Cliente AS cliente, r.DataEntrada AS entrada, r.Urgencia AS urgencia, "
    "GROUP_CONCAT(DISTINCT s.Exame SEPARATOR ' | ') AS exames "
    "FROM TabExameNumeroSolicitado s "
    "JOIN `TabExameNumeroRequisiçao` r ON r.CodNumeroSequencialTela = s.CodNumeroSequencialTela "
    "WHERE s.CodCategoria = 15 AND s.Exame LIKE 'Citologia Neopl%%' "
    "AND s.Exame NOT LIKE 'Solicita%%' AND r.CodNumeroSequencialTela > %s "
    "GROUP BY r.CodNumeroSequencialTela"
)

def rpc(nome, payload):
    url = SUPA_URL.rstrip("/") + "/rest/v1/rpc/" + nome
    req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers={
        "Content-Type": "application/json", "apikey": SUPA_KEY, "Authorization": "Bearer " + SUPA_KEY})
    return urllib.request.urlopen(req, timeout=90).read().decode()

def main():
    conn = pymysql.connect(host=HOST, user=USER, password=PWD, database=DB,
                           connect_timeout=20, read_timeout=180, charset="utf8mb4",
                           cursorclass=pymysql.cursors.DictCursor)
    cur = conn.cursor(); cur.execute(SQL, (MIN_ID,)); rows = cur.fetchall(); conn.close()
    items = []
    for r in rows:
        cliente = (r.get("cliente") or ""); tutor = (r.get("tutor") or ""); animal = (r.get("animal") or "")
        pet = "petlove" in (cliente + tutor + animal).lower().replace(" ", "")
        cabo_frio = "cabofrio" in cliente.lower().replace(" ", "")
        ent = r.get("entrada")
        items.append({
            "numero_hf": str(r["hf"]),
            "nome_paciente": animal,
            "tutor": tutor,
            "especie": r.get("especie") or "",
            "tipo_material": r.get("exames") or "",
            "observacoes": ("Cliente: " + cliente) if cliente else "",
            "urgente": (r.get("urgencia") == 1) or cabo_frio,
            "pet_love": pet,
            "data_entrada": (ent.strftime("%Y-%m-%d") + "T12:00:00") if ent else None,
        })
    print("citologias encontradas:", len(items))
    try:
        print("intake_cito:", rpc("intake_cito", {"p_token": TOKEN, "p_items": items}))
    except urllib.error.HTTPError as e:
        print("HTTP intake_cito", e.code, e.read().decode()); raise

if __name__ == "__main__":
    main()
