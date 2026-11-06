/* 🔎 Buscar do HF (Dudu 06/11) — dispara o build+POST do .enc (Action atualiza.yml, deploy=0) pra puxar
   o HF AGORA, sem esperar os 10 min. Reusa o build_and_encrypt.py (fonte única, sem duplicar a query).
   Precisa do env GH_DISPATCH_TOKEN (PAT fine-grained, actions:write no repo bi-alpha-producao). */
const OWNER = 'waldemiraguiar', REPO = 'bi-alpha-producao', WF = 'atualiza.yml';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST,OPTIONS' };

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { headers: cors });
  const tok = process.env.GH_DISPATCH_TOKEN;
  if (!tok) return new Response(JSON.stringify({ ok: false, erro: 'GH_DISPATCH_TOKEN não configurado no Netlify' }), { status: 500, headers: cors });
  try {
    const r = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WF}/dispatches`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + tok,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'alpha-producao-painel'
      },
      body: JSON.stringify({ ref: 'main', inputs: { deploy: '0' } })   // deploy=0 => só build + POST do .enc (barato, sem deploy)
    });
    if (r.status === 204) return Response.json({ ok: true }, { headers: cors });
    const txt = await r.text().catch(() => '');
    return new Response(JSON.stringify({ ok: false, status: r.status, erro: txt.slice(0, 200) }), { status: 502, headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, erro: String(e && e.message || e) }), { status: 500, headers: cors });
  }
};
export const config = { path: '/api/puxar-hf' };
