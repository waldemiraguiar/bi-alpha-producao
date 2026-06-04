/* Função serverless: urgentes MANUAIS + BAIXAS de urgência (no app, sem tocar no operacional).
   Netlify Blobs. GET -> {urgentes, baixas}. POST {tipo:'urgente'|'baixa', registro, acao:'add'|'remove', senha}.
   Segredo injetado no deploy (secret.mjs). Auto-expira (urgentes 3d, baixas 2d). */
import { getStore } from "@netlify/blobs";
import { SECRET } from "./secret.mjs";

const AGE = { lista: 3 * 864e5, baixas: 2 * 864e5 };

export default async (req) => {
  const store = getStore("urgentes-manuais");
  const load = async (key) => {
    const raw = (await store.get(key, { type: "json", consistency: "strong" })) || [];
    const cut = Date.now() - AGE[key];
    return raw.filter((x) => x && x.ts > cut);
  };
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" };
  if (req.method === "OPTIONS") return new Response("", { headers: cors });

  if (req.method === "GET")
    return Response.json({ urgentes: await load("lista"), baixas: await load("baixas") }, { headers: cors });

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    if (!SECRET || body.senha !== SECRET)
      return new Response(JSON.stringify({ erro: "nao autorizado" }), { status: 401, headers: cors });
    if (!body.registro)
      return new Response(JSON.stringify({ erro: "sem registro" }), { status: 400, headers: cors });
    const key = body.tipo === "baixa" ? "baixas" : "lista";
    const reg = String(body.registro);
    let lista = (await load(key)).filter((x) => String(x.registro) !== reg);
    if (body.acao !== "remove")
      lista.push({ registro: reg, paciente: body.paciente || "", exame: body.exame || "", por: body.por || "equipe", ts: Date.now() });
    await store.setJSON(key, lista);
    return Response.json({ ok: true, urgentes: await load("lista"), baixas: await load("baixas") }, { headers: cors });
  }
  return new Response("metodo nao permitido", { status: 405, headers: cors });
};

export const config = { path: "/api/urgentes" };
