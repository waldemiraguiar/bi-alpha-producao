/* Login individual do BI Alpha (19/set/2026 — pedido do Wal: cada pessoa com usuário e senha).

   DESENHO (envelope): o servidor NUNCA vê a chave que decifra o painel.
   Para cada usuário guardo:
     - hash_auth = PBKDF2(senha do usuário)         -> só para conferir a senha no servidor
     - envelope  = chave do painel CIFRADA com a senha do usuário (AES-GCM)
   No login o servidor confere o hash e devolve o envelope; o NAVEGADOR abre o envelope com a
   senha digitada e só aí obtém a chave que decifra os dados. Servidor invadido = dados continuam cifrados.
   Tirar o acesso de alguém = apagar o cadastro dele (ninguém mais precisa trocar de senha).

   Rotas (todas em /api/login):
     POST {acao:"entrar", usuario, senha}                  -> {token, envelope, nome, papel, abas}
     POST {acao:"trocar_senha", usuario, senha, nova, envelope}  -> regrava hash + envelope
     POST {acao:"salvar_usuario", ...}  (header x-pwd = SECRET) -> cria/atualiza usuário (script local)
     POST {acao:"remover_usuario", usuario} (header x-pwd)  -> tira o acesso
     POST {acao:"listar"} (header x-pwd)                    -> usuários + últimos acessos
     GET  ?token=<t>                                        -> confere a sessão

   Trava: 6 erros em 15 min bloqueiam o usuário por 15 min. Todo acesso (ok ou falha) fica registrado.
*/
import { getStore } from "@netlify/blobs";
import { SECRET } from "./secret.mjs";
import crypto from "node:crypto";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type,x-pwd,authorization",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "content-type": "application/json", "cache-control": "no-store" } });

const ITER = 250000;
const MAX_ERROS = 6;
const JANELA_MS = 15 * 60 * 1000;
const SESSAO_MS = 12 * 60 * 60 * 1000;
const LOG_MAX = 500;

const norm = (u) => String(u || "").trim().toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 40);
const pbkdf2 = (senha, salt) =>
  new Promise((ok, no) => crypto.pbkdf2(String(senha), Buffer.from(salt, "base64"), ITER, 32, "sha256",
    (e, d) => (e ? no(e) : ok(d.toString("base64")))));
