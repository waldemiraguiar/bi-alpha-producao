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
        obj = json.loads(pt.decode())
        return obj if isinstance(obj, dict) and "fat" in obj else {"fat": obj, "desde": {}}
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

def week_key(iso_d):
    try:
        y, w, _ = datetime.date.fromisoformat(iso_d).isocalendar()
        return f"{y}-W{int(w):02d}"
    except Exception:
        return "?"

def cerebro2(recent):
    """🧠² Aprende o RITMO de envio da clínica (média/semana + cadência típica) e detecta PAROU/CAIU.
    Alerta ADAPTATIVO: limiar ~2× a cadência da própria clínica (quem manda a cada 2d dispara em ~5d)."""
    if not isinstance(recent, list) or len(recent) < 4:
        return None
    from collections import Counter
    ds = [e.get("d", "") for e in recent if e.get("d")]
    days = sorted(set(ds))
    if len(days) < 2:
        return None
    today = datetime.date.today()
    dias_sil = max(0, (today - datetime.date.fromisoformat(days[-1])).days)
    wk = Counter(datetime.date.fromisoformat(d).isocalendar()[:2] for d in ds)
    wv = sorted(wk.values()); sem_med = wv[len(wv) // 2] if wv else 0
    gaps = sorted((datetime.date.fromisoformat(days[i]) - datetime.date.fromisoformat(days[i - 1])).days for i in range(1, len(days)))
    cad = gaps[len(gaps) // 2] if gaps else None
    alerta = max(cad * 2, cad + 3) if cad else 14
    cut = today - datetime.timedelta(days=14)
    rec14 = sum(1 for d in ds if datetime.date.fromisoformat(d) >= cut)
    esp14 = sem_med * 2
    if dias_sil >= alerta:
        return {"status": "parou", "dias": dias_sil, "cad": cad, "sem": sem_med}
    if esp14 > 0 and rec14 < esp14 * 0.5:
        return {"status": "caiu", "dias": dias_sil, "cad": cad, "sem": sem_med, "rec14": rec14, "esp14": esp14}
    return {"status": "ok", "dias": dias_sil, "cad": cad, "sem": sem_med}

def enrich(x):
    cod = str(x.get("cod")) if x.get("cod") else None
    m = master.get(cod) if cod else None
    prod = int(m.get("prod")) if m else None
    # R$ desde o marco zero se a clínica tem reconq_data; senão 12m
    _marco = x.get("reconq_data") or ""
    rs = None
    if cod:
        _desde = (rsmap.get("desde") or {}).get(cod)
        rs = _desde if (_marco and _desde is not None) else (rsmap.get("fat") or {}).get(cod)
    d = DET.get(cod) if cod else None
    falta = (d or {}).get("falta", []) or []
    recent = (d or {}).get("recent")   # None = detalhe ainda não veio; [] = 0 exames de verdade
    rec_n = len(recent) if isinstance(recent, list) else None
    rec_desde = (d or {}).get("recent_desde") or (d or {}).get("marco")
    marco = x.get("reconq_data") or ""
    prod_desde = (d or {}).get("prod_desde")
    # semana a semana (drill-down espelhado) + pets
    byweek, pets = {}, set()
    for e in (recent or []):
        byweek[week_key(e.get("d", ""))] = byweek.get(week_key(e.get("d", "")), 0) + 1
        if e.get("pet"):
            pets.add(e["pet"])
    concentrada = bool(d and len((d.get("cats") or [])) <= 1 and len(falta) >= 2)
    flag = (x.get("porte") == "G" and prod is not None and prod < PORTE_PROD_BAIXA) or concentrada
    # 🚨 comissão paga mas 0 exames: está na carteira (alguém ganhou comissão) e o HF confirma 0 no período
    zero = bool(m) and (rec_n == 0) and ((prod_desde in (0, None)) if marco else (prod in (0, None)))
    return {"nome": x.get("nome", ""), "cidade": x.get("cidade", ""), "tipo": x.get("tipo", "nova"),
            "porte": x.get("porte", ""), "prod": prod, "rs": rs, "flag": flag, "vinc": bool(m),
            "prod30": (d or {}).get("prod30"), "falta": falta, "cats": (d or {}).get("cats", []) or [],
            "rec_n": rec_n, "rec_desde": rec_desde, "byweek": byweek, "pets": len(pets),
            "marco": marco, "prod_desde": prod_desde, "motivo_perda": x.get("motivo_perda", ""), "zero": zero,
            "c2": cerebro2(recent)}

linhas = [enrich(x) for x in carteira]
nov = [l for l in linhas if l["tipo"] == "nova"]
rec = [l for l in linhas if l["tipo"] == "reconquistada"]
prod_total = sum((l["prod"] or 0) for l in linhas)
rs_total = sum((l["rs"] or 0) for l in linhas if l["rs"] is not None)
flags = [l for l in linhas if l["flag"]]
zerados = [l for l in linhas if l["zero"]]   # comissão paga mas 0 exames (auditoria)
parou = [l for l in linhas if l.get("c2") and l["c2"]["status"] == "parou"]
caiu = [l for l in linhas if l.get("c2") and l["c2"]["status"] == "caiu"]

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

# 🧠² ALERTA DE RITMO — clínicas que pararam / caíram vs a própria média (Cérebro 2)
if parou or caiu:
    _it = ""
    for l in sorted(parou, key=lambda z: -z["c2"]["dias"]):
        c2 = l["c2"]
        _it += (f"<li>🔴 <b>{l['nome']}</b> — <b>{c2['dias']} dias</b> sem enviar "
                f"(costuma a cada ~{c2['cad']}d · ~{c2['sem']}/sem). <b style='color:#c0392b'>Liga hoje.</b></li>")
    for l in caiu:
        c2 = l["c2"]
        _it += (f"<li>🟡 <b>{l['nome']}</b> — caiu vs a média dela "
                f"(~{c2['sem']}/sem; {c2.get('rec14',0)} nos últimos 14d). Atenção antes de perder.</li>")
    ritmo_html = (f"<h3 style='color:#c0392b;margin-top:18px'>🧠² Alerta de ritmo — {len(parou)} pararam · {len(caiu)} caíram</h3>"
                  "<p style='font-size:13px;color:#555;margin:2px 0 4px'>O Cérebro 2 aprende o ritmo de cada clínica e avisa quando ela sai do padrão dela mesma (não é régua fixa).</p>"
                  f"<ul style='font-size:14px'>{_it}</ul>")
else:
    ritmo_html = ("<h3 style='color:#0A1628;margin-top:18px'>🧠² Ritmo de envio</h3>"
                  "<p style='font-size:14px;color:#0A7A3B'>✅ Nenhuma clínica parou ou caiu vs a própria média. Ritmo saudável.</p>")

# 🎯 DEIXANDO NA MESA — share-of-wallet que grita (o que cada clínica NÃO te manda)
def _chip(t):
    return (f"<span style='display:inline-block;background:#fdecef;color:#a3242f;border:1px solid #f1a9b4;"
            f"border-radius:14px;padding:2px 11px;font-size:12px;font-weight:700;margin:3px 4px 0 0'>{t}</span>")
mesa = [l for l in linhas if l["vinc"] and l["falta"] and l["cats"]]   # só quem MANDA algo e deixa o resto (zerados vão na auditoria)
if mesa:
    blocks = ""
    for l in sorted(mesa, key=lambda z: -len(z["falta"])):
        nsend = len(l["cats"]); ntot = nsend + len(l["falta"])
        chips = "".join(_chip(f) for f in l["falta"][:10]) + (f"<span style='color:#c0392b;font-size:12px;font-weight:700'> +{len(l['falta'])-10}</span>" if len(l["falta"]) > 10 else "")
        rsline = (f"Já te rende <b>{brl(l['rs'])}</b> mandando só {nsend} de {ntot} classes — imagina com o resto. " if l["rs"] is not None else "")
        blocks += (f"<div style='border:1px solid #f1a9b4;border-left:4px solid #e24b4a;background:#fff6f7;border-radius:8px;padding:11px 13px;margin:9px 0'>"
                   f"<div style='font-weight:800;color:#c0392b;font-size:14px;text-transform:uppercase;letter-spacing:.3px'>🎯 {l['nome']} — {len(l['falta'])} classes na mesa</div>"
                   f"<div style='margin-top:6px'>{chips}</div>"
                   f"<div style='font-size:12.5px;color:#7a2230;margin-top:8px'>⚠️ Isso vai pro concorrente. {rsline}<b style='color:#c0392b'>Puxa essas classes.</b></div></div>")
    mesa_html = ("<h3 style='color:#c0392b;margin-top:18px'>🎯 Deixando na mesa — o que a clínica NÃO te manda (share-of-wallet)</h3>"
                 "<p style='font-size:13px;color:#555;margin:2px 0 4px'>Classes de exame que a clínica <b>já poderia mandar e não manda</b> — vão pro concorrente. É onde o Heitor/Fábio devem focar.</p>" + blocks)
else:
    mesa_html = "<h3 style='color:#0A1628;margin-top:18px'>🎯 Deixando na mesa</h3><p style='font-size:14px;color:#0A7A3B'>✅ As clínicas vinculadas mandam as classes que o lab faz. Sem white-space relevante.</p>"

# 🚨 comissão paga mas 0 exames (auditoria — pega todo "Faro Animal" da carteira)
if zerados:
    zrows = "".join(
        f"<li><b>{l['nome']}</b> ({PORTE_LBL.get(l['porte'])}, {l['cidade'] or '—'}) — "
        f"<b style='color:#c0392b'>0 exames</b>"
        + (f" desde o marco {l['marco']}" if l['marco'] else " nos últimos 180 dias")
        + " → conferir: comissão de reconquista (normal) × exames lançados em OUTRO código × ainda não digitados."
        + "</li>" for l in zerados)
    zero_html = (f"<h3 style='color:#c0392b;margin-top:18px'>🚨 Comissão paga mas 0 exames — auditar ({len(zerados)})</h3>"
                 f"<p style='font-size:13px;color:#555;margin:2px 0 6px'>Clínica na carteira (alguém ganhou comissão pela volta/entrada) mas o HF não registra <b>nenhum exame</b> no período. Vale checar o vínculo/código no HF.</p>"
                 f"<ul style='font-size:14px'>{zrows}</ul>")
else:
    zero_html = "<h3 style='color:#0A1628;margin-top:18px'>🚨 Comissão paga mas 0 exames</h3><p style='font-size:14px;color:#0A7A3B'>✅ Nenhuma clínica da carteira está zerada. Todo mundo com comissão tem exame entrando.</p>"

# 🔬 drill-down espelhado: movimento recente por clínica (semana a semana + pets)
def drill(items):
    vis = [l for l in items if l["rec_n"] not in (None, 0)]
    if not vis:
        return ""
    out = ""
    for l in sorted(vis, key=lambda z: -(z["rec_n"] or 0)):
        wks = sorted(l["byweek"].items(), reverse=True)[:5]
        wtxt = " · ".join(f"{k.split('-W')[-1]}: <b>{v}</b>" for k, v in wks)
        cats = ", ".join(f"{c['setor']} ({c['qtd']})" for c in (l["cats"] or [])[:4])
        falta = f" · <span style='color:#c0392b'>não manda: {', '.join(l['falta'][:4])}</span>" if l["falta"] else ""
        out += (f"<div style='padding:8px 10px;border-left:3px solid #00D4FF;background:#f4fbff;margin:6px 0'>"
                f"<b>{l['nome']}</b> — <b>{l['rec_n']}</b> exames · 🐾 {l['pets']} pets"
                + (f" · desde {l['rec_desde']}" if l["rec_desde"] else "")
                + (f"<br><span style='font-size:13px;color:#333'>por semana → {wtxt}</span>" if wtxt else "")
                + (f"<br><span style='font-size:13px;color:#333'>✅ manda: {cats}{falta}</span>" if cats else "")
                + "</div>")
    return out

drill_html = (drill(rec) + drill(nov)) or "<p style='color:#888;font-size:13px'>Detalhe por clínica chega quando o robô sincroniza o drill-down.</p>"

html = f"""<div style='font-family:Arial;max-width:820px;margin:auto;color:#1a1a1a'>
<h2 style='color:#0A1628'>🏥 Relatório de Clínicas — {label}</h2>
<p style='font-size:15px'><b>{len(rec)}</b> reconquistadas · <b>{len(nov)}</b> novas · produção somada <b>{prod_total}</b> exames/12m · faturamento <b>{brl(rs_total)}</b>{(' · <b style=color:#c0392b>🚨 ' + str(len(zerados)) + ' zeradas</b>') if zerados else ''}</p>
{ritmo_html}
{zero_html}
{mesa_html}
<h3 style='color:#0A1628;margin-top:18px'>🚩 Onde trabalhar (porte grande, produção baixa = dividindo exame)</h3>
<ul style='font-size:14px'>{flagtxt}</ul>
<h3 style='color:#0A1628;margin-top:18px'>🔬 Movimento recente por clínica (semana a semana)</h3>
{drill_html}
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
            "zerados": [{"nome": l["nome"], "cidade": l["cidade"], "porte": l["porte"], "marco": l["marco"]} for l in zerados],
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
