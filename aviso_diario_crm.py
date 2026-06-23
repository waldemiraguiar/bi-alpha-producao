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
MESA = "https://sophia-lab-alpha.netlify.app/mesa-de-comando.html"
WA_PHONE = os.environ.get("CALLMEBOT_PHONE", "5521997842246")
_brt = datetime.datetime.utcnow() - datetime.timedelta(hours=3)   # runner roda em UTC; BRT = UTC-3
hoje_d = _brt.date()
hoje = hoje_d.strftime("%d/%m/%Y")
DIAS = ["segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"]
diasem = DIAS[hoje_d.weekday()]
# Título/saudação conforme a hora do disparo (7h / 12h / 17h)
_h = _brt.hour
if _h < 12:   TITULO, SAUD, EMOJI = "Briefing Matinal", "Bom dia", "☀️"
elif _h < 16: TITULO, SAUD, EMOJI = "Briefing do Meio-dia", "Boa tarde", "🌤️"
else:         TITULO, SAUD, EMOJI = "Briefing de Fim de Tarde", "Boa tarde", "🌆"

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

# ---- 1) AGENDA do dia (Google Calendar via iCal secreto, se configurado) ----
def agenda_hoje():
    url = os.environ.get("CAL_ICS_URL", "").strip()
    if not url:
        return None  # agenda ainda nao conectada
    try:
        raw = fetch(url).decode("utf-8", "replace")
    except Exception as e:
        print("Agenda: falha ao ler iCal:", e); return None
    raw = raw.replace("\r\n", "\n").replace("\n ", "").replace("\n\t", "")
    evs = []
    for blk in raw.split("BEGIN:VEVENT")[1:]:
        body = blk.split("END:VEVENT")[0]; ds = ""; summ = ""
        for line in body.split("\n"):
            if line.startswith("DTSTART"): ds = line.split(":", 1)[-1].strip()
            elif line.startswith("SUMMARY"): summ = line.split(":", 1)[-1].strip()
        if len(ds) < 8: continue
        try: ev = datetime.date(int(ds[:4]), int(ds[4:6]), int(ds[6:8]))
        except Exception: continue
        hhmm = ""
        if "T" in ds:
            t = ds.split("T")[1]
            try:
                hh = int(t[:2]); mm = int(t[2:4])
                if ds.endswith("Z"):   # UTC -> BRT
                    b = datetime.datetime(ev.year, ev.month, ev.day, hh, mm) - datetime.timedelta(hours=3)
                    ev = b.date(); hh = b.hour; mm = b.minute
                hhmm = f"{hh:02d}:{mm:02d}"
            except Exception: pass
        if ev == hoje_d: evs.append((hhmm or "00:00", summ))
    return sorted(evs)

# ---- 2) TAREFAS do dia (input do Wal via gatilho "Tarefas de hoje") ----
def tarefas_hoje():
    try:
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "tarefas.json"), encoding="utf-8") as f:
            T = json.load(f)
    except Exception:
        return []
    itens = list(T.get(hoje_iso, []))
    for x in T.get("fixas", []):
        if x not in itens: itens.append(x)
    return itens

ag = agenda_hoje()
tarefas = tarefas_hoje()

# ---- texto WhatsApp (ordem: agenda -> tarefas -> CRM resumido) ----
if ag is None:   ag_wpp = "• (conecte sua agenda — abra a Mesa de Comando)"
elif not ag:     ag_wpp = "• sem compromissos hoje 👌"
else:            ag_wpp = "\n".join(f"• {h}  {s}" for h, s in ag)
tar_wpp = "\n".join(f"• {t}" for t in tarefas) if tarefas else "• nada anotado — diga: \"Tarefas de hoje: ...\""
wpp = (f"{EMOJI} *{TITULO}* — {diasem}, {hoje}\n{SAUD}, Wal!\n\n"
       f"*📅 Minha agenda*\n{ag_wpp}\n\n"
       f"*✅ Minhas tarefas*\n{tar_wpp}\n\n"
       f"*🎯 CRM (resumo)*\n"
       f"• {len(contatos)} p/ retornar · Parados {parados} · Queda {queda} · Alta {alta}\n"
       f"• Carteira {carteira} · {risco}% em risco\n\n"
       f"🎛️ Mesa de Comando: {MESA}")
wa_link = "https://wa.me/" + WA_PHONE + "?text=" + quote(wpp)

