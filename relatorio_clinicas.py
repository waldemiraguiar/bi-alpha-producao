#!/usr/bin/env python3
"""Relatório semanal das clínicas NOVAS e RECONQUISTADAS (sexta 9h BRT).
Lê as funções do CRM (carteira + master de clínicas + R$ cifrado), monta o relatório com PRODUÇÃO e
(só p/ diretoria) R$, manda por e-mail p/ a diretoria e grava uma FOTO no histórico (/api/crm-relatorios, SEM R$).
Env: GMAIL_USER, GMAIL_APP_PASSWORD, EMAIL_TO (diretoria), CRM_PWD, DIR_CODE, CRM_BASE (opcional). DRY_RUN=1 não envia."""
import os, json, ssl, smtplib, base64, datetime, urllib.request
from email.mime.text import MIMEText

BASE = os.environ.get("CRM_BASE", "https://agente-crm-matriz.netlify.app").rstrip("/")
NOW = int(datetime.datetime.now().timestamp())
PORTE_PROD_BAIXA = 40
PORTE_LBL = {"G": "🐘 Grande", "M": "🐎 Médio", "P": "🐇 Pequeno", "": "—"}

def fetch(path):
    req = urllib.request.Request(BASE + path + ("&" if "?" in path else "?") + "_=" + str(NOW), headers={"User-Agent": "relclin"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())

def decrypt_rs(dir_code):
    """Decifra {cod: fat} do /api/crm-clinicas-rs com o código da diretoria (AES-256-GCM + PBKDF2-SHA256)."""
    if not dir_code:
        return {}
    try:
        from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        env = fetch("/api/crm-clinicas-rs")
        if not env.get("ct"):
            return {}
        key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=base64.b64decode(env["salt"]),
                         iterations=int(env.get("iter") or 250000)).derive(dir_code.encode())
        pt = AESGCM(key).decrypt(base64.b64decode(env["iv"]), base64.b64decode(env["ct"]), None)
        return json.loads(pt.decode())
    except Exception as e:
        print(f"decrypt_rs falhou: {e}")
        return {}

def brl(v):
    return "R$ " + f"{(v or 0):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")

# ---- dados ----
carteira = fetch("/api/crm-carteira").get("carteira", [])
master = {str(c.get("cod")): c for c in fetch("/api/crm-clinicas").get("clinicas", [])}
rsmap = decrypt_rs(os.environ.get("FIN_KEY", ""))   # senha financeira (só diretoria)
try:
    detj = fetch("/api/crm-clinicas-det"); DET = detj.get("det", {}) or {}
except Exception:
    DET = {}

hoje = datetime.date.today()
iso = hoje.isocalendar()
semana = f"{iso[0]}-W{int(iso[1]):02d}"
label = hoje.strftime("%d/%m/%Y")

def enrich(x):
    cod = str(x.get("cod")) if x.get("cod") else None
    m = master.get(cod) if cod else None
    prod = int(m.get("prod")) if m else None
    rs = rsmap.get(cod) if cod else None
    d = DET.get(cod) if cod else None
    falta = (d or {}).get("falta", []) or []
    concentrada = bool(d and len((d.get("cats") or [])) <= 1 and len(falta) >= 2)
    flag = (x.get("porte") == "G" and prod is not None and prod < PORTE_PROD_BAIXA) or concentrada
    return {"nome": x.get("nome", ""), "cidade": x.get("cidade", ""), "tipo": x.get("tipo", "nova"),
            "porte": x.get("porte", ""), "prod": prod, "rs": rs, "flag": flag, "vinc": bool(m),
            "prod30": (d or {}).get("prod30"), "falta": falta}

linhas = [enrich(x) for x in carteira]
nov = [l for l in linhas if l["tipo"] == "nova"]
rec = [l for l in linhas if l["tipo"] == "reconquistada"]
prod_total = sum((l["prod"] or 0) for l in linhas)
rs_total = sum((l["rs"] or 0) for l in linhas if l["rs"] is not None)
flags = [l for l in linhas if l["flag"]]

def tabela(items):
    if not items:
        return "<p style='color:#888'>— nenhuma —</p>"
    rows = ""
    for l in sorted(items, key=lambda z: -(z["prod"] or 0)):
        rsc = brl(l["rs"]) if l["rs"] is not None else ("—" if not l["vinc"] else "R$ —")
        flagtxt = " <b style='color:#c0392b'>🚩 trabalhar</b>" if l["flag"] else ""
        vinc = "" if l["vinc"] else " <span style='color:#e67e22'>⚠️ pendente</span>"
        rows += (f"<tr><td style='padding:6px 8px;border-bottom:1px solid #eee'>{l['nome']}{vinc}{flagtxt}</td>"
                 f"<td style='padding:6px 8px;border-bottom:1px solid #eee'>{l['cidade']}</td>"
                 f"<td style='padding:6px 8px;border-bottom:1px solid #eee'>{PORTE_LBL.get(l['porte'],'—')}</td>"
                 f"<td style='padding:6px 8px;border-bottom:1px solid #eee;text-align:right'>{l['prod'] if l['prod'] is not None else '—'}</td>"
                 f"<td style='padding:6px 8px;border-bottom:1px solid #eee;text-align:right'>{rsc}</td></tr>")
    return ("<table style='border-collapse:collapse;width:100%;font-size:14px'>"
            "<tr style='background:#0A1628;color:#fff'><th style='padding:6px 8px;text-align:left'>Clínica</th>"
            "<th style='padding:6px 8px;text-align:left'>Cidade</th><th style='padding:6px 8px;text-align:left'>Porte</th>"
            "<th style='padding:6px 8px;text-align:right'>Produção 12m</th><th style='padding:6px 8px;text-align:right'>R$ 12m</th></tr>"
            + rows + "</table>")

