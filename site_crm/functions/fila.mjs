/* Função serverless: MONITOR DA FILA OFFLINE (feedbacks do comercial).
   A fila mora no APARELHO (localStorage). Quando um aparelho está ONLINE mas com feedback
   preso na fila (não sobe), o app manda um "heartbeat" pra cá. Um robô (vigia_fila_crm.yml)
   lê isto e avisa o Wal (WhatsApp/email) se algo ficar preso além do limite.
   GET público (sem R$). POST {acao:'beacon', senha, device, rep, n, oldest_ts}. */
import { getStore } from "@netlify/blobs";
import { SECRET } from "./secret.mjs";
import { updateBlob } from "./_store.mjs";

const MAXAGE = 2 * 3600 * 1000;   // beacons sem heartbeat há +2h = aparelho sumiu → some da lista

export default async (req) => {
  const store = getStore("crm-fila");
  const load = async () => (await store.get("beacons", { type: "json", consistency: "strong" })) || [];
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  };
  if (req.method === "OPTIONS") return new Response("", { headers: cors });
  if (req.method === "GET") {
    const now = Date.now();
    return Response.json({ beacons: (await load()).filter((b) => b && now - (b.ts || 0) < MAXAGE) }, { headers: cors });
  }
  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    if (!SECRET || body.senha !== SECRET)
      return new Response(JSON.stringify({ erro: "nao autorizado" }), { status: 401, headers: cors });
    const dev = String(body.device || "").slice(0, 60);
    if (!dev) return new Response(JSON.stringify({ erro: "sem device" }), { status: 400, headers: cors });
    await updateBlob(store, "beacons", (prev) => {
      const now = Date.now();
      // remove o próprio registro anterior + expira aparelhos que pararam de dar sinal
      let arr = (prev || []).filter((b) => b && b.device !== dev && now - (b.ts || 0) < MAXAGE);
      const n = Math.max(0, Math.min(9999, parseInt(body.n) || 0));
      if (n > 0) arr.push({
        device: dev,
        rep: String(body.rep || "").slice(0, 40),
        n,
        oldest_ts: +body.oldest_ts || now,   // ts do feedback MAIS ANTIGO preso na fila
        ts: now,                              // último heartbeat (prova que o aparelho está online agora)
      });
      return arr.slice(0, 200);
    });
    return Response.json({ ok: true }, { headers: cors });
  }
  return new Response("metodo nao permitido", { status: 405, headers: cors });
};

export const config = { path: "/api/crm-fila" };
