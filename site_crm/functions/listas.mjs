/* Função serverless: LISTAS DE CADASTRO do CRM — CANAL (onde encontrou o cliente),
   ORIGEM DO LEAD (ativo/receptivo) e OPERADOR (quem fechou). Editável pela equipe (aba de cadastro),
   com COR por item p/ a "chancela" colorida no relatório. Visível a TODOS (sem R$).
   Netlify Blobs, permanente. GET público. POST {acao:'set', cfg, senha} (senha do time). */
import { getStore } from "@netlify/blobs";
import { SECRET } from "./secret.mjs";

// Defaults (semente do pedido da Luciane) — usados enquanto ninguém salvou ainda
const DEFAULTS = {
  fechadores: [
    { nome: "HEITOR", cor: "#00D4FF" },
    { nome: "LUCIANE", cor: "#ff6b9d" },
  ],
  canais: [
    { nome: "GOOGLE", cor: "#4285F4" },
    { nome: "PET LOVE", cor: "#ff6b9d" },
    { nome: "OUTROS PLANOS", cor: "#ffb020" },
    { nome: "INSTAGRAM", cor: "#C13584" },
    { nome: "FACEBOOK", cor: "#1877F2" },
    { nome: "VET DIAGNÓSTICO", cor: "#00E5A0" },
    { nome: "VISITA", cor: "#00D4FF" },
    { nome: "INDICAÇÃO", cor: "#9b8cff" },
  ],
  origens: [
    { nome: "PROSPECÇÃO", grupo: "ativo", cor: "#00E5A0" },
    { nome: "VISITA", grupo: "ativo", cor: "#34d399" },
    { nome: "INDICAÇÃO", grupo: "ativo", cor: "#a3e635" },
    { nome: "CALL CENTER", grupo: "receptivo", cor: "#00D4FF" },
    { nome: "SITE", grupo: "receptivo", cor: "#38bdf8" },
    { nome: "INSTAGRAM", grupo: "receptivo", cor: "#C13584" },
  ],
  ts: 0,
};

const hex = (s, def) => (/^#[0-9a-fA-F]{3,8}$/.test(String(s || "")) ? String(s) : def);
const cleanItem = (x, extraGrupo) => {
  const o = { nome: String(x.nome || "").slice(0, 40).trim(), cor: hex(x.cor, "#9fb2cc") };
  if (extraGrupo) o.grupo = x.grupo === "receptivo" ? "receptivo" : "ativo";
  return o;
};
const dedupe = (arr, extraGrupo) => {
  const seen = new Set(), out = [];
  for (const x of Array.isArray(arr) ? arr : []) {
    const c = cleanItem(x, extraGrupo);
    if (!c.nome) continue;
    const k = (extraGrupo ? c.grupo + "|" : "") + c.nome.toUpperCase();
    if (seen.has(k)) continue;
    seen.add(k); out.push(c);
    if (out.length >= 60) break;
  }
  return out;
};

export default async (req) => {
  const store = getStore("crm-listas");
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  };
  const load = async () => (await store.get("cfg", { type: "json", consistency: "strong" })) || null;
  if (req.method === "OPTIONS") return new Response("", { headers: cors });
  if (req.method === "GET") return Response.json(await load() || DEFAULTS, { headers: cors });

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    if (!SECRET || body.senha !== SECRET)
      return new Response(JSON.stringify({ erro: "nao autorizado" }), { status: 401, headers: cors });
    if (body.acao === "set") {
      const cfg = body.cfg || {};
      const clean = {
        fechadores: dedupe(cfg.fechadores, false),
        canais: dedupe(cfg.canais, false),
        origens: dedupe(cfg.origens, true),
        ts: Date.now(),
      };
      // nunca deixa vazio — se limparem tudo, mantém os defaults daquela lista
      if (!clean.fechadores.length) clean.fechadores = DEFAULTS.fechadores;
      if (!clean.canais.length) clean.canais = DEFAULTS.canais;
      if (!clean.origens.length) clean.origens = DEFAULTS.origens;
      await store.setJSON("cfg", clean);
      return Response.json({ ok: true, cfg: clean }, { headers: cors });
    }
    return new Response(JSON.stringify({ erro: "acao invalida" }), { status: 400, headers: cors });
  }
  return new Response("metodo nao permitido", { status: 405, headers: cors });
};

export const config = { path: "/api/crm-listas" };
