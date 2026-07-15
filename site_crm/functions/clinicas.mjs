/* Função serverless: MASTER DE CLÍNICAS (espelho do HF/MySQL — TabCliente).
   Alimenta o AUTOCOMPLETE das abas Novas/Reconquistadas: o robô manda a lista de clínicas
   (cod=CodCliente, nome, cidade, prod=produção L12) — SEM R$ (valor fica em pipeline cifrado só p/ diretoria).
   Assim "Guaratiba" acha "Vet Guaratiba" e grava o CodCliente → correlação exata com o HF.
   Netlify Blobs. GET público (só produção). POST {acao:'set', clinicas, senha} pelo robô. */
import { getStore } from "@netlify/blobs";
import { SECRET } from "./secret.mjs";

export default async (req) => {
  const store = getStore("crm-clinicas");
  const load = async () => (await store.get("lista", { type: "json", consistency: "strong" })) || { clinicas: [], ts: 0 };
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
      const arr = Array.isArray(body.clinicas) ? body.clinicas : [];
      const clean = arr.slice(0, 8000).map((c) => ({
        cod: String(c.cod == null ? "" : c.cod).slice(0, 30),
        nome: String(c.nome || "").slice(0, 120),
        cidade: String(c.cidade || "").slice(0, 80),
        prod: +c.prod || 0,          // produção (nº de exames na janela) — SEM R$
        prod30: +c.prod30 || 0,      // produção últimos 30 dias (se enviado)
      })).filter((c) => c.cod && c.nome);
      await store.setJSON("lista", { clinicas: clean, ts: Date.now() });
      return Response.json({ ok: true, n: clean.length }, { headers: cors });
    }
    return new Response(JSON.stringify({ erro: "acao invalida" }), { status: 400, headers: cors });
  }
  return new Response("metodo nao permitido", { status: 405, headers: cors });
};

export const config = { path: "/api/crm-clinicas" };
