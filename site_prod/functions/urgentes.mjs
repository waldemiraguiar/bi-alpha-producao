/* Função serverless: urgentes MANUAIS (marcados no app, sem tocar no operacional).
   Armazenados em Netlify Blobs. GET lista · POST adiciona/remove (exige senha da equipe).
   Auto-expira em 3 dias (a amostra já deve ter saído). */
import { getStore } from "@netlify/blobs";

const SECRET = process.env.URG_SECRET || "";
const MAXAGE = 3 * 864e5; // 3 dias

export default async (req) => {
  const store = getStore("urgentes-manuais");
  const load = async () => {
    const raw = (await store.get("lista", { type: "json" })) || [];
    const cut = Date.now() - MAXAGE;
    return raw.filter((x) => x && x.ts > cut);
  };
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" };

  if (req.method === "OPTIONS") return new Response("", { headers: cors });

  if (req.method === "GET") {
    const lista = await load();
    return Response.json({ urgentes: lista }, { headers: cors });
  }

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    if (!SECRET || body.senha !== SECRET)
      return new Response(JSON.stringify({ erro: "nao autorizado" }), { status: 401, headers: cors });
    if (!body.registro)
      return new Response(JSON.stringify({ erro: "sem registro" }), { status: 400, headers: cors });
    let lista = await load();
    const reg = String(body.registro);
    lista = lista.filter((x) => String(x.registro) !== reg);          // remove duplicata
    if (body.acao !== "remove") {
      lista.push({ registro: reg, paciente: body.paciente || "", exame: body.exame || "",
                   por: body.por || "equipe", ts: Date.now() });
    }
    await store.setJSON("lista", lista);
    return Response.json({ ok: true, urgentes: lista }, { headers: cors });
  }
  return new Response("metodo nao permitido", { status: 405, headers: cors });
};

export const config = { path: "/api/urgentes" };