flagtxt = ("".join(f"<li><b>{l['nome']}</b> ({PORTE_LBL.get(l['porte'])}) — {l['prod']} exames/12m"
                   + (f"; <b>não te manda: {', '.join(l['falta'][:6])}</b> (vai pra outro lab)" if l['falta'] else "; provavelmente dividindo exame")
                   + "</li>" for l in flags)
           or "<li>Nenhuma clínica sinalizada 👍</li>")

html = f"""<div style='font-family:Arial;max-width:820px;margin:auto;color:#1a1a1a'>
<h2 style='color:#0A1628'>🏥 Relatório de Clínicas — {label}</h2>
<p style='font-size:15px'><b>{len(rec)}</b> reconquistadas · <b>{len(nov)}</b> novas · produção somada <b>{prod_total}</b> exames/12m · faturamento <b>{brl(rs_total)}</b></p>
<h3 style='color:#0A1628;margin-top:18px'>🚩 Onde trabalhar (porte grande, produção baixa = dividindo exame)</h3>
<ul style='font-size:14px'>{flagtxt}</ul>
<h3 style='color:#0A1628;margin-top:18px'>♻️ Reconquistadas</h3>{tabela(rec)}
<h3 style='color:#0A1628;margin-top:18px'>🆕 Novas</h3>{tabela(nov)}
<p style='color:#888;font-size:12px;margin-top:18px'>Produção = nº de exames (HF). R$ visível só para a diretoria (este e-mail). Relatório automático · sexta 9h.
Painel: <a href='{BASE}/#clinicas'>{BASE.split('//')[-1]}/#clinicas</a></p></div>"""

# ---- foto no histórico (SEM R$) ----
def post_snapshot():
    pwd = os.environ.get("CRM_PWD", "")
    if not pwd:
        return
    item = {"id": semana, "semana": semana, "label": label, "n_novas": len(nov), "n_reconq": len(rec),
            "prod_total": prod_total,
            "flags": [{"nome": l["nome"], "porte": l["porte"], "prod": l["prod"]} for l in flags],
            "linhas": [{"nome": l["nome"], "cidade": l["cidade"], "tipo": l["tipo"], "porte": l["porte"],
                        "prod": l["prod"], "flag": l["flag"], "vinc": l["vinc"]} for l in linhas], "ts": NOW * 1000}
    try:
        payload = json.dumps({"acao": "save", "item": item, "senha": pwd}).encode()
        r = urllib.request.urlopen(urllib.request.Request(BASE + "/api/crm-relatorios", data=payload,
            headers={"Content-Type": "application/json"}), timeout=30)
        print(f"snapshot relatorio {semana} -> HTTP {r.status}")
    except Exception as e:
        print(f"snapshot relatorio falhou: {e}")

GU = os.environ.get("GMAIL_USER", ""); GP = os.environ.get("GMAIL_APP_PASSWORD", "").replace(" ", "")
_raw = ",".join([os.environ.get("EMAIL_TO", ""), GU])   # SÓ diretoria (tem R$) — não vai p/ a equipe
TO = ",".join(dict.fromkeys([t.strip() for t in _raw.split(",") if t.strip()])) or GU

post_snapshot()

if os.environ.get("DRY_RUN") == "1" or not (GU and GP):
    print(f"[DRY_RUN] {len(rec)} reconq · {len(nov)} novas · prod {prod_total} · R$ {rs_total:.2f} · flags {len(flags)} · html {len(html)}b · TO={TO}")
else:
    msg = MIMEText(html, "html", "utf-8")
    msg["Subject"] = f"🏥 Clínicas da semana — {len(rec)} reconquistadas · {len(nov)} novas · {len(flags)} p/ trabalhar ({label})"
    msg["From"] = GU; msg["To"] = TO
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=ssl.create_default_context()) as s:
        s.login(GU, GP)
        s.sendmail(GU, [t.strip() for t in TO.split(",") if t.strip()], msg.as_string())
    print(f"Relatório de clínicas -> {TO} | {len(rec)} reconq, {len(nov)} novas, {len(flags)} flags.")
