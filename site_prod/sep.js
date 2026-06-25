/* Modo SEPARAÇÃO DE AMOSTRAS (pré-analítico) — isolado do painel da TV.
   Universo = DATA.separacao (exames abertos que exigem separar, cruzados com o cofre).
   Marcações persistentes via /api/separacao (separado -> enviado -> recebido).
   Reaproveita globais do app.js: DATA, window.__pwd, ROT, startRotation, esc, num. */
(function () {
  const API = '/api/separacao';
  const MEK = 'sep_me', USK = 'sep_users';
  // Contagem OFICIAL começa 23/jun/2026 (22/jun é treino e NÃO conta no placar/histórico).
  // Para começar a contar de outro dia, mude esta data (ano, mês-1, dia).
  const PISO_OFICIAL = new Date(2026, 5, 23, 0, 0, 0).getTime();
  const PISO_DAY = '2026-06-23';     // piso oficial original (string p/ comparar com dt)
  // RESET à MEIA-NOITE de 25/jun: a equipe recomeça LIMPA. Quando o relógio (BRT) virar 25/jun, tudo de
  // antes some da separação / histórico / placar — EXCETO "EXAMES ESPECIALIZADOS" (o time já trabalha
  // desde ontem, mantém o piso original 23/jun). Hoje (24/jun) fica INTACTO; zera sozinho à meia-noite.
  const RESET_DAY = '2026-06-25';
  const pisoDay = cat => {
    const hojeBRT = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10); // data em BRT (UTC-3)
    if (hojeBRT < RESET_DAY) return PISO_DAY;                       // antes da meia-noite de 25/jun: nada muda
    return /especializ/i.test(cat || '') ? PISO_DAY : RESET_DAY;    // 25/jun em diante: zera tudo menos especializados
  };
  let MODE = 'tv', view = 'separar', period = 'hoje';
  let marks = {};                 // chave -> marcação
  let descartes = new Set();      // chaves apagadas (p/ filtrar do histórico/placar)
  let descartesList = [];         // arquivo COMPLETO dos apagados (histórico do histórico)
  let selByView = { separar: '', urgente: '', receber: '', hist: '', apagados: '' }; // categoria selecionada por aba
  let histPer = 'dia', histFiltro = 'todos'; // Histórico: período + (todos/separados/nao)
  let apPer = 'mes';              // Apagados: período (dia/semana/mes/ano/tudo)
  let subSep = null;             // canal Realtime do Supabase
  const useSupa = () => window.SUPA && window.SUPA.ok;
  let timer = null;
  let idleTimer = null;          // logout automático por inatividade
  let lastAct = Date.now();      // último carimbo/login (p/ contar a inatividade)
  const IDLE_MIN = 15;           // desloga sozinho após N min parado (anti "sessão aberta do colega")
  const touch = () => { lastAct = Date.now(); };
  const ADMK = 'sep_admin';
  const adminPin = () => localStorage.getItem(ADMK) || '';
  const isAdmin = () => !!adminPin();

  const $ = id => document.getElementById(id);
  const esc2 = s => (typeof esc === 'function' ? esc(s) : String(s == null ? '' : s));
  const sepData = () => (typeof DATA !== 'undefined' && DATA && DATA.separacao) ? DATA.separacao : null;
  const cutoffs = () => { const d = sepData(); return (d && d.cutoffs && d.cutoffs.length) ? [...d.cutoffs].sort((a, b) => a - b) : [15, 21]; };
  const itens = () => { const d = sepData(); return d && d.itens ? d.itens : []; };
  const universo = () => { const d = sepData(); return d && d.historico ? d.historico : []; };  // últimos 7 dias (p/ histórico/placar)
  const chaveOf = it => `${it.req}-${it.codex}`;

  /* ---- quem está marcando: LOGIN DE OPERADOR (2 times) c/ fallback ao seletor antigo ---- */
  const OPK = 'sep_op';
  let op = (() => { try { return JSON.parse(localStorage.getItem(OPK) || 'null'); } catch (e) { return null; } })(); // {nome,papel}
  let teamList = [];        // [{nome,papel}] cadastrados no Supabase
  let teamMode = false;     // havendo ≥1 colaborador -> login exigido; senão, seletor antigo
  const papelLbl = p => p === 'recebidos' ? 'Recebidos' : p === 'ambos' ? 'Separação + Recebidos' : 'Separação';
  const meName = () => localStorage.getItem(MEK) || '';
  const me = () => teamMode ? (op ? op.nome : '') : meName();
  const papel = () => teamMode ? (op ? op.papel : '') : 'ambos';
  const canSep = () => !teamMode || papel() === 'separacao' || papel() === 'ambos';
  const canRec = () => !teamMode || papel() === 'recebidos' || papel() === 'ambos';
  const users = () => { try { return JSON.parse(localStorage.getItem(USK) || '[]'); } catch (e) { return []; } };
  function addUser(n) { n = (n || '').trim(); if (!n) return; const u = users(); if (!u.includes(n)) { u.push(n); u.sort(); localStorage.setItem(USK, JSON.stringify(u)); } localStorage.setItem(MEK, n); }
  function saveOp(o) { op = o; if (o) { localStorage.setItem(OPK, JSON.stringify(o)); touch(); } else localStorage.removeItem(OPK); }
  async function loadTeam() {
    if (!useSupa()) { teamMode = false; return; }
    try { teamList = await window.SUPA.teamNames(); teamMode = teamList.length > 0; if (teamMode && op && !teamList.some(u => u.nome === op.nome)) saveOp(null); }
    catch (e) { teamMode = false; }
  }
  const dayTs = ts => { const n = Number(ts); return n ? new Date(n - 3 * 3600e3).toISOString().slice(0, 10) : ''; }; // dia BRT de um timestamp
  // fila do 2º checkpoint: amostras já separadas, aguardando o time de Recebidos (respeita o piso/reset)
  const aReceber = () => Object.values(marks)
    .filter(m => m.estado === 'separado' || m.estado === 'enviado')
    .filter(m => !descartes.has(m.chave))
    .filter(m => { const d = dayTs(m.ts_sep); return !d || d >= pisoDay(m.cat); });

  /* ---- prazo (corte) relativo à hora de entrada ---- */
  function deadline(it) {
    if (!it.entrada_dt) return null;
    const d = new Date(it.entrada_dt.replace(' ', 'T')); if (isNaN(d)) return null;
    const cs = cutoffs();
    for (const h of cs) { const dl = new Date(d); dl.setHours(h, 0, 0, 0); if (dl >= d) return dl; }
    const dl = new Date(d); dl.setDate(dl.getDate() + 1); dl.setHours(cs[0], 0, 0, 0); return dl;
  }
  const hhmm = dt => dt ? dt.toTimeString().slice(0, 5) : '';
  // status: 'feito' (marcado), 'atrasado' (venceu, não marcado), 'noprazo'
  function statusOf(it) {
    const m = marks[chaveOf(it)];
    if (m && m.estado) return { st: 'feito', m };
    const dl = deadline(it);
    if (dl && Date.now() > dl.getTime()) return { st: 'atrasado', dl };
    return { st: 'noprazo', dl };
  }

  /* ---- rede ---- */
  function ingest(j) { marks = {}; (j.marks || []).forEach(m => marks[m.chave] = { ...m, ts_sep: m.ts_sep != null ? Number(m.ts_sep) : m.ts_sep }); descartesList = (j.descartes || []).map(d => ({ ...d, ts: d.ts != null ? Number(d.ts) : d.ts })); descartes = new Set(descartesList.map(d => d.chave)); }
  async function loadMarks() {
    try {
      if (useSupa()) { ingest(await window.SUPA.loadSep()); return; }
      const r = await fetch('/api/overlays?_=' + Date.now()); if (r.ok) ingest(await r.json());
    } catch (e) {}
  }
  async function post(payload) {
    try {
      if (useSupa()) {
        const a = payload.acao, k = payload.chave;
        if (a === 'separar') await window.SUPA.upsertMark({ chave: k, req: payload.req, ano: payload.ano, codex: payload.codex, exame: payload.exame || '', cat: payload.cat || '', classe: payload.classe || '', paciente: payload.paciente || '', tutor: payload.tutor || '', vet: payload.vet || '', estado: 'separado', por: payload.por || 'equipe', ts_sep: Date.now(), no_prazo: payload.no_prazo !== false, corte: payload.corte || null });
        else if (a === 'enviar') await window.SUPA.updateMark(k, { estado: 'enviado', por_env: payload.por || 'equipe', ts_env: Date.now(), data_env: new Date().toISOString().slice(0, 10) });
        else if (a === 'receber') await window.SUPA.updateMark(k, { estado: 'recebido', por_receb: payload.por || 'equipe', ts_receb: Date.now() });
        else if (a === 'voltar') { const m = marks[k]; if (m) { const ordem = ['separado', 'enviado', 'recebido']; const p = ordem.indexOf(m.estado); if (p <= 0) await window.SUPA.delMark(k); else await window.SUPA.updateMark(k, { estado: ordem[p - 1] }); } }
        else if (a === 'desfazer') await window.SUPA.delMark(k);
        touch(); await loadMarks(); return true;
      }
      const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, senha: window.__pwd }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { alert(j.erro || 'Não foi possível salvar.'); return false; }
      touch(); ingest(j); return true;
    } catch (e) { alert('Erro ao salvar (Supabase).'); return false; }
  }
  // apagar não-separados (unitário ou lote) — SÓ ADMIN. itens = objetos completos; undo passa só chaves
  async function descartar(itens, undo) {
    if (!isAdmin()) { alert('Só o admin pode apagar/restaurar. Destrave com o PIN (botão 🔓 Admin no topo).'); return false; }
    try {
      if (useSupa()) {
        if (undo) await window.SUPA.undescartar(itens.map(i => i.chave || i), adminPin());
        else await window.SUPA.descartar(itens.map(i => ({ chave: i.chave, req: i.req, ano: i.ano, codex: i.codex, exame: i.exame, cat: i.cat, paciente: i.paciente, dt: i.dt })), adminPin(), me() || 'admin');
        await loadMarks(); render(); return true;
      }
      const body = undo
        ? { acao: 'undescartar', chaves: itens.map(i => i.chave || i) }
        : { acao: 'descartar', itens: itens.map(i => ({ chave: i.chave, req: i.req, ano: i.ano, codex: i.codex, exame: i.exame, cat: i.cat, paciente: i.paciente, dt: i.dt })) };
      const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, admin: adminPin(), por: me() || 'admin', senha: window.__pwd }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { alert(j.erro || 'Não foi possível apagar.'); if (/admin/i.test(j.erro || '')) { localStorage.removeItem(ADMK); render(); } return false; }
      descartesList = j.descartes || []; descartes = new Set(descartesList.map(d => d.chave)); render(); return true;
    } catch (e) { if (/pin/i.test(e.message || '')) { alert('PIN de admin inválido.'); localStorage.removeItem(ADMK); render(); } else alert('Erro ao apagar (Supabase).'); return false; }
  }
  async function adminUnlock() {
    if (isAdmin()) { if (confirm('Travar o modo admin neste aparelho?')) { localStorage.removeItem(ADMK); render(); } return; }
    const pin = prompt('PIN de admin (para apagar e restaurar não-separados):'); if (!pin) return;
    try {
      let ok;
      if (useSupa()) ok = await window.SUPA.admincheck(pin);
      else { const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'admincheck', admin: pin, senha: window.__pwd }) }); ok = (await r.json().catch(() => ({}))).ok; }
      if (ok) { localStorage.setItem(ADMK, pin); render(); } else alert('PIN de admin incorreto.');
    } catch (e) { alert('Erro de conexão.'); }
  }

  /* ---- login de operador (modal) ---- */
  function logout() { saveOp(null); render(); }
  function openLogin() {
    if (!teamList.length) { alert('Nenhum colaborador cadastrado ainda. Peça ao admin (botão 🔓 Admin → 👥 Equipe).'); return; }
    const old = document.querySelector('.oplogin'); if (old) old.remove();
    const wrap = document.createElement('div'); wrap.className = 'oplogin';
    const opts = teamList.slice().sort((a, b) => a.nome.localeCompare(b.nome)).map(u => `<option value="${esc2(u.nome)}">${esc2(u.nome)} · ${papelLbl(u.papel)}</option>`).join('');
    wrap.innerHTML = `<div class="oplbox"><h3>👤 Entrar na Triagem</h3>
      <label>Colaborador</label><select id="opnome">${opts}</select>
      <label>Senha</label><input id="oppin" type="password" inputmode="numeric" autocomplete="off" placeholder="sua senha">
      <div class="opmsg" id="opmsg"></div>
      <div class="opbtns"><button class="opb cancel" id="opcancel">Cancelar</button><button class="opb ok" id="opgo">Entrar</button></div></div>`;
    document.body.appendChild(wrap);
    const close = () => wrap.remove();
    wrap.onclick = e => { if (e.target === wrap) close(); };
    wrap.querySelector('#opcancel').onclick = close;
    const pin = wrap.querySelector('#oppin'); pin.focus();
    const go = async () => {
      const nome = wrap.querySelector('#opnome').value, p = pin.value;
      if (!p) { pin.focus(); return; }
      wrap.querySelector('#opmsg').textContent = 'Conferindo…';
      const r = await window.SUPA.login(nome, p);
      if (r.ok) { saveOp({ nome, papel: r.papel }); close(); render(); }
      else { wrap.querySelector('#opmsg').textContent = '❌ Senha incorreta.'; pin.value = ''; pin.focus(); }
    };
    wrap.querySelector('#opgo').onclick = go;
    pin.onkeydown = e => { if (e.key === 'Enter') go(); };
  }
  /* ---- gestão da equipe (admin) ---- */
  async function openTeam() {
    if (!isAdmin()) { alert('Só o admin cadastra a equipe. Destrave no botão 🔒 Admin.'); return; }
    if (!useSupa()) { alert('A gestão de equipe exige o Supabase ativo.'); return; }
    const list = await window.SUPA.teamAdminList(adminPin());
    if (list == null) { alert('Não consegui carregar a equipe (PIN admin?).'); return; }
    const old = document.querySelector('.oplogin'); if (old) old.remove();
    const wrap = document.createElement('div'); wrap.className = 'oplogin';
    const rows = list.length ? list.map(u => `<div class="eqrow"><span class="eqn">${esc2(u.nome)}</span><span class="eqp ${u.papel}">${papelLbl(u.papel)}</span><button class="eqdel" data-del="${esc2(u.nome)}">remover</button></div>`).join('') : '<div class="opmsg">Ninguém cadastrado ainda — adicione abaixo.</div>';
    wrap.innerHTML = `<div class="oplbox wide"><h3>👥 Equipe da Triagem</h3>
      <div class="eqlist">${rows}</div>
      <div class="eqadd"><input id="eqnome" placeholder="nome / iniciais">
        <select id="eqpapel"><option value="separacao">Separação</option><option value="recebidos">Recebidos</option><option value="ambos">Sep + Receb</option></select>
        <input id="eqpin" type="text" inputmode="numeric" placeholder="senha"><button class="opb ok" id="eqsave">Salvar</button></div>
      <div class="opmsg" id="eqmsg">Dica: a senha pode ser repetida depois sem perder o histórico de quem carimbou.</div>
      <div class="opbtns"><button class="opb cancel" id="eqclose">Fechar</button></div></div>`;
    document.body.appendChild(wrap);
    const close = () => wrap.remove();
    wrap.onclick = e => { if (e.target === wrap) close(); };
    wrap.querySelector('#eqclose').onclick = close;
    wrap.querySelectorAll('.eqdel').forEach(b => b.onclick = async () => {
      if (!confirm(`Remover ${b.dataset.del} da equipe? (carimbos antigos continuam no histórico)`)) return;
      try { await window.SUPA.teamRemove(adminPin(), b.dataset.del); close(); await loadTeam(); render(); openTeam(); } catch (e) { alert('Erro ao remover.'); }
    });
    wrap.querySelector('#eqsave').onclick = async () => {
      const nome = wrap.querySelector('#eqnome').value.trim(), pp = wrap.querySelector('#eqpapel').value, pn = wrap.querySelector('#eqpin').value.trim();
      const msg = wrap.querySelector('#eqmsg');
      if (!nome || !pn) { msg.textContent = 'Preencha nome e senha.'; return; }
      try { const ok = await window.SUPA.teamSave(adminPin(), nome, pp, pn); if (!ok) { msg.textContent = 'PIN admin inválido.'; return; } close(); await loadTeam(); render(); openTeam(); } catch (e) { msg.textContent = 'Erro ao salvar.'; }
    };
  }

  /* ---- ações ---- */
  async function doSeparar(it) {
    if (teamMode && !me()) { openLogin(); return; }
    if (!me()) { alert('Selecione/insira o seu nome no topo (campo "Você") antes de marcar.'); return; }
    if (!canSep()) { alert('Você entrou como time de RECEBIDOS. Só o time de Separação pode separar — toque em "trocar" pra entrar como separação.'); return; }
    const dl = deadline(it); const noPrazo = !dl || Date.now() <= dl.getTime();
    const ok = await post({
      acao: 'separar', chave: chaveOf(it), req: it.req, ano: it.ano, codex: it.codex,
      exame: it.exame, cat: it.cat, classe: it.classe, paciente: it.paciente, tutor: it.tutor, vet: it.vet,
      por: me(), no_prazo: noPrazo, corte: dl ? dl.getHours() : null
    });
    if (ok) render();
  }
  async function step(acao, chave, confirmMsg) {
    if (teamMode && !me()) { openLogin(); return; }
    if ((acao === 'receber' || acao === 'enviar') && !canRec()) { alert('Você entrou como time de SEPARAÇÃO. Só o time de Recebidos dá o recebido — toque em "trocar" pra entrar como recebidos.'); return; }
    if ((acao === 'enviar' || acao === 'receber') && !me()) { alert('Selecione o seu nome no topo antes.'); return; }
    if (confirmMsg && !confirm(confirmMsg)) return;
    if (await post({ acao, chave, por: me() })) render();
  }

  /* ================= RENDER ================= */
  function header() {
    const sepN = ageItems(0, 0).length, urgN = ageItems(1, null).length;
    const us = users(), cur = me();
    const opts = us.map(u => `<option value="${esc2(u)}"${u === cur ? ' selected' : ''}>${esc2(u)}</option>`).join('');
    const apN = descartesList.length;
    // identidade: login de operador (teamMode) OU seletor de nome antigo (fallback)
    const opbox = teamMode
      ? (me()
        ? `<span class="opnow ${papel()}">👤 ${esc2(me())} · ${papelLbl(papel())}</span><button class="opbtn2" id="opswitch">trocar</button><button class="opbtn2" id="oplogout">sair</button>`
        : `<button class="opbtn2 enter" id="oplogin">🔑 Entrar</button>`)
      : `Você: <select id="sepme"><option value="">— escolher —</option>${opts}<option value="__novo__">＋ adicionar nome…</option></select>`;
    const eqbtn = isAdmin() ? `<button class="adminbtn" id="eqbtn" title="cadastrar/editar a equipe">👥 Equipe</button>` : '';
    return `<div class="sephead">
      <div class="septabs">
        <div class="septab ${view === 'separar' ? 'on' : ''}" data-v="separar">🧪 Separar / Receber <span class="c">${sepN}</span></div>
        <div class="septab andon ${urgN ? 'urgpulse' : ''} ${view === 'urgente' ? 'on' : ''}" data-v="urgente">🚨 Última Chamada <span class="c">${urgN}</span></div>
        <div class="septab ${view === 'placar' ? 'on' : ''}" data-v="placar">🏆 Placar</div>
        <div class="septab ${view === 'hist' ? 'on' : ''}" data-v="hist">📋 Histórico</div>
        <div class="septab ${view === 'apagados' ? 'on' : ''}" data-v="apagados">🗑 Apagados${apN ? ` <span class="c">${apN}</span>` : ''}</div>
      </div>
      <div class="sepme">
        <button class="adminbtn ${isAdmin() ? 'on' : ''}" id="adminbtn" title="apagar/restaurar não-separados">${isAdmin() ? '🔓 Admin' : '🔒 Admin'}</button>
        ${eqbtn}${opbox}
      </div>
    </div>`;
  }

  // LINHA com os 2 PASSOS na mesma tela: [1·Separar] → [2·Receber] (gateados por papel)
  function rowSeparar(it) {
    const s = statusOf(it); const k = chaveOf(it); const m = s.m;
    const tut = it.tutor ? ` · tutor <b>${esc2(it.tutor)}</b>` : '';
    const vet = it.vet ? ` · vet <b>${esc2(it.vet)}</b>` : '';
    const cl = `<span class="cl ${it.classe}">${it.classe === 'apoio' ? '📦 apoio' : '🏠 interno'}</span>`;
    const urg = it.urgente ? '<span class="urg2">URGENTE</span>' : '';
    const head = `<div class="req">${esc2(it.req)}<span class="y">/${esc2(it.ano)}</span></div>
      <div><div class="pac">${esc2(it.paciente)}${cl}${urg}</div>
      <div class="meta">${esc2(it.exame)}${tut}${vet}</div></div>`;
    const separated = !!(m && m.estado);            // separado / enviado / recebido
    const received = !!(m && m.estado === 'recebido');
    // PASSO 1 — SEPARAR
    let b1;
    if (separated) b1 = `<span class="step done" title="por ${esc2(m.por || '')}">✓ Separado</span>`;
    else if (canSep()) b1 = `<button class="sepbtn go" data-act="separar" data-k="${k}">1 · Separar</button>`;
    else b1 = `<span class="step lock" title="entre como time de Separação">🔒 Separar</span>`;
    // PASSO 2 — RECEBER
    let b2;
    if (received) b2 = `<span class="step done rec" title="por ${esc2(m.por_receb || '')}">✓ Recebido</span>`;
    else if (!separated) b2 = `<span class="step wait">2 · Receber</span>`;             // só libera após separar
    else if (canRec()) b2 = `<button class="sepbtn rec" data-act="receber" data-k="${k}">2 · Receber</button>`;
    else b2 = `<span class="step lock" title="entre como time de Recebidos">🔒 Receber</span>`;
    // prazo só enquanto não separou
    const badge = !separated ? (s.st === 'atrasado' ? `<span class="dl late">⏰ atrasado</span>` : (s.dl ? `<span class="dl ok">vence ${hhmm(s.dl)}</span>` : '')) : '';
    const undo = separated ? `<button class="sepbtn undo" data-act="voltar" data-k="${k}" title="desfazer 1 passo">↩</button>` : '';
    return `<div class="seprow ${received ? 'donerow' : ''}">${head}<div class="right2">${badge}${b1}<span class="steparrow">→</span>${b2}${undo}</div></div>`;
  }

  // ordena categorias seguindo a ORDEM da TV (familiaridade); fallback alfabético
  function catIdx(name) {
    try { if (typeof ORDER !== 'undefined' && typeof slug === 'function') { const i = ORDER.findIndex(o => slug(name).includes(slug(o))); return i < 0 ? 99 : i; } } catch (e) {}
    return 99;
  }
  function orderedCats(byCat) { return Object.keys(byCat).sort((a, b) => catIdx(a) - catIdx(b) || a.localeCompare(b)); }
  const rankSt = s => s === 'atrasado' ? 0 : s === 'noprazo' ? 1 : 2;

  /* ---- TÓPICOS: agrupa categorias por setor (fácil de reorganizar aqui) ---- */
  const TOPICS = [
    { t: '🧬 Biologia Molecular', cats: ['BIOLOGIA MOLECULAR - PCR'] },
    { t: '🔬 Patologia', cats: ['Citopatologia', 'NECRÓPSIA'] },
    { t: '⚗️ Análises Clínicas', cats: ['BIOQUÍMICA', 'Uroanálise', 'Hematologia'] },
    { t: '🦠 Micro & Parasito', cats: ['BACTERIOLOGIA - CULTURA', 'Parasitologia'] },
    { t: '💉 Imunologia & Endócrino', cats: ['IMUNOLOGIA', 'EXAMES ESPECIALIZADOS'] },
  ];
  const topicOf = cat => { const t = TOPICS.find(x => x.cats.some(c => slug(c) === slug(cat))); return t ? t.t : '📋 Outros'; };
  // pílulas de categoria AGRUPADAS por tópico. withAll => acrescenta "Todas".
  function topicStrip(byCat, viewKey, sel, lateFn, withAll) {
    const groups = {}; Object.keys(byCat).forEach(cat => { const t = topicOf(cat); (groups[t] = groups[t] || []).push(cat); });
    const order = TOPICS.map(x => x.t).concat(['📋 Outros']).filter(t => groups[t]);
    const total = Object.values(byCat).reduce((s, a) => s + a.length, 0);
    const all = withAll ? `<div class="topicgrp"><div class="catstrip"><div class="catpill ${!sel ? 'on' : ''}" data-selview="${viewKey}" data-selcat=""><span class="nm">Todas</span><span class="cc">${total}</span></div></div></div>` : '';
    return `<div class="topicwrap">` + all + order.map(t => {
      const cats = groups[t].sort((a, b) => catIdx(a) - catIdx(b));
      const pills = cats.map(c => { const arr = byCat[c]; const late = lateFn ? arr.filter(lateFn).length : 0;
        return `<div class="catpill ${c === sel ? 'on' : ''} ${late ? 'haslate' : ''}" data-selview="${viewKey}" data-selcat="${esc2(c)}"><span class="nm">${esc2(c)}</span><span class="cc ${late ? 'late' : ''}">${arr.length}</span></div>`; }).join('');
      return `<div class="topicgrp"><div class="topiclbl">${t}</div><div class="catstrip">${pills}</div></div>`;
    }).join('') + `</div>`;
  }

  /* ---- ciclo da amostra (2 chamadas, sem meio-termo): Separar(hoje) -> Última Chamada(1 dia+) ---- */
  const notFeito = it => { const m = marks[chaveOf(it)]; return !(m && m.estado); };
  const isRecebido = it => { const m = marks[chaveOf(it)]; return !!(m && m.estado === 'recebido'); };
  // PENDENTE = não finalizado. A FINALIZAÇÃO do processo é o RECEBER (não o separar):
  // enquanto não for recebida, a amostra segue na fila e, no dia seguinte, vai pra Última Chamada.
  const pendentes = () => itens().filter(it => (it.entrada || '') >= pisoDay(it.cat) && !descartes.has(chaveOf(it)) && !isRecebido(it));
  const ageItems = (lo, hi) => pendentes().filter(it => (it.dias || 0) >= lo && (hi == null || (it.dias || 0) <= hi));
  function worklistView(viewKey, items, opts) {
    if (!items.length) return `<div class="${opts.emptyClass || 'sepwait'}">${opts.empty}</div>`;
    const byCat = {}; items.forEach(it => { (byCat[it.cat] = byCat[it.cat] || []).push(it); });
    const cats = orderedCats(byCat);
    let sel = selByView[viewKey]; if (!sel || !byCat[sel]) sel = selByView[viewKey] = cats[0];
    const strip = topicStrip(byCat, viewKey, sel, opts.lateFn);
    const arr = byCat[sel];
    const ordered = [...arr].sort((a, b) => (b.dias || 0) - (a.dias || 0) || rankSt(statusOf(a).st) - rankSt(statusOf(b).st));
    const bar = opts.bar ? opts.bar(items.length) : '';
    return bar + strip + `<div class="sepcat ${opts.cardClass || ''}"><div class="h"><span>${opts.icon || ''}${esc2(sel)}</span>
      <span class="cnt">${arr.length} ${opts.noun}</span></div>${ordered.map(rowSeparar).join('')}</div>`;
  }
  const viewSeparar = () => worklistView('separar', ageItems(0, 0), { empty: '✓ Nada para separar ou receber hoje. 👍', noun: 'na fila de hoje (separar → receber)', lateFn: it => statusOf(it).st === 'atrasado' });
  const viewUrgente = () => worklistView('urgente', ageItems(1, null), {
    empty: '✓ Tudo certo! Nenhuma amostra na última chamada. 🎉', noun: 'na última chamada · não finalizada(s)', icon: '🚨 ', cardClass: 'andon urgmax', lateFn: () => true,
    bar: n => `<div class="andonbar urg"><span class="fw1">🎆</span><span class="fw2">🎇</span><span class="ico">🚨</span><span class="ttl">ÚLTIMA CHAMADA · ${n} AMOSTRA${n > 1 ? 'S' : ''} NÃO FINALIZADA${n > 1 ? 'S' : ''} (separar/receber) · FECHE ANTES DE PERDER!</span><span class="fw3">🎆</span><span class="fw1">🎇</span></div>`
  });

  function viewPlacar() {
    const now = new Date(); const today = now.toISOString().slice(0, 10);
    const cutDay = period === 'hoje' ? today : period === '7d' ? new Date(now - 7 * 864e5).toISOString().slice(0, 10) : '0';
    // denominador = UNIVERSO (tudo que precisava separar); numerador = separado no prazo. Não-separados PUXAM a nota pra baixo.
    const agg = {};
    universo().forEach(u => {
      const fl = cutDay > pisoDay(u.cat) ? cutDay : pisoDay(u.cat);
      const dia = (u.dt || '').slice(0, 10); if (!dia || dia < fl) return;
      const k = chaveOf(u); if (descartes.has(k)) return;
      const a = agg[u.cat] = agg[u.cat] || { cat: u.cat, total: 0, sep: 0, ok: 0 };
      a.total++;
      const m = marks[k]; if (m && m.estado) { a.sep++; if (m.no_prazo) a.ok++; }
    });
    const rows = Object.values(agg).map(a => ({ ...a, naoSep: a.total - a.sep, pct: a.total ? Math.round(100 * a.ok / a.total) : 100 }))
      .sort((x, y) => y.pct - x.pct || y.total - x.total);
    let podium = 0;
    const medal = r => (r.total > 0 && ++podium <= 3) ? (podium === 1 ? '🥇' : podium === 2 ? '🥈' : '🥉') : '·';
    const per = `<div class="perbtns">
      <div class="perbtn ${period === 'hoje' ? 'on' : ''}" data-per="hoje">Hoje</div>
      <div class="perbtn ${period === '7d' ? 'on' : ''}" data-per="7d">7 dias</div>
      <div class="perbtn ${period === 'tudo' ? 'on' : ''}" data-per="tudo">Tudo</div></div>`;
    const champ = rows.find(r => r.total > 0 && r.pct >= 70);   // só comemora quem realmente está bem
    const body = rows.length ? rows.map((r) => { const win = champ && r.cat === champ.cat; return `<div class="plrow ${win ? 'winner' : ''}">
        <div class="pos">${medal(r)}</div>
        <div><div class="nm">${esc2(r.cat)}${win ? ' 🎆🎉<span class="champ">PARABÉNS!</span>' : ''}</div>
          <div class="barwrap"><i style="width:${r.pct}%"></i></div>
          <div class="sub">${r.ok}/${r.total} no prazo${r.naoSep ? ` · <b style="color:var(--red)">${r.naoSep} não separado${r.naoSep > 1 ? 's' : ''}</b>` : ''}</div></div>
        <div></div>
        <div><div class="pct" style="color:${r.pct >= 80 ? 'var(--green)' : r.pct >= 50 ? 'var(--amber)' : 'var(--red)'}">${r.pct}%</div><div class="sub">no prazo</div></div>
      </div>`; }).join('') : `<div class="sepwait">Sem itens no período (contagem oficial desde 23/jun).</div>`;
    return `<div class="histfilt"><b style="font-size:15px">🏆 Pontualidade da separação por setor</b>${per}</div>${body}`;
  }

  // universo (7 dias) cruzado com marcações: cada item vira separado OU não-separado
  function histRows() {
    const now = Date.now(); const today = new Date().toISOString().slice(0, 10);
    const cutDay = histPer === 'dia' ? today : histPer === 'semana' ? new Date(now - 7 * 864e5).toISOString().slice(0, 10) : histPer === 'mes' ? new Date(now - 30 * 864e5).toISOString().slice(0, 10) : '0';
    const rows = [];
    universo().forEach(u => {
      const fl = cutDay > pisoDay(u.cat) ? cutDay : pisoDay(u.cat);
      const dia = (u.dt || '').slice(0, 10); if (!dia || dia < fl) return;
      const k = chaveOf(u); if (descartes.has(k)) return;
      const m = marks[k];
      rows.push({ chave: k, req: u.req, ano: u.ano, codex: u.codex, cat: u.cat, exame: u.exame, paciente: u.paciente, dt: u.dt, sep: !!(m && m.estado), m });
    });
    rows.sort((a, b) => (a.sep !== b.sep) ? (a.sep ? 1 : -1) : (a.dt < b.dt ? 1 : a.dt > b.dt ? -1 : 0)); // não-separados primeiro
    return rows;
  }

  function viewHist() {
    const all = histRows();
    const byCat = {}; all.forEach(r => { (byCat[r.cat] = byCat[r.cat] || []).push(r); });
    const histCat = selByView.hist;
    let shown = histCat ? all.filter(r => r.cat === histCat) : all;
    if (histFiltro === 'separados') shown = shown.filter(r => r.sep);
    else if (histFiltro === 'nao') shown = shown.filter(r => !r.sep);
    const nSep = shown.filter(r => r.sep).length, nNao = shown.length - nSep;
    const perLbl = { dia: 'Dia', semana: 'Semana', mes: 'Mês', tudo: 'Tudo' };
    const perBtns = `<div class="perbtns">${['dia', 'semana', 'mes', 'tudo'].map(p => `<div class="perbtn ${histPer === p ? 'on' : ''}" data-hper="${p}">${perLbl[p]}</div>`).join('')}</div>`;
    const fBtns = `<div class="perbtns">
      <div class="perbtn ${histFiltro === 'todos' ? 'on' : ''}" data-hf="todos">Todos</div>
      <div class="perbtn ${histFiltro === 'separados' ? 'on' : ''}" data-hf="separados">✓ Separados</div>
      <div class="perbtn ${histFiltro === 'nao' ? 'on' : ''}" data-hf="nao" style="${histFiltro === 'nao' ? 'border-color:var(--red);color:var(--red)' : ''}">✗ Não separados</div></div>`;
    const pills = topicStrip(byCat, 'hist', histCat, null, true);
    const misses = shown.filter(r => !r.sep);
    const batch = (isAdmin() && misses.length) ? `<button class="perbtn" id="histdelbatch" style="border-color:var(--red);color:var(--red);font-weight:800">🗑 Apagar ${misses.length} não-separado${misses.length > 1 ? 's' : ''} (deste filtro)</button>` : '';
    const head = `<div class="histfilt"><b style="font-size:15px">📋 Histórico</b>${perBtns}${fBtns}
      <span style="margin-left:auto;color:var(--mut);font-size:12px">✓ ${nSep} separados · <b style="color:var(--red)">✗ ${nNao} não</b></span></div>${pills}
      ${batch ? `<div class="histfilt">${batch}</div>` : ''}`;
    if (!shown.length) return head + `<div class="sepwait">Nada nesse período/filtro (contagem oficial desde 23/jun).</div>`;
    const fmtTs = ts => { const d = new Date(ts); return d.toLocaleDateString('pt-BR') + ' ' + d.toTimeString().slice(0, 5); };
    const fmtD = d => { const p = String(d || '').slice(0, 10).split('-'); return p.length === 3 ? `${p[2]}/${p[1]}` : (d || ''); };
    const rowsHtml = shown.map(r => {
      const when = r.sep ? fmtTs(r.m.ts_sep) : fmtD(r.dt);
      const recebido = r.sep && r.m.estado === 'recebido';
      const status = !r.sep
        ? `<span class="dl late" style="padding:2px 8px">✗ NÃO SEPARADO</span> <span style="color:var(--mut)">— setor ${esc2(r.cat)}</span>`
        : recebido
          ? `<span class="est separado" style="background:#dcfce7;color:#166534">✓ recebido (finalizado)</span> sep. <b>${esc2(r.m.por || '')}</b> · receb. <b>${esc2(r.m.por_receb || '')}</b>`
          : `<span class="est separado" style="background:#fef9c3;color:#854d0e">⏳ separado — aguardando receber</span> por <b>${esc2(r.m.por || '')}</b>${r.m.no_prazo === false ? ' <span class="dl late" style="padding:1px 5px">atraso</span>' : ''}`;
      const del = r.sep
        ? `<button class="sepbtn undo" data-del="${r.chave}" data-delkind="mark" title="desfazer marcação">↩</button>`
        : (isAdmin() ? `<button class="sepbtn undo" data-del="${r.chave}" data-delkind="miss" title="apagar este não-separado (admin)">✕</button>` : `<span style="color:var(--mut);font-size:13px" title="só admin apaga">🔒</span>`);
      return `<tr style="${r.sep ? '' : 'background:rgba(255,84,112,.06)'}">
        <td style="white-space:nowrap">${when}</td>
        <td style="color:var(--cyan);font-weight:700">${esc2(r.req)}/${esc2(r.ano)}</td>
        <td>${esc2(r.paciente)}</td>
        <td style="color:var(--mut)">${esc2(r.exame)}</td>
        <td>${esc2(r.cat)}</td>
        <td>${status}</td>
        <td style="text-align:right">${del}</td>
      </tr>`;
    }).join('');
    return head + `<table class="htable"><thead><tr>
      <th>Quando</th><th>Req</th><th>Paciente</th><th>Exame</th><th>Setor</th><th>Status</th><th></th>
      </tr></thead><tbody>${rowsHtml}</tbody></table>`;
  }

  // 🗑 APAGADOS (histórico do histórico) — todos veem; só admin restaura
  function viewApagados() {
    const now = Date.now();
    const cut = apPer === 'dia' ? new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00').getTime()
      : apPer === 'semana' ? now - 7 * 864e5 : apPer === 'mes' ? now - 30 * 864e5 : apPer === 'ano' ? now - 365 * 864e5 : 0;
    const within = descartesList.filter(d => (d.ts || 0) >= cut);
    const byCat = {}; within.forEach(d => { (byCat[d.cat] = byCat[d.cat] || []).push(d); });
    const apCat = selByView.apagados;
    let list = (apCat ? within.filter(d => d.cat === apCat) : within).sort((a, b) => (b.ts || 0) - (a.ts || 0));
    const perLbl = { dia: 'Dia', semana: 'Semana', mes: 'Mês', ano: 'Ano', tudo: 'Tudo' };
    const perBtns = `<div class="perbtns">${['dia', 'semana', 'mes', 'ano', 'tudo'].map(p => `<div class="perbtn ${apPer === p ? 'on' : ''}" data-apper="${p}">${perLbl[p]}</div>`).join('')}</div>`;
    const pills = topicStrip(byCat, 'apagados', apCat, null, true);
    const head = `<div class="histfilt"><b style="font-size:15px">🗑 Apagados <span style="color:var(--mut);font-weight:400;font-size:12px">(histórico do histórico — nada se perde)</span></b>${perBtns}
      <span style="margin-left:auto;color:var(--mut);font-size:12px">${list.length} registro${list.length !== 1 ? 's' : ''}</span></div>${pills}`;
    if (!list.length) return head + `<div class="sepwait">Nenhum item apagado nesse período.</div>`;
    const fmtTs = ts => { const d = new Date(ts); return d.toLocaleDateString('pt-BR') + ' ' + d.toTimeString().slice(0, 5); };
    const fmtD = d => { const p = String(d || '').slice(0, 10).split('-'); return p.length === 3 ? `${p[2]}/${p[1]}` : ''; };
    const rows = list.map(d => `<tr>
      <td style="white-space:nowrap">${fmtTs(d.ts)}</td>
      <td style="color:var(--cyan);font-weight:700">${esc2(d.req)}/${esc2(d.ano)}</td>
      <td>${esc2(d.paciente)}</td>
      <td style="color:var(--mut)">${esc2(d.exame)}</td>
      <td>${esc2(d.cat)}</td>
      <td>${fmtD(d.dt)}</td>
      <td><b>${esc2(d.por || '')}</b></td>
      <td style="text-align:right">${isAdmin() ? `<button class="sepbtn undo" data-restore="${esc2(d.chave)}" title="restaurar (volta pro histórico)">↩ restaurar</button>` : ''}</td>
    </tr>`).join('');
    return head + `<table class="htable"><thead><tr><th>Apagado em</th><th>Req</th><th>Paciente</th><th>Exame</th><th>Setor</th><th>Data orig.</th><th>Quem apagou</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  // legenda curta e autoexplicativa por aba (pros colaboradores)
  const LEGENDS = {
    separar: '🧪 Cada amostra tem 2 passos na mesma linha: 1·Separar (time de Separação) → 2·Receber (time de Recebidos).',
    urgente: '🚨 Não FINALIZADAS de ontem ou antes (faltou separar OU receber) — última chamada, feche antes de perder!',
    placar: '🏆 Pontualidade de cada setor: quanto foi separado no prazo.',
    hist: '📋 Tudo que foi separado E o que ficou sem separar — filtre por dia, setor e tipo.',
    apagados: '🗑 Não-separados que o admin apagou — ficam guardados aqui, nada se perde.',
  };
  function render() {
    const el = $('sep'); if (!el) return;
    if (!sepData()) { el.innerHTML = header() + `<div class="sepwait">Aguardando a próxima atualização dos dados (o robô gera a lista de separação a cada 10 min).</div>`; wire(el); return; }
    let body = '';
    if (view === 'separar') body = viewSeparar();
    else if (view === 'urgente') body = viewUrgente();
    else if (view === 'placar') body = viewPlacar();
    else if (view === 'apagados') body = viewApagados();
    else body = viewHist();
    const leg = LEGENDS[view] || LEGENDS.hist;
    el.innerHTML = header() + `<div class="seplegend ${view}">${leg}</div>` + `<div class="sepbody">${body}</div>`;
    wire(el);
  }

  function wire(el) {
    el.querySelectorAll('.septab').forEach(t => t.onclick = () => { view = t.dataset.v; render(); });
    const sm = $('sepme'); if (sm) sm.onchange = () => {
      if (sm.value === '__novo__') { const n = prompt('Seu nome ou iniciais:'); if (n && n.trim()) addUser(n); render(); return; }
      localStorage.setItem(MEK, sm.value); render();
    };
    el.querySelectorAll('[data-selcat]').forEach(p => p.onclick = () => { selByView[p.dataset.selview] = p.dataset.selcat; render(); });
    el.querySelectorAll('.perbtn[data-hper]').forEach(p => p.onclick = () => { histPer = p.dataset.hper; render(); });
    el.querySelectorAll('.perbtn[data-hf]').forEach(p => p.onclick = () => { histFiltro = p.dataset.hf; render(); });
    const ab = $('adminbtn'); if (ab) ab.onclick = adminUnlock;
    const eb = $('eqbtn'); if (eb) eb.onclick = openTeam;
    const ol = $('oplogin'); if (ol) ol.onclick = openLogin;
    const osw = $('opswitch'); if (osw) osw.onclick = openLogin;
    const olo = $('oplogout'); if (olo) olo.onclick = logout;
    el.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      const k = b.dataset.del;
      if (b.dataset.delkind === 'mark') {
        const mk = marks[k];
        if (mk && mk.estado === 'recebido') { if (confirm('Desfazer o RECEBIDO? Volta para a fila "A Receber" (a separação continua valendo).') && await post({ acao: 'voltar', chave: k })) render(); }
        else if (confirm('Desfazer esta marcação de "separado"? Volta a contar como não-separado.') && await post({ acao: 'desfazer', chave: k })) render();
      }
      else { const row = histRows().find(r => r.chave === k); if (row && confirm('Apagar este NÃO-separado? Vai pro arquivo de Apagados (não some de vez). Sai do histórico e do placar.')) descartar([row]); }
    });
    const bb = $('histdelbatch'); if (bb) bb.onclick = () => {
      const hc = selByView.hist; const all = histRows(); let m = hc ? all.filter(r => r.cat === hc) : all; m = m.filter(r => !r.sep);
      if (m.length && confirm(`Apagar ${m.length} não-separado(s) deste filtro de uma vez? Vão pro arquivo de Apagados.`)) descartar(m);
    };
    el.querySelectorAll('.perbtn[data-apper]').forEach(p => p.onclick = () => { apPer = p.dataset.apper; render(); });
    el.querySelectorAll('[data-restore]').forEach(b => b.onclick = () => { if (confirm('Restaurar este item? Volta pro histórico normal (como não-separado).')) descartar([{ chave: b.dataset.restore }], true); });
    el.querySelectorAll('[data-act]').forEach(b => b.onclick = () => {
      const k = b.dataset.k, act = b.dataset.act;
      if (act === 'separar') { const it = itens().find(x => chaveOf(x) === k); if (it) doSeparar(it); }
      else if (act === 'enviar') step('enviar', k);
      else if (act === 'receber') step('receber', k);
      else if (act === 'voltar') step('voltar', k, 'Desfazer o último passo desta amostra?');
    });
    el.querySelectorAll('.perbtn[data-per]').forEach(p => p.onclick = () => { period = p.dataset.per; render(); });
  }

  /* ---- modo ---- */
  async function setMode(m) {
    MODE = m;
    const isTv = m === 'tv';
    $('tabs').style.display = isTv ? '' : 'none';
    $('content').style.display = isTv ? '' : 'none';
    $('sep').style.display = m === 'sep' ? '' : 'none';
    const cliEl = $('cli'); if (cliEl) cliEl.style.display = m.indexOf('cli-') === 0 ? '' : 'none';
    document.querySelectorAll('#modesw .msbtn').forEach(b => b.classList.toggle('on', b.dataset.m === m));
    // rotação só roda na TV
    try { if (typeof ROT !== 'undefined' && ROT) clearInterval(ROT); } catch (e) {}
    if (isTv && typeof startRotation === 'function') startRotation();
    // Triagem: Supabase Realtime (push, zero polling) — fallback p/ polling 60s se não tiver Supabase
    if (subSep) { window.SUPA && window.SUPA.unsub(subSep); subSep = null; }
    if (timer) { clearInterval(timer); timer = null; }
    if (idleTimer) { clearInterval(idleTimer); idleTimer = null; }
    if (m === 'sep') {
      await loadTeam(); await loadMarks(); render();
      if (useSupa()) subSep = window.SUPA.subscribe(['sep_marks', 'sep_descartes'], async () => { if (MODE === 'sep') { await loadMarks(); render(); } });
      else timer = setInterval(async () => { if (MODE === 'sep' && !document.hidden) { await loadMarks(); render(); } }, 60000);
      // logout automático por inatividade (só faz sentido no modo equipe)
      idleTimer = setInterval(() => { if (MODE === 'sep' && teamMode && op && Date.now() - lastAct > IDLE_MIN * 60000) { saveOp(null); render(); } }, 60000);
    }
    // delega os modos de cliente
    if (window.CLI) await window.CLI.onMode(m);
  }

  // estilos do login de operador + gestão de equipe + aba A Receber
  (function injectCss() {
    if (document.getElementById('sepopcss')) return;
    const s = document.createElement('style'); s.id = 'sepopcss';
    s.textContent = `
.oplogin{position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:9999}
.oplbox{background:#fff;color:#1a1a1a;border-radius:16px;padding:22px;width:min(92vw,360px);box-shadow:0 12px 40px rgba(0,0,0,.45);font-size:16px}
.oplbox.wide{width:min(94vw,500px)}
.oplbox h3{margin:0 0 14px;font-size:20px}
.oplbox label{display:block;font-size:13px;opacity:.7;margin:10px 0 4px}
.oplbox select,.oplbox input{width:100%;padding:11px 12px;font-size:17px;border:1.5px solid #cbd5e1;border-radius:10px;box-sizing:border-box}
.opmsg{min-height:18px;font-size:14px;color:#b91c1c;margin:8px 0 2px}
.opbtns{display:flex;gap:10px;margin-top:14px}
.opb{flex:1;padding:12px;font-size:16px;font-weight:700;border:0;border-radius:10px;cursor:pointer}
.opb.ok{background:#16a34a;color:#fff}.opb.cancel{background:#e5e7eb;color:#333}
.opnow{font-weight:700;padding:5px 10px;border-radius:999px;background:#e0f2fe;color:#075985}
.opnow.recebidos{background:#fef3c7;color:#92400e}.opnow.ambos{background:#ede9fe;color:#5b21b6}
.opbtn2{margin-left:6px;padding:5px 10px;border-radius:8px;border:1px solid #cbd5e1;background:#fff;color:#333;cursor:pointer;font-size:13px}
.opbtn2.enter{background:#16a34a;color:#fff;border:0;font-weight:700;font-size:15px;padding:7px 14px}
.eqlist{max-height:42vh;overflow:auto;margin-bottom:10px}
.eqrow{display:flex;align-items:center;gap:8px;padding:7px 2px;border-bottom:1px solid #eee}
.eqrow .eqn{font-weight:700;flex:1}
.eqrow .eqp{font-size:12px;padding:2px 8px;border-radius:999px;background:#e0f2fe;color:#075985}
.eqrow .eqp.recebidos{background:#fef3c7;color:#92400e}.eqrow .eqp.ambos{background:#ede9fe;color:#5b21b6}
.eqdel{font-size:12px;color:#b91c1c;background:none;border:0;cursor:pointer;text-decoration:underline}
.eqadd{display:grid;grid-template-columns:1fr auto auto auto;gap:6px;align-items:center;margin-top:6px}
.eqadd input,.eqadd select{padding:9px;font-size:14px;border:1.5px solid #cbd5e1;border-radius:8px}
.eqadd .opb{padding:9px 12px;flex:none}
.dl.lock{opacity:.75;font-size:12px}
.sepbtn.rec{background:#f59e0b;color:#fff}
.step{font-size:13px;padding:5px 10px;border-radius:8px;font-weight:700;white-space:nowrap}
.step.done{background:#dcfce7;color:#166534}
.step.done.rec{background:#fef3c7;color:#92400e}
.step.wait{background:#f1f5f9;color:#94a3b8}
.step.lock{background:#f1f5f9;color:#64748b}
.steparrow{color:#cbd5e1;font-weight:800;margin:0 1px}`;
    document.head.appendChild(s);
  })();
  document.querySelectorAll('#modesw .msbtn').forEach(b => b.addEventListener('click', () => setMode(b.dataset.m)));
  // ao voltar o foco na aba, atualiza na hora (sensação de "ao vivo" sem ficar consultando à toa)
  document.addEventListener('visibilitychange', () => { if (!document.hidden && MODE === 'sep') loadMarks().then(render); });
  window.SEP = { setMode, render };
})();
