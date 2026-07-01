/* Função serverless: PISTA (feedback do comercial de rua — field sales).
   Netlify Blobs. GET -> {pista}. POST {acao:'save'|'remove', item, id, senha}.
   Cada feedback: cliente + texto (transcrito da voz, editável) + resultado + carimbo
   de data/hora. PERMANENTE — vira histórico por dia/semana/mês/ano. Editável (upsert por id).
   Segredo (senha do time CRM) injetado no deploy (secret.mjs). */
import { getStore } from "@netlify/blobs";
import * as SEC from "./secret.mjs";
const SECRET = SEC.SECRET;

const RES = ["interesse", "orcamento", "fechou", "objecao", "sem_interesse", "visita"];

export default async (req) => {
  const store = getStore("crm-pista");
  const load = async () => (await store.get("lista", { type: "json", consistency: "strong" })) || [];
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  };
  if (req.method === "OPTIONS") return new Response("", { headers: cors });
  if (req.method === "GET") return Response.json({ pista: await load() }, { headers: cors });

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    if (!SECRET || body.senha !== SECRET)
      return new Response(JSON.stringify({ erro: "nao autorizado" }), { status: 401, headers: cors });
    let lista = await load();
    if (body.acao === "remove") {
      lista = lista.filter((x) => x.id !== body.id);
    } else {
      const it = body.item || {};
      if (!String(it.texto || "").trim() && !String(it.cliente || "").trim())
        return new Response(JSON.stringify({ erro: "vazio" }), { status: 400, headers: cors });
      const existing = lista.find((x) => x.id === it.id);
      // BAIXA por "desmarcado" (sem ida) exige CÓDIGO DA DIRETORIA (blindagem anti-golpe)
      if (it.baixa && it.baixa.tipo === "desmarcado") {
        if (!SEC.DIR_CODE || body.dir_code !== SEC.DIR_CODE)
          return new Response(JSON.stringify({ erro: "codigo_diretoria_invalido" }), { status: 403, headers: cors });
      }
      const baixa = it.clear_baixa ? null : (it.baixa && typeof it.baixa === "object") ? {
        tipo: it.baixa.tipo === "desmarcado" ? "desmarcado" : "compareceu",
        ts: +it.baixa.ts || Date.now(),
        por: String(it.baixa.por || "").slice(0, 40),
        motivo: String(it.baixa.motivo || "").slice(0, 200),
        autorizado_por: it.baixa.tipo === "desmarcado" ? "diretoria" : "",
        checkin: (it.baixa.checkin && typeof it.baixa.checkin === "object")
          ? { lat: +it.baixa.checkin.lat || 0, lng: +it.baixa.checkin.lng || 0, acc: +it.baixa.checkin.acc || 0, ts: +it.baixa.checkin.ts || 0 } : null,
      } : (existing ? existing.baixa || null : null);
      const clean = {
        id: it.id || ("f" + Date.now()),
        cliente: String(it.cliente || "").slice(0, 120),
        bairro: String(it.bairro || "").slice(0, 80),
        cod: it.cod ? String(it.cod).slice(0, 30) : "",
        texto: String(it.texto || "").slice(0, 2000),
        resultado: RES.includes(it.resultado) ? it.resultado : "visita",
        data_visita: String(it.data_visita || "").slice(0, 20),
        checkin: (it.checkin && typeof it.checkin === "object")
          ? { lat: +it.checkin.lat || 0, lng: +it.checkin.lng || 0, acc: +it.checkin.acc || 0, ts: +it.checkin.ts || 0 }
          : (existing ? existing.checkin || null : null),   // não perde o check-in ao editar
        proximo: String(it.proximo || "").slice(0, 20),
        sem_retorno: !!it.sem_retorno,
        baixa,
        por: String(it.por || "equipe").slice(0, 40),
        ts: existing ? existing.ts : (it.ts || Date.now()),   // mantém data original ao editar
        ts_upd: Date.now(),
      };
      lista = lista.filter((x) => x.id !== clean.id);
      lista.push(clean);
    }
    await store.setJSON("lista", lista);
    return Response.json({ ok: true, pista: await load() }, { headers: cors });
  }
  return new Response("metodo nao permitido", { status: 405, headers: cors });
};

export const config = { path: "/api/crm-pista" };
