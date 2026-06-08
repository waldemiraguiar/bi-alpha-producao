/* Função serverless: HISTÓRICO semanal do radar de movimentação (snapshots).
   Netlify Blobs. GET -> {snapshots}. POST {week, snapshot, senha} faz UPSERT por semana ISO.
   Cada snapshot é a "foto" da semana: contagens + lista de clientes sinalizados.
   Resolve o problema do dado vivo (a cada 6h sobrescreve) guardando o histórico à parte.
   Segredo (senha do time CRM) injetado no deploy (secret.mjs). Retenção ~104 semanas. */
import { getStore } from "@netlify/blobs";
import { SECRET } from "./secret.mjs";

const MAX_WEEKS = 520; // ~10 anos (permanente na prática)

export default async (req) => {
  const store = getStore("crm-history");
  const load = async () =>
    (await store.get("snapshots", { type: "json", consistency: "strong" })) || [];
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  };
  if (req.method === "OPTIONS") return new Response("", { headers: cors });

  if (req.method === "GET")
    return Response.json({ snapshots: await load() }, { headers: cors });

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    if (!SECRET || body.senha !== SECRET)
      return new Response(JSON.stringify({ erro: "nao autorizado" }), { status: 401, headers: cors });
    if (!body.week || !body.snapshot)
      return new Response(JSON.stringify({ erro: "sem week/snapshot" }), { status: 400, headers: cors });

    const snap = { ...body.snapshot, week: String(body.week) };
    let arr = (await load()).filter((s) => s.week !== snap.week); // upsert por semana
    arr.push(snap);
    arr.sort((a, b) => (a.week < b.week ? -1 : a.week > b.week ? 1 : 0));
    if (arr.length > MAX_WEEKS) arr = arr.slice(-MAX_WEEKS);
    await store.setJSON("snapshots", arr);
    return Response.json({ ok: true, weeks: arr.length }, { headers: cors });
  }
  return new Response("metodo nao permitido", { status: 405, headers: cors });
};

export const config = { path: "/api/crm-history" };
