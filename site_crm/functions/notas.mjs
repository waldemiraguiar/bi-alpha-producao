/* Função serverless: NOTAS POR CLÍNICA (feedback da equipe sobre o cliente).
   {cod: [{ts, por, texto}]} — a Luciane (e o time) registra o que rolou com cada clínica dentro do "+".
   Compartilhado (todos veem) · com autor e data · histórico (não sobrescreve). SEM R$.
   GET público (em claro); POST add/remove com senha do time. Escrita SEGURA via updateBlob (CAS). */
import { getStore } from "@netlify/blobs";
import { SECRET } from "./secret.mjs";
import { updateBlob } from "./_store.mjs";

export default async (req) => {
  const store = getStore("crm-notas");
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  };
  if (req.method === "OPTIONS") return new Response("", { headers: cors });
  if (req.method === "GET") {
    const d = (await store.get("notas", { type: "json", consistency: "strong" })) || {};
    return Response.json({ notas: d }, { headers: cors });
  }
  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    if (!SECRET || body.senha !== SECRET)
      return new Response(JSON.stringify({ erro: "nao autorizado" }), { status: 401, headers: cors });
    const cod = String(body.cod || "").trim();
    if (!cod) return new Response(JSON.stringify({ erro: "sem cod" }), { status: 400, headers: cors });

    if (body.acao === "add") {
      const texto = String(body.texto || "").trim().slice(0, 1200);
      if (!texto) return new Response(JSON.stringify({ erro: "texto vazio" }), { status: 400, headers: cors });
      const nota = { ts: Date.now(), por: String(body.por || "equipe").slice(0, 40), texto };
      const next = await updateBlob(store, "notas", (prev) => {
        const d = prev && typeof prev === "object" ? prev : {};
        d[cod] = [...(d[cod] || []), nota];
        return d;
      });
      return Response.json({ ok: true, notas: next }, { headers: cors });
    }
    if (body.acao === "remove") {
      const ts = +body.ts;
      const next = await updateBlob(store, "notas", (prev) => {
        const d = prev && typeof prev === "object" ? prev : {};
        if (d[cod]) d[cod] = d[cod].filter((n) => n.ts !== ts);
        return d;
      });
      return Response.json({ ok: true, notas: next }, { headers: cors });
    }
    return new Response(JSON.stringify({ erro: "acao invalida" }), { status: 400, headers: cors });
  }
  return new Response("metodo nao permitido", { status: 405, headers: cors });
};

export const config = { path: "/api/crm-notas" };
