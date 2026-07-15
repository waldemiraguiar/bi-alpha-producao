/* Função serverless: OPERADORES (identidade + PIN por pessoa — pra saber QUEM mudou/ajustou).
   Mantém a senha do TIME (gate AES) pra ENTRAR; aqui cada operador tem um PIN pessoal só pra se
   identificar (atribuição/auditoria, não é controle de acesso). PIN guardado como HASH (nunca em claro).
   Netlify Blobs. Segredo (senha do time CRM) injetado no deploy (secret.mjs). */
import { getStore } from "@netlify/blobs";
import { createHash } from "node:crypto";
import * as SEC from "./secret.mjs";
const SECRET = SEC.SECRET;

const hashPin = (nome, pin) => createHash("sha256").update("crmop:" + nome.trim().toLowerCase() + ":" + String(pin)).digest("hex");
const pub = (lista) => lista.map((o) => ({ nome: o.nome, papel: o.papel || "comercial", ts: o.ts })).sort((a, b) => a.nome.localeCompare(b.nome));

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
    if (!SECRET || body.senha !== SECRET)
      return new Response(JSON.stringify({ erro: "nao autorizado" }), { status: 401, headers: cors });
    let lista = await load();
    const nome = String(body.nome || "").trim().slice(0, 40);
    const pin = String(body.pin || "").trim();

    if (body.acao === "verify") {
      const o = lista.find((x) => x.nome.toLowerCase() === nome.toLowerCase());
      if (!o) return Response.json({ ok: false, motivo: "nao_existe" }, { headers: cors });
      const ok = o.pin === hashPin(o.nome, pin);
      return Response.json({ ok, nome: o.nome, papel: o.papel || "comercial" }, { headers: cors });
    }
    if (body.acao === "remove") {
      lista = lista.filter((x) => x.nome.toLowerCase() !== nome.toLowerCase());
      await store.setJSON("lista", lista);
      return Response.json({ ok: true, operadores: pub(lista) }, { headers: cors });
    }
    // PAPEL diretoria (vê R$) — exige o CÓDIGO DA DIRETORIA (blindagem; só quem tem o código promove)
    if (body.acao === "setpapel") {
      const papel = body.papel === "diretoria" ? "diretoria" : "comercial";
      if (papel === "diretoria" && (!SEC.DIR_CODE || body.dir_code !== SEC.DIR_CODE))
        return new Response(JSON.stringify({ erro: "codigo_diretoria_invalido" }), { status: 403, headers: cors });
      const o = lista.find((x) => x.nome.toLowerCase() === nome.toLowerCase());
      if (!o) return new Response(JSON.stringify({ erro: "nao_existe" }), { status: 404, headers: cors });
      o.papel = papel;
      await store.setJSON("lista", lista);
      return Response.json({ ok: true, nome: o.nome, papel, operadores: pub(lista) }, { headers: cors });
    }
    // add / setpin (upsert) — cria operador ou troca o PIN
    if (!nome || pin.length < 4)
      return new Response(JSON.stringify({ erro: "nome/pin invalido (PIN >= 4 digitos)" }), { status: 400, headers: cors });
    const existing = lista.find((x) => x.nome.toLowerCase() === nome.toLowerCase());
    if (existing && body.acao !== "setpin")
      return new Response(JSON.stringify({ erro: "ja_existe" }), { status: 409, headers: cors });
    // troca de PIN exige o PIN antigo (a menos que seja criação)
    if (existing && body.acao === "setpin" && existing.pin !== hashPin(existing.nome, body.pin_atual || ""))
      return new Response(JSON.stringify({ erro: "pin_atual_invalido" }), { status: 403, headers: cors });
    // papel na CRIAÇÃO só vira diretoria com o código da diretoria
    let papel = "comercial";
    if (!existing && body.papel === "diretoria") {
      if (!SEC.DIR_CODE || body.dir_code !== SEC.DIR_CODE)
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
