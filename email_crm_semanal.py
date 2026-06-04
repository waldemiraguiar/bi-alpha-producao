#!/usr/bin/env python3
"""Relatório SEMANAL de produtividade do CRM por e-mail (Agentes de IA Alpha).

Leve: NÃO toca no MySQL. Lê os registros de contato da função /api/interacoes e a
movimentação do crm.enc (descriptografa com CRM_PWD) só para cruzar 'reativados'.
Envia via Gmail SMTP. Mesma família do email_radar.py.

Env: CRM_PWD, GMAIL_USER, GMAIL_APP_PASSWORD, CRM_TO (ou EMAIL_TO)."""
import os, json, base64, ssl, smtplib, time, datetime, urllib.request
from email.mime.text import MIMEText
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

BASE = os.environ.get("CRM_BASE", "https://agente-crm-matriz.netlify.app")
CRM_PWD = os.environ["CRM_PWD"]
NOW = int(time.time() * 1000)
WEEK = NOW - 7 * 86400_000
MONTH = NOW - 30 * 86400_000
hoje = datetime.date.today().strftime("%d/%m/%Y")

RES = {"positivo": ("Positivo", "#00A878"), "negociacao": ("Em negociação", "#1C7ED6"),
       "sem_resposta": ("Sem resposta", "#E8A317"), "negativo": ("Negativo", "#E03131")}

def fetch_json(url):
    req = urllib.request.Request(url + ("&" if "?" in url else "?") + "_=" + str(NOW),
                                 headers={"User-Agent": "crm-report"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())

def decrypt_enc(env):
    key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32,
                     salt=base64.b64decode(env["salt"]), iterations=env["iter"]).derive(CRM_PWD.encode())
    return json.loads(AESGCM(key).decrypt(base64.b64decode(env["iv"]),
                                          base64.b64decode(env["ct"]), None).decode())

# ---- dados ----
inter = fetch_json(BASE + "/api/interacoes").get("interacoes", [])
try:
    D = decrypt_enc(fetch_json(BASE + "/data/crm.enc"))
except Exception:
    D = {}
parados = {str(x["cod"]) for x in D.get("parados", [])}
queda = {str(x["cod"]) for x in (D.get("em_queda", []) + D.get("queda_forte", []))}

sem = [x for x in inter if x.get("ts", 0) >= WEEK]
mes = [x for x in inter if x.get("ts", 0) >= MONTH]

def conta(lst, campo="resultado"):
    d = {}
    for x in lst:
        d[x.get(campo)] = d.get(x.get(campo), 0) + 1
    return d

por_res = {k: 0 for k in RES}
for x in sem:
    if x.get("resultado") in por_res:
        por_res[x["resultado"]] += 1
por_pessoa = {}
for x in sem:
    p = x.get("por") or "equipe"
    por_pessoa.setdefault(p, {"n": 0, "pos": 0})
    por_pessoa[p]["n"] += 1
    if x.get("resultado") == "positivo":
        por_pessoa[p]["pos"] += 1
motivos = {}
for x in sem:
    if x.get("resultado") == "negativo" and x.get("motivo"):
        motivos[x["motivo"]] = motivos.get(x["motivo"], 0) + 1

# reativados (cruza snapshot ruim x estado atual fora de parados/queda)
contatados = {str(x["cod"]) for x in inter}
reativados = []
for cod in contatados:
    ints = [x for x in inter if str(x.get("cod")) == cod]
    ruim = any((s.get("dias_inativo") or 0) >= 21 or (s.get("delta") is not None and s["delta"] <= -10)
               or s.get("situacao") in ("parado", "queda", "queda_forte")
               for s in (i.get("snapshot") or {} for i in ints))
    if ruim and cod not in parados and cod not in queda:
        nome = next((i.get("cliente") for i in ints if i.get("cliente")), "#" + cod)
        reativados.append(nome)

tot_sem = len(sem)
pos_sem = por_res["positivo"]
pct = round(100 * pos_sem / tot_sem) if tot_sem else 0

# retornos pendentes (hoje/atrasado) a partir do último contato com proximo_passo
hoje_d = datetime.date.today()
pend = []
for cod in contatados:
    ints = sorted([x for x in inter if str(x.get("cod")) == cod and x.get("proximo_passo")],
                  key=lambda x: -x.get("ts", 0))
    if not ints:
        continue
    try:
        d = datetime.date.fromisoformat(ints[0]["proximo_passo"])
    except Exception:
        continue
    if d <= hoje_d:
        pend.append((ints[0].get("cliente") or ("#" + cod), (hoje_d - d).days))

# ---- HTML ----
def kpi(v, l, cor="#0A1628"):
    return (f"<td style='padding:14px 10px;text-align:center;border:1px solid #e6e9ef;border-radius:10px'>"
            f"<div style='font-size:30px;font-weight:800;color:{cor}'>{v}</div>"
            f"<div style='font-size:12px;color:#777;margin-top:3px'>{l}</div></td>")

def barra(lbl, n, tot, cor):
    w = round(100 * n / tot) if tot else 0
    return (f"<tr><td style='padding:4px 8px;font-size:13px'>{lbl}</td>"
            f"<td style='padding:4px 8px;width:60%'><div style='background:#eef1f6;border-radius:6px'>"
            f"<div style='background:{cor};height:14px;border-radius:6px;width:{max(2,w)}%'></div></div></td>"
            f"<td style='padding:4px 8px;font-weight:800;text-align:right'>{n}</td></tr>")

