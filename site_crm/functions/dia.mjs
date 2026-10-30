/* Função serverless: SÉRIE DIÁRIA por clínica (exames/dia nos últimos ~90 dias) — p/ o RADAR DE FUGAS RECENTES
   (queda em janelas curtas 3/7/15 dias) e a lupa de monitoramento. SEM R$ — só volume de exames.
   Payload compacto: {dia:{cod:[[idx,n],...]}, base:"YYYY-MM-DD", hoje_idx:N, dia_hoje:DD}. idx = dias desde `base`.
   Netlify Blobs. GET público (em claro). POST {acao:'set', dia, base, hoje_idx, dia_hoje, senha} pelo robô. */
import { getStore } from "@netlify/blobs";
import { SECRET } from "./secret.mjs";

export default async (req) => {
  const store = getStore("crm-dia");
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  };
  if (req.method === "OPTIONS") return new Response("", { headers: cors });
  if (req.method === "GET") {
    const d = (await store.get("serie", { type: "json" })) || { dia: {}, base: "", hoje_idx: 0, dia_hoje: 0, ts: 0 };
    const ch = "public, max-age=600, stale-while-revalidate=86400";   // muda a cada ~6h → cachear deixa rápido
    return Response.json(d, { headers: { ...cors, "Cache-Control": ch, "Netlify-CDN-Cache-Control": ch } });
  }
  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    if (!SECRET || body.senha !== SECRET)
      return new Response(JSON.stringify({ erro: "nao autorizado" }), { status: 401, headers: cors });
    if (body.acao === "set") {
      const dia = (body.dia && typeof body.dia === "object") ? body.dia : {};
      const rec = {
        dia,
        base: String(body.base || "").slice(0, 10),
        hoje_idx: +body.hoje_idx || 0,
        dia_hoje: +body.dia_hoje || 0,
        ts: Date.now(),
      };
      await store.setJSON("serie", rec);
      return Response.json({ ok: true, n: Object.keys(dia).length }, { headers: cors });
    }
    return new Response(JSON.stringify({ erro: "acao invalida" }), { status: 400, headers: cors });
  }
  return new Response("metodo nao permitido", { status: 405, headers: cors });
};

export const config = { path: "/api/crm-dia" };
