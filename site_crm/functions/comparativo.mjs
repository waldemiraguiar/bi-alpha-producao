/* Função serverless: COMPARATIVO DE TABELAS de preço (Alpha × concorrentes).
   Guarda { labs:[{id,nome,meu}], exames:[{id,cat,nome,precos:{labId:num}}] }. Tudo editável no app.
   Netlify Blobs, permanente. GET público (é tabela de preço, sem dado sigiloso de cliente). Segredo = senha do time. */
import { getStore } from "@netlify/blobs";
import { SECRET } from "./secret.mjs";

export default async (req) => {
  const store = getStore("crm-comparativo");
  const load = async () => (await store.get("dados", { type: "json", consistency: "strong" })) || { labs: [], exames: [], ts: 0 };
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  };
  if (req.method === "OPTIONS") return new Response("", { headers: cors });
  if (req.method === "GET") return Response.json(await load(), { headers: cors });

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    if (!SECRET || body.senha !== SECRET)
      return new Response(JSON.stringify({ erro: "nao autorizado" }), { status: 401, headers: cors });
    const d = body.dados || {};
    const labs = Array.isArray(d.labs) ? d.labs.slice(0, 40).map((l) => ({
      id: String(l.id || ("l" + Math.random().toString(36).slice(2, 7))).slice(0, 20),
      nome: String(l.nome || "Lab").slice(0, 60),
      meu: !!l.meu,
    })) : [];
    const num = (v) => { const n = +v; return isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null; };
    const exames = Array.isArray(d.exames) ? d.exames.slice(0, 4000).map((e) => {
      const precos = {};
      if (e.precos && typeof e.precos === "object") for (const k of Object.keys(e.precos)) { const v = num(e.precos[k]); if (v != null) precos[String(k).slice(0, 20)] = v; }
      return {
        id: String(e.id || ("e" + Math.random().toString(36).slice(2, 8))).slice(0, 24),
        cat: String(e.cat || "").slice(0, 40),
        nome: String(e.nome || "").slice(0, 160),
        precos,
      };
    }).filter((e) => e.nome) : [];
    await store.setJSON("dados", { labs, exames, ts: Date.now() });
    return Response.json({ ok: true, n: exames.length }, { headers: cors });
  }
  return new Response("metodo nao permitido", { status: 405, headers: cors });
};

export const config = { path: "/api/crm-comparativo" };
