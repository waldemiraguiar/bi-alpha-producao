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
  let MODE = 'tv', view = 'separar', period = 'hoje';
  let marks = {};                 // chave -> marcação
  let descartes = new Set();      // chaves apagadas (p/ filtrar do histórico/placar)
  let descartesList = [];         // arquivo COMPLETO dos apagados (histórico do histórico)
  let selCat = '';                // categoria selecionada (abas do Separar)
  let selCatA = '';               // categoria selecionada (abas do Atrasados/Andon)
  let histCat = '', histPer = 'dia', histFiltro = 'todos'; // Histórico: categoria + período + (todos/separados/nao)
  let apCat = '', apPer = 'mes';  // Apagados: categoria + período (dia/semana/mes/ano/tudo)
  let timer = null;
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

  /* ---- quem está marcando (por aparelho) ---- */
  const me = () => localStorage.getItem(MEK) || '';
  const users = () => { try { return JSON.parse(localStorage.getItem(USK) || '[]'); } catch (e) { return []; } };
  function addUser(n) { n = (n || '').trim(); if (!n) return; const u = users(); if (!u.includes(n)) { u.push(n); u.sort(); localStorage.setItem(USK, JSON.stringify(u)); } localStorage.setItem(MEK, n); }

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
  async function loadMarks() {
    try { const r = await fetch('/api/overlays?_=' + Date.now()); if (r.ok) { const j = await r.json(); marks = {}; (j.marks || []).forEach(m => marks[m.chave] = m); descartesList = j.descartes || []; descartes = new Set(descartesList.map(d => d.chave)); } } catch (e) {}
  }
  async function post(payload) {
    try {
      const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, senha: window.__pwd }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { alert(j.erro || 'Não foi possível salvar.'); return false; }
      marks = {}; (j.marks || []).forEach(m => marks[m.chave] = m); return true;
    } catch (e) { alert('Erro de conexão.'); return false; }
  }
  // apagar não-separados (unitário ou lote) — SÓ ADMIN. itens = objetos completos; undo passa só chaves
  async function descartar(itens, undo) {
    if (!isAdmin()) { alert('Só o admin pode apagar/restaurar. Destrave com o PIN (botão 🔓 Admin no topo).'); return false; }
    try {
      const body = undo
        ? { acao: 'undescartar', chaves: itens.map(i => i.chave || i) }
        : { acao: 'descartar', itens: itens.map(i => ({ chave: i.chave, req: i.req, ano: i.ano, codex: i.codex, exame: i.exame, cat: i.cat, paciente: i.paciente, dt: i.dt })) };
      const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, admin: adminPin(), por: me() || 'admin', senha: window.__pwd }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { alert(j.erro || 'Não foi possível apagar.'); if (/admin/i.test(j.erro || '')) { localStorage.removeItem(ADMK); render(); } return false; }
      descartesList = j.descartes || []; descartes = new Set(descartesList.map(d => d.chave)); render(); return true;
    } catch (e) { alert('Erro de conexão.'); return false; }
  }
  async function adminUnlock() {
    if (isAdmin()) { if (confirm('Travar o modo admin neste aparelho?')) { localStorage.removeItem(ADMK); render(); } return; }
    const pin = prompt('PIN de admin (para apagar e restaurar não-separados):'); if (!pin) return;
    try {
      const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'admincheck', admin: pin, senha: window.__pwd }) });
      const j = await r.json().catch(() => ({}));
      if (j.ok) { localStorage.setItem(ADMK, pin); render(); }
      else alert('PIN de admin incorreto.');
    } catch (e) { alert('Erro de conexão.'); }
  }

  /* ---- ações ---- */
  async function doSeparar(it) {
    if (!me()) { alert('Selecione/insira o seu nome no topo (campo "Você") antes de marcar.'); return; }
    const dl = deadline(it); const noPrazo = !dl || Date.now() <= dl.getTime();
    const ok = await post({
      acao: 'separar', chave: chaveOf(it), req: it.req, ano: it.ano, codex: it.codex,
      exame: it.exame, cat: it.cat, classe: it.classe, paciente: it.paciente, tutor: it.tutor, vet: it.vet,
      por: me(), no_prazo: noPrazo, corte: dl ? dl.getHours() : null
    });
    if (ok) render();
  }
  async function step(acao, chave, confirmMsg) {
    if (confirmMsg && !confirm(confirmMsg)) return;
    if ((acao === 'enviar' || acao === 'receber') && !me()) { alert('Selecione o seu nome no topo antes.'); return; }
    if (await post({ acao, chave, por: me() })) render();
  }

  /* ================= RENDER ================= */
  function header() {
    const it = itens(); const pend = it.filter(x => statusOf(x).st !== 'feito').length;
    const andon = it.filter(x => statusOf(x).st === 'atrasado').length;
    const us = users(), cur = me();
    const opts = us.map(u => `<option value="${esc2(u)}"${u === cur ? ' selected' : ''}>${esc2(u)}</option>`).join('');
    const apN = descartesList.length;
    return `<div class="sephead">
      <div class="septabs">
        <div class="septab ${view === 'separar' ? 'on' : ''}" data-v="separar">🧪 Separar <span class="c">${pend}</span></div>
        <div class="septab andon ${view === 'andon' ? 'on' : ''}" data-v="andon">🚨 Atrasados <span class="c">${andon}</span></div>
        <div class="septab ${view === 'placar' ? 'on' : ''}" data-v="placar">🏆 Placar</div>
        <div class="septab ${view === 'hist' ? 'on' : ''}" data-v="hist">📋 Histórico</div>
        <div class="septab ${view === 'apagados' ? 'on' : ''}" data-v="apagados">🗑 Apagados${apN ? ` <span class="c">${apN}</span>` : ''}</div>
      </div>
      <div class="sepme">
        <button class="adminbtn ${isAdmin() ? 'on' : ''}" id="adminbtn" title="apagar/restaurar não-separados">${isAdmin() ? '🔓 Admin' : '🔒 Admin'}</button>
        Você: <select id="sepme"><option value="">— escolher —</option>${opts}<option value="__novo__">＋ adicionar nome…</option></select>
      </div>
    </div>`;
  }

  function rowSeparar(it) {
    const s = statusOf(it); const k = chaveOf(it);
    const tut = it.tutor ? ` · tutor <b>${esc2(it.tutor)}</b>` : '';
    const vet = it.vet ? ` · vet <b>${esc2(it.vet)}</b>` : '';
    const cl = `<span class="cl ${it.classe}">${it.classe === 'apoio' ? '📦 apoio' : '🏠 interno'}</span>`;
    const urg = it.urgente ? '<span class="urg2">URGENTE</span>' : '';
    const head = `<div class="req">${esc2(it.req)}<span class="y">/${esc2(it.ano)}</span></div>
      <div><div class="pac">${esc2(it.paciente)}${cl}${urg}</div>
      <div class="meta">${esc2(it.exame)}${tut}${vet}</div></div>`;
    if (s.st === 'feito') {
      const m = s.m; let act = '', tag = '';
      if (it.classe === 'apoio') {
        if (m.estado === 'separado') { tag = `<span class="dl ok">separado</span>`; act = `<button class="sepbtn env" data-act="enviar" data-k="${k}">📦 Enviar p/ apoio</button>`; }
        else if (m.estado === 'enviado') { tag = `<span class="dl ok">enviado ${m.data_env || ''}</span>`; act = `<button class="sepbtn rec" data-act="receber" data-k="${k}">✓ Resultado recebido</button>`; }
        else { tag = `<span class="dl done">✓ recebido</span>`; }
      } else { tag = `<span class="dl ok">✓ separado</span>`; }
      const undo = `<button class="sepbtn undo" data-act="voltar" data-k="${k}" title="desfazer 1 passo">↩</button>`;
      return `<div class="seprow donerow">${head}<div class="right2"><span class="byline">${esc2(m.por || '')}</span>${tag}${act}${undo}</div></div>`;
    }
    const dl = s.dl;
    const badge = s.st === 'atrasado' ? `<span class="dl late">⏰ atrasado</span>` : `<span class="dl ok">vence ${hhmm(dl)}</span>`;
    return `<div class="seprow">${head}<div class="right2">${badge}<button class="sepbtn go" data-act="separar" data-k="${k}">✓ Separar</button></div></div>`;
  }

  // ordena categorias seguindo a ORDEM da TV (familiaridade); fallback alfabético
  function catIdx(name) {
    try { if (typeof ORDER !== 'undefined' && typeof slug === 'function') { const i = ORDER.findIndex(o => slug(name).includes(slug(o))); return i < 0 ? 99 : i; } } catch (e) {}
    return 99;
  }
  function orderedCats(byCat) { return Object.keys(byCat).sort((a, b) => catIdx(a) - catIdx(b) || a.localeCompare(b)); }
  const rankSt = s => s === 'atrasado' ? 0 : s === 'noprazo' ? 1 : 2;

  function viewSeparar() {
    const byCat = {};
    itens().forEach(it => { (byCat[it.cat] = byCat[it.cat] || []).push(it); });
    const cats = orderedCats(byCat);
    if (!cats.length) return `<div class="sepwait">✓ Nada para separar no momento.</div>`;
    if (!selCat || !byCat[selCat]) selCat = cats[0];
    const strip = cats.map(c => {
      const arr = byCat[c];
      const pend = arr.filter(x => statusOf(x).st !== 'feito').length;
      const late = arr.filter(x => statusOf(x).st === 'atrasado').length;
      return `<div class="catpill ${c === selCat ? 'on' : ''} ${late ? 'haslate' : ''}" data-c="${esc2(c)}">
        <span class="nm">${esc2(c)}</span><span class="cc ${late ? 'late' : ''}">${pend}</span></div>`;
    }).join('');
    const arr = byCat[selCat];
    const pend = arr.filter(x => statusOf(x).st !== 'feito');
    const late = arr.filter(x => statusOf(x).st === 'atrasado').length;
    const ordered = [...arr].sort((a, b) => rankSt(statusOf(a).st) - rankSt(statusOf(b).st));
    return `<div class="catstrip">${strip}</div>
      <div class="sepcat"><div class="h"><span>${esc2(selCat)}</span>
        <span class="cnt">${pend.length} a separar${late ? ` · <b style="color:var(--red)">${late} atrasado${late > 1 ? 's' : ''}</b>` : ''} · ${arr.length} total</span></div>
        ${ordered.map(rowSeparar).join('')}</div>`;
  }

  function viewAndon() {
    const late = itens().filter(x => statusOf(x).st === 'atrasado');
    if (!late.length) return `<div class="andonempty">✓ Nenhuma amostra atrasada. Tudo separado no prazo! 🎉</div>`;
    const byCat = {}; late.forEach(it => { (byCat[it.cat] = byCat[it.cat] || []).push(it); });
    const cats = orderedCats(byCat);
    if (!selCatA || !byCat[selCatA]) selCatA = cats[0];
    const strip = cats.map(c => `<div class="catpill haslate ${c === selCatA ? 'on' : ''}" data-ca="${esc2(c)}">
        <span class="nm">${esc2(c)}</span><span class="cc late">${byCat[c].length}</span></div>`).join('');
    const arr = byCat[selCatA];
    const tot = late.length;
    const bar = `<div class="andonbar"><span class="ico">🚨</span><span class="ttl">${tot} AMOSTRA${tot > 1 ? 'S' : ''} ATRASADA${tot > 1 ? 'S' : ''} — SEPARAR AGORA</span></div>`;
    return bar + `<div class="catstrip">${strip}</div>
      <div class="sepcat andon"><div class="h"><span>🚨 ${esc2(selCatA)}</span>
        <span class="cnt">${arr.length} amostra${arr.length > 1 ? 's' : ''} não separada${arr.length > 1 ? 's' : ''}</span></div>
        ${arr.map(rowSeparar).join('')}</div>`;
  }

  const PISO_DAY = '2026-06-23';   // contagem oficial (string p/ comparar com dt)

  function viewPlacar() {
    const now = new Date(); const today = now.toISOString().slice(0, 10);
    const cutDay = period === 'hoje' ? today : period === '7d' ? new Date(now - 7 * 864e5).toISOString().slice(0, 10) : '0';
    const floor = cutDay > PISO_DAY ? cutDay : PISO_DAY;
    // denominador = UNIVERSO (tudo que precisava separar); numerador = separado no prazo. Não-separados PUXAM a nota pra baixo.
    const agg = {};
    universo().forEach(u => {
      const dia = (u.dt || '').slice(0, 10); if (!dia || dia < floor) return;
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
    const floor = cutDay > PISO_DAY ? cutDay : PISO_DAY;
    const rows = [];
    universo().forEach(u => {
      const dia = (u.dt || '').slice(0, 10); if (!dia || dia < floor) return;
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
    const cats = orderedCats(byCat);
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
    const pills = `<div class="catstrip">
      <div class="catpill ${!histCat ? 'on' : ''}" data-hc=""><span class="nm">Todas</span><span class="cc">${all.length}</span></div>`
      + cats.map(c => `<div class="catpill ${histCat === c ? 'on' : ''}" data-hc="${esc2(c)}"><span class="nm">${esc2(c)}</span><span class="cc">${byCat[c].length}</span></div>`).join('') + `</div>`;
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
      const status = r.sep
        ? `<span class="est separado">separado</span> <b>${esc2(r.m.por || '')}</b>${r.m.no_prazo === false ? ' <span class="dl late" style="padding:1px 5px">atraso</span>' : ''}`
        : `<span class="dl late" style="padding:2px 8px">✗ NÃO SEPARADO</span> <span style="color:var(--mut)">— setor ${esc2(r.cat)}</span>`;
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
    const cats = orderedCats(byCat);
    let list = (apCat ? within.filter(d => d.cat === apCat) : within).sort((a, b) => (b.ts || 0) - (a.ts || 0));
    const perLbl = { dia: 'Dia', semana: 'Semana', mes: 'Mês', ano: 'Ano', tudo: 'Tudo' };
    const perBtns = `<div class="perbtns">${['dia', 'semana', 'mes', 'ano', 'tudo'].map(p => `<div class="perbtn ${apPer === p ? 'on' : ''}" data-apper="${p}">${perLbl[p]}</div>`).join('')}</div>`;
    const pills = `<div class="catstrip"><div class="catpill ${!apCat ? 'on' : ''}" data-apc=""><span class="nm">Todas</span><span class="cc">${within.length}</span></div>`
      + cats.map(c => `<div class="catpill ${apCat === c ? 'on' : ''}" data-apc="${esc2(c)}"><span class="nm">${esc2(c)}</span><span class="cc">${byCat[c].length}</span></div>`).join('') + `</div>`;
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

  function render() {
    const el = $('sep'); if (!el) return;
    if (!sepData()) { el.innerHTML = header() + `<div class="sepwait">Aguardando a próxima atualização dos dados (o robô gera a lista de separação a cada 10 min).</div>`; wire(el); return; }
    let body = '';
    if (view === 'separar') body = viewSeparar();
    else if (view === 'andon') body = viewAndon();
    else if (view === 'placar') body = viewPlacar();
    else if (view === 'apagados') body = viewApagados();
    else body = viewHist();
    el.innerHTML = header() + `<div class="sepbody">${body}</div>`;
    wire(el);
  }

  function wire(el) {
    el.querySelectorAll('.septab').forEach(t => t.onclick = () => { view = t.dataset.v; render(); });
    const sm = $('sepme'); if (sm) sm.onchange = () => {
      if (sm.value === '__novo__') { const n = prompt('Seu nome ou iniciais:'); if (n && n.trim()) addUser(n); render(); return; }
      localStorage.setItem(MEK, sm.value); render();
    };
    el.querySelectorAll('.catpill[data-c]').forEach(p => p.onclick = () => { selCat = p.dataset.c; render(); });
    el.querySelectorAll('.catpill[data-ca]').forEach(p => p.onclick = () => { selCatA = p.dataset.ca; render(); });
    el.querySelectorAll('.catpill[data-hc]').forEach(p => p.onclick = () => { histCat = p.dataset.hc; render(); });
    el.querySelectorAll('.perbtn[data-hper]').forEach(p => p.onclick = () => { histPer = p.dataset.hper; render(); });
    el.querySelectorAll('.perbtn[data-hf]').forEach(p => p.onclick = () => { histFiltro = p.dataset.hf; render(); });
    const ab = $('adminbtn'); if (ab) ab.onclick = adminUnlock;
    el.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      const k = b.dataset.del;
      if (b.dataset.delkind === 'mark') { if (confirm('Desfazer esta marcação de "separado"? Volta a contar como não-separado.') && await post({ acao: 'desfazer', chave: k })) render(); }
      else { const row = histRows().find(r => r.chave === k); if (row && confirm('Apagar este NÃO-separado? Vai pro arquivo de Apagados (não some de vez). Sai do histórico e do placar.')) descartar([row]); }
    });
    const bb = $('histdelbatch'); if (bb) bb.onclick = () => {
      const all = histRows(); let m = histCat ? all.filter(r => r.cat === histCat) : all; m = m.filter(r => !r.sep);
      if (m.length && confirm(`Apagar ${m.length} não-separado(s) deste filtro de uma vez? Vão pro arquivo de Apagados.`)) descartar(m);
    };
    el.querySelectorAll('.perbtn[data-apper]').forEach(p => p.onclick = () => { apPer = p.dataset.apper; render(); });
    el.querySelectorAll('.catpill[data-apc]').forEach(p => p.onclick = () => { apCat = p.dataset.apc; render(); });
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
    // timer da Triagem só no modo sep
    if (m === 'sep') {
      await loadMarks(); render();
      if (timer) clearInterval(timer);
      // poupa créditos: só consulta com a aba VISÍVEL, a cada 60s (cliques continuam instantâneos via POST)
      timer = setInterval(async () => { if (MODE === 'sep' && !document.hidden) { await loadMarks(); render(); } }, 60000);
    } else if (timer) { clearInterval(timer); timer = null; }
    // delega os modos de cliente
    if (window.CLI) await window.CLI.onMode(m);
  }

  document.querySelectorAll('#modesw .msbtn').forEach(b => b.addEventListener('click', () => setMode(b.dataset.m)));
  // ao voltar o foco na aba, atualiza na hora (sensação de "ao vivo" sem ficar consultando à toa)
  document.addEventListener('visibilitychange', () => { if (!document.hidden && MODE === 'sep') loadMarks().then(render); });
  window.SEP = { setMode, render };
})();
