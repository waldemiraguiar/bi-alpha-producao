/* Função serverless: FIXAÇÕES da Lupa POR COLABORADOR (Wal 04/11) — espelha no servidor quais clínicas cada
   colaborador fixou na Lupa, pra a diretoria (Wal/Fábio) ver a Lupa COMPLETA dele (tendo feedback ou não).
   Os pins continuam no localStorage de cada aparelho (rápido); aqui é só a CÓPIA pra diretoria enxergar.
   Estrutura: { <operador>: [ "cod", ... ] }. SEM R$. GET público · POST set com senha do time. Netlify Blobs · updateBlob (CAS). */
import { getStore } from "@netlify/blobs";
import { SECRET } from "./secret.mjs";
import { updateBlob } from "./_store.mjs";

export default async (req) => {
  const store = getStore("crm-lupa-pins");
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  };
  if (req.method === "OPTIONS") return new Response("", { headers: cors });
  if (req.method === "GET") {
    const d = (await store.get("pins", { type: "json", consistency: "strong" })) || {};
    return Response.json({ pins: d }, { headers: cors });
  }
  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    if (!SECRET || body.senha !== SECRET)
      return new Response(JSON.stringify({ erro: "nao autorizado" }), { status: 401, headers: cors });
    const op = String(body.op || "").trim().slice(0, 40);
    if (!op) return new Response(JSON.stringify({ erro: "sem op" }), { status: 400, headers: cors });
    if (body.acao === "set") {
      const cods = Array.isArray(body.cods) ? body.cods.map((c) => String(c)).filter(Boolean).slice(0, 40) : [];
      const next = await updateBlob(store, "pins", (prev) => {
        const d = prev && typeof prev === "object" ? prev : {};
        d[op] = cods;
        return d;
      });
      return Response.json({ ok: true, pins: next }, { headers: cors });
    }
    return new Response(JSON.stringify({ erro: "acao invalida" }), { status: 400, headers: cors });
  }
  return new Response("metodo nao permitido", { status: 405, headers: cors });
};

export const config = { path: "/api/crm-lupa-pins" };
