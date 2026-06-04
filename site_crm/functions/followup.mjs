/* Função serverless: FOLLOW-UP de clientes (marcação compartilhada pela equipe CRM).
   Netlify Blobs. GET -> {followups}. POST {cod, nome, por, nota, acao:'add'|'remove', senha}.
   Segredo (senha do time CRM) injetado no deploy (secret.mjs). Auto-expira em 30 dias. */
import { getStore } from "@netlify/blobs";
import { SECRET } from "./secret.mjs";

const AGE = 30 * 864e5; // 30 dias

export default async (req) => {
  const store = getStore("crm-followup");
  const load = async () => {
    const raw = (await store.get("lista", { type: "json", consistency: "strong" })) || [];
    const cut = Date.now() - AGE;
    return raw.filter((x) => x && x.ts > cut);
  };
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  };
  if (req.method === "OPTIONS") return new Response("", { headers: cors });

  if (req.method === "GET")
    return Response.json({ followups: await load() }, { headers: cors });

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    if (!SECRET || body.senha !== SECRET)
      return new Response(JSON.stringify({ erro: "nao autorizado" }), { status: 401, headers: cors });
    if (body.cod == null)
      return new Response(JSON.stringify({ erro: "sem cliente" }), { status: 400, headers: cors });
    const cod = String(body.cod);
    let lista = (await load()).filter((x) => String(x.cod) !== cod);
    if (body.acao !== "remove")
      lista.push({
        cod, nome: body.nome || "", por: body.por || "equipe",
        nota: (body.nota || "").slice(0, 140), ts: Date.now(),
      });
    await store.setJSON("lista", lista);
    return Response.json({ ok: true, followups: await load() }, { headers: cors });
  }
  return new Response("metodo nao permitido", { status: 405, headers: cors });
};

export const config = { path: "/api/followup" };
