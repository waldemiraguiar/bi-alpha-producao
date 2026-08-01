#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""custos_bi.py — monta D["custos"] da aba 'Custos de Projetos' do BI Alpha.

CUSTO DO ECOSSISTEMA INTEIRO, SEMPRE DIVIDIDO EM SETORES (padrão FinOps):
cada setor mostra suas fontes de custo — Claude (IA), Netlify (hospedagem),
Supabase/Resend/MySQL (infra) — sempre rotulando MEDIDO × ESTIMADO × CATÁLOGO.

Governança plena:
  • Claude = MEDIDO por agente/mesa/dia (Supabase public.custos_api, via ponte no Air a cada 30min).
  • Netlify = CATÁLOGO real dos sites (data_custos/netlify_sites.json, snapshot do Air) + rateio do plano.
  • Supabase/Resend = free tier hoje (declarado; confirmar no billing).
  • Frescura por fonte + manifesto: agente instrumentado mas sem dado aparece como LACUNA, não some.

Sempre atualizado: lê o Supabase a cada build. Só stdlib (urllib). Nunca derruba o build:
qualquer falha numa fonte vira {"erro": ...}, as outras seguem. Wal 1/ago.
"""
import os, json, urllib.request, datetime, collections

SUPA = "https://lrwjcdvporaivxvfuiwt.supabase.co/rest/v1"
SUPA_KEY = os.environ.get("SUPA_ANON_KEY", "sb_publishable_fcodHc3AxR_HQ-aduMGzlg_CTBALng8")
CAMBIO_BRL = float(os.environ.get("CAMBIO_BRL", "5.80"))   # US$→R$ (ajustável por env; rótulo no painel)
ROOT = os.path.dirname(os.path.abspath(__file__))

# id do agente no medidor (coluna 'mesa' do custos_api) -> nome amigável
AGENTE_NOME = {"A": "Mesa 1", "B": "Mesa 2", "HEM": "Hemograma"}

# ===== CATÁLOGO DE SETORES (o organograma do custo) =====
# claude_ids = ids no medidor (Claude MEDIDO). netlify = sites reais. infra = banco/e-mail/terceiro.
# status: ATIVO · INSTRUMENTADO (medidor pronto, sem produção) · CONGELADO · FORA DA OPERAÇÃO
SETORES = [
    {"id": "recepcao", "nome": "Recepção · Cérebro (Farejador)", "emoji": "🧠", "status": "ATIVO",
     "claude_ids": ["A", "B"], "netlify": [], "infra": ["Supabase (espinha)"],
     "nota": "roda nos Mac Minis (Mesa 1+2); leitura de requisição → HF"},
    {"id": "hemograma", "nome": "Farejador de Hemograma", "emoji": "🩸", "status": "INSTRUMENTADO",
     "claude_ids": ["HEM"], "netlify": [], "infra": ["Supabase (hemograma)"],
     "nota": "gateway multi-provider instrumentado; ainda não em produção (gasto ~0)"},
    {"id": "corpus", "nome": "Biblioteca · Corpus de Laudos", "emoji": "📚", "status": "ATIVO",
     "claude_ids": [], "netlify": [], "infra": ["Supabase (hemograma)"],
     "nota": "parse 100% LOCAL — Claude R$0; só custo de banco/armazenamento"},
    {"id": "producao", "nome": "Produção · Triagem/Histotécnica", "emoji": "🔬", "status": "ATIVO",
     "claude_ids": [], "netlify": ["producao-lab-alpha"], "infra": ["Supabase"]},
    {"id": "financeiro", "nome": "Financeiro · Cobrança", "emoji": "💲", "status": "ATIVO",
     "claude_ids": [], "netlify": ["alpha-financeiro", "alpha-cabofrio"], "infra": ["Supabase", "Resend (e-mail)"]},
    {"id": "provitta", "nome": "Provitta Oncology", "emoji": "🐾", "status": "ATIVO",
     "claude_ids": [], "netlify": ["provitta-equipe", "provitta-recepcao"], "infra": ["Supabase"]},
    {"id": "bi", "nome": "BI · Inteligência", "emoji": "📊", "status": "ATIVO",
     "claude_ids": [], "netlify": ["bi-alpha-waldemir", "alpha-matriz-painel"], "infra": ["MySQL HF (Hilário)"]},
    {"id": "comercial", "nome": "Comercial · CRM/Preços", "emoji": "🤝", "status": "ATIVO",
     "claude_ids": [], "netlify": ["agente-crm-matriz", "agente-crm-cabofrio", "alpha-disparador", "alpha-precos"],
     "infra": ["Supabase"]},
    {"id": "estoque", "nome": "Estoque", "emoji": "📦", "status": "ATIVO",
     "claude_ids": [], "netlify": ["alpha-estoque"], "infra": ["Supabase"]},
    {"id": "patologia", "nome": "Patologia · Sophia", "emoji": "🧫", "status": "CONGELADO",
     "claude_ids": [], "netlify": ["sophia-lab-alpha", "escola-sophia-alpha"], "infra": ["Supabase"]},
    {"id": "pessoal", "nome": "Pessoal / Experimental", "emoji": "🧪", "status": "FORA DA OPERAÇÃO",
     "claude_ids": [], "netlify": ["fenix-evolucao-waldemir", "painel-cripto-waldemir",
                                   "iridescent-sprinkles-4975c4", "phenomenal-llama-8b3ac4",
                                   "transcendent-tulumba-5cd816"], "infra": []},
]


def _rest(path):
    req = urllib.request.Request(SUPA + path, headers={"apikey": SUPA_KEY, "Authorization": "Bearer " + SUPA_KEY})
    return json.loads(urllib.request.urlopen(req, timeout=25).read().decode())


def _brl(usd):
    return round(usd * CAMBIO_BRL, 2)


def _medidor():
    """Claude MEDIDO. Lê o Supabase e devolve custo por AGENTE (id da coluna 'mesa'),
    ancorado no ÚLTIMO dia com dado (robusto na virada de meia-noite/mês)."""
    rows = _rest("/custos_api?select=mesa,dia,chamadas,tok_in,tok_out,cache_read,cache_write,usd,atualizado_em&order=dia.desc")
    dias_disp = sorted({str(r.get("dia")) for r in rows if r.get("dia")})
    dia_ref = dias_disp[-1] if dias_disp else datetime.date.today().isoformat()
    ym = dia_ref[:7]
    por_ag_dia = collections.defaultdict(lambda: {"usd": 0.0, "chamadas": 0})   # agente -> dia_ref
    por_ag_mes = collections.defaultdict(float)                                  # agente -> mês
    serie = collections.defaultdict(float)                                       # dia -> usd total
    mes_usd = 0.0
    dias_no_mes = set()
    for r in rows:
        usd = float(r.get("usd") or 0)
        dia = str(r.get("dia"))
        ag = r.get("mesa", "?")
        serie[dia] += usd
        if dia.startswith(ym):
            mes_usd += usd
            dias_no_mes.add(dia)
            por_ag_mes[ag] += usd
        if dia == dia_ref:
            por_ag_dia[ag]["usd"] += usd
            por_ag_dia[ag]["chamadas"] += int(r.get("chamadas") or 0)
    n_dias = max(1, len(dias_no_mes))
    media_dia = mes_usd / n_dias
    dias_mes = 30
    try:
        import calendar
        dias_mes = calendar.monthrange(int(ym[:4]), int(ym[5:7]))[1]
    except Exception:
        pass
    serie_ord = [{"dia": d, "usd": round(serie[d], 4), "brl": _brl(serie[d])} for d in sorted(serie)][-30:]
    dado_em = max((str(r.get("atualizado_em") or "") for r in rows), default="")
    stale_min = None
    try:
        t = datetime.datetime.fromisoformat(dado_em.replace("Z", "+00:00"))
        stale_min = int((datetime.datetime.now(datetime.timezone.utc) - t).total_seconds() // 60)
    except Exception:
        pass
    return {
        "dia_ref": dia_ref, "ym": ym,
        "por_ag_dia": por_ag_dia, "por_ag_mes": por_ag_mes,
        "mes_usd": mes_usd, "media_dia": media_dia, "projecao_mes": media_dia * dias_mes,
        "serie": serie_ord, "dado_em": dado_em, "stale_min": stale_min,
        "stale": (stale_min is not None and stale_min > 180),
    }


def _netlify_catalogo():
    """Sites reais (snapshot do Air) + rateio do plano do time por site ativo."""
    try:
        j = json.load(open(os.path.join(ROOT, "data_custos", "netlify_sites.json"), encoding="utf-8"))
    except Exception:
        j = {}
    sites = j.get("sites", [])
    ativos = {s["name"] for s in sites if s.get("ativo")}
    base = float(j.get("base_mes_usd", 19) or 19)
    rateio = base / len(ativos) if ativos else 0.0     # US$/site ativo/mês (ESTIMADO)
    return {"gerado_em": j.get("gerado_em", ""), "base_mes_usd": base, "sites": sites,
            "ativos": ativos, "rateio_site_usd": rateio}


def montar():
    """Objeto da aba: setores (cada um com suas fontes), infra compartilhada, governança, totais + %."""
    out = {"titulo": "Custos por Setor · Ecossistema de IA", "cambio_brl": CAMBIO_BRL,
           "atualizado": datetime.datetime.utcnow().isoformat(timespec="seconds") + "Z"}
    med = None
    try:
        med = _medidor()
    except Exception as e:
        out["medidor_erro"] = str(e)[:200]
    net = _netlify_catalogo()

    setores = []
    for s in SETORES:
        fontes = []
        claude_mes = claude_dia = 0.0
        det_mesas = []
        # --- Claude (MEDIDO) ---
        if s["claude_ids"] and med:
            for ag in s["claude_ids"]:
                dm = med["por_ag_dia"].get(ag, {"usd": 0.0, "chamadas": 0})
                mm = med["por_ag_mes"].get(ag, 0.0)
                claude_dia += dm["usd"]; claude_mes += mm
                det_mesas.append({"agente": AGENTE_NOME.get(ag, ag), "chamadas": dm["chamadas"],
                                  "dia_brl": _brl(dm["usd"]), "mes_brl": _brl(mm)})
            tem_dado = claude_mes > 0
            fontes.append({"tipo": "Claude · IA", "base": "MEDIDO" if tem_dado else "INSTRUMENTADO",
                           "mes_usd": round(claude_mes, 2), "mes_brl": _brl(claude_mes),
                           "dia_brl": _brl(claude_dia),
                           "obs": "" if tem_dado else "medidor pronto — sem produção ainda"})
        # --- Netlify (CATÁLOGO + rateio) ---
        net_sites = [x for x in s["netlify"]]
        net_ativos = [x for x in net_sites if x in net["ativos"]]
        net_mes = len(net_ativos) * net["rateio_site_usd"]
        if net_sites:
            fontes.append({"tipo": "Netlify · Hospedagem", "base": "CATÁLOGO+rateio",
                           "mes_usd": round(net_mes, 2), "mes_brl": _brl(net_mes),
                           "sites": net_sites, "ativos": len(net_ativos),
                           "obs": "rateio do plano US$%g / %d sites ativos" % (net["base_mes_usd"], len(net["ativos"]) or 1)})
        # --- Infra (declarado) ---
        for inf in s["infra"]:
            fontes.append({"tipo": inf, "base": "TERCEIRO" if "MySQL" in inf else "FREE TIER",
                           "mes_usd": 0.0, "mes_brl": 0.0,
                           "obs": "cobrança do Hilário (fora do nosso billing)" if "MySQL" in inf else "sem custo hoje — confirmar no billing"})
        setor_mes = round(claude_mes + net_mes, 2)
        setores.append({
            "id": s["id"], "nome": s["nome"], "emoji": s["emoji"], "status": s["status"],
            "nota": s.get("nota", ""), "fontes": fontes,
            "mes_usd": setor_mes, "mes_brl": _brl(setor_mes),
            "dia_brl": _brl(claude_dia), "por_mesa": det_mesas,
            "medido": bool(s["claude_ids"] and claude_mes > 0),
        })

    tot_mes = sum(x["mes_usd"] for x in setores)
    for x in setores:
        x["pct_mes"] = round(100 * x["mes_usd"] / tot_mes, 1) if tot_mes else 0.0
    setores.sort(key=lambda x: x["mes_usd"], reverse=True)

    # ===== GOVERNANÇA =====
    medidos = [s["nome"] for s in setores if s["medido"]]
    instrumentados = [s["nome"] for s in SETORES_por_status("INSTRUMENTADO")]
    gov = {
        "dia_ref": med["dia_ref"] if med else None,
        "dado_em": med["dado_em"] if med else None,
        "stale_min": med["stale_min"] if med else None,
        "stale": med["stale"] if med else True,
        "setores_total": len(setores),
        "setores_medidos": len(medidos), "medidos": medidos,
        "instrumentados": instrumentados,
        "netlify_snapshot": net["gerado_em"], "netlify_sites": len(net["sites"]), "netlify_ativos": len(net["ativos"]),
        "fontes": [
            {"fonte": "Claude · IA (Anthropic)", "base": "MEDIDO", "detalhe": "token real por chamada, por agente/dia (ponte → Supabase, 30min)"},
            {"fonte": "Netlify · Hospedagem", "base": "CATÁLOGO+rateio", "detalhe": "snapshot real dos sites; plano do time rateado por site ativo"},
            {"fonte": "Supabase · Banco", "base": "FREE TIER", "detalhe": "2 projetos; confirmar no billing se passar do free"},
            {"fonte": "Resend · E-mail", "base": "FREE TIER", "detalhe": "faturas Cabo Frio; confirmar volume"},
            {"fonte": "MySQL HF", "base": "TERCEIRO", "detalhe": "hosting do Hilário — fora do nosso billing"},
        ],
    }

    out["setores"] = setores
    out["governanca"] = gov
    out["serie"] = med["serie"] if med else []
    out["total_mes_usd"] = round(tot_mes, 2); out["total_mes_brl"] = _brl(tot_mes)
    proj = (med["projecao_mes"] if med else 0.0) + (net["base_mes_usd"])
    out["projecao_mes_usd"] = round(proj, 2); out["projecao_mes_brl"] = _brl(proj)
    out["dia_ref"] = med["dia_ref"] if med else None
    return out


def SETORES_por_status(st):
    return [s for s in SETORES if s["status"] == st]


if __name__ == "__main__":
    print(json.dumps(montar(), ensure_ascii=False, indent=2))
