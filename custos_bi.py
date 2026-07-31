#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""custos_bi.py — monta o objeto D["custos"] da aba 'Custos de Projetos' do BI Alpha.

Junta, SEPARADO e CATALOGADO (padrão FinOps), TODO custo da frota:
  • Farejador (IA / API Anthropic)  — REAL, medido por mesa/dia (Supabase public.custos_api, via custo_sync)
  • Netlify (hospedagem da frota)    — do plano/análise (data_custos/custos.json)
  • [próximos: é só adicionar um projeto na lista]

Sempre atualizado: lê o Supabase a cada build (que roda de tempos em tempos). Wal 30/jul.
Só biblioteca padrão (urllib). Nunca derruba o build: qualquer falha vira {"erro": ...} numa fonte,
as outras seguem.
"""
import os, json, urllib.request, datetime, collections

SUPA = "https://lrwjcdvporaivxvfuiwt.supabase.co/rest/v1"
SUPA_KEY = os.environ.get("SUPA_ANON_KEY", "sb_publishable_fcodHc3AxR_HQ-aduMGzlg_CTBALng8")
CAMBIO_BRL = float(os.environ.get("CAMBIO_BRL", "5.80"))   # US$→R$ (ajustável por env; rótulo no painel)
ROOT = os.path.dirname(os.path.abspath(__file__))
MESA_NOME = {"A": "Mesa 1", "B": "Mesa 2"}


def _rest(path):
    req = urllib.request.Request(SUPA + path, headers={"apikey": SUPA_KEY, "Authorization": "Bearer " + SUPA_KEY})
    return json.loads(urllib.request.urlopen(req, timeout=25).read().decode())


def _brl(usd):
    return round(usd * CAMBIO_BRL, 2)


def _projeto_farejador():
    """Custo REAL da API, medido por mesa/dia. Projeção do mês = média/dia × dias do mês."""
    rows = _rest("/custos_api?select=mesa,dia,chamadas,tok_in,tok_out,cache_read,cache_write,usd&order=dia.desc")
    hoje = datetime.date.today().isoformat()
    ym = hoje[:7]
    por_mesa_hoje = collections.defaultdict(lambda: {"usd": 0.0, "chamadas": 0})
    serie = collections.defaultdict(float)          # dia -> usd (total frota)
    mes_usd = 0.0
    dias_no_mes = set()
    for r in rows:
        usd = float(r.get("usd") or 0)
        dia = str(r.get("dia"))
        serie[dia] += usd
        if dia.startswith(ym):
            mes_usd += usd
            dias_no_mes.add(dia)
        if dia == hoje:
            m = por_mesa_hoje[r.get("mesa", "?")]
            m["usd"] += usd
            m["chamadas"] += int(r.get("chamadas") or 0)
    # leituras confirmadas hoje por mesa (p/ custo POR FOLHA) — best-effort
    reads = {}
    try:
        rq = _rest("/requisicoes?select=estacao&created_at=gte." + hoje)  # pode não existir via REST; ok se falhar
        for x in rq:
            e = (x.get("estacao") or "?").strip() or "?"
            reads[e] = reads.get(e, 0) + 1
    except Exception:
        reads = {}
    mesas = []
    total_hoje = 0.0
    for mesa, v in sorted(por_mesa_hoje.items()):
        total_hoje += v["usd"]
        nf = reads.get(mesa)
        mesas.append({
            "mesa": MESA_NOME.get(mesa, "Mesa " + str(mesa)),
            "usd": round(v["usd"], 4), "brl": _brl(v["usd"]),
            "chamadas": v["chamadas"],
            "leituras": nf,
            "usd_por_leitura": round(v["usd"] / nf, 4) if nf else None,
        })
    n_dias = max(1, len(dias_no_mes))
    media_dia = mes_usd / n_dias
    hoje_do_mes = datetime.date.today().day
    dias_mes = 30
    try:
        import calendar
        dias_mes = calendar.monthrange(datetime.date.today().year, datetime.date.today().month)[1]
    except Exception:
        pass
    projecao_mes = media_dia * dias_mes
    serie_ord = [{"dia": d, "usd": round(serie[d], 4), "brl": _brl(serie[d])} for d in sorted(serie)][-30:]
    return {
        "nome": "Farejador · IA (API Anthropic)",
        "fonte": "MEDIDO — token real por leitura, por mesa (custo_sync → Supabase)",
        "hoje_usd": round(total_hoje, 2), "hoje_brl": _brl(total_hoje),
        "mes_usd": round(mes_usd, 2), "mes_brl": _brl(mes_usd),
        "projecao_mes_usd": round(projecao_mes, 2), "projecao_mes_brl": _brl(projecao_mes),
        "media_dia_usd": round(media_dia, 2), "media_dia_brl": _brl(media_dia),
        "por_mesa": mesas, "serie": serie_ord,
    }


def _projeto_netlify():
    """Hospedagem da frota — do plano/análise (data_custos/custos.json)."""
    try:
        j = json.load(open(os.path.join(ROOT, "data_custos", "custos.json"), encoding="utf-8"))
    except Exception:
        j = {}
    plano = j.get("plano", {})
    base = float(plano.get("base_mes_usd", 19) or 19)
    return {
        "nome": "Netlify · Hospedagem da frota",
        "fonte": "PLANO/ANÁLISE (24/jun) — atualizar c/ API do Netlify",
        "mes_usd": round(base, 2), "mes_brl": _brl(base),
        "projecao_mes_usd": round(base, 2), "projecao_mes_brl": _brl(base),
        "detalhe": j.get("conclusao", ""), "cascata": j.get("cascata", []),
    }


def montar():
    """Objeto completo da aba. Cada projeto isolado; % de participação; totais em R$."""
    out = {"titulo": "Custos de Projetos", "cambio_brl": CAMBIO_BRL,
           "atualizado": datetime.datetime.utcnow().isoformat(timespec="seconds") + "Z", "projetos": []}
    for fn in (_projeto_farejador, _projeto_netlify):
        try:
            out["projetos"].append(fn())
        except Exception as e:
            out["projetos"].append({"nome": fn.__name__, "erro": str(e)[:200]})
    # totais do mês + % de participação
    tot_mes = sum(float(p.get("mes_usd") or 0) for p in out["projetos"] if "erro" not in p)
    proj_mes = sum(float(p.get("projecao_mes_usd") or 0) for p in out["projetos"] if "erro" not in p)
    for p in out["projetos"]:
        if "erro" not in p:
            p["pct_mes"] = round(100 * float(p.get("mes_usd") or 0) / tot_mes, 1) if tot_mes else 0
    out["total_mes_usd"] = round(tot_mes, 2); out["total_mes_brl"] = _brl(tot_mes)
    out["projecao_mes_usd"] = round(proj_mes, 2); out["projecao_mes_brl"] = _brl(proj_mes)
    return out


if __name__ == "__main__":
    print(json.dumps(montar(), ensure_ascii=False, indent=2))
