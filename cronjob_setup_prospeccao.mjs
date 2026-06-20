/* Cria no cron-job.org (via API) o disparo SEXTA 17:00 (America/Sao_Paulo) do
   workflow email_prospeccao.yml (resumo de Prospecção). Idempotente por título.

   Uso:
     CRONJOB_KEY='sua_api_key_cronjob'  \
     GH_TOKEN='seu_github_pat'          \   # token que autoriza o workflow_dispatch
     node cronjob_setup_prospeccao.mjs

   - CRONJOB_KEY: cron-job.org → Settings → API.
   - GH_TOKEN: o MESMO token que o job do radar já usa (Actions: read/write no repo
     bi-alpha-producao). Se preferir não colá-lo aqui, rode sem ele que o job é criado
     com a URL/horário certos e você cola o token no campo "Authorization" do job no
     painel do cron-job.org.
*/
const KEY = process.env.CRONJOB_KEY || "";
const GH = process.env.GH_TOKEN || "";
const REPO = "waldemiraguiar/bi-alpha-producao";
const WF = "email_prospeccao.yml";
const TITLE = "Prospecção CRM — sexta 17h";
if (!KEY) { console.error("Defina CRONJOB_KEY='...'"); process.exit(1); }

const API = "https://api.cron-job.org";
const H = { "Authorization": "Bearer " + KEY, "Content-Type": "application/json" };

const jobBody = {
  job: {
    url: `https://api.github.com/repos/${REPO}/actions/workflows/${WF}/dispatches`,
    enabled: true,
    title: TITLE,
    saveResponses: true,
    requestMethod: 1, // POST
    schedule: { timezone: "America/Sao_Paulo", hours: [17], minutes: [0], wdays: [5], mdays: [-1], months: [-1] },
    extendedData: {
      headers: GH
        ? { "Authorization": "Bearer " + GH, "Accept": "application/vnd.github+json", "User-Agent": "cronjob-prospeccao" }
        : { "Accept": "application/vnd.github+json", "User-Agent": "cronjob-prospeccao" },
      body: JSON.stringify({ ref: "main" }),
    },
  },
};

(async () => {
  // idempotência: se já existe um job com o mesmo título, atualiza
  let existing = null;
  try {
    const list = await (await fetch(API + "/jobs", { headers: H })).json();
    existing = (list.jobs || []).find((j) => (j.title || "") === TITLE);
  } catch (e) { /* segue criando */ }

  const url = existing ? `${API}/jobs/${existing.jobId}` : `${API}/jobs`;
  const method = existing ? "PATCH" : "PUT";
  const r = await fetch(url, { method, headers: H, body: JSON.stringify(jobBody) });
  const txt = await r.text();
  console.log(`${method} ${url} → HTTP ${r.status}`);
  console.log(txt.slice(0, 400));
  if (r.ok) console.log(`✅ Job ${existing ? "atualizado" : "criado"}: ${TITLE} · sexta 17:00 (BRT)` + (GH ? "" : "  ⚠️ falta colar o token do GitHub no campo Authorization do job."));
})();
