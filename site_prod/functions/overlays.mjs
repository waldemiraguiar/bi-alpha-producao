/* Função serverless ÚNICA de LEITURA — junta os 3 overlays numa só chamada (economia de créditos).
   GET /api/overlays -> { urgentes, urg_baixas, marks, flags, cli_baixas }
   Lê os 3 stores (urgentes-manuais, separacao-amostras, clientes-vigiados) numa invocação só.
   As ESCRITAS continuam nas funções próprias (/api/urgentes, /api/separacao, /api/clientes). */
import { getStore } from "@netlify/blobs";

const AGE = { lista: 3 * 864e5, baixas: 2 * 864e5, cli_baixas: 30 * 864e5 };
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "GET,OPTIONS" };

export default async (req) => {
  if (req.method === "OPTIONS") return new Response("", { headers: cors });
  const u = getStore("urgentes-manuais");
  const s = getStore("separacao-amostras");
  const c = getStore("clientes-vigiados");
  const get = async (store, key) => (await store.get(key, { type: "json", consistency: "strong" })) || [];
  const now = Date.now();
  try {
    const [lista, ubaixas, marks, flags, cbaixas] = await Promise.all([
      get(u, "lista"), get(u, "baixas"), get(s, "marks"), get(c, "flags"), get(c, "baixas"),
    ]);
    return Response.json({
      urgentes: lista.filter(x => x && x.ts > now - AGE.lista),
      urg_baixas: ubaixas.filter(x => x && x.ts > now - AGE.baixas),
      marks,
      flags,
      cli_baixas: cbaixas.filter(x => x && x.ts > now - AGE.cli_baixas),
    }, { headers: cors });
  } catch (e) {
    return Response.json({ urgentes: [], urg_baixas: [], marks: [], flags: [], cli_baixas: [] }, { headers: cors });
  }
};

export const config = { path: "/api/overlays" };
