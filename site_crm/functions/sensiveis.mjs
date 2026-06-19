/* Função serverless: CLIENTES SENSÍVEIS (atenção máxima) — lista editável pela equipe CRM.
   Netlify Blobs. GET -> {sensiveis}. POST {acao:'add'|'remove', nome, obs, id, senha}.
   Sem valores financeiros/produção — só nome + observação. Permanente.
   Pensada para um telão no atendimento (via deep-link #sensiveis, que trava só esta aba).
   Segredo (senha do time CRM) injetado no deploy (secret.mjs). */
import { getStore } from "@netlify/blobs";
import { SECRET } from "./secret.mjs";

export default async (req) => {
  const store = getStore("crm-sensiveis");
  const load = async () => (await store.get("lista", { type: "json", consistency: "strong" })) || [];
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  };
  if (req.method === "OPTIONS") return new Response("", { headers: cors });
  if (req.method === "GET") return Response.json({ sensiveis: await load() }, { headers: cors });

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    if (!SECRET || body.senha !== SECRET)
      return new Response(JSON.stringify({ erro: "nao autorizado" }), { status: 401, headers: cors });
    let lista = await load();
    if (body.acao === "remove") {
      lista = lista.filter((x) => x.id !== body.id);
    } else {
      if (!body.nome || !String(body.nome).trim())
        return new Response(JSON.stringify({ erro: "sem nome" }), { status: 400, headers: cors });
      lista.push({
        id: "s" + Date.now(),
        nome: String(body.nome).trim().slice(0, 120),
        obs: String(body.obs || "").trim().slice(0, 300),
        por: String(body.por || "equipe").slice(0, 40),
        ts: Date.now(),
      });
    }
    await store.setJSON("lista", lista);
    return Response.json({ ok: true, sensiveis: await load() }, { headers: cors });
  }
  return new Response("metodo nao permitido", { status: 405, headers: cors });
};

export const config = { path: "/api/crm-sensiveis" };
