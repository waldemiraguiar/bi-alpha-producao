/* Função serverless: OPERADORES (identidade + PIN por pessoa — pra saber QUEM mudou/ajustou).
   Mantém a senha do TIME (gate AES) pra ENTRAR; aqui cada operador tem um PIN pessoal só pra se
   identificar (atribuição/auditoria, não é controle de acesso). PIN guardado como HASH (nunca em claro).
   Netlify Blobs. Segredo (senha do time CRM) injetado no deploy (secret.mjs). */
import { getStore } from "@netlify/blobs";
import { createHash } from "node:crypto";
import * as SEC from "./secret.mjs";
const SECRET = SEC.SECRET;
// SAFRA_KEY = chave do pacote isolado da Safra (item 3). MESMA derivação do build (sha256("safra-v1:"+FIN_KEY)).
const SAFRA_KEY = createHash("sha256").update("safra-v1:" + (SEC.FIN_KEY || "")).digest("hex");

const hashPin = (nome, pin) => createHash("sha256").update("crmop:" + nome.trim().toLowerCase() + ":" + String(pin)).digest("hex");
const pub = (lista) => lista.map((o) => ({ nome: o.nome, papel: o.papel || "comercial", escopos: o.escopos || [], admin: !!o.admin, ativo: o.ativo !== false, ts: o.ts })).sort((a, b) => a.nome.localeCompare(b.nome));

