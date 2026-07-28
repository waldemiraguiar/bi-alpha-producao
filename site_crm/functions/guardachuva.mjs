/* Função serverless: 🌂 GUARDA-CHUVA HISTOPATOLOGIA.
   Ponte CRM ↔ produção da histotécnica (Supabase). Fonte única = clinicas_reconquista.
   GET  ?acao=list     -> {clinicas}          (classificação atual)
   GET  ?acao=esteira  -> {esteira}           (exames histopat em andamento dos classificados)
   POST {acao:'upsert', senha, id?, nome, estado, motivo, responsavel, ativo}
   POST {acao:'remove', senha, id}
   Escrita exige a senha do time (SECRET). Token do Supabase fica só no servidor. */
import { SECRET } from "./secret.mjs";

const SUPA_URL = "https://lrwjcdvporaivxvfuiwt.supabase.co";
const ANON = "sb_publishable_fcodHc3AxR_HQ-aduMGzlg_CTBALng8";
const TOKEN = process.env.HISTO_TOKEN || "756544b63f3d524e0c9fb9942c10bb5cba66ead67139efab";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

async function rpc(fn, args) {
  const r = await fetch(`${SUPA_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON, Authorization: `Bearer ${ANON}` },
    body: JSON.stringify(args),
  });
  if (!r.ok) throw new Error(fn + " " + r.status + " " + (await r.text().catch(() => "")));
  return await r.json().catch(() => null);
}

export default async (req) => {
  if (req.method === "OPTIONS") return new Response("", { headers: cors });
  try {
    if (req.method === "GET") {
      const acao = new URL(req.url).searchParams.get("acao") || "list";
      if (acao === "esteira") return Response.json({ esteira: (await rpc("guarda_chuva_esteira", { p_token: TOKEN })) || [] }, { headers: cors });
      return Response.json({ clinicas: (await rpc("guarda_chuva_list", { p_token: TOKEN })) || [] }, { headers: cors });
    }
    if (req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      if (!SECRET || b.senha !== SECRET)
        return new Response(JSON.stringify({ erro: "nao autorizado" }), { status: 401, headers: cors });
      if (b.acao === "remove") {
        await rpc("guarda_chuva_remove", { p_token: TOKEN, p_id: b.id });
      } else {
        // criar exige nome; editar (id presente) pode mandar só o campo que muda (o RPC faz coalesce)
        if (!b.id && (!b.nome || !String(b.nome).trim()))
          return new Response(JSON.stringify({ erro: "sem nome" }), { status: 400, headers: cors });
        await rpc("guarda_chuva_upsert", {
          p_token: TOKEN,
          p_id: b.id || null,
          p_nome: b.nome != null ? String(b.nome).trim().slice(0, 160) : null,
          p_estado: b.estado != null ? String(b.estado).slice(0, 20) : null,
          p_motivo: b.motivo != null ? String(b.motivo).slice(0, 300) : null,
          p_responsavel: b.responsavel != null ? String(b.responsavel).slice(0, 80) : null,
          p_ativo: typeof b.ativo === "boolean" ? b.ativo : null,
        });
      }
      const clinicas = (await rpc("guarda_chuva_list", { p_token: TOKEN })) || [];
      return Response.json({ ok: true, clinicas }, { headers: cors });
    }
    return new Response("metodo nao permitido", { status: 405, headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ erro: String(e && e.message || e) }), { status: 500, headers: cors });
  }
};

export const config = { path: "/api/crm-guardachuva" };
