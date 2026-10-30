/* Função serverless: DETALHE RECENTE DE EXAMES por clínica (últimos ~21 dias, direto do HF) — p/ a LUPA DE MONITORAMENTO.
   Cada requisição: {r:nº registro HF, d:dia (idx desde base), p:paciente, e:espécie, v:vet solicitante}. SEM R$.
   Payload ~450KB — carregado SOB DEMANDA (só quando a equipe abre a lupa). GET público · POST {acao:'set',...,senha} pelo robô.
   Netlify Blobs. */
import { getStore } from "@netlify/blobs";
import { SECRET } from "./secret.mjs";

export default async (req) => {
  const store = getStore("crm-hf");
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  };
  if (req.method === "OPTIONS") return new Response("", { headers: cors });
  if (req.method === "GET") {
    const d = (await store.get("det", { type: "json", consistency: "strong" })) || { det: {}, base: "", hoje_idx: 0, dias: 0, ts: 0 };
    return Response.json(d, { headers: cors });
  }
  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    if (!SECRET || body.senha !== SECRET)
      return new Response(JSON.stringify({ erro: "nao autorizado" }), { status: 401, headers: cors });
    if (body.acao === "set") {
      const det = (body.det && typeof body.det === "object") ? body.det : {};
      const rec = {
        det,
        base: String(body.base || "").slice(0, 10),
        hoje_idx: +body.hoje_idx || 0,
        dias: +body.dias || 0,
        ts: Date.now(),
      };
      await store.setJSON("det", rec);
      return Response.json({ ok: true, n: Object.keys(det).length }, { headers: cors });
    }
    return new Response(JSON.stringify({ erro: "acao invalida" }), { status: 400, headers: cors });
  }
  return new Response("metodo nao permitido", { status: 405, headers: cors });
};

export const config = { path: "/api/crm-hf" };
