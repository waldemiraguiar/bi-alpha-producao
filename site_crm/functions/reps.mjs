/* Função serverless: COMERCIAIS da Pista (lista de representantes de rua).
   Netlify Blobs. GET -> {reps}. POST {acao:'add'|'remove', nome, senha}.
   Lista gerenciável pelo gestor — pra setorizar os feedbacks por pessoa.
   Segredo (senha do time CRM) injetado no deploy (secret.mjs). */
import { getStore } from "@netlify/blobs";
import { SECRET } from "./secret.mjs";

export default async (req) => {
  const store = getStore("crm-reps");
  const load = async () => (await store.get("lista", { type: "json", consistency: "strong" })) || [];
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  };
  if (req.method === "OPTIONS") return new Response("", { headers: cors });
  if (req.method === "GET") return Response.json({ reps: await load() }, { headers: cors });

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    if (!SECRET || body.senha !== SECRET)
      return new Response(JSON.stringify({ erro: "nao autorizado" }), { status: 401, headers: cors });
    let lista = await load();
    const nome = String(body.nome || "").trim().slice(0, 60);
    if (body.acao === "remove") {
      lista = lista.filter((n) => n.toLowerCase() !== nome.toLowerCase());
    } else {
      if (!nome) return new Response(JSON.stringify({ erro: "sem nome" }), { status: 400, headers: cors });
      if (!lista.some((n) => n.toLowerCase() === nome.toLowerCase())) lista.push(nome);
      lista.sort((a, b) => a.localeCompare(b));
    }
    await store.setJSON("lista", lista);
    return Response.json({ ok: true, reps: await load() }, { headers: cors });
  }
  return new Response("metodo nao permitido", { status: 405, headers: cors });
};

export const config = { path: "/api/crm-reps" };
