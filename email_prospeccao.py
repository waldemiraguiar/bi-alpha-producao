#!/usr/bin/env python3
"""Resumo SEMANAL de PROSPECÇÃO do CRM (sexta 17h BRT) — e-mail + texto pronto p/ WhatsApp.
Lê a função /api/crm-prospeccao (pública), calcula a semana vs a anterior (tendência
interna = "mercado bom/ruim") e o pipeline atual. Sem MySQL.
Env: GMAIL_USER, GMAIL_APP_PASSWORD, CRM_TO (ou EMAIL_TO), CRM_BASE (opcional)."""
import os, json, ssl, smtplib, time, datetime, urllib.request, urllib.parse
from email.mime.text import MIMEText

BASE = os.environ.get("CRM_BASE", "https://agente-crm-matriz.netlify.app").rstrip("/")
NOW = int(time.time() * 1000)
W1, W2 = NOW - 7 * 86400_000, NOW - 14 * 86400_000
hoje = datetime.date.today().strftime("%d/%m/%Y")
SLBL = {"novo": "Novos", "em_contato": "Em contato", "visita_agendada": "Visita agendada",
        "grupo_aberto": "Grupo aberto", "venda_ganha": "Venda ganha", "venda_perdida": "Venda perdida"}

def fetch(url):
    req = urllib.request.Request(url + ("&" if "?" in url else "?") + "_=" + str(NOW), headers={"User-Agent": "prosp"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())

prospects = fetch(BASE + "/api/crm-prospeccao").get("prospects", [])

def novos(ini, fim): return [p for p in prospects if ini <= (p.get("ts") or 0) < fim]
def fbs(ini, fim):
    n = 0
    for p in prospects:
        for f in (p.get("feedbacks") or []):
            if ini <= (f.get("ts") or 0) < fim:
                n += 1
    return n
def por_status():
    d = {k: 0 for k in SLBL}
    for p in prospects:
        if p.get("status") in d:
            d[p["status"]] += 1
    return d

nov_sem, nov_ant = len(novos(W1, NOW)), len(novos(W2, W1))
fb_sem, fb_ant = fbs(W1, NOW), fbs(W2, W1)
st = por_status()
ganhas_sem = len([p for p in prospects if p.get("status") == "venda_ganha" and (p.get("ts_upd") or 0) >= W1])
perdidas_sem = len([p for p in prospects if p.get("status") == "venda_perdida" and (p.get("ts_upd") or 0) >= W1])
total = len(prospects)
fechadas = st["venda_ganha"] + st["venda_perdida"]
conv = round(100 * st["venda_ganha"] / fechadas) if fechadas else 0

def seta(a, b): return "▲" if a > b else "▼" if a < b else "→"
# veredito de "mercado interno"
score = (1 if nov_sem >= nov_ant else -1) + (1 if fb_sem >= fb_ant else -1) + (1 if ganhas_sem >= perdidas_sem else -1)
verdito = ("⚪ sem prospecção registrada ainda" if total == 0 else
           "🟢 ritmo BOM — prospecção aquecendo" if score >= 2 else
           "🟡 ritmo estável — atenção" if score >= 0 else
           "🔴 ritmo FRACO — prospecção esfriou")

# ---- texto WhatsApp ----
wpp = (f"*Prospecção CRM — semana {hoje}*\n"
       f"{verdito}\n\n"
       f"• Novos leads: {nov_sem} ({seta(nov_sem,nov_ant)} vs {nov_ant})\n"
       f"• Contatos de prospecção: {fb_sem} ({seta(fb_sem,fb_ant)} vs {fb_ant})\n"
       f"• Visitas agendadas: {st['visita_agendada']}\n"
       f"• Vendas ganhas (semana): {ganhas_sem} · perdidas: {perdidas_sem}\n"
       f"• Pipeline: {total} prospects · conversão {conv}%\n\n"
       f"Painel: {BASE} (aba Prospecção)")
wa_link = "https://wa.me/?text=" + urllib.parse.quote(wpp)

def card(v, l, cor="#0A1628"):
    return (f"<td style='padding:14px 10px;text-align:center;border:1px solid #e6e9ef;border-radius:10px'>"
            f"<div style='font-size:28px;font-weight:800;color:{cor}'>{v}</div>"
            f"<div style='font-size:12px;color:#777;margin-top:3px'>{l}</div></td>")
pipe = "".join(f"<tr><td style='padding:5px 10px'>{SLBL[k]}</td><td style='padding:5px 10px;text-align:right;font-weight:800'>{st[k]}</td></tr>" for k in SLBL)

html = f"""<div style='font-family:Arial;max-width:760px;margin:auto;color:#1a1a1a'>
<div style='background:#0A1628;color:#fff;padding:18px 22px;border-radius:10px'>
  <h2 style='margin:0'>🧲 Prospecção — resumo da semana</h2>
  <div style='color:#8aa2bd;font-size:13px;margin-top:4px'>{hoje} · trabalho de prospecção do CRM · Agentes de IA Alpha</div></div>
<p style='font-size:16px;font-weight:700;margin:16px 0 4px'>{verdito}</p>
<p style='font-size:12.5px;color:#777;margin:0 0 12px'>Tendência interna (semana vs anterior). Mercado externo: <i>fonte a definir</i>.</p>
<table style='width:100%;border-collapse:separate;border-spacing:8px;font-family:Arial'><tr>
  {card(f"{nov_sem}", f"Novos leads ({seta(nov_sem,nov_ant)} vs {nov_ant})")}
  {card(f"{fb_sem}", f"Contatos ({seta(fb_sem,fb_ant)} vs {fb_ant})")}
  {card(st['visita_agendada'], "Visitas agendadas", "#E8A317")}
  {card(f"{ganhas_sem}", "Vendas ganhas (sem.)", "#00A878")}
  {card(f"{conv}%", "Conversão", "#00A878")}
</tr></table>
<h3 style='font-family:Arial;margin:18px 0 6px'>Pipeline atual ({total} prospects)</h3>
<table style='width:100%;border-collapse:collapse;font-family:Arial;font-size:13px'>{pipe}</table>
<div style='margin:22px 0;text-align:center'>
  <a href='{BASE}' style='display:inline-block;background:linear-gradient(135deg,#00D4FF,#00E5A0);color:#0A1628;font-weight:800;font-size:14px;text-decoration:none;border-radius:10px;padding:12px 22px'>🧲 Abrir Prospecção</a>
  &nbsp;
  <a href='{wa_link}' style='display:inline-block;background:#25D366;color:#fff;font-weight:800;font-size:14px;text-decoration:none;border-radius:10px;padding:12px 22px'>📲 Enviar no WhatsApp</a>
</div>
<div style='background:#f3f5f9;border-radius:10px;padding:14px 16px;font-family:monospace;font-size:12.5px;white-space:pre-wrap;color:#333'>{wpp}</div>
<p style='color:#888;font-size:12px;margin-top:16px'>Copie o texto acima ou clique em "Enviar no WhatsApp". Resumo automático · sexta 17h.</p></div>"""

GU = os.environ.get("GMAIL_USER", ""); GP = os.environ.get("GMAIL_APP_PASSWORD", "").replace(" ", "")
TO = (os.environ.get("CRM_TO") or os.environ.get("EMAIL_TO") or GU).strip()
CB_PHONE = os.environ.get("CALLMEBOT_PHONE", "").strip()
CB_KEY = os.environ.get("CALLMEBOT_APIKEY", "").strip()

def enviar_whatsapp():
    """CallMeBot (opcional): envia o texto pronto no WhatsApp. Falha não derruba o e-mail."""
    if not (CB_PHONE and CB_KEY):
        print("WhatsApp: CallMeBot não configurado (defina CALLMEBOT_PHONE e CALLMEBOT_APIKEY)."); return
    try:
        u = ("https://api.callmebot.com/whatsapp.php?phone=" + urllib.parse.quote(CB_PHONE)
             + "&text=" + urllib.parse.quote(wpp) + "&apikey=" + urllib.parse.quote(CB_KEY))
        with urllib.request.urlopen(u, timeout=30) as r:
            print(f"WhatsApp (CallMeBot) -> {CB_PHONE}: HTTP {r.status}")
    except Exception as e:
        print("WhatsApp (CallMeBot) FALHOU (e-mail seguiu normal):", e)

if os.environ.get("DRY_RUN"):
    wa = "ligado" if (CB_PHONE and CB_KEY) else "desligado (sem CALLMEBOT_*)"
    print(f"[DRY_RUN] {verdito} | novos {nov_sem}(ant {nov_ant}) | contatos {fb_sem} | ganhas {ganhas_sem} | pipeline {total} | conv {conv}% | html {len(html)}b | WhatsApp {wa}")
    raise SystemExit(0)
msg = MIMEText(html, "html", "utf-8")
msg["Subject"] = f"🧲 Prospecção da semana — {nov_sem} novos leads · {verdito.split(' ',1)[1] if ' ' in verdito else verdito} ({hoje})"
msg["From"] = GU; msg["To"] = TO
with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=ssl.create_default_context()) as s:
    s.login(GU, GP)
    s.sendmail(GU, [t.strip() for t in TO.split(",") if t.strip()], msg.as_string())
print(f"Prospecção -> {TO} | {nov_sem} novos, {ganhas_sem} ganhas, pipeline {total}.")
enviar_whatsapp()
