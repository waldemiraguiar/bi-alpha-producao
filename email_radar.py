#!/usr/bin/env python3
"""E-mail semanal do RADAR de clientes (variações ±10% na semana vs média das 4 anteriores).
Reusa build_financeiro.build() para obter o radar. Envia via Gmail SMTP (app password).
Env: MYSQL_*, BI_PWD (exigido pelo módulo), GMAIL_USER, GMAIL_APP_PASSWORD, EMAIL_TO."""
import os, smtplib, ssl, datetime
from email.mime.text import MIMEText
from build_financeiro import build

D = build()
radar = D.get("radar", [])
rs = D.get("tiers_resumo", {})
hoje = datetime.date.today().strftime("%d/%m/%Y")

def brl(n): return "R$ " + f"{round(n):,}".replace(",", ".")
sobe = [x for x in radar if x["flag"] == "up"]
cai  = [x for x in radar if x["flag"] == "down"]
# prioridade: quedas de AAA/A no topo
prior = [x for x in cai if x["tier"] in ("AAA", "A")]

def linha(x):
    cor = "#E03131" if x["flag"] == "down" else "#1C7ED6"
    seta = "▼" if x["flag"] == "down" else "▲"
    return (f"<tr><td style='padding:6px 10px'><b>{x['tier']}</b></td>"
            f"<td style='padding:6px 10px'>{x['nome'] or ('#'+str(x['cod']))}</td>"
            f"<td style='padding:6px 10px;color:#666'>{x.get('cidade') or '—'}</td>"
            f"<td style='padding:6px 10px;text-align:right'>{brl(x['atual'])}</td>"
            f"<td style='padding:6px 10px;text-align:right;color:#666'>{brl(x['base'])}</td>"
            f"<td style='padding:6px 10px;text-align:right;font-weight:800;color:{cor}'>{seta} {abs(x['delta'])}%</td></tr>")

def tabela(titulo, lst):
    if not lst: return ""
    rows = "".join(linha(x) for x in lst)
    return (f"<h3 style='font-family:Arial;margin:18px 0 6px'>{titulo}</h3>"
            f"<table style='border-collapse:collapse;font-family:Arial;font-size:13px;width:100%'>"
            f"<tr style='background:#0A1628;color:#fff'><th style='padding:6px 10px;text-align:left'>Tier</th>"
            f"<th style='padding:6px 10px;text-align:left'>Cliente</th><th style='padding:6px 10px;text-align:left'>Cidade</th>"
            f"<th style='padding:6px 10px;text-align:right'>Semana</th><th style='padding:6px 10px;text-align:right'>Média 4 sem</th>"
            f"<th style='padding:6px 10px;text-align:right'>Variação</th></tr>{rows}</table>")

html = f"""<div style='font-family:Arial;max-width:760px;margin:auto;color:#1a1a1a'>
<div style='background:#0A1628;color:#fff;padding:18px 22px;border-radius:10px'>
  <h2 style='margin:0'>📊 Radar semanal de clientes — Lab Alpha</h2>
  <div style='color:#8aa2bd;font-size:13px;margin-top:4px'>{hoje} · variação da última semana vs média das 4 anteriores (±10%)</div>
</div>
<p style='font-size:14px'><b>{len(cai)}</b> clientes em <span style='color:#E03131'>queda</span> ·
  <b>{len(sobe)}</b> em <span style='color:#1C7ED6'>alta</span>.
  {('<b style="color:#E03131">⚠ '+str(len(prior))+' cliente(s) AAA/A em queda — priorizar contato.</b>') if prior else ''}</p>
{tabela('⚠ Prioridade — AAA/A em queda', prior)}
{tabela('▼ Quedas ≥10%', cai)}
{tabela('▲ Altas ≥10%', sobe)}
<p style='color:#888;font-size:12px;margin-top:20px'>Painel completo: https://bi-alpha-waldemir.netlify.app (aba Clientes · Tiers).<br>
Valores = faturamento (valor cobrado). E-mail automático semanal.</p></div>"""

GU, GP, TO = os.environ["GMAIL_USER"], os.environ["GMAIL_APP_PASSWORD"], os.environ.get("EMAIL_TO", os.environ["GMAIL_USER"])
msg = MIMEText(html, "html", "utf-8")
msg["Subject"] = f"📊 Radar de clientes — {len(cai)} quedas / {len(sobe)} altas ({hoje})"
msg["From"] = GU; msg["To"] = TO
with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=ssl.create_default_context()) as s:
    s.login(GU, GP.replace(" ", "")); s.sendmail(GU, [t.strip() for t in TO.split(",")], msg.as_string())
print(f"E-mail enviado p/ {TO}: {len(cai)} quedas, {len(sobe)} altas.")
