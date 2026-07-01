/* Função serverless: HISTÓRICO DE EXCLUSÕES (auditoria — nada some sem rastro).
   Netlify Blobs (append-only). GET -> {exclusoes}. POST {acao:'add', item, senha}.
   Registra quem excluiu, quando, o quê e por quê. Regra do Wal: toda exclusão vira histórico.
   Segredo (senha do time CRM) injetado no deploy (secret.mjs). */
import { getStore } from "@netlify/blobs";
import { SECRET } from "./secret.mjs";

export default async (req) => {
  const store = getStore("crm-exclusoes");
  const load = async () => (await store.get("lista", { type: "json", consistency: "strong" })) || [];
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  };
  if (req.method === "OPTIONS") return new Response("", { headers: cors });
  if (req.method === "GET") return Response.json({ exclusoes: await load() }, { headers: cors });

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    if (!SECRET || body.senha !== SECRET)
      return new Response(JSON.stringify({ erro: "nao autorizado" }), { status: 401, headers: cors });
    const it = body.item || {};
    const lista = await load();
    lista.push({
      id: "x" + Date.now(),
      tipo: String(it.tipo || "Feedback pista").slice(0, 40),
      cliente: String(it.cliente || "").slice(0, 120),
      bairro: String(it.bairro || "").slice(0, 80),
      resumo: String(it.resumo || "").slice(0, 300),
      por_registro: String(it.por_registro || "").slice(0, 40),   // quem tinha registrado
      por_exclusao: String(it.por_exclusao || "equipe").slice(0, 40), // quem excluiu
      motivo: String(it.motivo || "").slice(0, 300),
      ts_original: +it.ts_original || 0,
      ts: Date.now(),   // quando excluiu
    });
    await store.setJSON("lista", lista.slice(-2000));   // teto de segurança
    return Response.json({ ok: true, exclusoes: await load() }, { headers: cors });
  }
  return new Response("metodo nao permitido", { status: 405, headers: cors });
};

export const config = { path: "/api/crm-exclusoes" };
