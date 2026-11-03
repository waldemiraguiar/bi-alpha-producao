/* Função serverless: HISTÓRICO dos relatórios do Monitoramento (fotos datadas).
   Toda vez que a equipe puxa um relatório (financeiro ou p/ equipe), salva uma FOTO da lista;
   o app mostra o DIFF (🆕 entraram / ❌ saíram / 🔻 passaram a cair) vs a foto anterior do mesmo tipo.
   SEM R$ — guarda só {c:cod, n:nome, t:tipo, b:bairro, q:caindo?1:0} (seguro em claro).
   {hist:[{ts,por,tipo,dia,rows:[...]}]} mais novo primeiro, cap 20. GET público · POST add com senha do time.
   Netlify Blobs · escrita SEGURA via updateBlob (CAS). */
import { getStore } from "@netlify/blobs";
import { SECRET } from "./secret.mjs";
import { updateBlob } from "./_store.mjs";

export default async (req) => {
  const store = getStore("crm-safra-hist");
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  };
  if (req.method === "OPTIONS") return new Response("", { headers: cors });
  if (req.method === "GET") {
    const d = (await store.get("hist", { type: "json", consistency: "strong" })) || [];
    return Response.json({ hist: Array.isArray(d) ? d : [] }, { headers: cors });
  }
  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    if (!SECRET || body.senha !== SECRET)
      return new Response(JSON.stringify({ erro: "nao autorizado" }), { status: 401, headers: cors });
    if (body.acao === "add") {
      const s = body.snap && typeof body.snap === "object" ? body.snap : null;
      if (!s) return new Response(JSON.stringify({ erro: "sem snap" }), { status: 400, headers: cors });
      const snap = {
        ts: Date.now(),
        por: String(s.por || "equipe").slice(0, 40),
        tipo: s.tipo === "fin" ? "fin" : "equipe",
        dia: +s.dia || 0,
        rows: Array.isArray(s.rows) ? s.rows.slice(0, 400).map((r) => ({
          c: String(r.c || r.cod || "").slice(0, 12),
          n: String(r.n || r.nome || "").slice(0, 80),
          t: String(r.t || r.tipo || "").slice(0, 16),
          b: String(r.b || r.bairro || "").slice(0, 40),
          q: r.q ? 1 : 0,
        })) : [],
      };
      const next = await updateBlob(store, "hist", (prev) => {
        const a = Array.isArray(prev) ? prev : [];
        return [snap, ...a].slice(0, 20);
      });
      return Response.json({ ok: true, hist: next }, { headers: cors });
    }
    return new Response(JSON.stringify({ erro: "acao invalida" }), { status: 400, headers: cors });
  }
  return new Response("metodo nao permitido", { status: 405, headers: cors });
};

export const config = { path: "/api/crm-safra-hist" };
