/* Função serverless: EXAMES MÊS A MÊS POR CATEGORIA (público, SEM R$) — p/ achar qual CLASSE de exame puxou
   a alta/queda do mês (de→para por categoria). Wal 06/11.
   Payload: {catmes:{cod:{ym:{categoria:{n,nd}}}}, dia:DD, ts}. n=mês cheio · nd=até o dia DD. ~carregado SOB DEMANDA.
   Netlify Blobs. GET público (em claro, só volume) · POST {acao:'set', catmes, dia, senha} pelo robô. */
import { getStore } from "@netlify/blobs";
import { SECRET } from "./secret.mjs";

export default async (req) => {
  const store = getStore("crm-catmes");
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  };
  if (req.method === "OPTIONS") return new Response("", { headers: cors });
  if (req.method === "GET") {
    const d = (await store.get("catmes", { type: "json" })) || { catmes: {}, dia: 0, ts: 0 };
    const ch = "public, max-age=600, stale-while-revalidate=86400";   // muda a cada ~6h → cachear deixa rápido
    return Response.json(d, { headers: { ...cors, "Cache-Control": ch, "Netlify-CDN-Cache-Control": ch } });
  }
  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    if (!SECRET || body.senha !== SECRET)
      return new Response(JSON.stringify({ erro: "nao autorizado" }), { status: 401, headers: cors });
    if (body.acao === "set") {
      const catmes = (body.catmes && typeof body.catmes === "object") ? body.catmes : {};
      await store.setJSON("catmes", { catmes, dia: +body.dia || 0, ts: Date.now() });
      return Response.json({ ok: true, n: Object.keys(catmes).length }, { headers: cors });
    }
    return new Response(JSON.stringify({ erro: "acao invalida" }), { status: 400, headers: cors });
  }
  return new Response("metodo nao permitido", { status: 405, headers: cors });
};

export const config = { path: "/api/crm-catmes" };
