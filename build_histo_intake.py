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

def main():
    conn = pymysql.connect(host=HOST, user=USER, password=PWD, database=DB,
                           connect_timeout=20, read_timeout=180, charset="utf8mb4",
                           cursorclass=pymysql.cursors.DictCursor)
    cur = conn.cursor(); cur.execute(SQL, (MIN_ID,)); rows = cur.fetchall(); conn.close()
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
            "urgente": bool(r.get("urgencia")),
            "pet_love": pet,
            "data_entrada": ent.isoformat() if hasattr(ent, "isoformat") else (str(ent) if ent else None),
        })
    print("requisicoes encontradas:", len(items))
    url = SUPA_URL.rstrip("/") + "/rest/v1/rpc/intake_hf"
    payload = json.dumps({"p_token": TOKEN, "p_items": items}).encode("utf-8")
    req = urllib.request.Request(url, data=payload, headers={
        "Content-Type": "application/json",
        "apikey": SUPA_KEY,
        "Authorization": "Bearer " + SUPA_KEY,
    })
    try:
        resp = urllib.request.urlopen(req, timeout=90)
        print("resposta:", resp.read().decode())
    except urllib.error.HTTPError as e:
        print("HTTP", e.code, e.read().decode()); raise

if __name__ == "__main__":
    main()
