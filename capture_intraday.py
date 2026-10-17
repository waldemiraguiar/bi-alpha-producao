#!/usr/bin/env python3
"""Captura INTRADIÁRIA: a cada ~30 min grava quanto já foi lançado HOJE (q exames, f R$) até AGORA.
Alimenta a curva /api/intraday — que o painel usa para comparar "hoje a esta hora" com a média do
mesmo dia da semana a esta hora. Barato: 1 query agregada no espelho + 1 POST. Sem deploy.

Env: MYSQL_HOST, MYSQL_USER, MYSQL_PWD, MYSQL_DB(bi_alpha), BI_PWD(=senha do painel p/ x-pwd),
     SITE_URL (ex.: https://bi-alpha-waldemir.netlify.app)."""
import os, json, urllib.request, datetime
import pymysql

try:
    from zoneinfo import ZoneInfo
    NOW = datetime.datetime.now(ZoneInfo("America/Sao_Paulo"))
except Exception:
    NOW = datetime.datetime.utcnow() - datetime.timedelta(hours=3)  # BRT fallback

DATE = NOW.strftime("%Y-%m-%d")
SLOT = "%02d%02d" % (NOW.hour, 0 if NOW.minute < 30 else 30)  # faixa de 30 min: HHMM

SRC = dict(host=os.environ["MYSQL_HOST"], user=os.environ["MYSQL_USER"],
           password=os.environ["MYSQL_PWD"], database=os.environ.get("MYSQL_DB", "bi_alpha"),
           connect_timeout=30, read_timeout=120, charset="utf8mb4",
           cursorclass=pymysql.cursors.DictCursor)
EX = "TabExameNumeroSolicitado"

cx = pymysql.connect(**SRC); c = cx.cursor()
c.execute(f"SELECT COUNT(*) q, COALESCE(ROUND(SUM(ValorExame)),0) f FROM {EX} WHERE DATE(DataExame)=%s", (DATE,))
r = c.fetchone(); cx.close()
q, f = int(r["q"] or 0), int(r["f"] or 0)

site = os.environ["SITE_URL"].rstrip("/")
body = json.dumps({"date": DATE, "slot": SLOT, "q": q, "f": f}).encode()
req = urllib.request.Request(site + "/api/intraday", data=body, method="POST",
                             headers={"Content-Type": "application/json", "x-pwd": os.environ["BI_PWD"]})
try:
    with urllib.request.urlopen(req, timeout=30) as resp:
        print(f"[intraday] {DATE} {SLOT} -> q={q} f={f} · HTTP {resp.status} · {resp.read().decode()[:200]}")
except Exception as e:
    print(f"::warning::POST /api/intraday falhou: {e} (q={q} f={f})")
    raise
