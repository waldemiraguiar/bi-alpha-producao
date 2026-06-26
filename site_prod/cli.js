/* Modos CLIENTES VIGIADOS — isolados do painel.
   🔴 Sensível  = time de ATENDIMENTO/call center → alerta mostra SÓ o nome da clínica (sem produção).
   🟡 Atenção   = time de PRODUÇÃO → alerta mostra TODOS os dados (paciente/registro/vet) p/ check-in antes de liberar.
   Sub-abas: 🔔 Alertas (acende quando a clínica cadastrada entra no HF) · 📋 Cadastrados (público: qualquer um cadastra/remove).
   Acende via DATA.clientes.reqs (10/10 min). Baixa manual. Persiste em /api/clientes. */
(function () {
  const API = '/api/clientes';
  const MEK = 'sep_me';
  let classe = null, cliView = 'alertas';
  let flags = [], baixas = [], term = '', timer = null, sub = null;
  const useSupa = () => window.SUPA && window.SUPA.ok;

  const $ = id => document.getElementById(id);
  const esc2 = s => (typeof esc === 'function' ? esc(s) : String(s == null ? '' : s));
  const escA = s => esc2(s).replace(/"/g, '&quot;');
  const cliData = () => (typeof DATA !== 'undefined' && DATA && DATA.clientes) ? DATA.clientes : null;
  const me = () => localStorage.getItem(MEK) || 'equipe';

  async function load() {
    try {
      if (useSupa()) { const j = await window.SUPA.loadCli(); flags = j.flags || []; baixas = j.cli_baixas || []; return; }
      const r = await fetch('/api/overlays?_=' + Date.now()); if (r.ok) { const j = await r.json(); flags = j.flags || []; baixas = j.cli_baixas || []; }
    } catch (e) {}
  }
  async function post(p) {
    try {
      if (useSupa()) {
        if (p.acao === 'flag') await window.SUPA.upsertFlag({ cod: String(p.cod), nome: p.nome || '', classe: p.classe, por: p.por || 'equipe', ts: Date.now() });
        else if (p.acao === 'desflag') await window.SUPA.delFlag(p.cod);
        else if (p.acao === 'baixa') {
          const chaves = p.chaves || [p.chave];
          await window.SUPA.baixaCli(chaves.map(ch => ({ chave: ch, cod: String(p.cod || ''), classe: p.classe, cliente: p.cliente || '', req: p.req || null, ano: p.ano || null, paciente: p.paciente || '', por: p.por || 'equipe', ts: Date.now() })));
        }
        await load(); return true;
      }
      const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...p, senha: window.__pwd }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { alert(j.erro || 'Não foi possível salvar.'); return false; }
      flags = j.flags || flags; baixas = j.baixas || baixas; return true;
    } catch (e) { alert('Erro ao salvar (Supabase).'); return false; }
  }

  const myFlags = () => flags.filter(f => f.classe === classe);
  const flaggedCods = () => new Set(myFlags().map(f => String(f.cod)));
  const baixadas = () => new Set(baixas.map(b => b.chave));
  const espBaixadas = () => new Set(baixas.filter(b => b.classe === 'esp').map(b => b.chave)); // check-ins "conferi" dos especializados
  function alertReqs() {
    const d = cliData(); if (!d) return [];
    const cods = flaggedCods(), bx = baixadas();
    return (d.reqs || []).filter(r => cods.has(String(r.cod)) && !bx.has(`${r.req}-${r.ano}`)).sort((a, b) => (b.dt || '').localeCompare(a.dt || ''));
  }
  // pendente RELEVANTE na Atenção = exame em processo E não-especializado (especializado mora na aba Especializados)
  const pendOf = r => (r.exames || []).filter(e => e.proc && !e.esp);
  // só mostra a req na Atenção se tiver algo pendente de 1-2 dias (ou se não veio a lista de exames = dado antigo)
  const atencaoReqs = () => alertReqs().filter(r => !r.exames || pendOf(r).length > 0);
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
      const leg = `<div class="seplegend"><b style="color:var(--amber)">🟡 Amarelo</b> = clínica sensível só de olho · <b style="color:var(--red)">🔴 vermelho + fogos</b> = entrou exame no HF. A baixa volta pro amarelo.</div>`;
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
    const leg = `<div class="seplegend atrasado">🟡 Confira e libere cada exame (check-in, baixa <b>manual</b>). Não liberou → <b style="color:var(--red)">🔴 loucura total</b> até alguém liberar.</div>`;
    const reqs = atencaoReqs();
    if (!reqs.length) return leg + `<div class="sepwait" style="padding:30px">Nenhum exame de liberação rápida pendente agora. (Especializados ficam na aba 🟡 Atenção·Especializados.)</div>`;
    const todayStr = new Date().toISOString().slice(0, 10);
    const esq = [], hj = [];
    reqs.forEach(r => { const d = (r.dt || '').slice(0, 10); (d && d < todayStr ? esq : hj).push(r); });
    const card = (r, esquecido) => {
      const dt = r.dt ? new Date(r.dt.replace(' ', 'T')) : null;
      const when = dt && !isNaN(dt) ? dt.toLocaleDateString('pt-BR') + ' ' + dt.toTimeString().slice(0, 5) : '';
      const chave = `${r.req}-${r.ano}`;
      const diasAtras = dt && !isNaN(dt) ? Math.max(1, Math.floor((Date.now() - dt.getTime()) / 864e5)) : 1;
      const txtEsq = diasAtras === 1 ? 'ESQUECIDO DE ONTEM' : `ESQUECIDO HÁ ${diasAtras} DIAS`;
      const flag = esquecido ? `<div style="display:flex;align-items:center;gap:8px;margin-bottom:3px"><span class="fw1">🎆</span><span class="fw2">🎇</span><span style="font-size:12.5px;font-weight:900;letter-spacing:.04em;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.6)">⚠️ ${txtEsq} — LIBERE AGORA!</span><span class="fw3">🎆</span></div>` : '';
      const exs = r.exames || [];
      const pendEx = exs.filter(e => e.proc && !e.esp);
      const nLib = exs.filter(e => !e.proc).length;
      const nEsp = exs.filter(e => e.esp && e.proc).length;
      const exHtml = (pendEx.length || nLib || nEsp) ? `<div class="meta" style="margin-top:4px">${pendEx.length ? '🧪 ' + pendEx.map(e => `<b>${esc2(e.exame)}</b>`).join(' · ') : ''}${nLib ? ` <span style="opacity:.55">· ✅ ${nLib} liberado${nLib > 1 ? 's' : ''}</span>` : ''}${nEsp ? ` <span style="opacity:.7">· 🔬 ${nEsp} especializado${nEsp > 1 ? 's' : ''} (aba Especializados)</span>` : ''}</div>` : '';
      return `<div class="alertcard atencao ${esquecido ? 'esquecido' : ''}">
        <div style="min-width:0">${flag}<div class="cli">🟡 ${esc2(r.cliente)}</div>
          <div class="big2">🐾 ${esc2(r.paciente)} &nbsp; <span class="reg">Reg ${esc2(r.req)}/${esc2(r.ano)}</span></div>
          <div class="meta">${r.vet ? `vet ${esc2(r.vet)} · ` : ''}${when}</div>${exHtml}</div>
        <button class="baixab" data-baixa="${chave}" data-cod="${escA(r.cod)}" data-cliente="${escA(r.cliente)}" data-req="${escA(r.req)}" data-ano="${escA(r.ano)}" data-paciente="${escA(r.paciente)}">✓ liberar</button>
      </div>`;
    };
    let html = leg;
    if (esq.length) html += `<h3 style="font-size:13px;font-weight:900;color:var(--red);margin:6px 0 10px;letter-spacing:.03em">🔴 ${esq.length} ESQUECIDO${esq.length > 1 ? 'S' : ''} DE ONTEM — LIBERE JÁ!</h3>` + esq.map(r => card(r, true)).join('');
    if (hj.length) html += `<h3 style="font-size:12px;color:var(--mut);text-transform:uppercase;letter-spacing:.05em;margin:16px 0 10px">🟡 De hoje (${hj.length})</h3>` + hj.map(r => card(r, false)).join('');
    return html;
  }

  function viewCadastrados() {
    const lbl = classe === 'sensivel' ? 'sensível' : 'atenção';
    const leg = `<div class="seplegend">📋 O que já está cadastrado como <b>${lbl}</b> — qualquer um cadastra ou remove. Use a busca pra adicionar.</div>`;
    const srch = `<div class="srch"><input id="clisearch" placeholder="🔎 buscar clínica no HF para cadastrar como ${lbl}..." value="${escA(term)}" autocomplete="off">${resultsHtml()}</div>`;
    const reg = myFlags().sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
    const regHtml = reg.length ? `<div class="regwrap">` + reg.map(f => `<span class="regchip ${classe}">${esc2(f.nome || ('Cliente ' + f.cod))} <button class="x" data-desflag="${escA(f.cod)}" title="remover">✕</button></span>`).join('') + `</div>`
      : `<div class="sepwait" style="padding:24px">Nenhuma clínica cadastrada ainda. Use a busca acima.</div>`;
    return leg + srch + `<h3 style="font-size:12px;color:var(--mut);text-transform:uppercase;letter-spacing:.05em;margin:16px 0 10px">${reg.length} cadastrada${reg.length !== 1 ? 's' : ''}</h3>` + regHtml;
  }

  /* ===== 🟡 ATENÇÃO-ESPECIALIZADOS: exames de prazo longo (SLA>=3), HF-driven ===== */
  const ddmm = s => { const p = String(s || '').slice(0, 10).split('-'); return p.length === 3 ? `${p[2]}/${p[1]}` : (s || ''); };
  const espItens = () => (typeof DATA !== 'undefined' && DATA && DATA.especializados) ? DATA.especializados : null;
  function viewEsp() {
    const done = espBaixadas();
    const items = (espItens() || []).filter(it => !done.has(`${it.req}-${it.ano}-${it.codex}`));
    const leg = `<div class="seplegend atrasado">🟡 Exames de <b>2 dias ou mais</b>: entram <b>amarelos</b> → <b style="color:var(--red)">🔴 vermelho 2 dias antes de vencer</b> · <b style="color:var(--green)">✅ verde</b> = já liberado no HF. A baixa é <b>MANUAL</b>: só some quando alguém toca <b>✓ conferi</b> (não some sozinho ao liberar no HF).</div>`;
    if (!items.length) return leg + `<div class="sepwait" style="padding:30px">Nenhum exame especializado pendente agora. 👍</div>`;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const rows = items.map(it => {
      const ent = it.entrada ? new Date(it.entrada + 'T00:00:00') : null;
      const venceMs = ent && !isNaN(ent) ? ent.getTime() + (it.prazo || 1) * 864e5 : null;
      const faltam = venceMs != null ? Math.round((venceMs - today.getTime()) / 864e5) : 99;
      const lib = !!it.liberado;
      return { it, vence: venceMs != null ? new Date(venceMs).toISOString().slice(0, 10) : '', faltam, lib, red: !lib && faltam <= 2 };
    }).sort((a, b) => a.faltam - b.faltam);
    const reds = rows.filter(r => !r.lib && r.red), yellows = rows.filter(r => !r.lib && !r.red), libs = rows.filter(r => r.lib);
    const faltaTxt = f => f < 0 ? `VENCEU há ${-f} dia${f < -1 ? 's' : ''}` : f === 0 ? 'VENCE HOJE' : f === 1 ? 'vence amanhã' : `faltam ${f} dias`;
    const card = ({ it, vence, faltam, red, lib }) => {
      const hora = it.entrada_dt ? String(it.entrada_dt).slice(11, 16) : '';
      const dot = lib ? '✅' : red ? '🔴' : '🟡';
      const flag = lib
        ? `<div style="font-size:12.5px;font-weight:900;letter-spacing:.03em;color:var(--green);margin-bottom:3px">✅ LIBERADO NO HF — confirme a baixa</div>`
        : (red ? `<div style="display:flex;align-items:center;gap:8px;margin-bottom:3px"><span class="fw1">🎆</span><span class="fw2">🎇</span><span style="font-size:12.5px;font-weight:900;letter-spacing:.04em;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.6)">⚠️ ${faltaTxt(faltam).toUpperCase()} — LIBERE!</span><span class="fw3">🎆</span></div>` : '');
      const venceLine = lib ? '' : ` · ⏳ vence ${ddmm(vence)} (${faltaTxt(faltam)})`;
      return `<div class="alertcard atencao ${red ? 'esquecido' : ''}"${lib ? ' style="border-left:5px solid var(--green)"' : ''}>
        <div style="min-width:0">${flag}
          <div class="cli" style="font-size:17px">${dot} ${esc2(it.exame)}</div>
          <div class="big2">🐾 ${esc2(it.paciente)} &nbsp; <span class="reg">Reg ${esc2(it.req)}/${esc2(it.ano)}</span></div>
          <div class="meta"><b>${esc2(it.cat)}</b>${it.clinica ? ' · ' + esc2(it.clinica) : ''}${it.vet ? ' · vet ' + esc2(it.vet) : ''} · 📅 entrou ${ddmm(it.entrada)}${hora ? ' ' + hora : ''}${venceLine}</div></div>
        <button class="baixab" data-baixa="${escA(it.req + '-' + it.ano + '-' + it.codex)}" data-cod="esp" data-cliente="${escA(it.exame)}" data-req="${escA(it.req)}" data-ano="${escA(it.ano)}" data-paciente="${escA(it.paciente)}">✓ conferi</button>
      </div>`;
    };
    let html = leg;
    if (reds.length) html += `<h3 style="font-size:13px;font-weight:900;color:var(--red);margin:6px 0 10px;letter-spacing:.03em">🔴 ${reds.length} PERTO DE VENCER (≤2 dias) — PRIORIDADE!</h3>` + reds.map(card).join('');
    if (yellows.length) html += `<h3 style="font-size:12px;color:var(--mut);text-transform:uppercase;letter-spacing:.05em;margin:16px 0 10px">🟡 No prazo (${yellows.length})</h3>` + yellows.map(card).join('');
    if (libs.length) html += `<h3 style="font-size:12px;color:var(--green);text-transform:uppercase;letter-spacing:.05em;margin:16px 0 10px">✅ Liberados no HF — confirme a baixa (${libs.length})</h3>` + libs.map(card).join('');
    return html;
  }

  function render() {
    const el = $('cli'); if (!el) return;
    if (classe === 'esp') {
      const n = (espItens() || []).length;
      const head = `<div class="clihead"><div><h2>🟡 Atenção — Especializados ${n ? `<span class="c" style="font-size:14px">${n}</span>` : ''}</h2><div class="clisub">Produção · exames de prazo longo · puxado do HF (some quando liberado)</div></div></div>`;
      if (!espItens()) { el.innerHTML = head + `<div class="sepwait">Aguardando dados do HF (~10 min).</div>`; return; }
      el.innerHTML = head + `<div class="clibody">${viewEsp()}</div>`;
      wire(el);
      return;
    }
    const titulo = classe === 'sensivel' ? '🔴 Clientes Sensíveis' : '🟡 Clientes com Atenção';
    const sub = classe === 'sensivel' ? 'Atendimento ao cliente · só o nome da clínica' : 'Produção · check-in antes de liberar o exame';
    const nAl = classe === 'sensivel' ? alertByClinic().length : atencaoReqs().length;
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
      if (sub) { window.SUPA && window.SUPA.unsub(sub); sub = null; }
      if (timer) { clearInterval(timer); timer = null; }
      if (useSupa()) {
        // Realtime: re-renderiza quando flags/baixas mudam (push, ZERO polling)
        sub = window.SUPA.subscribe(['cli_flags', 'cli_baixas'], async () => { await load(); render(); });
      } else {
        timer = setInterval(async () => { const el = $('cli'); if (el && el.style.display !== 'none' && !document.hidden) { await load(); render(); } }, 60000);
      }
    } else if (m === 'cli-atencao-esp') {
      classe = 'esp'; await load(); render();
      if (sub) { window.SUPA && window.SUPA.unsub(sub); sub = null; }
      if (timer) { clearInterval(timer); timer = null; }
      if (useSupa()) sub = window.SUPA.subscribe(['cli_baixas'], async () => { await load(); render(); });
      // re-renderiza a cada 60s p/ as cores acompanharem o relógio (vira vermelho 2 dias antes)
      timer = setInterval(() => { const el = $('cli'); if (el && el.style.display !== 'none' && !document.hidden) render(); }, 60000);
    } else { if (sub) { window.SUPA && window.SUPA.unsub(sub); sub = null; } if (timer) { clearInterval(timer); timer = null; } }
  }
  document.addEventListener('visibilitychange', () => { const el = $('cli'); if (!document.hidden && el && el.style.display !== 'none') load().then(render); });
  window.CLI = { onMode, render };
})();