# ---- e-mail HTML ----
def li(c): return f"<li><b>{c['cliente']}</b> <span style='color:#888'>· retorno {br(c['data'])} ({atras(c['data'])})</span></li>"
contatos_html = ("<ul style='margin:6px 0 0;padding-left:18px;line-height:1.6'>" + "".join(li(c) for c in contatos[:8]) + "</ul>") \
    if contatos else "<p style='color:#888;margin:6px 0 0'>Nenhum retorno agendado para hoje. 👌</p>"
def kpi(v, l, cor="#0A1628"):
    return (f"<td style='padding:12px 6px;text-align:center;border:1px solid #e6e9ef;border-radius:10px'>"
            f"<div style='font-size:22px;font-weight:800;color:{cor}'>{v}</div>"
            f"<div style='font-size:11px;color:#777;margin-top:3px'>{l}</div></td>")
if ag is None:   ag_html = f"<p style='color:#888;margin:6px 0 0'>🔧 Conecte sua agenda — veja ao vivo na <a href='{MESA}'>Mesa de Comando</a>.</p>"
elif not ag:     ag_html = "<p style='color:#888;margin:6px 0 0'>Sem compromissos hoje. 👌</p>"
else:            ag_html = "<ul style='margin:6px 0 0;padding-left:18px;line-height:1.9'>" + "".join(f"<li><b>{h}</b> &nbsp; {s}</li>" for h, s in ag) + "</ul>"
tar_html = ("<ul style='margin:6px 0 0;padding-left:18px;line-height:1.9'>" + "".join(f"<li>{t}</li>" for t in tarefas) + "</ul>") \
    if tarefas else "<p style='color:#888;margin:6px 0 0'>Nada anotado. Diga: <i>\"Darwin, tarefas de hoje: …\"</i></p>"
html = f"""<div style='font-family:Arial;max-width:680px;margin:auto;color:#1a1a1a'>
<div style='background:#0A1628;color:#fff;padding:18px 22px;border-radius:10px'>
  <h2 style='margin:0'>{EMOJI} {TITULO}</h2>
  <div style='color:#8aa2bd;font-size:13px;margin-top:4px'>{SAUD}, Wal · {diasem.capitalize()}, {hoje} · 🎛️ Mesa de Comando</div></div>
<h3 style='margin:20px 0 2px'>📅 Minha agenda de hoje</h3>
{ag_html}
<h3 style='margin:20px 0 2px'>✅ Minhas tarefas de hoje</h3>
{tar_html}
<div style='text-align:center;margin:22px 0'>
  <a href='{MESA}' style='display:inline-block;background:linear-gradient(135deg,#00D4FF,#00E5A0);color:#0A1628;font-weight:800;text-decoration:none;border-radius:10px;padding:12px 22px'>🎛️ Abrir Mesa de Comando</a></div>
<hr style='border:none;border-top:1px solid #e6e9ef;margin:24px 0'>
<h3 style='margin:10px 0 2px;color:#555'>🎯 CRM — resumo ({len(contatos)} p/ retornar)</h3>
<div style='color:#999;font-size:12px'>controle da carteira · detalhe no painel</div>
{contatos_html}
<table style='width:100%;border-collapse:separate;border-spacing:6px;margin-top:10px'><tr>
  {kpi(parados, "Parados", "#FF5470")}{kpi(queda, "Em queda", "#FF8A00")}
  {kpi(alta, "Em alta", "#0A7")}{kpi(carteira, "Carteira")}{kpi(f"{risco}%", "Em risco", "#FF5470")}
</tr></table>
<div style='text-align:center;margin:14px 0'>
  <a href='{BASE}' style='display:inline-block;background:#0A1628;color:#fff;font-weight:700;text-decoration:none;border-radius:9px;padding:9px 18px;font-size:13px'>🎯 Abrir o CRM</a></div>
<p style='color:#888;font-size:12px;margin-top:16px'>Briefing automático · 7h · 12h · 17h · Darwin / Mesa de Comando.</p></div>"""

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
    msg["Subject"] = f"{EMOJI} {TITULO} — {diasem.capitalize()}, {hoje}"
    msg["From"] = GU; msg["To"] = TO
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=ssl.create_default_context()) as s:
        s.login(GU, GP); s.sendmail(GU, [t.strip() for t in TO.split(",") if t.strip()], msg.as_string())
    print(f"E-mail -> {TO}")
enviar_whatsapp(wpp)
