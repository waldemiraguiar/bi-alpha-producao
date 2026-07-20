/* Função serverless: CLÍNICAS TRIPLO A — top faturamento 12m (curva A), com share-of-wallet 12m.
   Ordem do array = ranking por faturamento (SEM R$ no payload — só qtd de exames + categorias que manda/não manda).
   O R$ 12m da diretoria já vem cifrado no /api/crm-clinicas-rs. Netlify Blobs. GET público · POST {acao:'set'} pelo robô. */
import { getStore } from "@netlify/blobs";
import { SECRET } from "./secret.mjs";

export default async (req) => {
  const store = getStore("crm-aaa");
  const load = async () => (await store.get("dados", { type: "json", consistency: "strong" })) || { aaa: [], setores: [], pct: 80, ts: 0 };
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  };
  if (req.method === "OPTIONS") return new Response("", { headers: cors });
  if (req.method === "GET") return Response.json(await load(), { headers: cors });

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    if (!SECRET || body.senha !== SECRET)
      return new Response(JSON.stringify({ erro: "nao autorizado" }), { status: 401, headers: cors });
    if (body.acao === "set") {
      const arr = Array.isArray(body.aaa) ? body.aaa : [];
      const setores = Array.isArray(body.setores) ? body.setores.slice(0, 20).map((s) => String(s).slice(0, 40)) : [];
      const out = arr.slice(0, 200).map((a) => ({
        cod: String(a.cod || "").slice(0, 30),
        nome: String(a.nome || "").slice(0, 120),
        cidade: String(a.cidade || "").slice(0, 80),
        qtd: +a.qtd || 0,
        cats: Array.isArray(a.cats) ? a.cats.slice(0, 20).map((c) => ({ setor: String(c.setor || "").slice(0, 40), qtd: +c.qtd || 0 })) : [],
        falta: Array.isArray(a.falta) ? a.falta.slice(0, 20).map((s) => String(s).slice(0, 40)) : [],
      }));
      await store.setJSON("dados", { aaa: out, setores, pct: +body.pct || 80, ts: Date.now() });
      return Response.json({ ok: true, n: out.length }, { headers: cors });
    }
    return new Response(JSON.stringify({ erro: "acao invalida" }), { status: 400, headers: cors });
  }
  return new Response("metodo nao permitido", { status: 405, headers: cors });
};

export const config = { path: "/api/crm-aaa" };
