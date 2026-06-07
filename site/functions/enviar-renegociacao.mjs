/* Função serverless: envia a lista de renegociação Pet Love por e-mail.
   POST {senha, assunto, html} -> valida senha===SECRET -> envia via Gmail SMTP para EMAIL_TO (fixo no servidor).
   Credenciais injetadas no deploy (secret.mjs). Destinatário é FIXO — não dá p/ desviar o e-mail. */
import nodemailer from "nodemailer";
import { SECRET, GMAIL_USER, GMAIL_APP_PASSWORD, EMAIL_TO } from "./secret.mjs";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};

export default async (req) => {
  if (req.method === "OPTIONS") return new Response("", { headers: cors });
  if (req.method !== "POST") return new Response("metodo nao permitido", { status: 405, headers: cors });

  const body = await req.json().catch(() => ({}));
  if (!SECRET || body.senha !== SECRET)
    return new Response(JSON.stringify({ erro: "nao autorizado" }), { status: 401, headers: cors });
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD || !EMAIL_TO)
    return new Response(JSON.stringify({ erro: "e-mail nao configurado no servidor" }), { status: 500, headers: cors });

  try {
    const t = nodemailer.createTransport({
      host: "smtp.gmail.com", port: 465, secure: true,
      auth: { user: GMAIL_USER, pass: String(GMAIL_APP_PASSWORD).replace(/ /g, "") },
    });
    await t.sendMail({
      from: `"BI Alpha" <${GMAIL_USER}>`,
      to: EMAIL_TO,
      subject: body.assunto || "Renegociação Pet Love — exames subprecificados",
      html: body.html || "<p>(sem conteúdo)</p>",
    });
    const masked = EMAIL_TO.replace(/^(.{2}).*(@.*)$/, "$1***$2");
    return Response.json({ ok: true, to: masked }, { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ erro: "falha no envio", detalhe: String(e && e.message || e) }), { status: 500, headers: cors });
  }
};

export const config = { path: "/api/enviar-renegociacao" };
