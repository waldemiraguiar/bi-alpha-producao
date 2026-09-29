#!/usr/bin/env python3
"""RASTREADOR DE CANCELAMENTOS — Fúlvio, 28/set 20h00.

"A preocupação não é só o parâmetro que a gente criou de cancelamento. É se um
 cliente pediu e o processo não avançou."

Lê (SÓ LÊ) os arquivos que o ouvinte já captura e deposita os pedidos de
cancelamento numa tabela própria, para o painel mostrar dentro da aba.
NADA do ouvinte é alterado — nem arquivo, nem processo, nem trava de envio.

O detector é o mesmo que calibrei medindo 14 dias (24.841 mensagens, 607 grupos):
  · pega pedido de cancelamento vindo do CLIENTE
  · descarta o que é de coleta/rota/motoboy, que é outro assunto
  · descarta o que veio do próprio laboratório (autor com "alpha", ou de_mim)
Ele NÃO tenta adivinhar pet nem requisição: nos 14 dias, o número da requisição
apareceu 0 vezes em 26 pedidos. Mostra a mensagem e o grupo; quem trata decide.

Env: HISTO_INTAKE_TOKEN. Uso: python3 rastreador_cancelamentos.py [dias]
"""
import datetime
import glob
import json
import os
import re
import sys
import urllib.request

CAP = os.path.expanduser("~/CALL_CENTER_ALPHA/ouvinte/capturado/*.jsonl")
SB_URL = "https://lrwjcdvporaivxvfuiwt.supabase.co"
ANON = "sb_publishable_fcodHc3AxR_HQ-aduMGzlg_CTBALng8"
TOKEN = os.environ.get("HISTO_INTAKE_TOKEN", "")
DIAS = int(sys.argv[1]) if len(sys.argv) > 1 else 3

PEDIDO = re.compile(r"\bcancel|desconsider|n[ãa]o precisa (mais|fazer)|pode (tirar|excluir)|retirar o exame", re.I)
# coleta/rota/motoboy é outro assunto: vira terremoto, não cancelamento de exame
FORA = re.compile(r"\bmotoboy|coleta|retirada|agendamento|rota\b", re.I)


def do_laboratorio(d):
    return bool(d.get("de_mim")) or "ALPHA" in (d.get("autor") or "").upper()


def achar():
    corte = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=DIAS)
    achados, lidos = [], 0
    for arq in sorted(glob.glob(CAP)):
        for linha in open(arq, encoding="utf-8"):
            linha = linha.strip()
            if not linha:
                continue
            try:
                d = json.loads(linha)
            except Exception:
                continue
            if d.get("tipo") != "texto":
                continue
            texto = (d.get("texto") or "").strip()
            if not texto or do_laboratorio(d):
                continue
            try:
                quando = datetime.datetime.fromisoformat(d.get("quando"))
            except Exception:
                continue
            lidos += 1
            if quando < corte:
                continue
            if not PEDIDO.search(texto) or FORA.search(texto):
                continue
            mid = d.get("id")
            if not mid:
                continue
            achados.append({"msg_id": str(mid), "quando": quando.isoformat(),
                            "grupo": d.get("grupo"), "autor": d.get("autor"),
                            "texto": texto[:1000]})
    return achados, lidos


def enviar(itens):
    if not TOKEN:
        print("SEM HISTO_INTAKE_TOKEN — não enviei")
        return
    if not itens:
        print("nada novo para enviar")
        return
    body = json.dumps({"p_token": TOKEN, "p_itens": itens}).encode()
    req = urllib.request.Request(f"{SB_URL}/rest/v1/rpc/inc_cancel_susp_pop", data=body, method="POST",
                                 headers={"apikey": ANON, "Authorization": f"Bearer {ANON}",
                                          "Content-Type": "application/json"})
    r = json.loads(urllib.request.urlopen(req, timeout=90).read() or "null")
    print("enviado:", r)
    if not (isinstance(r, dict) and r.get("ok")):
        raise RuntimeError("o banco recusou: %s" % r)


BATIDA = os.path.expanduser("~/Claude BI Alpha/.rastreador_cancel_ok")

if __name__ == "__main__":
    itens, lidos = achar()
    print(f"mensagens de cliente nos últimos {DIAS} dia(s): {lidos} · pedidos de cancelamento: {len(itens)}")
    for i in itens[:10]:
        print("  •", (i["grupo"] or "?")[:34], "|", i["texto"][:70].replace("\n", " "))
    enviar(itens)
    # ⭐ a batida só é gravada depois que o banco ACEITOU. "Rodou" não é "entregou":
    # se o token cair ou o Supabase estiver fora, o arquivo envelhece e o vigia acusa.
    # Sem itens novos também conta como entrega: ler 12 mil mensagens e não achar
    # cancelamento é o resultado normal, não falha.
    det = {"quando": datetime.datetime.now(datetime.timezone.utc).isoformat(),
           "lidos": lidos, "achados": len(itens)}
    with open(BATIDA, "w", encoding="utf-8") as f:
        json.dump(det, f)
    # e bate também no banco, para o vigia da NUVEM enxergar mesmo com este Mac
    # desligado — que é o furo do FileVault
    if TOKEN:
        try:
            b = json.dumps({"p_token": TOKEN, "p_nome": "rastreador_cancel",
                            "p_detalhe": {"lidos": lidos, "achados": len(itens)}}).encode()
            rq = urllib.request.Request(f"{SB_URL}/rest/v1/rpc/inc_batida", data=b, method="POST",
                                        headers={"apikey": ANON, "Authorization": f"Bearer {ANON}",
                                                 "Content-Type": "application/json"})
            print("batida no banco:", json.loads(urllib.request.urlopen(rq, timeout=45).read() or "null"))
        except Exception as e:
            print("batida no banco falhou:", type(e).__name__, str(e)[:80])
    print("batida gravada")
