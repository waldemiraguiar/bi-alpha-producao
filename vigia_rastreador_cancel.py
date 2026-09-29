#!/usr/bin/env python3
"""VIGIA DO RASTREADOR DE CANCELAMENTOS — 29/set/2026.

A frase da skill: *processo de pé não quer dizer entregando.*
Por isso este vigia NÃO olha o launchctl nem o ps. Ele olha a BATIDA, que o
rastreador só grava depois que o banco aceitou. Se o token cair, se o Supabase
sair do ar ou se o Mac dormir, a batida envelhece e isto acusa.

⭐ O CRITÉRIO QUE VALE EM QUALQUER HORA É DIVERGÊNCIA, NÃO SILÊNCIO
Comparo a batida com o arquivo capturado mais recente do ouvinte (só leitura):
  jsonl fresco + batida velha  → o rastreador quebrou.            ALARME
  jsonl velho  + batida velha  → o ouvinte parou (não é meu).     aviso diferente
  os dois frescos              → tudo certo.                      calado
Silêncio dos dois de madrugada é normal — este Mac dorme — e não alarma sozinho.

⛔ "Não consegui ler" NÃO é "está tudo bem": conto rodadas cegas seguidas e, na
terceira, aviso que estou cego — em vez de ficar calado achando que está bom.

⛔ Nunca medir "o arquivo de hoje": às 00h05 ele não existe e o vigia se declara
cego à toa. Meço sempre o MAIS RECENTE da pasta.

Avisa só na VIRADA (quebrou / voltou), guardando o estado em disco.
Env: VIGIA_WHATS=1 liga o aviso no WhatsApp (escreve na caixa do ouvinte).
"""
import datetime
import glob
import json
import os
import subprocess

BASE = os.path.expanduser("~/Claude BI Alpha")
BATIDA = os.path.join(BASE, ".rastreador_cancel_ok")
ESTADO = os.path.join(BASE, ".vigia_rastreador_estado.json")
CAPTURADO = os.path.expanduser("~/CALL_CENTER_ALPHA/ouvinte/capturado/*.jsonl")
CAIXA = os.path.expanduser("~/CALL_CENTER_ALPHA/ouvinte/saida_privada")
USA_WHATS = os.environ.get("VIGIA_WHATS") == "1"

# o rastreador roda de 30 em 30 min. Dois ciclos perdidos + folga:
LIMITE_MIN = 70
# de madrugada este Mac dorme; silêncio ali é esperado (skill: não alarmar por silêncio)
HORA_INI, HORA_FIM = 7, 21


def agora():
    return datetime.datetime.now(datetime.timezone.utc)


def idade_batida():
    """minutos desde a última ENTREGA confirmada. None = não consegui ler."""
    try:
        d = json.load(open(BATIDA, encoding="utf-8"))
        q = datetime.datetime.fromisoformat(d["quando"])
        return (agora() - q).total_seconds() / 60
    except Exception:
        return None


def idade_captura():
    """minutos desde o último arquivo capturado. SEMPRE o mais recente da pasta,
    nunca o 'de hoje' — às 00h05 o de hoje não existe."""
    try:
        arqs = glob.glob(CAPTURADO)
        if not arqs:
            return None
        m = max(os.path.getmtime(a) for a in arqs)
        return (agora().timestamp() - m) / 60
    except Exception:
        return None


def avisar(titulo, texto, urgente):
    canais = []
    try:
        subprocess.run(["osascript", "-e",
                        f'display notification {json.dumps(texto)} with title {json.dumps(titulo)}'],
                       timeout=10, capture_output=True)
        canais.append("notificacao")
    except Exception:
        pass
    if urgente and USA_WHATS:
        try:
            os.makedirs(CAIXA, exist_ok=True)
            nome = "vigia_rastreador_cancel_%d.txt" % int(agora().timestamp() * 1000)
            open(os.path.join(CAIXA, nome), "w", encoding="utf-8").write(f"{titulo}\n\n{texto}")
            canais.append("whatsapp")
        except Exception as e:
            canais.append("whatsapp_falhou:%s" % type(e).__name__)
    print(f"[{agora().strftime('%F %T')}] {titulo} — {texto} · canais: {canais or 'nenhum'}")


def main():
    est = {}
    try:
        est = json.load(open(ESTADO, encoding="utf-8"))
    except Exception:
        pass
    cegas = int(est.get("cegas", 0))
    antes = est.get("estado", "ok")

    b, c = idade_batida(), idade_captura()
    hora_local = datetime.datetime.now().hour
    no_horario = HORA_INI <= hora_local < HORA_FIM

    if b is None:
        cegas += 1
        novo = "cego"
        if cegas == 3:
            avisar("🔎 Vigia do rastreador", "Não consigo ler a batida há 3 rodadas — estou cego.", True)
    else:
        cegas = 0
        if b <= LIMITE_MIN:
            novo = "ok"
        elif c is not None and c < 15:
            novo = "quebrado"        # ⭐ divergência: o ouvinte entrega, eu não
        elif no_horario:
            novo = "quebrado"        # em horário de trabalho, silêncio já basta
        else:
            novo = "dormindo"        # madrugada com tudo parado: normal

    if novo != antes:
        if novo == "quebrado":
            motivo = (f"o ouvinte capturou há {c:.0f} min, mas o rastreador não entrega há {b:.0f} min"
                      if c is not None and c < 15 else
                      f"sem entregar há {b:.0f} min (limite {LIMITE_MIN})")
            avisar("🚨 Rastreador de cancelamentos parado", motivo, True)
        elif novo == "ok" and antes in ("quebrado", "cego"):
            avisar("✅ Rastreador de cancelamentos voltou", f"entregou há {b:.0f} min", False)
        elif novo == "dormindo":
            print("silêncio noturno com tudo parado — normal, não alarmo")

    # ⛔ o dump vai SEMPRE, fora de qualquer if: contador que não persiste nunca dispara
    json.dump({"estado": novo, "cegas": cegas, "quando": agora().isoformat(),
               "batida_min": b, "captura_min": c},
              open(ESTADO, "w", encoding="utf-8"))
    print(f"batida={b if b is None else round(b)}min captura={c if c is None else round(c)}min "
          f"→ {novo} (antes {antes}, cegas {cegas})")


if __name__ == "__main__":
    main()