const iguais = (a, b) => {
  const x = Buffer.from(String(a || ""), "utf8"), y = Buffer.from(String(b || ""), "utf8");
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

function assina(payload) {
  const corpo = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = crypto.createHmac("sha256", SECRET).update(corpo).digest("base64url");
  return `${corpo}.${mac}`;
}
export function confereToken(token) {
  if (!token || !SECRET) return null;
  const [corpo, mac] = String(token).split(".");
  if (!corpo || !mac) return null;
  const certo = crypto.createHmac("sha256", SECRET).update(corpo).digest("base64url");
  if (!iguais(mac, certo)) return null;
  try {
    const p = JSON.parse(Buffer.from(corpo, "base64url").toString());
    return p.exp > Date.now() ? p : null;
  } catch (e) { return null; }
}

const usuarios = () => getStore("bi-auth");
const registros = () => getStore("bi-acessos");

async function registra(ev) {
  try {
    const st = registros();
    const atual = (await st.get("log", { type: "json", consistency: "strong" })) || [];
    atual.unshift({ ...ev, quando: new Date().toISOString() });
    await st.setJSON("log", atual.slice(0, LOG_MAX));
  } catch (e) { /* registro nunca derruba o login */ }
}

export default async (req) => {
  if (req.method === "OPTIONS") return new Response("", { headers: cors });
  const url = new URL(req.url);
  const ip = req.headers.get("x-nf-client-connection-ip") || req.headers.get("x-forwarded-for") || "";
  const ua = (req.headers.get("user-agent") || "").slice(0, 160);

  if (req.method === "GET") {
    const s = confereToken(url.searchParams.get("token"));
    return s ? J({ ok: true, usuario: s.u, nome: s.n, papel: s.p, abas: s.a, expira: s.exp }) : J({ ok: false }, 401);
  }
  if (req.method !== "POST") return J({ erro: "metodo nao permitido" }, 405);

  let b;
  try { b = await req.json(); } catch (e) { return J({ erro: "json invalido" }, 400); }
  const acao = String(b.acao || "entrar");
  const st = usuarios();
  // administrador: senha mestre (scripts locais) OU sessão de quem é "dono" (gestão pelo próprio BI)
  const sessao = confereToken((req.headers.get("authorization") || "").replace(/^Bearer\s+/i, ""));
  const admin = (SECRET && req.headers.get("x-pwd") === SECRET) || (sessao && sessao.p === "dono");

  // ---- administração (script local, com a senha mestre) ----
  if (acao === "salvar_usuario" || acao === "remover_usuario" || acao === "listar") {
    if (!admin) return J({ erro: "nao autorizado" }, 401);
    if (acao === "listar") {
      const { blobs } = await st.list();
      const lista = [];
      for (const x of blobs) {
        const u = await st.get(x.key, { type: "json" });
        if (u) lista.push({ usuario: x.key, nome: u.nome, papel: u.papel, abas: u.abas, criado: u.criado, ultimo_acesso: u.ultimo_acesso || null });
      }
      const log = (await registros().get("log", { type: "json" })) || [];
      return J({ ok: true, usuarios: lista, acessos: log.slice(0, 50) });
    }
    const u = norm(b.usuario);
    if (!u) return J({ erro: "usuario invalido" }, 400);
    if (acao === "remover_usuario") {
      await st.delete(u);
      await registra({ usuario: u, evento: "usuario removido" + (sessao ? " por " + sessao.u : ""), ip, ua });
      return J({ ok: true, removido: u });
    }
    if (!b.salt_auth || !b.hash_auth || !b.envelope) return J({ erro: "faltam campos" }, 400);
    await st.setJSON(u, {
      nome: String(b.nome || u).slice(0, 60), papel: String(b.papel || "socio").slice(0, 20),
      abas: Array.isArray(b.abas) ? b.abas.slice(0, 40) : ["*"],
      salt_auth: b.salt_auth, hash_auth: b.hash_auth, envelope: b.envelope,
      criado: new Date().toISOString(), trocar_senha: !!b.trocar_senha,
    });
    await registra({ usuario: u, evento: "usuario criado/atualizado" + (sessao ? " por " + sessao.u : ""), ip, ua });
    return J({ ok: true, usuario: u });
  }

  // ---- entrar ----
  const u = norm(b.usuario);
  const reg = u ? await st.get(u, { type: "json", consistency: "strong" }) : null;
  const agora = Date.now();

  if (acao === "entrar") {
    if (!reg) {
      await registra({ usuario: u || "(vazio)", evento: "falha: usuário não existe", ip, ua });
      return J({ erro: "usuário ou senha inválidos" }, 401);
    }
    if (reg.bloqueado_ate && reg.bloqueado_ate > agora) {
      await registra({ usuario: u, evento: "falha: bloqueado por tentativas", ip, ua });
      return J({ erro: "muitas tentativas — espere 15 minutos", bloqueado_ate: reg.bloqueado_ate }, 429);
    }
    const hash = await pbkdf2(b.senha, reg.salt_auth);
    if (!iguais(hash, reg.hash_auth)) {
      const erros = (reg.erros_desde && agora - reg.erros_desde < JANELA_MS ? reg.erros || 0 : 0) + 1;
      await st.setJSON(u, { ...reg, erros, erros_desde: reg.erros_desde && agora - reg.erros_desde < JANELA_MS ? reg.erros_desde : agora,
                            bloqueado_ate: erros >= MAX_ERROS ? agora + JANELA_MS : 0 });
      await registra({ usuario: u, evento: `falha: senha errada (${erros}/${MAX_ERROS})`, ip, ua });
      return J({ erro: "usuário ou senha inválidos", tentativas: erros }, 401);
    }
    await st.setJSON(u, { ...reg, erros: 0, erros_desde: 0, bloqueado_ate: 0, ultimo_acesso: new Date().toISOString() });
    await registra({ usuario: u, evento: "entrou", ip, ua });
    const token = assina({ u, n: reg.nome, p: reg.papel, a: reg.abas, exp: agora + SESSAO_MS });
    return J({ ok: true, token, envelope: reg.envelope, nome: reg.nome, papel: reg.papel, abas: reg.abas,
               trocar_senha: !!reg.trocar_senha, expira_em: SESSAO_MS });
  }

  // ---- trocar a própria senha (precisa acertar a atual e mandar o envelope novo) ----
  if (acao === "trocar_senha") {
    if (!reg) return J({ erro: "usuário ou senha inválidos" }, 401);
    const hash = await pbkdf2(b.senha, reg.salt_auth);
    if (!iguais(hash, reg.hash_auth)) {
      await registra({ usuario: u, evento: "falha: troca de senha com senha atual errada", ip, ua });
      return J({ erro: "usuário ou senha inválidos" }, 401);
    }
    if (!b.salt_auth || !b.hash_auth || !b.envelope) return J({ erro: "faltam campos" }, 400);
    await st.setJSON(u, { ...reg, salt_auth: b.salt_auth, hash_auth: b.hash_auth, envelope: b.envelope,
                          trocar_senha: false, senha_trocada: new Date().toISOString() });
    await registra({ usuario: u, evento: "trocou a senha", ip, ua });
    return J({ ok: true });
  }

  return J({ erro: "ação desconhecida" }, 400);
};

export const config = { path: "/api/login" };
