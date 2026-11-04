/* Função serverless: FEEDBACK DE CLIENTE na Lupa, POR COLABORADOR (Wal 04/11).
   Cada colaborador (Lu, Wal, Fábio…) tem as SUAS anotações de feedback por clínica; a diretoria (Wal/Fábio)
   pode VER as de qualquer um pelo seletor "👁️ ver a Lupa de: [Lu]". O app é que faz a regra de quem vê o quê
   (comercial vê só as suas; diretoria escolhe). Mesmo modelo de confiança do resto do CRM (senha do time no POST).
   Estrutura: { <operador>: { <cod>: [ {ts, texto} ] } }. SEM R$. GET público · POST add/remove com senha.
   Netlify Blobs · escrita SEGURA via updateBlob (CAS). */
import { getStore } from "@netlify/blobs";
import { SECRET } from "./secret.mjs";
import { updateBlob } from "./_store.mjs";

export default async (req) => {
  const store = getStore("crm-lupa-notas");
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
    const op = String(body.op || "").trim().slice(0, 40);
    const cod = String(body.cod || "").trim();
    if (!op || !cod) return new Response(JSON.stringify({ erro: "falta op/cod" }), { status: 400, headers: cors });

    if (body.acao === "add") {
      const texto = String(body.texto || "").trim().slice(0, 1200);
      if (!texto) return new Response(JSON.stringify({ erro: "texto vazio" }), { status: 400, headers: cors });
      const nota = { ts: Date.now(), texto };
      const next = await updateBlob(store, "notas", (prev) => {
        const d = prev && typeof prev === "object" ? prev : {};
        if (!d[op] || typeof d[op] !== "object") d[op] = {};
        d[op][cod] = [...(d[op][cod] || []), nota].slice(-50);
        return d;
      });
      return Response.json({ ok: true, notas: next }, { headers: cors });
    }
    if (body.acao === "remove") {
      const ts = +body.ts;
      const next = await updateBlob(store, "notas", (prev) => {
        const d = prev && typeof prev === "object" ? prev : {};
        if (d[op] && d[op][cod]) d[op][cod] = d[op][cod].filter((n) => n.ts !== ts);
        return d;
      });
      return Response.json({ ok: true, notas: next }, { headers: cors });
    }
    return new Response(JSON.stringify({ erro: "acao invalida" }), { status: 400, headers: cors });
  }
  return new Response("metodo nao permitido", { status: 405, headers: cors });
};

export const config = { path: "/api/crm-lupa-notas" };
