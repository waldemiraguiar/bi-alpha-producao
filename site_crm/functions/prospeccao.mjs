/* Função serverless: PROSPECÇÃO (novos leads — crescimento, não defesa).
   Netlify Blobs. GET -> {prospects}. POST {acao:'save'|'remove', prospect, id, senha}.
   Upsert por id (gera id no 1º save). Cada prospect carrega seu próprio pipeline,
   feedbacks (append) e incrementos (campos futuros). PERMANENTE — tudo rastreado.
   Segredo (senha do time CRM) injetado no deploy (secret.mjs). */
import { getStore } from "@netlify/blobs";
import { SECRET } from "./secret.mjs";

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
    let lista = await load();
    if (body.acao === "remove") {
      lista = lista.filter((p) => p.id !== body.id);
    } else {
      const p = body.prospect || {};
      if (!p.nome || !String(p.nome).trim())
        return new Response(JSON.stringify({ erro: "sem nome" }), { status: 400, headers: cors });
      const clean = {
        id: p.id || ("p" + Date.now()),
        nome: String(p.nome).trim().slice(0, 120),
        contato: String(p.contato || "").slice(0, 80),
        cidade: String(p.cidade || "").slice(0, 60),
        origem: String(p.origem || "").slice(0, 60),
        status: STATUS.includes(p.status) ? p.status : "novo",
        visita: String(p.visita || "").slice(0, 20),
        feedbacks: Array.isArray(p.feedbacks) ? p.feedbacks.slice(-200).map((f) => ({
          ts: f.ts || Date.now(), por: String(f.por || "equipe").slice(0, 40), texto: String(f.texto || "").slice(0, 600),
        })) : [],
        incrementos: Array.isArray(p.incrementos) ? p.incrementos.slice(0, 50).map((i) => ({
          label: String(i.label || "").slice(0, 60), valor: String(i.valor || "").slice(0, 200),
        })) : [],
        por: String(p.por || "equipe").slice(0, 40),
        ts: p.ts || Date.now(),
        ts_upd: Date.now(),
      };
      lista = lista.filter((x) => x.id !== clean.id);
      lista.push(clean);
    }
    await store.setJSON("lista", lista);
    return Response.json({ ok: true, prospects: await load() }, { headers: cors });
  }
  return new Response("metodo nao permitido", { status: 405, headers: cors });
};

export const config = { path: "/api/crm-prospeccao" };
