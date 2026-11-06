/* ============================================================
   Mesmo Paciente — lógica da aba do farejador (hospedada; carregada por <script src>).
   Edita aqui + deploy pela Action → as 4 mesas pegam no próximo load. Sem re-patch de mesa.
   Injeta as views no <main> (evita pai-oculto), define window.abrirProntuario/abrirCalibracao.
   ============================================================ */
(function () {
  if (window.__PU_LOADED) return; window.__PU_LOADED = true;
  var URL = 'https://lrwjcdvporaivxvfuiwt.supabase.co/rest/v1';
  var KEY = 'sb_publishable_fcodHc3AxR_HQ-aduMGzlg_CTBALng8';
  var HED = { apikey: KEY, Authorization: 'Bearer ' + KEY };
  var CAP = 150;
  var PU = { fila: [], entradas: [], stats: null, hist: [], tab: 'fila', sel: {} };

  function el(id) { return document.getElementById(id); }
  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function nf(n) { return (Number(n) || 0).toLocaleString('pt-BR'); }
  function main() { return document.querySelector('main') || document.body; }

  // ---- estilos próprios (pulse do botão + utilidades) ----
  (function () {
    var css = '@keyframes puPulse{0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,.6);transform:scale(1)}50%{box-shadow:0 0 20px 5px rgba(239,68,68,.9);transform:scale(1.06)}}'
      + '#btnProntuario.pu-pulse{background:#ef4444!important;color:#fff!important;animation:puPulse 1s ease-in-out infinite;font-weight:800}'
      + '#btnProntuario{white-space:nowrap} #btnProntuario .pu-badge{display:inline-block;min-width:20px;padding:0 7px;margin-left:6px;border-radius:11px;background:#fff;color:#ef4444;font-weight:800;font-size:13px;line-height:20px}'
      + '.pu-card{border:1px solid var(--line);border-left:4px solid var(--mut);border-radius:10px;padding:10px 12px;margin:6px 0;background:var(--panel2)}'
      + '.pu-card.quase{border-left-color:var(--warn)}'
      + '.pu-b{border:0;border-radius:7px;padding:7px 11px;cursor:pointer;font-size:13px;font-weight:700}'
      + '.pu-b.sim{background:#0d9488;color:#fff}.pu-b.nao{background:#1e293b;color:#cbd5e1;border:1px solid #334155}.pu-b.del{background:transparent;color:var(--mut);border:1px solid var(--line)}'
      + '.pu-tab{display:inline-block;padding:7px 14px;border-radius:9px 9px 0 0;cursor:pointer;font-weight:700;font-size:14px;color:var(--mut)}'
      + '.pu-tab.on{background:var(--panel2);color:var(--txt)}'
      + '.pu-batbar{position:sticky;top:0;z-index:5;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:8px 12px;margin:6px 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap}'
      + '.pu-hero{background:linear-gradient(135deg,rgba(13,148,136,.22),rgba(124,91,255,.12));border:1px solid var(--line);border-radius:14px;padding:15px 18px;margin:6px 0 14px}'
      + '.pu-hero h2{margin:0;font-size:19px;font-weight:800;letter-spacing:-.01em}.pu-hero p{margin:5px 0 0;font-size:13px;color:var(--mut);max-width:72ch}'
      + '.pu-pct{width:52px;height:52px;border-radius:50%;border:2.5px solid var(--c);color:var(--c);font-weight:800;font-size:18px;display:flex;align-items:center;justify-content:center;flex-shrink:0}'
      + '.pu-card.quase{box-shadow:0 0 0 1px rgba(245,158,11,.5),0 0 16px rgba(245,158,11,.20)}'
      + '.pu-b.sim{padding:9px 15px;font-size:14px;box-shadow:0 2px 12px rgba(13,148,136,.4)}.pu-b.sim:hover{filter:brightness(1.08)}'
      + '.pu-tile{border-radius:14px;padding:12px 16px;min-width:120px;border:1px solid var(--line);position:relative;overflow:hidden}.pu-tile b{font-size:26px;font-weight:800;display:block;line-height:1.1}.pu-tile span{font-size:11px;color:var(--mut)}'
      + '.pu-qzap{font-size:9px;font-weight:800;background:var(--warn);color:#111;padding:2px 6px;border-radius:5px;white-space:nowrap}'
      + '.pu-sub{background:linear-gradient(145deg,var(--panel),var(--panel2));border:1px solid var(--line);border-left:5px solid var(--line);border-radius:11px;padding:10px 13px;margin:6px 0;box-shadow:0 3px 9px rgba(0,0,0,.28)}'
      + '.pu-sub-t{font-size:11px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;margin-bottom:3px}'
      + '.pu-sub .pet{font-size:17px;font-weight:800;color:var(--txt);line-height:1.2}.pu-sub .dono{font-size:14.5px;color:var(--txt)}.pu-sub .meta{font-size:12px;color:var(--mut);margin-top:4px}.pu-sub .meta b{color:var(--brand)}'
      + '.pu-cli{font-size:12.5px;color:var(--txt);font-weight:600;text-align:right;margin-bottom:3px}.pu-cli .n{color:var(--mut);font-weight:400}';
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  })();

  // ---- injeta as views no main (fora de qualquer view oculta) ----
  function ensure() {
    var m = main();
    if (!el('puView')) {
      var v = document.createElement('div'); v.id = 'puView'; v.style.display = 'none';
      v.innerHTML = '<button class="back" onclick="window.goHome&&goHome()">← voltar</button>'
        + '<div class="pu-hero"><h2>🔗 Mesmo paciente, dois códigos</h2><p>Quando a recepção cadastra o mesmo bicho com <b>código diferente</b>, os resultados não pareiam. Você decide: <b style="color:var(--ok)">✓ mesmo</b> junta · <b>✕ diferentes</b> · <b>🗑 apagar</b>. O <b>nascimento</b> é o desempatador — tudo vai pro Histórico e é reversível.</p></div>'
        + '<div id="puWho" style="margin-bottom:8px"></div><div id="puTabs" style="margin-bottom:2px"></div><div id="puBody"></div>';
      m.appendChild(v);
    }
    if (!el('calibView')) {
      var c = document.createElement('div'); c.id = 'calibView'; c.style.display = 'none';
      c.innerHTML = '<button class="back" onclick="window.goHome&&goHome()">← voltar</button>'
        + '<div class="section-title">📊 Calibração — precisão por faixa</div>'
        + '<div style="font-size:13px;color:var(--mut);margin:-4px 0 12px;max-width:780px">Conforme a equipe decide, cada faixa ganha a precisão medida — mostra onde travar o corte.</div>'
        + '<div id="calibBody"></div>';
      m.appendChild(c);
    }
  }

  function hideFarejador() { // esconde home + todas as views do farejador
    var h = el('home'); if (h) h.style.display = 'none';
    document.querySelectorAll('main > [id$="View"]').forEach(function (e) { if (e.id !== 'puView' && e.id !== 'calibView') e.style.display = 'none'; });
  }
  function hideMine() { var a = el('puView'), b = el('calibView'); if (a) a.style.display = 'none'; if (b) b.style.display = 'none'; }

  // quando clicar em QUALQUER botão de nav do farejador (menos os meus), esconde as minhas views
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('button'); if (!b) return;
    if (b.id === 'btnProntuario' || b.id === 'btnCalib') return;
    if (b.closest('header')) hideMine();
  }, true);

  function quem() { try { return localStorage.getItem('pu_quem') || ''; } catch (e) { return ''; } }
  function pedirNome() { var n = prompt('Quem está conferindo? (seu nome)'); if (n && n.trim()) { try { localStorage.setItem('pu_quem', n.trim()); } catch (e) {} return n.trim(); } return ''; }

  // ================= FILA =================
  window.abrirProntuario = function () {
    ensure(); hideFarejador(); el('puView').style.display = 'block'; PU.tab = 'fila';
    el('puBody').innerHTML = '<div style="color:var(--mut);padding:14px">🔗 Carregando…</div>';
    Promise.all([
      fetch(URL + '/pu_candidatos?select=*&estado=eq.pendente&order=score.desc&limit=' + CAP, { headers: HED }).then(r => r.json()),
      fetch(URL + '/pu_entradas?select=*&order=score.desc', { headers: HED }).then(r => r.json()),
      fetch(URL + '/pu_stats?select=*&id=eq.1', { headers: HED }).then(r => r.json())
    ]).then(function (r) {
      PU.fila = Array.isArray(r[0]) ? r[0] : []; PU.entradas = Array.isArray(r[1]) ? r[1] : []; PU.stats = (Array.isArray(r[2]) && r[2][0]) || null; PU.sel = {};
      render(); badge();
    }).catch(function () { el('puBody').innerHTML = '<div style="color:var(--bad);padding:14px">Não consegui ler agora. <button class="btn ghost sm" onclick="abrirProntuario()">tentar de novo</button></div>'; });
  };

  function tabs() {
    el('puTabs').innerHTML = '<span class="pu-tab ' + (PU.tab === 'fila' ? 'on' : '') + '" onclick="puTab(\'fila\')">Fila</span>'
      + '<span class="pu-tab ' + (PU.tab === 'hist' ? 'on' : '') + '" onclick="puTab(\'hist\')">Histórico</span>';
  }
  window.puTab = function (t) { PU.tab = t; if (t === 'hist') loadHist(); else render(); };

  function quebra(br) { br = br || {}; var sg = function (v) { return v === '✓' ? '<span style="color:var(--ok)">✓</span>' : v === '✗' ? '<span style="color:var(--bad)">✗</span>' : v === '~' ? '<span style="color:var(--warn)">~</span>' : '<span style="color:var(--mut)">?</span>'; }; var pc = function (v) { return Math.round((Number(v) || 0) * 100) + '%'; }; return '<div style="font-size:11.5px;color:var(--mut);margin-top:4px">nome <b>' + pc(br.pet) + '</b> · dono <b>' + pc(br.dono) + '</b> · raça ' + sg(br.raca) + ' · sexo ' + sg(br.sexo) + ' · <b>nascimento ' + sg(br.nasc) + '</b></div>'; }
  function nasc(n) { return n ? esc(String(n).slice(0, 4) + '/' + String(n).slice(4, 6)) : '—'; }
  function linha(cod, pet, dono, raca, sexo, n, reqs) { var E = function (s) { s = esc(s).trim(); return s || '—'; }; return '<div style="font-size:13.5px;color:var(--txt)"><span style="color:var(--mut)">cód</span> <b style="color:var(--brand)">' + esc(cod) + '</b> · 🐾 <b>' + E(pet) + '</b> · ' + E(dono) + ' · ' + E(raca) + ' · ' + E(sexo) + ' <span style="color:var(--mut)">· nasc ' + nasc(n) + ' · ' + (reqs || 0) + ' req</span></div>'; }

  function origemInfo(o) { o = Number(o); if (o === 1) return { lbl: '🔵 FAREJADOR', col: '#3b82f6' }; if (o === 0) return { lbl: '🟠 HF', col: '#f59e0b' }; return { lbl: '', col: 'var(--line)' }; }
  function sub(cod, pet, dono, raca, sexo, n, reqs, origem, cli) {
    var oi = origemInfo(origem), E = function (s) { s = esc(s).trim(); return s || '—'; };
    return '<div class="pu-sub" style="border-left-color:' + oi.col + '">'
      + (oi.lbl ? '<div class="pu-sub-t" style="color:' + oi.col + '">' + oi.lbl + '</div>' : '')
      + '<div class="pet">🐾 ' + E(pet) + '</div>'
      + '<div class="dono">' + E(dono) + '</div>'
      + '<div class="meta"><b>cód HF ' + esc(cod) + '</b> · ' + E(raca) + ' · ' + E(sexo) + ' · nasc ' + nasc(n) + ' · ' + (reqs || 0) + ' req' + (cli ? ' · 🏥 ' + E(cli) : '') + '</div>'
      + '</div>';
  }
  function cardFila(c) {
    var sc = Number(c.score) || 0, pct = Math.round(sc * 100), qc = c.quase, chk = !!PU.sel[c.par_id], P = esc(c.par_id);
    var col = qc ? '#f59e0b' : (pct >= 80 ? '#eab308' : 'var(--mut)');
    var cliN = c.a_cli || c.b_cli;
    var cliLine = cliN ? '🏥 ' + esc(cliN) + ' <span class="n">(#' + esc(c.cc) + ' · ' + esc(c.esp) + ')</span>' : 'clínica #' + esc(c.cc) + ' · ' + esc(c.esp);
    return '<div class="pu-card' + (qc ? ' quase' : '') + '" style="display:flex;gap:13px;align-items:flex-start">'
      + '<div style="display:flex;flex-direction:column;align-items:center;gap:6px">'
      + '<input type="checkbox" ' + (chk ? 'checked' : '') + ' onclick="puSel(\'' + P + '\')" style="transform:scale(1.25);cursor:pointer">'
      + '<div class="pu-pct" style="--c:' + col + '">' + pct + '</div>'
      + (qc ? '<span class="pu-qzap" style="text-align:center;line-height:1.1">QUASE<br>CERTO</span>' : '')
      + '</div>'
      + '<div style="flex:1;min-width:0">'
      + '<div class="pu-cli">' + cliLine + '</div>'
      + sub(c.a_cod, c.a_pet, c.a_dono, c.a_raca, c.a_sexo, c.a_nasc, c.a_reqs, c.a_origem, c.a_cli)
      + sub(c.b_cod, c.b_pet, c.b_dono, c.b_raca, c.b_sexo, c.b_nasc, c.b_reqs, c.b_origem, c.b_cli)
      + quebra(c.br)
      + '<div style="display:flex;gap:6px;margin-top:9px;flex-wrap:wrap">'
      + '<button class="pu-b sim" onclick="puAct(\'' + P + '\',\'mesmo\')">✓ mesmo — juntar</button>'
      + '<button class="pu-b nao" onclick="puAct(\'' + P + '\',\'diferente\')">✕ são diferentes</button>'
      + '<button class="pu-b del" onclick="puAct(\'' + P + '\',\'apagado\')">🗑 apagar</button>'
      + '</div></div></div>';
  }

  function render() {
    tabs();
    var st = PU.stats, fila = PU.fila, ent = PU.entradas;
    var tile = function (n, l, c) { return '<div class="pu-tile" style="background:linear-gradient(135deg,' + c + '26,transparent 70%)"><b style="color:' + c + '">' + n + '</b><span>' + l + '</span></div>'; };
    var topo = st ? '<div style="display:flex;gap:10px;flex-wrap:wrap;margin:8px 0 12px">'
      + tile(nf(st.n_pac), 'pacientes', '#8b7bff') + tile(nf(st.n_voltam), 'voltaram', '#38bdf8')
      + tile(nf(st.n_fila), 'suspeitas', '#f59e0b') + tile(nf(st.n_merges), 'resolvidas', '#34d399') + '</div>' : '';
    // entradas de hoje
    var secEnt = '';
    if (ent.length) {
      secEnt = '<div style="margin-bottom:14px"><div style="font-size:14px;font-weight:800;color:var(--warn)">🔔 Entraram HOJE e já têm código (' + ent.length + ')</div>'
        + ent.map(function (e) { return '<div class="pu-card quase"><div style="display:flex;justify-content:space-between"><div style="font-size:14px"><b>🐾 ' + esc(e.pet) + '</b> · ' + esc(e.dono) + '</div><div style="font-weight:800;color:var(--warn)">' + Math.round((Number(e.score) || 0) * 100) + '%</div></div><div style="font-size:12.5px;color:var(--txt);margin-top:3px">entrou hoje como <b style="color:var(--brand)">cód ' + esc(e.novo_cod) + '</b> → já existe <b style="color:var(--brand)">cód ' + esc(e.match_cod) + '</b> (' + (e.hist_reqs || 0) + ' req)</div>' + quebra(e.br)
          + '<div style="display:flex;gap:6px;margin-top:8px"><button class="pu-b sim" onclick="puAct(\'' + esc(e.par_id) + '\',\'mesmo\')">✓ mesmo</button><button class="pu-b nao" onclick="puAct(\'' + esc(e.par_id) + '\',\'diferente\')">✕ diferentes</button><button class="pu-b del" onclick="puAct(\'' + esc(e.par_id) + '\',\'apagado\')">🗑 apagar</button></div></div>'; }).join('') + '</div>';
    }
    // barra de lote
    var nsel = Object.keys(PU.sel).length;
    var bat = nsel ? '<div class="pu-batbar"><b>' + nsel + ' selecionado' + (nsel > 1 ? 's' : '') + '</b>'
      + '<button class="pu-b nao" onclick="puBatch(\'diferente\')">✕ marcar diferentes</button>'
      + '<button class="pu-b del" onclick="puBatch(\'apagado\')">🗑 apagar em lote</button>'
      + '<button class="pu-b" style="background:transparent;color:var(--mut)" onclick="puSelNone()">limpar seleção</button></div>' : '';
    var totFila = st ? nf(st.n_fila) : fila.length;
    var note = (st && st.n_fila > fila.length) ? ' <span style="font-weight:400;color:var(--mut)">· mostrando as ' + fila.length + ' de maior %</span>' : '';
    var head = '<div style="display:flex;justify-content:space-between;align-items:center;margin:6px 0 2px"><span style="font-size:14px;font-weight:800">Fila — código duplicado (' + totFila + ')' + note + '</span>'
      + (fila.length ? '<button class="btn ghost sm" onclick="puSelAll()">selecionar todos (' + fila.length + ')</button>' : '') + '</div>';
    el('puBody').innerHTML = topo + secEnt + bat + head + (fila.length ? fila.map(cardFila).join('') : '<div style="color:var(--mut);padding:10px">✓ Nada na fila agora.</div>');
    whoBar();
  }
  function whoBar() { var q = quem(); el('puWho').innerHTML = q ? '<span style="font-size:13px;color:var(--mut)">Conferindo como <b style="color:var(--txt)">' + esc(q) + '</b></span> <button class="btn ghost sm" onclick="puTrocar()">trocar</button>' : '<span style="font-size:12.5px;color:var(--mut)">As decisões ficam registradas no seu nome (pergunto na 1ª vez).</span>'; }
  window.puTrocar = function () { pedirNome(); whoBar(); };

  window.puSel = function (par) { if (PU.sel[par]) delete PU.sel[par]; else PU.sel[par] = 1; render(); };
  window.puSelAll = function () { PU.fila.forEach(function (c) { PU.sel[c.par_id] = 1; }); render(); };
  window.puSelNone = function () { PU.sel = {}; render(); };

  function rpc(par, dec, por) { return fetch(URL + '/rpc/pu_decidir', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, HED), body: JSON.stringify({ p_par_id: par, p_decisao: dec, p_por: por }) }).then(function (r) { if (!r.ok) throw new Error(); }); }

  window.puAct = function (par, dec) {
    var q = quem() || pedirNome(); if (!q) return;
    PU.fila = PU.fila.filter(function (c) { return String(c.par_id) !== String(par); });
    PU.entradas = PU.entradas.filter(function (c) { return String(c.par_id) !== String(par); });
    delete PU.sel[par]; render();
    rpc(par, dec, q).catch(function () { alert('Não consegui salvar — recarregando.'); abrirProntuario(); });
  };
  window.puBatch = function (dec) {
    var q = quem() || pedirNome(); if (!q) return;
    var pars = Object.keys(PU.sel); if (!pars.length) return;
    if (dec === 'apagado' && !confirmBox(pars.length + ' par(es) vão pra lista de Apagados (reversível). Confirmar?')) return;
    PU.fila = PU.fila.filter(function (c) { return !PU.sel[c.par_id]; });
    PU.sel = {}; render();
    pars.forEach(function (p) { rpc(p, dec, q); });
  };
  function confirmBox(m) { return window.confirm ? window.confirm(m) : true; }

  // ================= HISTÓRICO =================
  function loadHist() {
    ensure(); el('puBody').innerHTML = '<div style="color:var(--mut);padding:14px">Carregando histórico…</div>'; tabs();
    fetch(URL + '/pu_candidatos?select=*&estado=neq.pendente&order=decidido_em.desc&limit=3000', { headers: HED }).then(r => r.json()).then(function (d) {
      PU.hist = Array.isArray(d) ? d : []; renderHist();
    }).catch(function () { el('puBody').innerHTML = '<div style="color:var(--bad);padding:14px">Não consegui ler o histórico.</div>'; });
  }
  function renderHist() {
    var g = { mesmo: [], diferente: [], apagado: [] };
    PU.hist.forEach(function (c) { (g[c.estado] || (g[c.estado] = [])).push(c); });
    var sec = function (key, titulo, cor) {
      var arr = g[key] || [];
      var cards = arr.slice(0, 200).map(function (c) {
        return '<div class="pu-card" style="border-left-color:' + cor + '"><div style="display:flex;justify-content:space-between"><span style="font-size:13px;color:var(--mut)">' + Math.round((Number(c.score) || 0) * 100) + '% · clín ' + esc(c.cc) + ' · ' + esc(c.decidido_por || '') + '</span><button class="pu-b" style="background:transparent;color:var(--brand);border:1px solid var(--line)" onclick="puAct(\'' + esc(c.par_id) + '\',\'pendente\')">↩ voltar pra fila</button></div>'
          + '<div style="font-size:13px;margin-top:3px">🐾 <b>' + esc(c.a_pet) + '</b> (cód ' + esc(c.a_cod) + ') · <b>' + esc(c.b_pet) + '</b> (cód ' + esc(c.b_cod) + ')</div></div>';
      }).join('');
      return '<div style="margin-top:14px"><div style="font-size:14px;font-weight:800;color:' + cor + '">' + titulo + ' (' + arr.length + ')</div>' + (arr.length ? cards + (arr.length > 200 ? '<div style="color:var(--mut);font-size:12px;padding:6px">mostrando 200 de ' + arr.length + '</div>' : '') : '<div style="color:var(--mut);padding:8px;font-size:13px">nada aqui ainda</div>') + '</div>';
    };
    el('puBody').innerHTML = '<div style="font-size:13px;color:var(--mut);margin:8px 0">Tudo que foi decidido — reversível (↩ volta pra fila).</div>'
      + sec('mesmo', '✓ Mesmo paciente (juntados)', 'var(--ok)')
      + sec('diferente', '✕ São diferentes', 'var(--bad)')
      + sec('apagado', '🗑 Apagados', 'var(--mut)');
  }

  // ================= CALIBRAÇÃO =================
  window.abrirCalibracao = function () {
    ensure(); hideFarejador(); el('calibView').style.display = 'block';
    el('calibBody').innerHTML = '<div style="color:var(--mut);padding:14px">📊 Carregando…</div>';
    var B = [[95, 101], [90, 95], [85, 90], [80, 85], [75, 80]];
    Promise.all([
      fetch(URL + '/pu_candidatos?select=score,estado&estado=neq.pendente&limit=100000', { headers: HED }).then(r => r.json()),
      fetch(URL + '/pu_stats?select=*&id=eq.1', { headers: HED }).then(r => r.json()),
      Promise.all(B.map(function (b) { return fetch(URL + '/pu_candidatos?select=par_id&estado=eq.pendente&score=gte.' + (b[0] / 100) + '&score=lt.' + (b[1] / 100), { headers: Object.assign({ Prefer: 'count=exact', Range: '0-0' }, HED) }).then(function (x) { var cr = x.headers.get('content-range') || '/0'; return Number(cr.split('/')[1] || 0); }); }))
    ]).then(function (r) { calibRender(Array.isArray(r[0]) ? r[0] : [], (Array.isArray(r[1]) && r[1][0]) || null, r[2], B); })
      .catch(function () { el('calibBody').innerHTML = '<div style="color:var(--bad);padding:14px">Não consegui ler.</div>'; });
  };
  function calibRender(dec, st, pend, B) {
    var cor = function (p) { return p >= 0.9 ? 'var(--ok)' : p >= 0.75 ? 'var(--warn)' : 'var(--bad)'; };
    var nM = dec.filter(function (x) { return x.estado === 'mesmo'; }).length, nD = dec.length, pG = nD ? Math.round(100 * nM / nD) : 0;
    var tile = function (n, l) { return '<div style="background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:11px 15px;min-width:116px"><div style="font-size:22px;font-weight:800">' + n + '</div><div style="font-size:11px;color:var(--mut)">' + l + '</div></div>'; };
    var band = function (lbl, sub, w, c, pct, right) { return '<div style="display:grid;grid-template-columns:84px 1fr 120px;gap:12px;align-items:center;padding:10px 0;border-top:1px solid var(--line)"><div style="font-weight:700;font-size:14px">' + lbl + (sub ? '<div style="font-weight:400;color:var(--mut);font-size:11px">' + sub + '</div>' : '') + '</div><div style="position:relative;height:22px;background:var(--panel2);border-radius:6px;overflow:hidden"><div style="position:absolute;top:0;bottom:0;left:0;width:' + Math.max(w, 2) + '%;background:' + c + '"></div><span style="position:absolute;right:8px;top:50%;transform:translateY(-50%);font-size:12.5px;font-weight:700">' + pct + '</span></div><div style="font-size:12.5px;color:var(--mut);text-align:right">' + right + '</div></div>'; };
    var tiles = '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">' + tile(st ? nf(st.n_pac) : '—', 'pacientes') + tile(st ? nf(st.n_fila) : '—', 'na fila') + tile(nf(nD), 'decididos') + tile(nD ? pG + '%' : '—', '% era o mesmo') + '</div>';
    var byB = B.map(function (b) { var inb = dec.filter(function (x) { var p = x.score * 100; return p >= b[0] && p < b[1]; }); var m = inb.filter(function (x) { return x.estado === 'mesmo'; }).length, df = inb.filter(function (x) { return x.estado === 'diferente'; }).length, t = m + df; return { lo: b[0], hi: b[1], m: m, t: t, prec: t ? m / t : null }; });
    var prec = nD ? byB.map(function (b) { var lbl = b.hi > 100 ? '≥95%' : b.lo + '–' + b.hi + '%'; if (!b.t) return band(lbl, 'sem votos', 0, 'transparent', '—', '—'); var p = Math.round(b.prec * 100); return band(lbl, b.t + ' decidido' + (b.t > 1 ? 's' : ''), p, cor(b.prec), p + '%', '<b style="color:var(--ok)">' + b.m + '</b>/' + b.t); }).join('') : '<div style="color:var(--mut);padding:14px">Ainda <b>sem decisões</b>. Conforme a equipe decide, a precisão aparece aqui.</div>';
    var mp = Math.max.apply(null, [1].concat(pend));
    var pn = B.map(function (b, i) { var lbl = b[1] > 100 ? '≥95%' : b[0] + '–' + b[1] + '%', n = pend[i] || 0; return band(lbl, '', Math.round(100 * n / mp), 'var(--brand)', nf(n), 'aguardando'); }).join('');
    el('calibBody').innerHTML = tiles + '<div style="font-weight:700;font-size:14px">Precisão por faixa</div>' + prec + '<div style="font-weight:700;font-size:14px;margin:18px 0 2px">Fila por faixa</div>' + pn;
  }

  // ================= BADGE =================
  function badge() {
    var bp = el('btnProntuario'); if (!bp) return;
    fetch(URL + '/pu_stats?select=n_fila,n_entradas_hoje&id=eq.1', { headers: HED }).then(r => r.json()).then(function (s) {
      s = (Array.isArray(s) && s[0]) || null; var hoje = s ? Number(s.n_entradas_hoje || 0) : 0, fila = s ? Number(s.n_fila || 0) : 0, n = hoje || fila;
      if (n > 0) { bp.classList.add('pu-pulse'); bp.innerHTML = '🔗 Mesmo Paciente <span class="pu-badge">' + (hoje > 0 ? '🔔' + hoje : nf(fila)) + '</span>'; }
      else { bp.classList.remove('pu-pulse'); bp.innerHTML = '🔗 Mesmo Paciente'; }
    }).catch(function () {});
  }
  function boot() { ensure(); badge(); }
  if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(boot, 50); else window.addEventListener('load', boot);
  setInterval(badge, 240000);
})();
