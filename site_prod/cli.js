/* Modos CLIENTES VIGIADOS — isolados do painel.
   🔴 Sensível  = time de ATENDIMENTO/call center → alerta mostra SÓ o nome da clínica (sem produção).
   🟡 Atenção   = time de PRODUÇÃO → alerta mostra TODOS os dados (paciente/registro/vet) p/ check-in antes de liberar.
   Sub-abas: 🔔 Alertas (acende quando a clínica cadastrada entra no HF) · 📋 Cadastrados (público: qualquer um cadastra/remove).
   Acende via DATA.clientes.reqs (10/10 min). Baixa manual. Persiste em /api/clientes. */
(function () {
  const API = '/api/clientes';
  const MEK = 'sep_me';
  let classe = null, cliView = 'alertas';
  let flags = [], baixas = [], term = '', timer = null;

  const $ = id => document.getElementById(id);
  const esc2 = s => (typeof esc === 'function' ? esc(s) : String(s == null ? '' : s));
  const escA = s => esc2(s).replace(/"/g, '&quot;');
  const cliData = () => (typeof DATA !== 'undefined' && DATA && DATA.clientes) ? DATA.clientes : null;
  const me = () => localStorage.getItem(MEK) || 'equipe';

  async function load() { try { const r = await fetch('/api/overlays?_=' + Date.now()); if (r.ok) { const j = await r.json(); flags = j.flags || []; baixas = j.cli_baixas || []; } } catch (e) {} }
  async function post(p) {
    try {
      const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...p, senha: window.__pwd }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { alert(j.erro || 'Não foi possível salvar.'); return false; }
      flags = j.flags || flags; baixas = j.baixas || baixas; return true;
    } catch (e) { alert('Erro de conexão.'); return false; }
  }

  const myFlags = () => flags.filter(f => f.classe === classe);
  const flaggedCods = () => new Set(myFlags().map(f => String(f.cod)));
  const baixadas = () => new Set(baixas.map(b => b.chave));
  function alertReqs() {
    const d = cliData(); if (!d) return [];
    const cods = flaggedCods(), bx = baixadas();
    return (d.reqs || []).filter(r => cods.has(String(r.cod)) && !bx.has(`${r.req}-${r.ano}`)).sort((a, b) => (b.dt || '').localeCompare(a.dt || ''));
  }
  // sensível: agrupado por clínica (só o nome importa p/ o call center)
  function alertByClinic() {
    const g = {}; alertReqs().forEach(r => { const k = String(r.cod); (g[k] = g[k] || { cod: r.cod, cliente: r.cliente, reqs: [], lastDt: '' }); g[k].reqs.push(r); if ((r.dt || '') > g[k].lastDt) g[k].lastDt = r.dt; });
    return Object.values(g).sort((a, b) => (b.lastDt || '').localeCompare(a.lastDt || ''));
  }

  function resultsHtml() {
    const d = cliData(), t = term.trim().toLowerCase(); if (!d || !t) return '';
    const flagged = flaggedCods();
    const res = (d.lista || []).filter(c => (c.nome || '').toLowerCase().includes(t)).slice(0, 40);
    if (!res.length) return `<div class="srchres"><div class="r" style="color:var(--mut)">nada encontrado</div></div>`;
    return `<div class="srchres">${res.map(c => { const has = flagged.has(String(c.cod));
      return `<div class="r" ${has ? '' : `data-add="${escA(c.cod)}" data-nome="${escA(c.nome)}"`}>
        <span>${esc2(c.nome)}</span>
        <span class="add" style="background:${has ? 'rgba(255,255,255,.1)' : (classe === 'sensivel' ? 'var(--red)' : 'var(--amber)')};color:${has ? 'var(--mut)' : (classe === 'sensivel' ? '#fff' : '#2a1c00')}">${has ? 'já cadastrado' : '+ adicionar'}</span></div>`;
    }).join('')}</div>`;
  }

  function viewAlertas() {
    if (classe === 'sensivel') {
      const leg = `<div class="seplegend">🟡 Clínicas sensíveis monitoradas. Em <b style="color:var(--amber)">amarelo</b> = só de olho · vira <b style="color:var(--red)">vermelho + fogos</b> quando entra exame no HF. Baixa volta pro amarelo.</div>`;
      const regs = myFlags();
      if (!regs.length) return leg + `<div class="sepwait" style="padding:30px">Nenhuma clínica sensível cadastrada. Vá na aba <b>📋 Cadastrados</b> para adicionar.</div>`;
      const byCod = {}; alertByClinic().forEach(g => byCod[String(g.cod)] = g);
      const active = [], watch = [];
      regs.forEach(f => { const g = byCod[String(f.cod)]; if (g) active.push({ f, g }); else watch.push(f); });
      active.sort((a, b) => (b.g.lastDt || '').localeCompare(a.g.lastDt || ''));
      watch.sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
      const activeHtml = active.map(({ f, g }) => {
        const chaves = g.reqs.map(r => `${r.req}-${r.ano}`).join(',');
        return `<div class="alertcard sensivel">
          <div style="display:flex;align-items:center;gap:12px;min-width:0">
            <span class="fw1">🎆</span><span class="fw2">🎇</span>
            <div class="cli" style="font-size:22px">🔴 ${esc2(f.nome)}${g.reqs.length > 1 ? ` <span style="font-size:13px;opacity:.85">(${g.reqs.length} novas)</span>` : ''}
              <div style="font-size:12.5px;font-weight:800;letter-spacing:.03em">⚠️ TEM EXAME NA CASA — DÊ ATENÇÃO!</div></div>
            <span class="fw3">🎆</span></div>
          <button class="baixab" data-baixaclin="${escA(chaves)}" data-cod="${escA(f.cod)}" data-cliente="${escA(f.nome)}">✓ baixa</button>
        </div>`;
      }).join('');
      const watchHtml = watch.length ? `<h3 style="font-size:12px;color:var(--mut);text-transform:uppercase;letter-spacing:.05em;margin:16px 0 10px">🟡 Monitoradas — sem entrada no HF agora (${watch.length})</h3><div class="watchgrid">` + watch.map(f => `<div class="senswatch">🟡 ${esc2(f.nome)}</div>`).join('') + `</div>` : '';
      return leg + (activeHtml || '') + watchHtml;
    }
    const leg = `<div class="seplegend atrasado">🟡 Confira cada exame antes de liberar (check-in) e dê baixa <b>manual</b>. O que ficar de ontem vira <b style="color:var(--red)">🔴 loucura total</b>.</div>`;
    const reqs = alertReqs();
    if (!reqs.length) return leg + `<div class="sepwait" style="padding:30px">Nenhum cliente com atenção ativo agora. Quando um cadastrar no HF, acende aqui (~10 min).</div>`;
    const todayStr = new Date().toISOString().slice(0, 10);
    const esq = [], hj = [];
    reqs.forEach(r => { const d = (r.dt || '').slice(0, 10); (d && d < todayStr ? esq : hj).push(r); });
    const card = (r, esquecido) => {
      const dt = r.dt ? new Date(r.dt.replace(' ', 'T')) : null;
      const when = dt && !isNaN(dt) ? dt.toLocaleDateString('pt-BR') + ' ' + dt.toTimeString().slice(0, 5) : '';
      const chave = `${r.req}-${r.ano}`;
      const flag = esquecido ? `<div style="display:flex;align-items:center;gap:8px;margin-bottom:3px"><span class="fw1">🎆</span><span class="fw2">🎇</span><span style="font-size:12.5px;font-weight:900;letter-spacing:.04em;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.6)">⚠️ ESQUECIDO DE ONTEM — LIBERE AGORA!</span><span class="fw3">🎆</span></div>` : '';
      return `<div class="alertcard atencao ${esquecido ? 'esquecido' : ''}">
        <div style="min-width:0">${flag}<div class="cli">🟡 ${esc2(r.cliente)}</div>
          <div class="big2">🐾 ${esc2(r.paciente)} &nbsp; <span class="reg">Reg ${esc2(r.req)}/${esc2(r.ano)}</span></div>
          <div class="meta">${r.vet ? `vet ${esc2(r.vet)} · ` : ''}${when}</div></div>
        <button class="baixab" data-baixa="${chave}" data-cod="${escA(r.cod)}" data-cliente="${escA(r.cliente)}" data-req="${escA(r.req)}" data-ano="${escA(r.ano)}" data-paciente="${escA(r.paciente)}">✓ liberar</button>
      </div>`;
    };
    let html = leg;
    if (esq.length) html += `<h3 style="font-size:13px;font-weight:900;color:var(--red);margin:6px 0 10px;letter-spacing:.03em">🔴 ${esq.length} ESQUECIDO${esq.length > 1 ? 'S' : ''} DE ONTEM — LIBERE JÁ!</h3>` + esq.map(r => card(r, true)).join('');
    if (hj.length) html += `<h3 style="font-size:12px;color:var(--mut);text-transform:uppercase;letter-spacing:.05em;margin:16px 0 10px">🟡 De hoje (${hj.length})</h3>` + hj.map(r => card(r, false)).join('');
    return html;
  }

  function viewCadastrados() {
    const lbl = classe === 'sensivel' ? 'sensível' : 'com atenção';
    const leg = `<div class="seplegend">📋 Clínicas já cadastradas como <b>${lbl}</b>. Qualquer um pode cadastrar ou remover.</div>`;
    const srch = `<div class="srch"><input id="clisearch" placeholder="🔎 buscar clínica no HF para cadastrar como ${lbl}..." value="${escA(term)}" autocomplete="off">${resultsHtml()}</div>`;
    const reg = myFlags().sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
    const regHtml = reg.length ? `<div class="regwrap">` + reg.map(f => `<span class="regchip ${classe}">${esc2(f.nome || ('Cliente ' + f.cod))} <button class="x" data-desflag="${escA(f.cod)}" title="remover">✕</button></span>`).join('') + `</div>`
      : `<div class="sepwait" style="padding:24px">Nenhuma clínica cadastrada ainda. Use a busca acima.</div>`;
    return leg + srch + `<h3 style="font-size:12px;color:var(--mut);text-transform:uppercase;letter-spacing:.05em;margin:16px 0 10px">${reg.length} cadastrada${reg.length !== 1 ? 's' : ''}</h3>` + regHtml;
  }

  function render() {
    const el = $('cli'); if (!el) return;
    const titulo = classe === 'sensivel' ? '🔴 Clientes Sensíveis' : '🟡 Clientes com Atenção';
    const sub = classe === 'sensivel' ? 'Atendimento ao cliente · só o nome da clínica' : 'Produção · check-in antes de liberar o exame';
    const nAl = classe === 'sensivel' ? alertByClinic().length : alertReqs().length;
    const nReg = myFlags().length;
    const subtabs = `<div class="septabs" style="margin:0 0 12px">
      <div class="septab ${cliView === 'alertas' ? 'on' : ''}" data-cliview="alertas">🔔 Alertas ${nAl ? `<span class="c">${nAl}</span>` : ''}</div>
      <div class="septab ${cliView === 'cadastrados' ? 'on' : ''}" data-cliview="cadastrados">📋 Cadastrados <span class="c">${nReg}</span></div>
    </div>`;
    const head = `<div class="clihead"><div><h2>${titulo}</h2><div class="clisub">${sub}</div></div></div>${subtabs}`;
    if (!cliData()) { el.innerHTML = head + `<div class="sepwait">Aguardando dados (lista de clínicas vem do HF a cada 10 min).</div>`; wire(el); return; }
    el.innerHTML = head + `<div class="clibody">${cliView === 'cadastrados' ? viewCadastrados() : viewAlertas()}</div>`;
    wire(el);
  }

  function wire(el) {
    el.querySelectorAll('.septab[data-cliview]').forEach(t => t.onclick = () => { cliView = t.dataset.cliview; render(); });
    const s = $('clisearch');
    if (s) s.oninput = () => { term = s.value; render(); const n = $('clisearch'); if (n) { n.focus(); try { n.setSelectionRange(n.value.length, n.value.length); } catch (e) {} } };
    el.querySelectorAll('[data-add]').forEach(r => r.onclick = async () => {
      if (await post({ acao: 'flag', cod: r.dataset.add, nome: r.dataset.nome, classe, por: me() })) { term = ''; render(); }
    });
    el.querySelectorAll('[data-desflag]').forEach(b => b.onclick = async () => {
      if (confirm('Remover esta clínica da lista?') && await post({ acao: 'desflag', cod: b.dataset.desflag })) render();
    });
    el.querySelectorAll('[data-baixa]').forEach(b => b.onclick = async () => {
      if (await post({ acao: 'baixa', chave: b.dataset.baixa, cod: b.dataset.cod, classe, cliente: b.dataset.cliente, req: b.dataset.req, ano: b.dataset.ano, paciente: b.dataset.paciente, por: me() })) render();
    });
    el.querySelectorAll('[data-baixaclin]').forEach(b => b.onclick = async () => {
      const chaves = b.dataset.baixaclin.split(',').filter(Boolean);
      if (await post({ acao: 'baixa', chaves, cod: b.dataset.cod, classe, cliente: b.dataset.cliente, por: me() })) render();
    });
  }

  async function onMode(m) {
    if (m === 'cli-sensivel' || m === 'cli-atencao') {
      classe = m === 'cli-sensivel' ? 'sensivel' : 'atencao'; term = ''; cliView = 'alertas';
      await load(); render();
      if (timer) clearInterval(timer);
      timer = setInterval(async () => { const el = $('cli'); if (el && el.style.display !== 'none' && !document.hidden) { await load(); render(); } }, 60000);
    } else if (timer) { clearInterval(timer); timer = null; }
  }
  document.addEventListener('visibilitychange', () => { const el = $('cli'); if (!document.hidden && el && el.style.display !== 'none') load().then(render); });
  window.CLI = { onMode, render };
})();
