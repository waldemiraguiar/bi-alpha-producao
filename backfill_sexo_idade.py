# -*- coding: utf-8 -*-
"""Robo diario: mantem sexo/idade 100% na cache hf_paciente (Supabase), puxando do HF VIVO (bi_alpha).
Le as requisicoes de histopatologia MAIS RECENTES no MySQL (mesma fonte do intake) e faz upsert
via RPC hf_paciente_set. Sem restore, sem container: consulta o banco vivo. Idempotente e fail-safe.
Cobre os exames que entram na esteira -> a fila/aba do JARVAS sempre com sexo/idade preenchidos."""
import os, re, json, urllib.request, pymysql

HOST=os.environ["MYSQL_HOST"]; USER=os.environ["MYSQL_USER"]; PWD=os.environ["MYSQL_PWD"]; DB=os.environ["MYSQL_DB"]
SUPA=os.environ.get("SUPA_URL","https://lrwjcdvporaivxvfuiwt.supabase.co")
KEY=os.environ.get("SUPA_ANON_KEY","sb_publishable_fcodHc3AxR_HQ-aduMGzlg_CTBALng8")
N=int(os.environ.get("BACKFILL_N","500"))

SQL=("SELECT r.NumeroSequencial hf, r.Sexo sexo, r.Idade idade, r.Raça raca "
     "FROM TabExameNumeroSolicitado s "
     "JOIN `TabExameNumeroRequisiçao` r ON r.CodNumeroSequencialTela = s.CodNumeroSequencialTela "
     "WHERE s.CodCategoria = 15 AND (s.Exame LIKE 'Histologia%%' OR s.Exame LIKE '%%Cell Block%%') "
     "AND s.Exame NOT LIKE 'Solicita%%' "
     "GROUP BY r.CodNumeroSequencialTela ORDER BY r.CodNumeroSequencialTela DESC LIMIT %s")

def sx(g):
    g=(g or "").strip().upper()
    return "Macho" if g.startswith("M") else ("Fêmea" if g.startswith("F") else "")
def idf(s):
    s=(s or "").upper(); a=re.search(r"(\d+)\s*A",s); m=re.search(r"(\d+)\s*M",s)
    a=int(a.group(1)) if a else 0; mo=int(m.group(1)) if m else 0
    return ("%da %dm"%(a,mo) if a and mo else ("%da"%a if a else ("%dm"%mo if mo else "")))
def upsert(hf,sexo,idade,raca):
    body=json.dumps({"p_hf":hf,"p_sexo":sexo or None,"p_idade":idade or None,"p_raca":raca}).encode()
    req=urllib.request.Request(SUPA.rstrip("/")+"/rest/v1/rpc/hf_paciente_set",data=body,
        headers={"Content-Type":"application/json","apikey":KEY,"Authorization":"Bearer "+KEY})
    urllib.request.urlopen(req,timeout=30).read()

def main():
    cn=pymysql.connect(host=HOST,user=USER,password=PWD,database=DB,charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,connect_timeout=20)
    cur=cn.cursor(); cur.execute(SQL,(N,)); rows=cur.fetchall(); cn.close()
    ok=0; skip=0
    for r in rows:
        hf="".join(c for c in str(r.get("hf") or "") if c.isdigit())
        if not hf: continue
        sexo=sx(r.get("sexo")); idade=idf(r.get("idade")); raca=(str(r.get("raca") or "").strip() or None)
        if not (sexo or idade): skip+=1; continue
        try: upsert(hf,sexo,idade,raca); ok+=1
        except Exception as e: print("ERR",hf,str(e)[:60])
    print("backfill sexo/idade: %d recentes · gravados %d · sem dado %d" % (len(rows),ok,skip))

if __name__=="__main__": main()
