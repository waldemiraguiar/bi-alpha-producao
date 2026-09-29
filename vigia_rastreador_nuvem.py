#!/usr/bin/env python3
"""VIGIA DO RASTREADOR — VERSÃO NUVEM · 29/set/2026.

POR QUE ELE EXISTE, mesmo já havendo um vigia no Mac:
o Mac tem FileVault LIGADO e sem autologin. Depois de um reboot nenhum
LaunchAgent sobe até alguém digitar a senha — nem o rastreador, nem o vigia
local. Justamente no pior cenário, o vigia de lá não avisa porque também não
roda. Este roda no GitHub, fora da máquina, e cobre esse buraco.

Ele lê a BATIDA que o rastreador grava no banco (inc_batidas) — sinal de
ENTREGA, não de processo de pé. Avisa no WhatsApp pelo CallMeBot.

⭐ Só alarma em HORÁRIO DE TRABALHO. O Mac dorme de madrugada e a batida
envelhece por motivo normal; alarmar às 3h viraria ruído e o alarme acabaria
silenciado — foi assim que nasceu o ~/.alerta_silencio do ouvinte.

⭐ Avisa só na VIRADA (parou / voltou). O estado mora no próprio banco, porque
o runner do GitHub é descartável e não guarda nada entre execuções.

Env: HISTO_INTAKE_TOKEN, CALLMEBOT_PHONE, CALLMEBOT_APIKEY.
"""
import datetime
import json
import os
import re
import urllib.request
from urllib.parse import quote

SB_URL = "https://lrwjcdvporaivxvfuiwt.supabase.co"
ANON = "sb_publishable_fcodHc3AxR_HQ-aduMGzlg_CTBALng8"
TOKEN = os.environ.get("HISTO_INTAKE_TOKEN", "")
ROBO = "rastreador_cancel"
ESTADO = "vigia_rastreador_estado"

LIMITE_MIN = 90          # o local usa 70; este é a rede de baixo, mais folgado
HORA_INI, HORA_FIM = 7, 21   # BRT


def ler(nome):
    u = f"{SB_URL}/rest/v1/inc_batidas?select=nome,quando,detalhe&nome=eq.{quote(nome)}"
    r = urllib.request.Request(u, headers={"apikey": ANON, "Authorization": f"Bearer {ANON}"})
    d = json.loads(urllib.request.urlopen(r, timeout=45).read() or "[]")
    return d[0] if d else None


def gravar(nome, detalhe):
    if not TOKEN:
        return
    b = json.dumps({"p_token": TOKEN, "p_nome": nome, "p_detalhe": detalhe}).encode()
    r = urllib.request.Request(f"{SB_URL}/rest/v1/rpc/inc_batida", data=b, method="POST",
                               headers={"apikey": ANON, "Authorization": f"Bearer {ANON}",
                                        "Content-Type": "application/json"})
    urllib.request.urlopen(r, timeout=45).read()


def whats(texto):
    ph, ak = os.environ.get("CALLMEBOT_PHONE", ""), os.environ.get("CALLMEBOT_APIKEY", "")
    if not (ph and ak):
        print("WhatsApp: CallMeBot não configurado."); return False
    try:
        u = ("https://api.callmebot.com/whatsapp.php?phone=" + quote(ph)
             + "&text=" + quote(texto) + "&apikey=" + quote(ak))
        with urllib.request.urlopen(u, timeout=30) as r:
            body = r.read().decode("utf-8", "replace")
            # ⚠️ CallMeBot devolve 200 mesmo quando falha: o motivo real vem no corpo
            limpo = re.sub(r"\s+", " ", re.sub("<[^>]+>", " ", body)).strip()[:300]
            ok = any(x in body.lower() for x in ("message queued", "message sent", "enviado"))
            print(f"WhatsApp -> {ph}: {'OK' if ok else 'CHECAR'} | {limpo}")
            return ok
    except Exception as e:
        print("WhatsApp FALHOU:", type(e).__name__, str(e)[:100])
        return False


def main():
    agora = datetime.datetime.now(datetime.timezone.utc)
    brt = agora - datetime.timedelta(hours=3)
    no_horario = HORA_INI <= brt.hour < HORA_FIM

    b = ler(ROBO)
    if b is None:
        idade = None
    else:
        idade = (agora - datetime.datetime.fromisoformat(b["quando"].replace("Z", "+00:00"))).total_seconds() / 60

    st = ler(ESTADO)
    antes = ((st or {}).get("detalhe") or {}).get("estado", "ok")

    if idade is None:
        # ⛔ nunca vi batida nenhuma: isso é diferente de "está tudo bem"
        novo = "sem_batida" if no_horario else antes
    elif idade <= LIMITE_MIN:
        novo = "ok"
    elif no_horario:
        novo = "parado"
    else:
        novo = antes          # madrugada: o Mac dorme, não é notícia

    if novo != antes:
        if novo == "parado":
            whats(f"🚨 ALPHA — o rastreador de cancelamentos não entrega há {idade:.0f} min "
                  f"(limite {LIMITE_MIN}). Pode ser o Mac desligado, sem login depois de um "
                  f"reboot, ou o script quebrado. Aba Cancelamentos fica sem achar pedido novo.")
        elif novo == "sem_batida":
            whats("🚨 ALPHA — nunca recebi batida do rastreador de cancelamentos. "
                  "Ele nunca rodou, ou não está conseguindo falar com o banco.")
        elif novo == "ok" and antes in ("parado", "sem_batida"):
            whats(f"✅ ALPHA — o rastreador de cancelamentos voltou (entregou há {idade:.0f} min).")

    gravar(ESTADO, {"estado": novo, "visto_em": agora.isoformat(),
                    "idade_min": None if idade is None else round(idade)})
    print(f"batida={'nunca' if idade is None else round(idade)}min "
          f"horario={'sim' if no_horario else 'nao'} → {novo} (antes {antes})")


if __name__ == "__main__":
    main()