res_rows = "".join(barra(RES[k][0], por_res[k], tot_sem, RES[k][1]) for k in RES)
pess_rows = "".join(
    f"<tr><td style='padding:5px 10px'>{p}</td><td style='padding:5px 10px;text-align:right'>{v['n']}</td>"
    f"<td style='padding:5px 10px;text-align:right;color:#00A878;font-weight:800'>{v['pos']}</td></tr>"
    for p, v in sorted(por_pessoa.items(), key=lambda x: -x[1]["n"]))
mot_rows = "".join(f"<li>{m} — <b>{n}</b></li>" for m, n in sorted(motivos.items(), key=lambda x: -x[1])) or "<li>Nenhuma perda registrada. 🎉</li>"
reat_html = (", ".join(reativados[:20]) + (f" +{len(reativados)-20}" if len(reativados) > 20 else "")) if reativados else "—"
pend_html = "".join(f"<li>{n} — <b style='color:#E03131'>{'hoje' if d==0 else str(d)+'d atrás'}</b></li>"
                    for n, d in sorted(pend, key=lambda x: -x[1])[:15]) or "<li>Nenhum retorno pendente. 👍</li>"

html = f"""<div style='font-family:Arial;max-width:760px;margin:auto;color:#1a1a1a'>
<div style='background:#0A1628;color:#fff;padding:18px 22px;border-radius:10px'>
  <h2 style='margin:0'>📋 Relatório semanal do CRM — Lab Alpha</h2>
  <div style='color:#8aa2bd;font-size:13px;margin-top:4px'>{hoje} · produtividade dos últimos 7 dias · Agentes de IA Alpha</div></div>
<table style='width:100%;border-collapse:separate;border-spacing:8px;margin:14px 0;font-family:Arial'><tr>
  {kpi(tot_sem, "Contatos na semana")}
  {kpi(str(pct)+"%", "Taxa de sucesso", "#00A878")}
  {kpi(len(reativados), "Clientes reativados", "#00A878")}
  {kpi(len(mes), "Contatos no mês")}
</tr></table>
<h3 style='font-family:Arial;margin:18px 0 6px'>Resultados da semana</h3>
<table style='width:100%;border-collapse:collapse;font-family:Arial'>{res_rows}</table>
<h3 style='font-family:Arial;margin:18px 0 6px'>Por colaborador</h3>
<table style='width:100%;border-collapse:collapse;font-family:Arial;font-size:13px'>
  <tr style='background:#0A1628;color:#fff'><th style='padding:6px 10px;text-align:left'>Colaborador</th>
  <th style='padding:6px 10px;text-align:right'>Contatos</th><th style='padding:6px 10px;text-align:right'>Positivos</th></tr>
  {pess_rows or "<tr><td colspan=3 style='padding:8px;color:#888'>Sem contatos na semana.</td></tr>"}</table>
<h3 style='font-family:Arial;margin:18px 0 6px'>✅ Clientes reativados</h3>
<p style='font-size:14px;color:#00A878;font-weight:700'>{reat_html}</p>
<h3 style='font-family:Arial;margin:18px 0 6px'>↻ Retornos pendentes</h3>
<ul style='font-size:14px'>{pend_html}</ul>
<h3 style='font-family:Arial;margin:18px 0 6px'>Motivos de perda</h3>
<ul style='font-size:14px'>{mot_rows}</ul>
<div style='margin-top:22px;text-align:center'>
  <a href='{BASE}' style='display:inline-block;background:linear-gradient(135deg,#00D4FF,#00E5A0);color:#0A1628;font-weight:800;font-size:14px;text-decoration:none;border-radius:10px;padding:12px 22px'>🎯 Abrir o Agente CRM</a></div>
<p style='color:#888;font-size:12px;margin-top:18px'>Relatório automático semanal · sem valores financeiros · Agentes de IA Alpha.</p></div>"""

GU = os.environ.get("GMAIL_USER", ""); GP = os.environ.get("GMAIL_APP_PASSWORD", "").replace(" ", "")
TO = (os.environ.get("CRM_TO") or os.environ.get("EMAIL_TO") or GU).strip()
if os.environ.get("DRY_RUN"):
    print(f"[DRY_RUN] sem envio. assunto: 📋 CRM da semana — {tot_sem} contatos · {pct}% sucesso · {len(reativados)} reativados")
    print(f"[DRY_RUN] por_resultado={por_res} | por_pessoa={ {k:v['n'] for k,v in por_pessoa.items()} } | reativados={len(reativados)} | retornos_pendentes={len(pend)} | html_bytes={len(html)}")
    raise SystemExit(0)
msg = MIMEText(html, "html", "utf-8")
msg["Subject"] = f"📋 CRM da semana — {tot_sem} contatos · {pct}% sucesso · {len(reativados)} reativados ({hoje})"
msg["From"] = GU; msg["To"] = TO
with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=ssl.create_default_context()) as s:
    s.login(GU, GP)
    s.sendmail(GU, [t.strip() for t in TO.split(",") if t.strip()], msg.as_string())
print(f"CRM report -> {TO} | {tot_sem} contatos, {pct}% sucesso, {len(reativados)} reativados, {len(pend)} retornos pendentes.")
