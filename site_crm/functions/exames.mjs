/* Função serverless: EXAMES MÊS A MÊS (PÚBLICO, SEM R$).
   Guarda {cod:[{ym,n,nd}]} + dia — só CONTAGEM de exames (volume), nada de dinheiro. Pro time (ex.: Luciane)
   ver tendência/% de alta e queda sem ver R$. GET devolve em CLARO (não é dado financeiro). POST = senha do time.
   Netlify Blobs. */
import { getStore } from "@netlify/blobs";
import { SECRET } from "./secret.mjs";

export default async (req) => {
  const store = getStore("crm-exames");
  const load = async () => (await store.get("dados", { type: "json", consistency: "strong" })) || {};
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
    if (body.acao === "set" && body.exmes) {
      await store.setJSON("dados", { exmes: body.exmes, dia: +body.dia || (new Date()).getDate(), ts: Date.now() });
      return Response.json({ ok: true }, { headers: cors });
    }
    return new Response(JSON.stringify({ erro: "acao invalida" }), { status: 400, headers: cors });
  }
  return new Response("metodo nao permitido", { status: 405, headers: cors });
};

export const config = { path: "/api/crm-exames" };
