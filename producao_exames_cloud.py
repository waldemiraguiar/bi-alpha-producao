#!/usr/bin/env python3
"""24/7 (GitHub Actions): nº de exames CONCLUÍDOS por mês×categoria (e por exame) do HF/MySQL bi_alpha
-> Supabase (producao_exames + producao_exames_det). Alimenta o CUSTO POR EXAME do estoque.
Env: MYSQL_HOST, MYSQL_USER, MYSQL_PWD, MYSQL_DB(bi_alpha), SUPABASE_URL, SUPABASE_SERVICE_KEY, MESES(opc)."""
import os, json, urllib.request, datetime, pymysql

MESES = int(os.environ.get("MESES", "8"))
SB_URL = os.environ.get("SUPABASE_URL", "https://lrwjcdvporaivxvfuiwt.supabase.co").rstrip("/")
SB_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
SRC = dict(host=os.environ["MYSQL_HOST"], user=os.environ["MYSQL_USER"], password=os.environ["MYSQL_PWD"],
           database=os.environ.get("MYSQL_DB", "bi_alpha"), connect_timeout=20, read_timeout=180, charset="utf8mb4")

def _ini():
    return (datetime.date.today().replace(day=1) - datetime.timedelta(days=31*(MESES-1))).replace(day=1)

def _q(sql):
    con = pymysql.connect(**SRC); c = con.cursor(); c.execute(sql, (_ini().isoformat(),))
    r = c.fetchall(); con.close(); return r

def cat():
    return [{"mes": x[0], "cod_categoria": int(x[1]), "categoria": x[2], "n": int(x[3])} for x in _q(
        "SELECT DATE_FORMAT(e.DataExame,'%%Y-%%m'), e.CodCategoria, "
        "MAX(COALESCE(cat.Categoria,CONCAT('Cat ',e.CodCategoria))), COUNT(*) "
        "FROM TabExameNumeroSolicitado e LEFT JOIN TabCategoria cat ON cat.CodCategoria=e.CodCategoria "
        "WHERE e.DataExame IS NOT NULL AND e.DataExame>=%s AND e.DataExame<=CURDATE() GROUP BY 1,2")]

def det():
    seen = {}
    for x in _q(
        "SELECT DATE_FORMAT(e.DataExame,'%%Y-%%m'), e.CodCategoria, "
        "MAX(COALESCE(cat.Categoria,CONCAT('Cat ',e.CodCategoria))), COALESCE(e.CodExame,0), "
        "MAX(COALESCE(e.Exame,CONCAT('Exame ',e.CodExame))), COUNT(*) "
        "FROM TabExameNumeroSolicitado e LEFT JOIN TabCategoria cat ON cat.CodCategoria=e.CodCategoria "
        "WHERE e.DataExame IS NOT NULL AND e.DataExame>=%s AND e.DataExame<=CURDATE() GROUP BY 1,2,4"):
        seen[(x[0], int(x[1]), int(x[3]))] = {"mes": x[0], "cod_categoria": int(x[1]), "categoria": x[2],
                                              "cod_exame": int(x[3]), "exame": x[4], "n": int(x[5])}
    return list(seen.values())

def up(tab, rows, conf):
    if not SB_KEY:
        print("SEM SUPABASE_SERVICE_KEY — não enviei", tab); return
    for i in range(0, len(rows), 2000):
        b = rows[i:i+2000]
        req = urllib.request.Request(f"{SB_URL}/rest/v1/{tab}?on_conflict={conf}", data=json.dumps(b).encode(),
            method="POST", headers={"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}",
            "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"})
        urllib.request.urlopen(req, timeout=90); print(f"{tab}: +{len(b)}")

if __name__ == "__main__":
    c = cat(); print("categoria:", len(c)); up("producao_exames", c, "mes,cod_categoria")
    d = det(); print("detalhe:", len(d)); up("producao_exames_det", d, "mes,cod_categoria,cod_exame")
    print("OK")
