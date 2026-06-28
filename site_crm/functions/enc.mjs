/* Função serverless GENÉRICA: serve um .enc (JSON cifrado) por Netlify Blob, identificado por ?f=<nome>.
   OBJETIVO DE CUSTO: atualizar os DADOS sem re-deployar o site (cada deploy de prod ~15 créditos ≈ US$0,10).
   O build POSTa o .enc aqui (web request barato); o app lê GET /api/enc?f=<nome> e CAI no arquivo
   estático data/<nome>.enc se a função falhar/estiver vazia (nunca quebra).
   GET  ?f=nome  -> JSON cifrado {salt,iter,iv,ct}  (404 se ninguém publicou ainda)
   POST ?f=nome  (header x-pwd: senha do painel, corpo = o JSON cifrado) -> grava no Blob.
   Segredo = senha do painel (secret.mjs). Cada SITE tem seu próprio Blob (isolado por deploy). */
import { getStore } from "@netlify/blobs";
import { SECRET } from "./secret.mjs";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type,x-pwd",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};
const safe = (s) => (String(s || "data").replace(/[^a-z0-9_-]/gi, "").slice(0, 40) || "data");

export default async (req) => {
  const store = getStore("enc-data");
  const key = safe(new URL(req.url).searchParams.get("f"));
  if (req.method === "OPTIONS") return new Response("", { headers: cors });

  if (req.method === "GET") {
    const v = await store.get(key, { type: "text", consistency: "strong" });
    if (!v) return new Response("", { status: 404, headers: cors });
    return new Response(v, { headers: { ...cors, "content-type": "application/json", "cache-control": "no-store" } });
  }

  if (req.method === "POST") {
    if (!SECRET || req.headers.get("x-pwd") !== SECRET)
      return new Response(JSON.stringify({ erro: "nao autorizado" }), { status: 401, headers: cors });
    const body = await req.text();
    let j;
    try { j = JSON.parse(body); } catch (e) { return new Response(JSON.stringify({ erro: "json invalido" }), { status: 400, headers: cors }); }
    if (!j || !j.ct || !j.salt || !j.iv) return new Response(JSON.stringify({ erro: "faltam campos cifrados" }), { status: 400, headers: cors });
    await store.set(key, body);
    return Response.json({ ok: true, key, bytes: body.length }, { headers: cors });
  }

  return new Response("metodo nao permitido", { status: 405, headers: cors });
};

export const config = { path: "/api/enc" };
