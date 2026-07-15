/* Função serverless: DETALHE das clínicas da carteira (share-of-wallet) — SEM R$.
   Por CodCliente: setores que ela MANDA (L12) + o que NÃO manda (white-space) + produção 30d/7d.
   Alimenta o card das abas Novas/Reconquistadas: "manda histopato · não manda hemato/bioquímica" → dividindo exame.
   Netlify Blobs. GET público (produção, sem R$). POST {acao:'set', det, setores, senha} pelo robô. */
import { getStore } from "@netlify/blobs";
import { SECRET } from "./secret.mjs";

export default async (req) => {
  const store = getStore("crm-clinicas-det");
  const load = async () => (await store.get("dados", { type: "json", consistency: "strong" })) || { det: {}, setores: [], ts: 0 };
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
      const det = (body.det && typeof body.det === "object") ? body.det : {};
      const setores = Array.isArray(body.setores) ? body.setores.slice(0, 20).map((s) => String(s).slice(0, 40)) : [];
      // sane cap: no máx 500 clínicas
      const keys = Object.keys(det).slice(0, 500), out = {};
      for (const k of keys) {
        const d = det[k] || {};
        out[String(k).slice(0, 30)] = {
          prod30: +d.prod30 || 0, prod7: +d.prod7 || 0,
          cats: Array.isArray(d.cats) ? d.cats.slice(0, 20).map((c) => ({ setor: String(c.setor || "").slice(0, 40), qtd: +c.qtd || 0 })) : [],
          falta: Array.isArray(d.falta) ? d.falta.slice(0, 20).map((s) => String(s).slice(0, 40)) : [],
        };
      }
      await store.setJSON("dados", { det: out, setores, ts: Date.now() });
      return Response.json({ ok: true, n: keys.length }, { headers: cors });
    }
    return new Response(JSON.stringify({ erro: "acao invalida" }), { status: 400, headers: cors });
  }
  return new Response("metodo nao permitido", { status: 405, headers: cors });
};

export const config = { path: "/api/crm-clinicas-det" };