export default async (req) => {
  const store = getStore("crm-operadores");
  const load = async () => (await store.get("lista", { type: "json", consistency: "strong" })) || [];
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  };
  if (req.method === "OPTIONS") return new Response("", { headers: cors });
  if (req.method === "GET") return Response.json({ operadores: pub(await load()) }, { headers: cors });

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    // LOGIN INDIVIDUAL: entra com nome + PIN pessoal; NÃO exige a senha do time (é o próprio gate).
    // Se o PIN bate e o operador está ativo, devolve a CHAVE dos dados (p/ decifrar o crm.enc).
    if (body.acao === "login") {
      const lista0 = await load();
      const o = lista0.find((x) => x.nome.toLowerCase() === String(body.nome || "").trim().toLowerCase());
      if (!o) return Response.json({ ok: false, motivo: "nao_existe" }, { headers: cors });
      if (o.ativo === false) return Response.json({ ok: false, motivo: "inativo" }, { headers: cors });
      const ok = o.pin === hashPin(o.nome, String(body.pin || "").trim());
      if (!ok) return Response.json({ ok: false }, { headers: cors });
      // DIRETORIA (ex.: Wal, Fábio no CF) recebe a CHAVE FINANCEIRA no login → R$ abre sozinho ao entrar (inclusive por biometria). Reps (comercial) NUNCA recebem.
      // ESCOPO "safra" (ex.: Fábio na Matriz): recebe SÓ a SAFRA_KEY → decifra só a tabela da Safra, nunca os outros valores. admin = vê a aba Equipe.
      const escopos = Array.isArray(o.escopos) ? o.escopos : [];
      return Response.json({ ok: true, nome: o.nome, papel: o.papel || "comercial", key: SECRET,
        finkey: (o.papel === "diretoria" ? (SEC.FIN_KEY || "") : undefined),
        escopos, admin: !!o.admin,
        safrakey: ((o.papel !== "diretoria") && escopos.includes("safra")) ? SAFRA_KEY : undefined }, { headers: cors });
    }
    if (!SECRET || body.senha !== SECRET)
      return new Response(JSON.stringify({ erro: "nao autorizado" }), { status: 401, headers: cors });
    let lista = await load();
    const nome = String(body.nome || "").trim().slice(0, 40);
    const pin = String(body.pin || "").trim();

    if (body.acao === "verify") {
      const o = lista.find((x) => x.nome.toLowerCase() === nome.toLowerCase());
      if (!o) return Response.json({ ok: false, motivo: "nao_existe" }, { headers: cors });
      const ok = o.pin === hashPin(o.nome, pin);
      const escopos = ok && Array.isArray(o.escopos) ? o.escopos : [];
      return Response.json({ ok, nome: o.nome, papel: o.papel || "comercial",
        finkey: (ok && o.papel === "diretoria" ? (SEC.FIN_KEY || "") : undefined),
        escopos, admin: ok && !!o.admin,
        safrakey: (ok && o.papel !== "diretoria" && escopos.includes("safra")) ? SAFRA_KEY : undefined }, { headers: cors });
    }
    if (body.acao === "remove") {
      lista = lista.filter((x) => x.nome.toLowerCase() !== nome.toLowerCase());
      await store.setJSON("lista", lista);
      return Response.json({ ok: true, operadores: pub(lista) }, { headers: cors });
    }
    // PAPEL diretoria (vê R$) — exige o CÓDIGO DA DIRETORIA (blindagem; só quem tem o código promove)
    if (body.acao === "setpapel") {
      const papel = body.papel === "diretoria" ? "diretoria" : "comercial";
      if (papel === "diretoria" && (!SEC.FIN_KEY || body.dir_code !== SEC.FIN_KEY))
        return new Response(JSON.stringify({ erro: "codigo_diretoria_invalido" }), { status: 403, headers: cors });
      const o = lista.find((x) => x.nome.toLowerCase() === nome.toLowerCase());
      if (!o) return new Response(JSON.stringify({ erro: "nao_existe" }), { status: 404, headers: cors });
      o.papel = papel;
      await store.setJSON("lista", lista);
      return Response.json({ ok: true, nome: o.nome, papel, operadores: pub(lista) }, { headers: cors });
    }
    // ESCOPO pontual (ex.: "safra" — Fábio vê SÓ a tabela da Safra em R$). Exige o CÓDIGO DA DIRETORIA.
    // 🔓 SAFRAKEY SEM PIN (Wal 23/10): o operador já passou a senha do TIME (gate). Se ele tem o escopo "safra"
    // no servidor, devolve a safrakey direto — abre o R$ dele sozinho, sem pedir PIN (o Fábio não lembrava o PIN).
    if (body.acao === "safrakey") {
      const o = lista.find((x) => x.nome.toLowerCase() === nome.toLowerCase());
      const esc = o && Array.isArray(o.escopos) ? o.escopos : [];
      const ok = !!o && o.ativo !== false && o.papel !== "diretoria" && esc.includes("safra");
      return Response.json({ ok, safrakey: ok ? SAFRA_KEY : undefined }, { headers: cors });
    }
    if (body.acao === "setescopo") {
      if (!SEC.FIN_KEY || body.dir_code !== SEC.FIN_KEY)
        return new Response(JSON.stringify({ erro: "codigo_diretoria_invalido" }), { status: 403, headers: cors });
      const o = lista.find((x) => x.nome.toLowerCase() === nome.toLowerCase());
      if (!o) return new Response(JSON.stringify({ erro: "nao_existe" }), { status: 404, headers: cors });
      const es = String(body.escopo || "").trim();
      if (!es) return new Response(JSON.stringify({ erro: "escopo_invalido" }), { status: 400, headers: cors });
      o.escopos = (Array.isArray(o.escopos) ? o.escopos : []).filter((e) => e !== es);
      if (body.on) o.escopos.push(es);
      await store.setJSON("lista", lista);
      return Response.json({ ok: true, operadores: pub(lista) }, { headers: cors });
    }
    // ADMIN (vê a aba Equipe). Exige o CÓDIGO DA DIRETORIA.
    if (body.acao === "setadmin") {
      if (!SEC.FIN_KEY || body.dir_code !== SEC.FIN_KEY)
        return new Response(JSON.stringify({ erro: "codigo_diretoria_invalido" }), { status: 403, headers: cors });
      const o = lista.find((x) => x.nome.toLowerCase() === nome.toLowerCase());
      if (!o) return new Response(JSON.stringify({ erro: "nao_existe" }), { status: 404, headers: cors });
      o.admin = !!body.on;
      await store.setJSON("lista", lista);
      return Response.json({ ok: true, operadores: pub(lista) }, { headers: cors });
    }
    // ATIVAR/DESATIVAR operador (quem sai do time). Só senha do time (já validada acima).
    if (body.acao === "setativo") {
      const o = lista.find((x) => x.nome.toLowerCase() === nome.toLowerCase());
      if (!o) return new Response(JSON.stringify({ erro: "nao_existe" }), { status: 404, headers: cors });
      o.ativo = body.on !== false;
      await store.setJSON("lista", lista);
      return Response.json({ ok: true, operadores: pub(lista) }, { headers: cors });
    }
    // add / setpin (upsert) — cria operador ou troca o PIN
    if (!nome || pin.length < 6)
      return new Response(JSON.stringify({ erro: "nome/pin invalido (PIN >= 6 digitos)" }), { status: 400, headers: cors });
    const existing = lista.find((x) => x.nome.toLowerCase() === nome.toLowerCase());
    if (existing && body.acao !== "setpin")
      return new Response(JSON.stringify({ erro: "ja_existe" }), { status: 409, headers: cors });
    // troca de PIN exige o PIN antigo (a menos que seja criação)
    if (existing && body.acao === "setpin" && existing.pin !== hashPin(existing.nome, body.pin_atual || ""))
      return new Response(JSON.stringify({ erro: "pin_atual_invalido" }), { status: 403, headers: cors });
    // papel na CRIAÇÃO só vira diretoria com o código da diretoria
    let papel = "comercial";
    if (!existing && body.papel === "diretoria") {
      if (!SEC.FIN_KEY || body.dir_code !== SEC.FIN_KEY)
        return new Response(JSON.stringify({ erro: "codigo_diretoria_invalido" }), { status: 403, headers: cors });
      papel = "diretoria";
    }
    lista = lista.filter((x) => x.nome.toLowerCase() !== nome.toLowerCase());
    lista.push({ nome: existing ? existing.nome : nome, pin: hashPin(existing ? existing.nome : nome, pin), papel: existing ? (existing.papel || "comercial") : papel, ts: existing ? existing.ts : Date.now() });
    await store.setJSON("lista", lista);
    return Response.json({ ok: true, operadores: pub(lista) }, { headers: cors });
  }
  return new Response("metodo nao permitido", { status: 405, headers: cors });
};

export const config = { path: "/api/crm-operadores" };
