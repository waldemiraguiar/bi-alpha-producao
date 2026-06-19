/* Função serverless: CLIENTES INATIVOS (parados travados — calote, falta de pagamento).
   Categoria SEPARADA de Encerrados. Netlify Blobs. GET -> {inativos}.
   POST {acao:'add'|'remove', cod, ..., senha}. PERMANENTE: nada expira.
   Servem p/ TIRAR do percentual geral do estudo (não distorcer a estatística) e
   medir o % de inativação por motivo. Motivos livres (Calote / Falta de pagamento /
   Judicial / Sem contato / qualquer novo). Segredo injetado no deploy (secret.mjs). */
import { getStore } from "@netlify/blobs";
import { SECRET } from "./secret.mjs";

export default async (req) => {
  const store = getStore("crm-inativos");
  const load = async () =>
    (await store.get("lista", { type: "json", consistency: "strong" })) || [];
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  };
  if (req.method === "OPTIONS") return new Response("", { headers: cors });

  if (req.method === "GET")
    return Response.json({ inativos: await load() }, { headers: cors });

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    if (!SECRET || body.senha !== SECRET)
      return new Response(JSON.stringify({ erro: "nao autorizado" }), { status: 401, headers: cors });
    if (body.cod == null)
      return new Response(JSON.stringify({ erro: "sem cliente" }), { status: 400, headers: cors });

    const cod = String(body.cod);
    let lista = (await load()).filter((x) => String(x.cod) !== cod); // 1 registro ativo por cliente
    if (body.acao !== "remove")
      lista.push({
        cod,
        cliente: (body.cliente || "").slice(0, 120),
        motivo: (body.motivo || "Outro").slice(0, 60),
        por: (body.por || "equipe").slice(0, 40),
        nota: (body.nota || "").slice(0, 400),
        cidade: (body.cidade || "").slice(0, 60),
        ts: Date.now(),
      });
    await store.setJSON("lista", lista);
    return Response.json({ ok: true, inativos: await load() }, { headers: cors });
  }
  return new Response("metodo nao permitido", { status: 405, headers: cors });
};

export const config = { path: "/api/crm-inativos" };
