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
        const o = {
          prod30: +d.prod30 || 0, prod7: +d.prod7 || 0,
          cats: Array.isArray(d.cats) ? d.cats.slice(0, 20).map((c) => ({ setor: String(c.setor || "").slice(0, 40), qtd: +c.qtd || 0 })) : [],
          falta: Array.isArray(d.falta) ? d.falta.slice(0, 20).map((s) => String(s).slice(0, 40)) : [],
        };
        if (d.prod12 != null) o.prod12 = +d.prod12 || 0;   // produção 12m somando os códigos-extra (sobrepõe o master quando há cadastro duplicado)
        if (d.prod_desde != null) o.prod_desde = +d.prod_desde || 0;   // produção desde o marco zero (data da reconquista)
        if (d.marco) o.marco = String(d.marco).slice(0, 20);
        if (Array.isArray(d.recent)) {   // drill-down exame-a-exame (dia · exame · PET · tutor · registro)
          o.recent = d.recent.slice(0, 300).map((e) => ({
            d: String(e.d || "").slice(0, 10), ex: String(e.ex || "").slice(0, 60),
            cat: String(e.cat || "").slice(0, 40), pet: String(e.pet || "").slice(0, 40),
            tut: String(e.tut || "").slice(0, 40), req: e.req == null ? null : String(e.req).slice(0, 20),
          }));
          if (d.recent_desde) o.recent_desde = String(d.recent_desde).slice(0, 10);
          if (d.recent_mais) o.recent_mais = true;
        }
        out[String(k).slice(0, 30)] = o;
      }
      await store.setJSON("dados", { det: out, setores, ts: Date.now() });
      return Response.json({ ok: true, n: keys.length }, { headers: cors });
    }
    return new Response(JSON.stringify({ erro: "acao invalida" }), { status: 400, headers: cors });
  }
  return new Response("metodo nao permitido", { status: 405, headers: cors });
};

export const config = { path: "/api/crm-clinicas-det" };
