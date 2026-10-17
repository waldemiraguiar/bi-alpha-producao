/* Função serverless: CURVA INTRADIÁRIA de produção (q = exames, f = R$) por dia e faixa de 30 min.
   Objetivo: comparar "hoje A ESTA HORA" com a média do mesmo dia da semana A ESTA HORA — o valor do
   dia enche ao longo do dia/madrugada, então o total do dia só fecha de manhã. Esta curva guarda,
   a cada ~30 min, quanto já havia sido lançado até aquele instante.

   Armazenamento: Netlify Blob PRIVADO (store "intraday-data", key "curve") — NUNCA no repo público.
   POST  x-pwd (senha do painel)  corpo {date:"YYYY-MM-DD", slot:"HHMM", q:int, f:number}
         -> lê a curva, ATUALIZA a faixa (date,slot), poda > 120 dias, grava.
   GET   Authorization: Bearer <sessão>  -> devolve a curva JSON (só com login individual, igual ao enc).
   Observação: valor em R$ fica no Blob privado (não é o repo público); leitura exige sessão. */
import { getStore } from "@netlify/blobs";
import { SECRET } from "./secret.mjs";
import { confereToken } from "./login.mjs";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type,x-pwd",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};
const KEY = "curve";
const MAXDIAS = 120;
const okDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
const okSlot = (s) => /^\d{4}$/.test(s || "");
const wdOf = (d) => new Date(d + "T12:00:00Z").getUTCDay(); // 0=dom..6=sáb (date-only, meio-dia evita fuso)

export default async (req) => {
  const store = getStore("intraday-data");
  if (req.method === "OPTIONS") return new Response("", { headers: cors });

  if (req.method === "GET") {
    const auth = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!confereToken(auth))
      return new Response(JSON.stringify({ erro: "sessao necessaria" }), { status: 401, headers: { ...cors, "content-type": "application/json" } });
    const v = await store.get(KEY, { type: "text", consistency: "strong" });
    return new Response(v || JSON.stringify({ v: 1, days: {} }), { headers: { ...cors, "content-type": "application/json", "cache-control": "no-store" } });
  }

  if (req.method === "POST") {
    if (!SECRET || req.headers.get("x-pwd") !== SECRET)
      return new Response(JSON.stringify({ erro: "nao autorizado" }), { status: 401, headers: cors });
    let j;
    try { j = JSON.parse(await req.text()); } catch (e) { return new Response(JSON.stringify({ erro: "json invalido" }), { status: 400, headers: cors }); }
    if (!okDate(j.date) || !okSlot(j.slot))
      return new Response(JSON.stringify({ erro: "date (YYYY-MM-DD) e slot (HHMM) obrigatorios" }), { status: 400, headers: cors });
    const q = Math.max(0, Math.round(+j.q || 0));
    const f = Math.max(0, Math.round(+j.f || 0));

    let cur;
    try { cur = JSON.parse(await store.get(KEY, { type: "text", consistency: "strong" }) || "null"); } catch (e) { cur = null; }
    if (!cur || typeof cur !== "object") cur = { v: 1, days: {} };
    if (!cur.days) cur.days = {};

    if (!cur.days[j.date]) cur.days[j.date] = { wd: wdOf(j.date), slots: {} };
    // só grava se este ponto for >= o último já visto nessa faixa (monotônico — evita engasgo de réplica)
    const prev = cur.days[j.date].slots[j.slot];
    if (!prev || f >= (prev.f || 0)) cur.days[j.date].slots[j.slot] = { q, f };

    // poda > MAXDIAS
    const corte = new Date(Date.now() - MAXDIAS * 864e5).toISOString().slice(0, 10);
    for (const d of Object.keys(cur.days)) if (d < corte) delete cur.days[d];

    cur.updated = new Date().toISOString();
    await store.set(KEY, JSON.stringify(cur));
    return Response.json({ ok: true, date: j.date, slot: j.slot, q, f, dias: Object.keys(cur.days).length }, { headers: cors });
  }

  return new Response("metodo nao permitido", { status: 405, headers: cors });
};

export const config = { path: "/api/intraday" };
