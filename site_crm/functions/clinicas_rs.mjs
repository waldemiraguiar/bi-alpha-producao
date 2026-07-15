/* Função serverless: R$ POR CLÍNICA — CIFRADO só p/ DIRETORIA.
   Guarda o mapa {CodCliente: faturamento} cifrado (AES-256-GCM + PBKDF2-SHA256) com a chave derivada do
   CÓDIGO DA DIRETORIA. O GET é público mas devolve só o CIPHERTEXT — inútil sem o código. Reps (que têm a
   senha do time) NUNCA veem R$: não têm o código pra decifrar. O robô POSTa o env cifrado (senha do time).
   Netlify Blobs. */
import { getStore } from "@netlify/blobs";
import { SECRET } from "./secret.mjs";

export default async (req) => {
  const store = getStore("crm-clinicas-rs");
  const load = async () => (await store.get("env", { type: "json", consistency: "strong" })) || {};
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  };
  if (req.method === "OPTIONS") return new Response("", { headers: cors });
  if (req.method === "GET") return Response.json(await load(), { headers: cors });   // só ciphertext

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    if (!SECRET || body.senha !== SECRET)
      return new Response(JSON.stringify({ erro: "nao autorizado" }), { status: 401, headers: cors });
    if (body.acao === "set" && body.env && body.env.ct) {
      const e = body.env;
      await store.setJSON("env", { v: 1, kdf: "PBKDF2-SHA256", iter: +e.iter || 250000,
        salt: String(e.salt || ""), iv: String(e.iv || ""), ct: String(e.ct || ""), ts: Date.now() });
      return Response.json({ ok: true }, { headers: cors });
    }
    return new Response(JSON.stringify({ erro: "acao invalida" }), { status: 400, headers: cors });
  }
  return new Response("metodo nao permitido", { status: 405, headers: cors });
};

export const config = { path: "/api/crm-clinicas-rs" };
