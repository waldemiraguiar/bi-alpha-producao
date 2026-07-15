/* Função serverless: HISTÓRICO dos RELATÓRIOS semanais de clínicas (Novas/Reconquistadas).
   Toda sexta 9h o robô gera o relatório e grava aqui uma FOTO (sem R$ — produção/flags), pra consultar
   a evolução. O R$ vai só no e-mail da diretoria. Netlify Blobs. POST {acao:'save', item, senha} pelo robô. */
import { getStore } from "@netlify/blobs";
import { SECRET } from "./secret.mjs";

export default async (req) => {
  const store = getStore("crm-relatorios");
  const load = async () => (await store.get("lista", { type: "json", consistency: "strong" })) || [];
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  };
  if (req.method === "OPTIONS") return new Response("", { headers: cors });
  if (req.method === "GET") return Response.json({ relatorios: await load() }, { headers: cors });

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    if (!SECRET || body.senha !== SECRET)
      return new Response(JSON.stringify({ erro: "nao autorizado" }), { status: 401, headers: cors });
    let lista = await load();
    if (body.acao === "remove") {
      lista = lista.filter((x) => x.id !== body.id);
    } else {
      const it = body.item || {};
      const clean = {
        id: String(it.id || ("rel" + Date.now())).slice(0, 40),   // upsert por semana (ex.: "2026-W29")
        semana: String(it.semana || "").slice(0, 12),
        label: String(it.label || "").slice(0, 40),
        n_novas: +it.n_novas || 0,
        n_reconq: +it.n_reconq || 0,
        prod_total: +it.prod_total || 0,
        flags: Array.isArray(it.flags) ? it.flags.slice(0, 200) : [],   // clínicas a trabalhar (sem R$)
        linhas: Array.isArray(it.linhas) ? it.linhas.slice(0, 500) : [], // {nome,cidade,tipo,porte,prod,flag}
        ts: +it.ts || Date.now(),
      };
      lista = lista.filter((x) => x.id !== clean.id);
      lista.push(clean);
      lista.sort((a, b) => (a.id < b.id ? 1 : -1));
      lista = lista.slice(0, 260);   // ~5 anos de sextas
    }
    await store.setJSON("lista", lista);
    return Response.json({ ok: true, n: lista.length }, { headers: cors });
  }
  return new Response("metodo nao permitido", { status: 405, headers: cors });
};

export const config = { path: "/api/crm-relatorios" };
