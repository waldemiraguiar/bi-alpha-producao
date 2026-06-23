#!/usr/bin/env python3
"""AVISO DIÁRIO 7h (e-mail + WhatsApp) — Briefing do Wal (regra: todo dia, dom a dom).
Lê o CRM AO VIVO e monta o "Bom dia":
  1) Contatos do dia  — retornos agendados p/ hoje ou atrasados (de /api/interacoes)
  2) Radar / panorama — parados, em queda, em alta, carteira, % em risco (de crm.enc)
  3) Frota            — links rápidos dos agentes de IA Alpha
Inativos e Encerrados NÃO entram nas contagens (mesma regra do painel).
Env: CRM_PWD, GMAIL_USER, GMAIL_APP_PASSWORD, EMAIL_TO, CALLMEBOT_PHONE, CALLMEBOT_APIKEY."""
import os, json, ssl, smtplib, base64, datetime, time, urllib.request
from email.mime.text import MIMEText
from urllib.parse import quote
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

BASE = "https://agente-crm-matriz.netlify.app"
WA_PHONE = os.environ.get("CALLMEBOT_PHONE", "5521997842246")
hoje_d = datetime.date.today()
hoje = hoje_d.strftime("%d/%m/%Y")
DIAS = ["segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"]
diasem = DIAS[hoje_d.weekday()]

FROTA = [
    ("🧲 CRM — Matriz", "agente-crm-matriz.netlify.app"),
    ("📺 Produção (TV)", "producao-lab-alpha.netlify.app"),
    ("👥 CRM recepção (telão)", "agente-crm-matriz.netlify.app/telao.html"),
]

