/* Função serverless: SEPARAÇÃO DE AMOSTRAS (pré-analítico) — marcações PERMANENTES.
   Netlify Blobs (sem auto-expiração; histórico precisa persistir).
   GET  -> { marks:[...] }            (todas as marcações; ?desde=YYYY-MM-DD filtra por data da separação)
   POST { senha, acao, chave, ... }   acao = separar | enviar | receber | voltar | desfazer
   Estados do ciclo: separado -> (apoio) enviado -> recebido.
   chave = `${req}-${codex}` (única por exame da requisição). Segredo = PROD_PWD (secret.mjs). */
import { getStore } from "@netlify/blobs";
import { SECRET } from "./secret.mjs";
import { ADMIN } from "./admin.mjs";

const KEY = "marks";
const PRUNE = 366 * 864e5; // descarta marcações com mais de ~1 ano (limita tamanho)
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" };

const load = async (store) => (await store.get(KEY, { type: "json", consistency: "strong" })) || [];

export default async (req) => {
  const store = getStore("separacao-amostras");
  if (req.method === "OPTIONS") return new Response("", { headers: cors });

  if (req.method === "GET") {
    let marks = await load(store);
    const url = new URL(req.url);
    const desde = url.searchParams.get("desde");
    if (desde) marks = marks.filter((m) => (m.ts_sep ? new Date(m.ts_sep).toISOString().slice(0, 10) >= desde : true));
    return Response.json({ marks }, { headers: cors });
  }

  if (req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    if (!SECRET || b.senha !== SECRET)
      return new Response(JSON.stringify({ erro: "nao autorizado" }), { status: 401, headers: cors });

    // ADMIN: validar PIN (não altera nada)
    if (b.acao === "admincheck")
      return Response.json({ ok: !!ADMIN && b.admin === ADMIN }, { headers: cors });

    // APAGAR / RESTAURAR não-separados — SÓ ADMIN (PIN validado no servidor). Guarda o item completo (arquivo).
    if (b.acao === "descartar" || b.acao === "undescartar") {
      if (!ADMIN || b.admin !== ADMIN)
        return new Response(JSON.stringify({ erro: "PIN de admin inválido" }), { status: 403, headers: cors });
      const DK = "descartes";
      let desc = (await store.get(DK, { type: "json", consistency: "strong" })) || [];
      if (b.acao === "undescartar") {
        const chaves = Array.isArray(b.chaves) ? b.chaves : (b.chave ? [b.chave] : []);
        desc = desc.filter((d) => !chaves.includes(d.chave));
      } else {
        const itens = Array.isArray(b.itens) ? b.itens : [];
        const set = new Set(desc.map((d) => d.chave));
        itens.forEach((it) => { if (it && it.chave && !set.has(it.chave)) desc.push({ ...it, por: b.por || "admin", ts: Date.now() }); });
      }
      await store.setJSON(DK, desc);
      return Response.json({ ok: true, descartes: desc }, { headers: cors });
    }

    if (!b.chave)
      return new Response(JSON.stringify({ erro: "sem chave" }), { status: 400, headers: cors });

    const now = Date.now();
    let marks = (await load(store)).filter((m) => m && (!m.ts_sep || now - new Date(m.ts_sep).getTime() < PRUNE));
    const i = marks.findIndex((m) => m.chave === b.chave);
    const cur = i >= 0 ? marks[i] : null;

    if (b.acao === "desfazer") {
      if (i >= 0) marks.splice(i, 1);
    } else if (b.acao === "separar") {
      const novo = {
        chave: b.chave, req: b.req, ano: b.ano, codex: b.codex, exame: b.exame || "",
        cat: b.cat || "", classe: b.classe || "", paciente: b.paciente || "", tutor: b.tutor || "",
        vet: b.vet || "", estado: "separado", por: b.por || "equipe",
        ts_sep: now, no_prazo: b.no_prazo !== false, corte: b.corte || null,
      };
      if (i >= 0) marks[i] = { ...cur, ...novo }; else marks.push(novo);
    } else if (b.acao === "enviar") {
      if (!cur) return new Response(JSON.stringify({ erro: "marque como separado antes de enviar" }), { status: 400, headers: cors });
      marks[i] = { ...cur, estado: "enviado", por_env: b.por || "equipe", ts_env: now, data_env: b.data_env || new Date(now).toISOString().slice(0, 10) };
    } else if (b.acao === "receber") {
      if (!cur) return new Response(JSON.stringify({ erro: "sem marcação para receber" }), { status: 400, headers: cors });
      marks[i] = { ...cur, estado: "recebido", por_receb: b.por || "equipe", ts_receb: now };
    } else if (b.acao === "voltar") {
      if (i >= 0) {
        const ordem = ["separado", "enviado", "recebido"];
        const p = ordem.indexOf(cur.estado);
        if (p <= 0) marks.splice(i, 1); // voltar do 1º passo = remover
        else marks[i] = { ...cur, estado: ordem[p - 1] };
      }
    } else {
      return new Response(JSON.stringify({ erro: "acao invalida" }), { status: 400, headers: cors });
    }

    await store.setJSON(KEY, marks);
    return Response.json({ ok: true, marks }, { headers: cors });
  }
  return new Response("metodo nao permitido", { status: 405, headers: cors });
};

export const config = { path: "/api/separacao" };
