/* Função serverless: CARTEIRA — clínicas NOVAS e RECONQUISTADAS marcadas pela equipe (input manual).
   Cada registro vincula ao HF pelo CodCliente (via autocomplete no cliente) → correlação exata da produção.
   Campos: cod(HF, pode ser "" = pendente de vínculo), nome, cidade, tipo(nova|reconquistada), porte(P|M|G),
   obs, por(operador), ts. Netlify Blobs, permanente, upsert por id. Segredo = senha do time. */
import { getStore } from "@netlify/blobs";
import { SECRET } from "./secret.mjs";

export default async (req) => {
  const store = getStore("crm-carteira");
  const load = async () => (await store.get("lista", { type: "json", consistency: "strong" })) || [];
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  };
  if (req.method === "OPTIONS") return new Response("", { headers: cors });
  if (req.method === "GET") return Response.json({ carteira: await load() }, { headers: cors });

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    if (!SECRET || body.senha !== SECRET)
      return new Response(JSON.stringify({ erro: "nao autorizado" }), { status: 401, headers: cors });
    let lista = await load();
    if (body.acao === "remove") {
      lista = lista.filter((x) => x.id !== body.id);
    } else {
      const it = body.item || {};
      if (!String(it.nome || "").trim())
        return new Response(JSON.stringify({ erro: "sem nome" }), { status: 400, headers: cors });
      const existing = lista.find((x) => x.id === it.id);
      const clean = {
        id: it.id || ("c" + Date.now()),
        cod: String(it.cod == null ? "" : it.cod).slice(0, 30),   // CodCliente do HF ("" = pendente de vínculo)
        nome: String(it.nome || "").slice(0, 120),
        cidade: String(it.cidade || "").slice(0, 80),
        tipo: it.tipo === "reconquistada" ? "reconquistada" : "nova",
        porte: ["P", "M", "G"].includes(it.porte) ? it.porte : "",
        obs: String(it.obs || "").slice(0, 500),
        por: String(it.por || "equipe").slice(0, 40),
        ts: existing ? existing.ts : (it.ts || Date.now()),
        ts_upd: Date.now(),
      };
      lista = lista.filter((x) => x.id !== clean.id);
      lista.push(clean);
    }
    await store.setJSON("lista", lista);
    return Response.json({ ok: true, carteira: await load() }, { headers: cors });
  }
  return new Response("metodo nao permitido", { status: 405, headers: cors });
};

export const config = { path: "/api/crm-carteira" };