def fetch(url):
    req = urllib.request.Request(url + ("&" if "?" in url else "?") + "_=" + str(int(time.time())),
                                 headers={"User-Agent": "aviso-diario"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()

def fetch_json(url):
    try: return json.loads(fetch(url).decode())
    except Exception: return {}

def decrypt_enc(url, pwd):
    env = json.loads(fetch(url).decode())
    key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32,
                     salt=base64.b64decode(env["salt"]), iterations=env["iter"]).derive(pwd.encode())
    pt = AESGCM(key).decrypt(base64.b64decode(env["iv"]), base64.b64decode(env["ct"]), None)
    return json.loads(pt.decode())

# ---- dados ao vivo ----
CRM_PWD = os.environ.get("CRM_PWD", "")
D = decrypt_enc(BASE + "/data/crm.enc", CRM_PWD) if CRM_PWD else {}
out = set(str(x["cod"]) for x in fetch_json(BASE + "/api/crm-inativos").get("inativos", [])) \
    | set(str(x["cod"]) for x in fetch_json(BASE + "/api/crm-encerrados").get("encerrados", []))
def act(lst): return [x for x in (lst or []) if str(x.get("cod")) not in out]

parados = len(act(D.get("parados")))
queda = len(act(D.get("em_queda"))) + len(act(D.get("queda_forte")))
alta = len(act(D.get("em_alta")))
carteira = len(act(D.get("carteira"))) or D.get("resumo", {}).get("ativos", 0) or 0
risco = round(100 * queda / carteira) if carteira else 0   # risco GERAL = sem parados (parados à parte)

# contatos do dia (retorno <= hoje), do último próximo_passo de cada cliente
inter = fetch_json(BASE + "/api/interacoes").get("interacoes", [])
prox = {}
for x in sorted(inter, key=lambda i: i.get("ts", 0)):
    if x.get("proximo_passo"):
        prox[str(x["cod"])] = {"cliente": x.get("cliente") or ("#" + str(x["cod"])), "data": x["proximo_passo"]}
hoje_iso = hoje_d.isoformat()
contatos = sorted([v for c, v in prox.items() if c not in out and v["data"] <= hoje_iso], key=lambda v: v["data"])

def br(iso):
    try: return datetime.date.fromisoformat(iso).strftime("%d/%m")
    except Exception: return iso
def atras(iso):
    try:
        d = (hoje_d - datetime.date.fromisoformat(iso)).days
        return "hoje" if d == 0 else (f"atrasado {d}d" if d > 0 else f"em {-d}d")
    except Exception: return ""

# ---- texto WhatsApp (curto) ----
cont_top = "\n".join(f"• {c['cliente']} ({atras(c['data'])})" for c in contatos[:8]) or "• nenhum retorno marcado p/ hoje"
wpp = (f"☀️ *Briefing Matinal* — {diasem}, {hoje}\nBom dia, Wal!\n\n"
       f"*📞 Contatos do dia ({len(contatos)})*\n{cont_top}\n\n"
       f"*🎯 Radar do CRM*\n"
       f"• Parados: {parados}\n• Em queda: {queda}\n• Em alta: {alta}\n"
       f"• Carteira ativa: {carteira} · {risco}% em risco (sem parados)\n\n"
       f"Painel: {BASE}")
wa_link = "https://wa.me/" + WA_PHONE + "?text=" + quote(wpp)

# ---- e-mail HTML ----
def li(c): return f"<li><b>{c['cliente']}</b> <span style='color:#888'>· retorno {br(c['data'])} ({atras(c['data'])})</span></li>"
contatos_html = ("<ul style='margin:6px 0 0;padding-left:18px;line-height:1.7'>" + "".join(li(c) for c in contatos[:20]) + "</ul>") \
    if contatos else "<p style='color:#888;margin:6px 0 0'>Nenhum retorno agendado para hoje. 👌</p>"
def kpi(v, l, cor="#0A1628"):
    return (f"<td style='padding:14px 8px;text-align:center;border:1px solid #e6e9ef;border-radius:10px'>"
            f"<div style='font-size:26px;font-weight:800;color:{cor}'>{v}</div>"
            f"<div style='font-size:12px;color:#777;margin-top:3px'>{l}</div></td>")
frota_html = " · ".join(f"<a href='https://{u}' style='color:#0A7'>{n}</a>" for n, u in FROTA)
html = f"""<div style='font-family:Arial;max-width:680px;margin:auto;color:#1a1a1a'>
<div style='background:#0A1628;color:#fff;padding:18px 22px;border-radius:10px'>
  <h2 style='margin:0'>☀️ Briefing Matinal</h2>
  <div style='color:#8aa2bd;font-size:13px;margin-top:4px'>Bom dia, Wal · {diasem.capitalize()}, {hoje} · 7h · Agentes de IA Alpha</div></div>
<h3 style='margin:18px 0 2px'>📞 Contatos do dia ({len(contatos)})</h3>
<div style='color:#777;font-size:12.5px'>clientes com retorno agendado p/ hoje ou atrasado</div>
{contatos_html}
<h3 style='margin:20px 0 8px'>🎯 Radar / panorama do CRM</h3>
<table style='width:100%;border-collapse:separate;border-spacing:8px'><tr>
  {kpi(parados, "Parados", "#FF5470")}{kpi(queda, "Em queda", "#FF8A00")}
  {kpi(alta, "Em alta", "#0A7")}{kpi(carteira, "Carteira ativa")}{kpi(f"{risco}%", "Em risco (s/ parados)", "#FF5470")}
</tr></table>
<p style='color:#888;font-size:12px;margin:6px 0 0'>Inativos e encerrados não entram nestas contagens.</p>
<div style='text-align:center;margin:22px 0'>
  <a href='{BASE}' style='display:inline-block;background:linear-gradient(135deg,#00D4FF,#00E5A0);color:#0A1628;font-weight:800;text-decoration:none;border-radius:10px;padding:12px 22px'>🎯 Abrir o CRM</a>
  &nbsp;
  <a href='{wa_link}' style='display:inline-block;background:#25D366;color:#fff;font-weight:800;text-decoration:none;border-radius:10px;padding:12px 22px'>📲 Mandar no meu WhatsApp</a></div>
<h3 style='margin:18px 0 6px'>🤖 Frota</h3><div style='font-size:13px;line-height:1.8'>{frota_html}</div>
<p style='color:#888;font-size:12px;margin-top:16px'>Briefing automático · todo dia 7h · Darwin / Agentes de IA Alpha.</p></div>"""

# ---- WhatsApp automático (CallMeBot) ----
def enviar_whatsapp(texto):
    ph = os.environ.get("CALLMEBOT_PHONE", "").strip(); ak = os.environ.get("CALLMEBOT_APIKEY", "").strip()
    if not (ph and ak):
        print("WhatsApp: CallMeBot não configurado."); return
    try:
        u = ("https://api.callmebot.com/whatsapp.php?phone=" + quote(ph) + "&text=" + quote(texto) + "&apikey=" + quote(ak))
        with urllib.request.urlopen(u, timeout=30) as r:
            body = r.read().decode("utf-8", "replace")
            # CallMeBot devolve 200 mesmo quando falha; o motivo real vem no corpo.
            import re as _re
            clean = _re.sub("<[^>]+>", " ", body)
            clean = _re.sub(r"\s+", " ", clean).strip()[:400]
            ok = ("message queued" in body.lower()) or ("message sent" in body.lower()) or ("enviado" in body.lower())
            print(f"WhatsApp -> {ph}: HTTP {r.status} | {'OK' if ok else 'CHECAR'} | {clean}")
    except Exception as e:
        print("WhatsApp FALHOU (e-mail seguiu):", e)

# ---- envio ----
GU = os.environ.get("GMAIL_USER", ""); GP = os.environ.get("GMAIL_APP_PASSWORD", "").replace(" ", "")
TO = (os.environ.get("EMAIL_TO") or GU).strip()
if os.environ.get("DRY_RUN"):
    print(f"[DRY_RUN] {diasem} {hoje} | contatos {len(contatos)} | parados {parados} queda {queda} alta {alta} carteira {carteira} risco {risco}% | email->{TO or '(sem)'} | wa {'on' if os.environ.get('CALLMEBOT_APIKEY') else 'off'} | html {len(html)}b")
    raise SystemExit(0)
if GU and GP and TO:
    msg = MIMEText(html, "html", "utf-8")
    msg["Subject"] = f"☀️ Briefing Matinal — {diasem.capitalize()}, {hoje}"
    msg["From"] = GU; msg["To"] = TO
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=ssl.create_default_context()) as s:
        s.login(GU, GP); s.sendmail(GU, [t.strip() for t in TO.split(",") if t.strip()], msg.as_string())
    print(f"E-mail -> {TO}")
enviar_whatsapp(wpp)
