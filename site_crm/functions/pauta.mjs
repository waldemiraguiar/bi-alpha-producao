/* Função serverless: PAUTA DE REUNIÃO SEMANAL (time de vendas + CRM).
   Cada documento = uma pauta (data + tópicos). Tópico: seção, título, texto, COR (marcação visual),
   status, enriquecimento de mercado, decisão, responsável, flag "encaminhar p/ próxima". Editável.
   Netlify Blobs, permanente (histórico), upsert por id. Segredo = senha do time. */
import { getStore } from "@netlify/blobs";
import { SECRET } from "./secret.mjs";

const CORES = ["vermelho", "laranja", "amarelo", "verde", "azul", "roxo", "rosa", "cinza"];

export default async (req) => {
  const store = getStore("crm-pauta");
  const load = async () => (await store.get("lista", { type: "json", consistency: "strong" })) || [];
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  };
  const loadExcl = async () => (await store.get("excluidos", { type: "json", consistency: "strong" })) || [];
  const loadSquads = async () => (await store.get("squads", { type: "json", consistency: "strong" })) || [];
  if (req.method === "OPTIONS") return new Response("", { headers: cors });
  if (req.method === "GET") return Response.json({ pautas: await load(), excluidos: await loadExcl(), squads: await loadSquads() }, { headers: cors });

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    if (!SECRET || body.senha !== SECRET)
      return new Response(JSON.stringify({ erro: "nao autorizado" }), { status: 401, headers: cors });
    let lista = await load();

    // SQUADS — lista gerenciável (Diretoria, Gerência Técnica, Microbiologia, PCR/ELISA, Histopato/IHQ, Qualidade…)
    if (body.acao === "squads_set") {
      const arr = Array.isArray(body.squads) ? [...new Set(body.squads.map((s) => String(s || "").trim()).filter(Boolean))].slice(0, 60) : [];
      await store.setJSON("squads", arr);
      return Response.json({ ok: true, squads: await loadSquads() }, { headers: cors });
    }

    // LOG de EXCLUSÃO de tópico (governança dia/mês/ano — nada some sem rastro)
    if (body.acao === "logexcl") {
      const log = await loadExcl();
      const e = body.item || {};
      log.unshift({ id: "x" + Date.now(), titulo: String(e.titulo || "").slice(0, 200), sec: String(e.sec || "").slice(0, 80),
        pauta: String(e.pauta || "").slice(0, 10), por: String(e.por || "equipe").slice(0, 40), motivo: String(e.motivo || "").slice(0, 300), ts: Date.now() });
      await store.setJSON("excluidos", log.slice(0, 2000));
      return Response.json({ ok: true, excluidos: await loadExcl() }, { headers: cors });
    }

    if (body.acao === "remove") {
      lista = lista.filter((x) => x.id !== body.id);
      await store.setJSON("lista", lista);
      return Response.json({ ok: true, pautas: await load() }, { headers: cors });
    }

    const it = body.item || {};
    const cleanTopico = (t) => ({
      id: String(t.id || ("t" + Date.now() + Math.random().toString(36).slice(2, 6))),
      sec: String(t.sec || "Geral").slice(0, 80),
      titulo: String(t.titulo || "").slice(0, 200),
      texto: String(t.texto || "").slice(0, 4000),
      cor: CORES.includes(t.cor) ? t.cor : "cinza",
      status: ["aberto", "andamento", "resolvido", "decisao"].includes(t.status) ? t.status : "aberto",
      enr: String(t.enr || "").slice(0, 3000),        // 💡 melhor de mercado (enriquecimento)
      resp: String(t.resp || "").slice(0, 60),
      decisao: String(t.decisao || "").slice(0, 1000),
      fwd: !!t.fwd,                                    // marcado p/ encaminhar à próxima
      de: String(t.de || "").slice(0, 20),            // "encaminhado da pauta DD/MM"
      arq: !!t.arq,                                    // ARQUIVADO (sai da pauta ativa, fica no acervo, reversível)
      arq_ts: +t.arq_ts || 0,
      arq_por: String(t.arq_por || "").slice(0, 40),
      // ✅ AÇÕES do tópico (quem faz o quê até quando) — cobrança da reunião
      acoes: Array.isArray(t.acoes) ? t.acoes.slice(0, 50).map((a) => ({
        id: String(a.id || ("a" + Date.now() + Math.random().toString(36).slice(2, 5))),
        txt: String(a.txt || "").slice(0, 400),
        dono: String(a.dono || "").slice(0, 60),
        prazo: String(a.prazo || "").slice(0, 10),   // YYYY-MM-DD
        feito: !!a.feito,
        feito_ts: +a.feito_ts || 0,
        ts: +a.ts || Date.now(),
      })) : [],
      ts: +t.ts || Date.now(),
    });
    const clean = {
      id: String(it.id || ("p" + Date.now())),
      data: String(it.data || "").slice(0, 10),
      squad: String(it.squad || "").slice(0, 60),   // squad dono da pauta (app Reuniões de Squad)
      titulo: String(it.titulo || "Pauta Reunião Semanal").slice(0, 120),
      status: it.status === "fechada" ? "fechada" : "aberta",
      topicos: Array.isArray(it.topicos) ? it.topicos.slice(0, 200).map(cleanTopico) : [],
      por: String(it.por || "equipe").slice(0, 40),
      ts: +it.ts || Date.now(),
      ts_upd: Date.now(),
    };
    lista = lista.filter((x) => x.id !== clean.id);
    lista.push(clean);
    lista.sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : b.ts - a.ts));   // mais recente no topo
    lista = lista.slice(0, 300);
    await store.setJSON("lista", lista);
    return Response.json({ ok: true, pautas: await load() }, { headers: cors });
  }
  return new Response("metodo nao permitido", { status: 405, headers: cors });
};

export const config = { path: "/api/crm-pauta" };
