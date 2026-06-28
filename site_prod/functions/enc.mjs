/* Função serverless: serve o producao.enc (JSON cifrado) por Netlify Blob.
   OBJETIVO DE CUSTO: atualizar os DADOS sem re-deployar o site inteiro (cada deploy de prod
   custa ~15 créditos ≈ US$0,10). O build POSTa o .enc aqui a cada ~10 min (web request barato);
   o painel lê GET /api/enc e CAI no arquivo estático data/producao.enc se a função falhar/estiver vazia.
   GET  -> JSON cifrado {salt,iter,iv,ct}   (ou 404 enquanto ninguém publicou ainda)
   POST (header x-pwd: PROD_PWD, corpo = o JSON cifrado) -> grava no Blob.
   Segredo = PROD_PWD (secret.mjs). */
import { getStore } from "@netlify/blobs";
import { SECRET } from "./secret.mjs";

const KEY = "producao";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type,x-pwd",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

export default async (req) => {
  const store = getStore("enc-producao");
  if (req.method === "OPTIONS") return new Response("", { headers: cors });

  if (req.method === "GET") {
    const v = await store.get(KEY, { type: "text", consistency: "strong" });
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
    await store.set(KEY, body);
    return Response.json({ ok: true, bytes: body.length }, { headers: cors });
  }

  return new Response("metodo nao permitido", { status: 405, headers: cors });
};

export const config = { path: "/api/enc" };
