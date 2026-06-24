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
  let selCat = '';                // categoria selecionada (abas do Separar)
  let selCatA = '';               // categoria selecionada (abas do Atrasados/Andon)
  let histCat = '', histPer = 'dia'; // filtro do Histórico: categoria + período (dia/semana/mes/tudo)
  let timer = null;

  const $ = id => document.getElementById(id);
  const esc2 = s => (typeof esc === 'function' ? esc(s) : String(s == null ? '' : s));
  const sepData = () => (typeof DATA !== 'undefined' && DATA && DATA.separacao) ? DATA.separacao : null;
  const cutoffs = () => { const d = sepData(); return (d && d.cutoffs && d.cutoffs.length) ? [...d.cutoffs].sort((a, b) => a - b) : [15, 21]; };
  const itens = () => { const d = sepData(); return d && d.itens ? d.itens : []; };
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
    try { const r = await fetch(API + '?_=' + Date.now()); if (r.ok) { const j = await r.json(); marks = {}; (j.marks || []).forEach(m => marks[m.chave] = m); } } catch (e) {}
  }
  async function post(payload) {
    try {
      const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, senha: window.__pwd }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { alert(j.erro || 'Não foi possível salvar.'); return false; }
      marks = {}; (j.marks || []).forEach(m => marks[m.chave] = m); return true;
    } catch (e) { alert('Erro de conexão.'); return false; }
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
    return `<div class="sephead">
      <div class="septabs">
        <div class="septab ${view === 'separar' ? 'on' : ''}" data-v="separar">🧪 Separar <span class="c">${pend}</span></div>
        <div class="septab andon ${view === 'andon' ? 'on' : ''}" data-v="andon">🚨 Atrasados <span class="c">${andon}</span></div>
        <div class="septab ${view === 'placar' ? 'on' : ''}" data-v="placar">🏆 Placar</div>
        <div class="septab ${view === 'hist' ? 'on' : ''}" data-v="hist">📋 Histórico</div>
      </div>
      <div class="sepme">Você:
        <select id="sepme"><option value="">— escolher —</option>${opts}<option value="__novo__">＋ adicionar nome…</option></select>
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

  function viewPlacar() {
    const now = new Date(); const today = now.toISOString().slice(0, 10);
    const cut = period === 'hoje' ? today : period === '7d' ? new Date(now - 7 * 864e5).toISOString().slice(0, 10) : '0';
    // numerador/denominador a partir das marcações (pontualidade da separação)
    const agg = {};
    Object.values(marks).forEach(m => {
      if (!m.ts_sep || m.ts_sep < PISO_OFICIAL) return;   // treino (antes do piso) não conta
      const dia = new Date(m.ts_sep).toISOString().slice(0, 10);
      if (dia < cut) return;
      const a = agg[m.cat] = agg[m.cat] || { cat: m.cat, total: 0, ok: 0 };
      a.total++; if (m.no_prazo) a.ok++;
    });
    // atrasados em aberto agora (não separados) por categoria — pra ninguém esconder
    const open = {}; itens().forEach(it => { if (statusOf(it).st === 'atrasado') open[it.cat] = (open[it.cat] || 0) + 1; });
    Object.keys(open).forEach(c => { agg[c] = agg[c] || { cat: c, total: 0, ok: 0 }; });
    const rows = Object.values(agg).map(a => ({ ...a, pct: a.total ? Math.round(100 * a.ok / a.total) : (open[a.cat] ? 0 : 100), aberto: open[a.cat] || 0 }))
      .sort((x, y) => y.pct - x.pct || y.total - x.total || x.aberto - y.aberto);
    // medalha só para quem realmente separou algo no período; senão, posição numérica
    let podium = 0;
    const medal = r => (r.total > 0 && ++podium <= 3) ? (podium === 1 ? '🥇' : podium === 2 ? '🥈' : '🥉') : '·';
    const per = `<div class="perbtns">
      <div class="perbtn ${period === 'hoje' ? 'on' : ''}" data-per="hoje">Hoje</div>
      <div class="perbtn ${period === '7d' ? 'on' : ''}" data-per="7d">7 dias</div>
      <div class="perbtn ${period === 'tudo' ? 'on' : ''}" data-per="tudo">Tudo</div></div>`;
    const champCat = (rows.find(r => r.total > 0) || {}).cat;
    const body = rows.length ? rows.map((r) => { const win = r.cat && r.cat === champCat; return `<div class="plrow ${win ? 'winner' : ''}">
        <div class="pos">${medal(r)}</div>
        <div><div class="nm">${esc2(r.cat)}${win ? ' 🎆🎉<span class="champ">PARABÉNS!</span>' : ''}</div>
          <div class="barwrap"><i style="width:${r.pct}%"></i></div>
          <div class="sub">${r.ok}/${r.total} no prazo${r.aberto ? ` · <b style="color:var(--red)">${r.aberto} em aberto atrasado</b>` : ''}</div></div>
        <div></div>
        <div><div class="pct" style="color:${r.pct >= 80 ? 'var(--green)' : r.pct >= 50 ? 'var(--amber)' : 'var(--red)'}">${r.pct}%</div><div class="sub">no prazo</div></div>
      </div>`; }).join('') : `<div class="sepwait">Sem separações registradas no período.</div>`;
    return `<div class="histfilt"><b style="font-size:15px">🏆 Pontualidade da separação por setor</b>${per}</div>${body}`;
  }

  function viewHist() {
    const now = Date.now();
    const cut = histPer === 'dia' ? new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00').getTime()
      : histPer === 'semana' ? now - 7 * 864e5
        : histPer === 'mes' ? now - 30 * 864e5 : 0;
    let ms = Object.values(marks).filter(m => m.ts_sep && m.ts_sep >= PISO_OFICIAL && m.ts_sep >= cut).sort((a, b) => b.ts_sep - a.ts_sep);
    const byCat = {}; ms.forEach(m => { (byCat[m.cat] = byCat[m.cat] || []).push(m); });
    const cats = orderedCats(byCat);
    const perLbl = { dia: 'Dia', semana: 'Semana', mes: 'Mês', tudo: 'Tudo' };
    const perBtns = `<div class="perbtns">${['dia', 'semana', 'mes', 'tudo'].map(p => `<div class="perbtn ${histPer === p ? 'on' : ''}" data-hper="${p}">${perLbl[p]}</div>`).join('')}</div>`;
    const pills = `<div class="catstrip">
      <div class="catpill ${!histCat ? 'on' : ''}" data-hc=""><span class="nm">Todas</span><span class="cc">${ms.length}</span></div>`
      + cats.map(c => `<div class="catpill ${histCat === c ? 'on' : ''}" data-hc="${esc2(c)}"><span class="nm">${esc2(c)}</span><span class="cc">${byCat[c].length}</span></div>`).join('') + `</div>`;
    const shown = histCat ? ms.filter(m => m.cat === histCat) : ms;
    const head = `<div class="histfilt"><b style="font-size:15px">📋 Histórico de separações</b>${perBtns}
      <span style="margin-left:auto;color:var(--mut);font-size:12px">${shown.length} registro${shown.length !== 1 ? 's' : ''}</span></div>${pills}`;
    if (!shown.length) return head + `<div class="sepwait">Nenhuma separação registrada nesse período${histCat ? ' nessa categoria' : ''}.</div>`;
    const fmt = ts => { const d = new Date(ts); return d.toLocaleDateString('pt-BR') + ' ' + d.toTimeString().slice(0, 5); };
    const ms2 = shown;
    const rows = ms2.map(m => `<tr>
      <td style="white-space:nowrap">${fmt(m.ts_sep)}</td>
      <td style="color:var(--cyan);font-weight:700">${esc2(m.req)}/${esc2(m.ano)}</td>
      <td>${esc2(m.paciente)}</td>
      <td style="color:var(--mut)">${esc2(m.exame)}</td>
      <td>${esc2(m.cat)}</td>
      <td><span class="cl ${m.classe}">${m.classe === 'apoio' ? '📦' : '🏠'}</span></td>
      <td>${esc2(m.por)}${m.no_prazo === false ? ' <span class="dl late" style="padding:1px 5px">atraso</span>' : ''}</td>
      <td><span class="est ${m.estado}">${m.estado}</span>${m.data_env ? `<div style="font-size:10px;color:var(--mut)">env ${m.data_env}</div>` : ''}</td>
    </tr>`).join('');
    return head + `<table class="htable"><thead><tr>
      <th>Quando</th><th>Req</th><th>Paciente</th><th>Exame</th><th>Categoria</th><th>Tipo</th><th>Quem separou</th><th>Estado</th>
      </tr></thead><tbody>${rows}</tbody></table>`;
  }

  function render() {
    const el = $('sep'); if (!el) return;
    if (!sepData()) { el.innerHTML = header() + `<div class="sepwait">Aguardando a próxima atualização dos dados (o robô gera a lista de separação a cada 10 min).</div>`; wire(el); return; }
    let body = '';
    if (view === 'separar') body = viewSeparar();
    else if (view === 'andon') body = viewAndon();
    else if (view === 'placar') body = viewPlacar();
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
