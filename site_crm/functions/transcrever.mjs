/* Função serverless: TRANSCREVER áudio (gravação de reunião) via ElevenLabs Scribe.
   Recebe {audio: base64, mime, senha}. Devolve {text}. Chave ELEVEN_KEY injetada no deploy (secret.mjs).
   Uso: o CRM grava a reunião no navegador (sem Plaud) e joga o texto na pauta do dia. */
import { SECRET, ELEVEN_KEY } from "./secret.mjs";

export default async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
  };
  if (req.method === "OPTIONS") return new Response("", { headers: cors });
  if (req.method !== "POST") return new Response("metodo nao permitido", { status: 405, headers: cors });

  const body = await req.json().catch(() => ({}));
  if (!SECRET || body.senha !== SECRET)
    return new Response(JSON.stringify({ erro: "nao autorizado" }), { status: 401, headers: cors });
  if (!ELEVEN_KEY)
    return Response.json({ erro: "transcrição não configurada (sem chave)" }, { status: 200, headers: cors });

  try {
    const b64 = String(body.audio || "");
    if (!b64) return Response.json({ erro: "sem áudio" }, { status: 200, headers: cors });
    const bin = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    const blob = new Blob([bin], { type: body.mime || "audio/webm" });
    const fd = new FormData();
    fd.append("file", blob, "reuniao." + ((body.mime || "").includes("mp4") ? "mp4" : "webm"));
    fd.append("model_id", "scribe_v1");
    fd.append("language_code", "por");
    const r = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST", headers: { "xi-api-key": ELEVEN_KEY }, body: fd,
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      return Response.json({ erro: "transcrição falhou (" + r.status + ")", detalhe: t.slice(0, 200) }, { status: 200, headers: cors });
    }
    const j = await r.json();
    return Response.json({ text: j.text || "", ok: true }, { headers: cors });
  } catch (e) {
    return Response.json({ erro: "erro na transcrição: " + String(e).slice(0, 200) }, { status: 200, headers: cors });
  }
};

export const config = { path: "/api/crm-transcrever" };
