/* Função serverless: REGISTRO DE CONTATOS do CRM (log de interações por cliente).
   Netlify Blobs. GET -> {interacoes}. POST {acao:'add'|'remove', ...campos, senha}.
   Cada registro é um EVENTO IMUTÁVEL com carimbo (snapshot) do estado do cliente no momento.
   Segredo (senha do time CRM) injetado no deploy (secret.mjs). Auto-expira em 365 dias. */
import { getStore } from "@netlify/blobs";
import { SECRET } from "./secret.mjs";

const AGE = 365 * 864e5;
const RESULTADOS = ["positivo", "negociacao", "sem_resposta", "negativo"];

export default async (req) => {
  const store = getStore("crm-interacoes");
  const load = async () => {
    const raw = (await store.get("log", { type: "json", consistency: "strong" })) || [];
    const cut = Date.now() - AGE;
    return raw.filter((x) => x && x.ts > cut);
  };
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  };
  if (req.method === "OPTIONS") return new Response("", { headers: cors });

  if (req.method === "GET")
    return Response.json({ interacoes: await load() }, { headers: cors });

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    if (!SECRET || body.senha !== SECRET)
      return new Response(JSON.stringify({ erro: "nao autorizado" }), { status: 401, headers: cors });

    let log = await load();
    if (body.acao === "remove") {
      log = log.filter((x) => x.id !== body.id);
    } else {
      if (body.cod == null)
        return new Response(JSON.stringify({ erro: "sem cliente" }), { status: 400, headers: cors });
      const resultado = RESULTADOS.includes(body.resultado) ? body.resultado : "sem_resposta";
      const rec = {
        id: `${body.cod}-${Date.now()}`,
        cod: String(body.cod),
        cliente: (body.cliente || "").slice(0, 120),
        por: (body.por || "equipe").slice(0, 40),
        ts: Date.now(),
        canal: (body.canal || "").slice(0, 20),
        resultado,
        motivo: (body.motivo || "").slice(0, 40),
        nota: (body.nota || "").slice(0, 600),
        proximo_passo: (body.proximo_passo || "").slice(0, 20),
        snapshot: {
          dias_inativo: body.snapshot?.dias_inativo ?? null,
          delta: body.snapshot?.delta ?? null,
          situacao: (body.snapshot?.situacao || "").slice(0, 20),
        },
      };
      log.push(rec);
    }
    await store.setJSON("log", log);
    return Response.json({ ok: true, interacoes: await load() }, { headers: cors });
  }
  return new Response("metodo nao permitido", { status: 405, headers: cors });
};

export const config = { path: "/api/interacoes" };
