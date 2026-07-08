/* Função serverless: RELATOS DA PISTA (voz da rua — inteligência de campo do comercial).
   O rep GRAVA um áudio relatando o cenário (ligação/reunião com a clínica) → transcrito no aparelho
   → vira card estruturado: título, clínica, médico, data, hora, resumo + dores detectadas.
   ≠ Feedbacks de visita (que têm check-in/baixa/rota). Aqui é relato qualitativo (voz do cliente).
   Netlify Blobs, permanente, upsert por id. Segredo (senha do time CRM) injetado no deploy (secret.mjs). */
import { getStore } from "@netlify/blobs";
import * as SEC from "./secret.mjs";
const SECRET = SEC.SECRET;

const ORIG = ["ligacao", "reuniao", "visita", "whatsapp", "outro"];

export default async (req) => {
  const store = getStore("crm-relatos");
  const load = async () => (await store.get("lista", { type: "json", consistency: "strong" })) || [];
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  };
  if (req.method === "OPTIONS") return new Response("", { headers: cors });
  if (req.method === "GET") return Response.json({ relatos: await load() }, { headers: cors });

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    if (!SECRET || body.senha !== SECRET)
      return new Response(JSON.stringify({ erro: "nao autorizado" }), { status: 401, headers: cors });
    let lista = await load();
    if (body.acao === "remove") {
      lista = lista.filter((x) => x.id !== body.id);
    } else {
      const it = body.item || {};
      if (!String(it.texto || "").trim() && !String(it.clinica || "").trim())
        return new Response(JSON.stringify({ erro: "vazio" }), { status: 400, headers: cors });
      const existing = lista.find((x) => x.id === it.id);
      const clean = {
        id: it.id || ("r" + Date.now()),
        clinica: String(it.clinica || "").slice(0, 120),
        medico: String(it.medico || "").slice(0, 120),
        titulo: String(it.titulo || "").slice(0, 160),
        texto: String(it.texto || "").slice(0, 4000),
        data: String(it.data || "").slice(0, 20),
        hora: String(it.hora || "").slice(0, 10),
        origem: ORIG.includes(it.origem) ? it.origem : "visita",
        por: String(it.por || "equipe").slice(0, 40),
        ts: existing ? existing.ts : (it.ts || Date.now()),   // mantém a data original ao editar
        ts_upd: Date.now(),
      };
      lista = lista.filter((x) => x.id !== clean.id);
      lista.push(clean);
    }
    await store.setJSON("lista", lista);
    return Response.json({ ok: true, relatos: await load() }, { headers: cors });
  }
  return new Response("metodo nao permitido", { status: 405, headers: cors });
};

export const config = { path: "/api/crm-relatos" };
