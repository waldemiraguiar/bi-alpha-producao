/* Função serverless: CLIENTES VIGIADOS (sensível / com atenção) — PERMANENTE.
   Netlify Blobs. GET -> { flags:[...], baixas:[...] }.
   POST { senha, acao, ... }:
     - flag    {cod, nome, classe('sensivel'|'atencao'), por}   -> cadastra/atualiza cliente vigiado
     - desflag {cod}                                            -> remove (cancelar) cliente
     - baixa   {chave, cod, classe, cliente, req, ano, paciente, por} -> da baixa num alerta (req)
     - desbaixa{chave}                                          -> desfaz a baixa
   chave do alerta = `${req}-${ano}`. Segredo = PROD_PWD (secret.mjs). */
import { getStore } from "@netlify/blobs";
import { SECRET } from "./secret.mjs";

const FK = "flags", BK = "baixas";
const BAIXA_AGE = 30 * 864e5; // baixas expiram em ~30d (alerta só vive ~2d na fonte mesmo)
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" };
const load = async (store, k) => (await store.get(k, { type: "json", consistency: "strong" })) || [];

export default async (req) => {
  const store = getStore("clientes-vigiados");
  if (req.method === "OPTIONS") return new Response("", { headers: cors });

  if (req.method === "GET") {
    const flags = await load(store, FK);
    const baixas = (await load(store, BK)).filter(b => b && b.ts > Date.now() - BAIXA_AGE);
    return Response.json({ flags, baixas }, { headers: cors });
  }

  if (req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    if (!SECRET || b.senha !== SECRET)
      return new Response(JSON.stringify({ erro: "nao autorizado" }), { status: 401, headers: cors });
    const now = Date.now();

    if (b.acao === "flag") {
      if (b.cod == null || !["sensivel", "atencao"].includes(b.classe))
        return new Response(JSON.stringify({ erro: "dados invalidos" }), { status: 400, headers: cors });
      let flags = (await load(store, FK)).filter(f => String(f.cod) !== String(b.cod));
      flags.push({ cod: b.cod, nome: b.nome || "", classe: b.classe, por: b.por || "equipe", ts: now });
      await store.setJSON(FK, flags);
      return Response.json({ ok: true, flags, baixas: await load(store, BK) }, { headers: cors });
    }
    if (b.acao === "desflag") {
      const flags = (await load(store, FK)).filter(f => String(f.cod) !== String(b.cod));
      await store.setJSON(FK, flags);
      return Response.json({ ok: true, flags, baixas: await load(store, BK) }, { headers: cors });
    }
    if (b.acao === "baixa") {
      // unitário {chave} ou lote {chaves:[...]} (sensível dá baixa na clínica inteira)
      const chaves = Array.isArray(b.chaves) ? b.chaves : (b.chave ? [b.chave] : []);
      if (!chaves.length) return new Response(JSON.stringify({ erro: "sem chave" }), { status: 400, headers: cors });
      let baixas = (await load(store, BK)).filter(x => !chaves.includes(x.chave));
      chaves.forEach(ch => baixas.push({ chave: ch, cod: b.cod, classe: b.classe, cliente: b.cliente || "", req: b.req, ano: b.ano, paciente: b.paciente || "", por: b.por || "equipe", ts: now }));
      await store.setJSON(BK, baixas);
      return Response.json({ ok: true, flags: await load(store, FK), baixas }, { headers: cors });
    }
    if (b.acao === "desbaixa") {
      const baixas = (await load(store, BK)).filter(x => x.chave !== b.chave);
      await store.setJSON(BK, baixas);
      return Response.json({ ok: true, flags: await load(store, FK), baixas }, { headers: cors });
    }
    return new Response(JSON.stringify({ erro: "acao invalida" }), { status: 400, headers: cors });
  }
  return new Response("metodo nao permitido", { status: 405, headers: cors });
};

export const config = { path: "/api/clientes" };
