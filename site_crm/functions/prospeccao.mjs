/* Função serverless: PROSPECÇÃO (novos leads — crescimento, não defesa).
   Netlify Blobs. GET -> {prospects}. POST {acao:'save'|'remove', prospect, id, senha}.
   Upsert por id (gera id no 1º save). Cada prospect carrega seu próprio pipeline,
   feedbacks (append) e incrementos (campos futuros). PERMANENTE — tudo rastreado.
   Segredo (senha do time CRM) injetado no deploy (secret.mjs). */
import { getStore } from "@netlify/blobs";
import { SECRET } from "./secret.mjs";
import { updateBlob } from "./_store.mjs";

const STATUS = ["novo", "em_contato", "visita_agendada", "grupo_aberto", "venda_ganha", "venda_perdida"];

export default async (req) => {
  const store = getStore("crm-prospeccao");
  const load = async () => (await store.get("lista", { type: "json", consistency: "strong" })) || [];
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  };
  if (req.method === "OPTIONS") return new Response("", { headers: cors });
  if (req.method === "GET") return Response.json({ prospects: await load() }, { headers: cors });

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    if (!SECRET || body.senha !== SECRET)
      return new Response(JSON.stringify({ erro: "nao autorizado" }), { status: 401, headers: cors });
    if (body.acao === "remove") {
      const next = await updateBlob(store, "lista", (prev) => (prev || []).filter((p) => p.id !== body.id));
      return Response.json({ ok: true, prospects: next }, { headers: cors });
    }
    const p = body.prospect || {};
    if (!p.nome || !String(p.nome).trim())
      return new Response(JSON.stringify({ erro: "sem nome" }), { status: 400, headers: cors });
    const cleanFb = (f) => ({ ts: f.ts || Date.now(), por: String(f.por || "equipe").slice(0, 40), texto: String(f.texto || "").slice(0, 600) });
    const next = await updateBlob(store, "lista", (prev) => {
      const lista = (prev || []).slice();
      const existing = lista.find((x) => x.id === p.id);
      // MERGE de feedbacks por (ts|texto): NUNCA descarta o que outro adicionou enquanto este cliente estava com cópia velha
      const seen = new Set(), fb = [];
      [...((existing && Array.isArray(existing.feedbacks)) ? existing.feedbacks : []),
       ...(Array.isArray(p.feedbacks) ? p.feedbacks : [])].forEach((f) => {
        const c = cleanFb(f), k = (c.ts || 0) + "|" + c.texto;
        if (!seen.has(k)) { seen.add(k); fb.push(c); }
      });
      fb.sort((a, b) => (a.ts || 0) - (b.ts || 0));
      const clean = {
        id: p.id || ("p" + Date.now()),
        nome: String(p.nome).trim().slice(0, 120),
        contato: String(p.contato || "").slice(0, 80),
        cidade: String(p.cidade || "").slice(0, 60),
        origem: String(p.origem || "").slice(0, 60),
        status: STATUS.includes(p.status) ? p.status : (existing ? existing.status : "novo"),
        visita: String(p.visita || "").slice(0, 20),
        feedbacks: fb.slice(-200),
        incrementos: Array.isArray(p.incrementos) ? p.incrementos.slice(0, 50).map((i) => ({
          label: String(i.label || "").slice(0, 60), valor: String(i.valor || "").slice(0, 200),
        })) : (existing ? existing.incrementos || [] : []),
        por: String(p.por || "equipe").slice(0, 40),
        ts: existing ? existing.ts : (p.ts || Date.now()),
        ts_upd: Date.now(),
      };
      return lista.filter((x) => x.id !== clean.id).concat([clean]);
    });
    return Response.json({ ok: true, prospects: next }, { headers: cors });
  }
  return new Response("metodo nao permitido", { status: 405, headers: cors });
};

export const config = { path: "/api/crm-prospeccao" };
