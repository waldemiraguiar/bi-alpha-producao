/* Modos CLIENTES VIGIADOS (🔴 sensível / 🟡 com atenção) — isolados do painel.
   Busca clínicas do HF (DATA.clientes.lista), cadastra como sensível/atenção (persiste em /api/clientes),
   e ACENDE alerta quando o cliente cadastra requisição no HF (DATA.clientes.reqs, atualiza 10/10min).
   Baixa MANUAL nos dois. Reaproveita window.__pwd, DATA, esc, e o nome do colaborador (sep_me). */
(function () {
  const API = '/api/clientes';
  const MEK = 'sep_me', USK = 'sep_users';   // mesma identidade da Triagem
  let classe = null;                          // 'sensivel' | 'atencao'
  let flags = [], baixas = [], term = '', timer = null;

  const $ = id => document.getElementById(id);
  const esc2 = s => (typeof esc === 'function' ? esc(s) : String(s == null ? '' : s));
  const escA = s => esc2(s).replace(/"/g, '&quot;');
  const cliData = () => (typeof DATA !== 'undefined' && DATA && DATA.clientes) ? DATA.clientes : null;
  const me = () => localStorage.getItem(MEK) || '';
  const users = () => { try { return JSON.parse(localStorage.getItem(USK) || '[]'); } catch (e) { return []; } };
  function addUser(n) { n = (n || '').trim(); if (!n) return; const u = users(); if (!u.includes(n)) { u.push(n); u.sort(); localStorage.setItem(USK, JSON.stringify(u)); } localStorage.setItem(MEK, n); }

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
  function alertas() {
    const d = cliData(); if (!d) return [];
    const cods = flaggedCods(), bx = baixadas();
    return (d.reqs || []).filter(r => cods.has(String(r.cod)) && !bx.has(`${r.req}-${r.ano}`))
      .sort((a, b) => (b.dt || '').localeCompare(a.dt || ''));
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
  function alertCard(r) {
    const dt = r.dt ? new Date(r.dt.replace(' ', 'T')) : null;
    const when = dt && !isNaN(dt) ? dt.toLocaleDateString('pt-BR') + ' ' + dt.toTimeString().slice(0, 5) : '';
    const chave = `${r.req}-${r.ano}`;
    const ic = classe === 'sensivel' ? '🔴' : '🟡';
    return `<div class="alertcard ${classe}">
      <div><div class="cli">${ic} ${esc2(r.cliente)}</div>
        <div class="big2">🐾 ${esc2(r.paciente)} &nbsp; <span class="reg">Reg ${esc2(r.req)}/${esc2(r.ano)}</span></div>
        <div class="meta">${r.vet ? `vet ${esc2(r.vet)} · ` : ''}${when}</div></div>
      <button class="baixab" data-baixa="${chave}" data-cod="${escA(r.cod)}" data-cliente="${escA(r.cliente)}" data-req="${escA(r.req)}" data-ano="${escA(r.ano)}" data-paciente="${escA(r.paciente)}">✓ baixa</button>
    </div>`;
  }

  function render() {
    const el = $('cli'); if (!el) return;
    const titulo = classe === 'sensivel' ? '🔴 Clientes Sensíveis' : '🟡 Clientes com Atenção';
    const lbl = classe === 'sensivel' ? 'sensível' : 'com atenção';
    const us = users(), cur = me();
    const opts = us.map(u => `<option ${u === cur ? 'selected' : ''}>${esc2(u)}</option>`).join('');
    const head = `<div class="clihead"><h2>${titulo}</h2>
      <div class="you">Você: <select id="clime"><option value="">— escolher —</option>${opts}<option value="__novo__">＋ adicionar nome…</option></select></div></div>`;
    if (!cliData()) { el.innerHTML = head + `<div class="sepwait">Aguardando a próxima atualização dos dados (lista de clientes vem do HF a cada 10 min).</div>`; wire(el); return; }
    const srch = `<div class="srch"><input id="clisearch" placeholder="🔎 buscar clínica no HF para adicionar..." value="${escA(term)}" autocomplete="off">${resultsHtml()}</div>`;
    const al = alertas();
    const alHtml = al.length ? al.map(alertCard).join('') : `<div class="sepwait" style="padding:24px">Nenhum cliente ${lbl} cadastrou no momento. Quando um cliente monitorado entrar no HF, acende aqui em ~10 min.</div>`;
    const reg = myFlags().sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
    const regHtml = reg.length ? reg.map(f => `<span class="regchip ${classe}">${esc2(f.nome || ('Cliente ' + f.cod))} <button class="x" data-desflag="${escA(f.cod)}" title="remover da lista">✕</button></span>`).join('')
      : `<span class="clicount">nenhum cliente cadastrado ainda — use a busca acima para adicionar.</span>`;
    el.innerHTML = head + `<div class="clibody">${srch}
      <div class="clihalf"><h3>🔔 Acendeu agora <span class="clicount">(${al.length})</span></h3>${alHtml}</div>
      <div class="clihalf"><h3>📋 Clientes monitorados <span class="clicount">(${reg.length})</span></h3>${regHtml}</div>
    </div>`;
    wire(el);
  }

  function wire(el) {
    const s = $('clisearch');
    if (s) s.oninput = () => { term = s.value; render(); const n = $('clisearch'); if (n) { n.focus(); try { n.setSelectionRange(n.value.length, n.value.length); } catch (e) {} } };
    const mesel = $('clime');
    if (mesel) mesel.onchange = () => { if (mesel.value === '__novo__') { const n = prompt('Seu nome ou iniciais:'); if (n && n.trim()) addUser(n); render(); return; } localStorage.setItem(MEK, mesel.value); render(); };
    el.querySelectorAll('[data-add]').forEach(r => r.onclick = async () => {
      if (!me()) { alert('Selecione/insira seu nome no topo (campo "Você") antes.'); return; }
      if (await post({ acao: 'flag', cod: r.dataset.add, nome: r.dataset.nome, classe, por: me() })) { term = ''; render(); }
    });
    el.querySelectorAll('[data-desflag]').forEach(b => b.onclick = async () => {
      if (confirm('Remover este cliente da lista de monitorados?') && await post({ acao: 'desflag', cod: b.dataset.desflag })) render();
    });
    el.querySelectorAll('[data-baixa]').forEach(b => b.onclick = async () => {
      if (!me()) { alert('Selecione/insira seu nome no topo (campo "Você") antes.'); return; }
      if (await post({ acao: 'baixa', chave: b.dataset.baixa, cod: b.dataset.cod, classe, cliente: b.dataset.cliente, req: b.dataset.req, ano: b.dataset.ano, paciente: b.dataset.paciente, por: me() })) render();
    });
  }

  async function onMode(m) {
    if (m === 'cli-sensivel' || m === 'cli-atencao') {
      classe = m === 'cli-sensivel' ? 'sensivel' : 'atencao'; term = '';
      await load(); render();
      if (timer) clearInterval(timer);
      // poupa créditos: só consulta com a aba VISÍVEL, a cada 60s
      timer = setInterval(async () => { const el = $('cli'); if (el && el.style.display !== 'none' && !document.hidden) { await load(); render(); } }, 60000);
    } else if (timer) { clearInterval(timer); timer = null; }
  }
  document.addEventListener('visibilitychange', () => { const el = $('cli'); if (!document.hidden && el && el.style.display !== 'none') load().then(render); });
  window.CLI = { onMode, render };
})();
