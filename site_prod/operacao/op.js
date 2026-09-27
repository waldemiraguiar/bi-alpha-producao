/* ═══ MOVIMENTO DAS ROTAS ═══════════════════════════════════════════════════
   Wal, 27/set: "quero gráficos, mais visual, mais BI, mais cores".
   O WhatsApp não pinta texto — cor só em emoji. Então o resumo diário continua
   indo por lá (sparkline + candle) e o GRÁFICO mora aqui.

   Fonte: tabela rota_dia, a série histórica que passou a ser gravada em 26/set.
   Mesmo login da Fila de Agendamento (inc_sessao) — não cria senha nova.

   ⚠️ CORES: as SÉRIES (azul = dia útil, laranja = domingo) passaram no validador
   da skill dataviz em claro e escuro. O verde/vermelho de candle NÃO é série —
   é status de direção, e por isso vem SEMPRE com seta (▲▼) e o número. Verde ×
   vermelho tem ΔE 4,1 para deuteranopia: sozinhos, 8% dos homens não distinguem.
   ═══════════════════════════════════════════════════════════════════════════ */
;(() => {
  const URL_SB = 'https://lrwjcdvporaivxvfuiwt.supabase.co'
  const ANON = 'sb_publishable_fcodHc3AxR_HQ-aduMGzlg_CTBALng8'
  const $ = s => document.querySelector(s)
  const BR = { timeZone: 'America/Sao_Paulo' }

  let sessao = null, serie = [], dias = 14

  const lerSes = () => { try { const s = JSON.parse(localStorage.getItem('inc_sessao') || 'null'); return s && s.ate > Date.now() ? s : null } catch { return null } }
  const gravarSes = s => { try { localStorage.setItem('inc_sessao', JSON.stringify(s)) } catch {} }

  async function rpc(fn, args) {
    const r = await fetch(`${URL_SB}/rest/v1/rpc/${fn}`, {
      method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args) })
    const t = await r.text()
    if (!r.ok) throw new Error((() => { try { return JSON.parse(t).message || t } catch { return t } })())
    try { return JSON.parse(t) } catch { return t }
  }
  async function ler(q) {
    const r = await fetch(`${URL_SB}/rest/v1/${q}`, { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` }, cache: 'no-store' })
    return r.ok ? r.json() : []
  }

  // ── helpers ────────────────────────────────────────────────────────────────
  const ehDomingo = d => new Date(d + 'T12:00:00').getDay() === 0
  const dd = d => `${d.slice(8)}/${d.slice(5, 7)}`
  const sem3 = d => new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short', ...BR }).slice(0, 3).replace('.', '')
  const pct = (a, b) => b ? Math.round((a - b) * 100 / b) : null
  const med = a => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0
  /** ⚠️ seta SEMPRE junto do número: a cor nunca carrega sozinha o significado */
  function delta(v) {
    if (v === null || v === undefined) return { cls: 'lado', txt: '—', seta: '' }
    if (v > 2) return { cls: 'sobe', txt: `+${v}%`, seta: '▲' }
    if (v < -2) return { cls: 'cai', txt: `${v}%`, seta: '▼' }
    return { cls: 'lado', txt: `${v >= 0 ? '+' : ''}${v}%`, seta: '◆' }
  }

  // ── dados ──────────────────────────────────────────────────────────────────
  async function carregar() {
    const linhas = await ler('rota_dia?select=*&order=dia.asc&limit=4000')
    const porDia = new Map()
    for (const r of linhas) {
      const d = porDia.get(r.dia) || { dia: r.dia, exames: 0, paradas: 0, informadas: 0, rotas: [], motoboys: new Map() }
      d.exames += Number(r.exames) || 0
      d.paradas += Number(r.paradas) || 0
      d.informadas += Number(r.informadas) || 0
      d.rotas.push(r)
      if (r.motoboy) d.motoboys.set(r.motoboy, (d.motoboys.get(r.motoboy) || 0) + (Number(r.exames) || 0))
      porDia.set(r.dia, d)
    }
    serie = [...porDia.values()].filter(d => d.exames > 0).sort((a, b) => a.dia.localeCompare(b.dia))
    pintar()
  }

  // ── tooltip ────────────────────────────────────────────────────────────────
  const dica = document.createElement('div'); dica.className = 'dica'; document.body.appendChild(dica)
  function mostrarDica(el, html) {
    dica.innerHTML = html; dica.classList.add('on')
    const r = el.getBoundingClientRect()
    const larg = dica.offsetWidth
    let x = r.left + r.width / 2 - larg / 2
    x = Math.max(8, Math.min(x, innerWidth - larg - 8))
    dica.style.left = x + 'px'
    dica.style.top = Math.max(8, r.top - dica.offsetHeight - 8) + 'px'
  }
  const esconderDica = () => dica.classList.remove('on')

  // ── gráfico de colunas ─────────────────────────────────────────────────────
  function colunas(alvo, dados, opt = {}) {
    const el = $(alvo); el.innerHTML = ''
    if (!dados.length) { el.innerHTML = '<p class="nota">sem dado ainda</p>'; return }
    const topo = Math.max(...dados.map(d => d.exames), 1)
    const wrap = document.createElement('div'); wrap.className = 'colunas'
    dados.forEach((d, i) => {
      const ant = i > 0 ? dados[i - 1].exames : null
      const v = ant !== null ? pct(d.exames, ant) : null
      const dl = delta(v)
      const c = document.createElement('div')
      c.className = 'col' + (ehDomingo(d.dia) ? ' dom' : '')
      const mostraTopo = dados.length <= 16
      c.innerHTML =
        (mostraTopo ? `<span class="colTopo ${dl.cls}">${dl.seta}</span>` : '') +
        `<div class="barra" style="height:${Math.max(3, Math.round(d.exames / topo * 118))}px"></div>` +
        `<span class="colRot">${dados.length <= 16 ? dd(d.dia).slice(0, 5) : ''}</span>`
      c.addEventListener('pointerenter', () => mostrarDica(c,
        `<b>${dd(d.dia)} ${sem3(d.dia)}</b>${ehDomingo(d.dia) ? ' · domingo' : ''}<br>` +
        `<b>${d.exames}</b> exames<br>${d.informadas}/${d.paradas} paradas<br>` +
        (v !== null ? `<span style="color:${v > 2 ? '#7ee787' : v < -2 ? '#ff9b9b' : '#bbb'}">${dl.seta} ${dl.txt}</span> vs dia anterior` : '')))
      c.addEventListener('pointerleave', esconderDica)
      c.addEventListener('click', () => { selecionar(d.dia) })
      wrap.appendChild(c)
    })
    el.appendChild(wrap)
  }

  function barrasH(alvo, itens) {
    const el = $(alvo); el.innerHTML = ''
    if (!itens.length) { el.innerHTML = '<p class="nota">sem dado</p>'; return }
    const topo = Math.max(...itens.map(i => i.v), 1)
    for (const it of itens) {
      const d = document.createElement('div'); d.className = 'lh'
      d.innerHTML = `<span class="nm">${it.nome}</span>` +
        `<span class="tr"><span class="pr" style="width:${Math.round(it.v / topo * 100)}%"></span></span>` +
        `<span class="vl">${it.v}</span>` +
        (it.sub ? `<span class="sub2">${it.sub}</span>` : '')
      el.appendChild(d)
    }
  }

  function tabela(alvo, cols, linhas) {
    const el = $(alvo)
    el.innerHTML = '<table><thead><tr>' + cols.map(c => `<th>${c}</th>`).join('') + '</tr></thead><tbody>' +
      linhas.map(l => '<tr>' + l.map((c, i) => `<td class="${i ? 'n' : ''}">${c}</td>`).join('') + '</tr>').join('') +
      '</tbody></table>'
  }

  let diaSel = null
  function selecionar(dia) { diaSel = dia; pintar() }

  // ── pintar ─────────────────────────────────────────────────────────────────
  function pintar() {
    if (!serie.length) { $('#sub').textContent = 'ainda não há dias com movimento'; return }
    const uteis = serie.filter(d => !ehDomingo(d.dia))
    const doms = serie.filter(d => ehDomingo(d.dia))
    const corte = serie.slice(-dias)
    const ultimo = serie[serie.length - 1]
    const alvo = serie.find(d => d.dia === diaSel) || ultimo

    $('#sub').textContent = `${serie.length} dias na série · ${serie[0].dia.split('-').reverse().join('/')} até ${ultimo.dia.split('-').reverse().join('/')}`

    // herói
    $('#heroiN').textContent = alvo.exames
    $('#heroiDia').textContent = new Date(alvo.dia + 'T12:00:00').toLocaleDateString('pt-BR',
      { weekday: 'long', day: '2-digit', month: 'long', ...BR }) + (diaSel ? '  ·  toque numa barra para trocar' : '')
    const base = ehDomingo(alvo.dia) ? doms : uteis
    const idx = base.findIndex(d => d.dia === alvo.dia)
    const ant5 = base.slice(Math.max(0, idx - 5), idx).map(d => d.exames)
    const mesmoDia = serie.filter(d => d.dia < alvo.dia && new Date(d.dia + 'T12:00:00').getDay() === new Date(alvo.dia + 'T12:00:00').getDay()).slice(-4)
    const cards = [
      ['média 5 dias', med(ant5)],
      [`${sem3(alvo.dia)}. anteriores`, med(mesmoDia.map(d => d.exames))],
      ['melhor da série', Math.max(...base.map(d => d.exames))],
    ]
    $('#deltas').innerHTML = cards.filter(c => c[1]).map(([rot, val]) => {
      const dl = delta(pct(alvo.exames, val))
      return `<div class="delta"><span>${rot}</span><b>${val}</b><span class="${dl.cls}">${dl.seta} ${dl.txt}</span></div>`
    }).join('')

    // dia a dia
    colunas('#gDia', corte)
    tabela('#tDia', ['dia', 'exames', 'paradas', 'var.'], corte.map((d, i) => {
      const v = i > 0 ? pct(d.exames, corte[i - 1].exames) : null
      const dl = delta(v)
      return [`${dd(d.dia)} ${sem3(d.dia)}${ehDomingo(d.dia) ? ' (dom)' : ''}`, d.exames, `${d.informadas}/${d.paradas}`, `${dl.seta} ${dl.txt}`]
    }))

    // por rota
    $('#rotaDia').textContent = `· ${dd(alvo.dia)}`
    const rr = [...alvo.rotas].filter(r => r.exames).sort((a, b) => b.exames - a.exames)
      .map(r => ({ nome: r.rota, v: r.exames, sub: `${r.informadas || 0}/${r.paradas || 0} paradas${r.motoboy ? ' · ' + r.motoboy : ''}` }))
    barrasH('#gRota', rr)
    tabela('#tRota', ['rota', 'exames', 'paradas', 'motoboy'], rr.map(r => {
      const o = alvo.rotas.find(x => x.rota === r.nome)
      return [r.nome, r.v, `${o.informadas || 0}/${o.paradas || 0}`, o.motoboy || '—']
    }))

    // motoboy
    const mb = [...alvo.motoboys.entries()].sort((a, b) => b[1] - a[1]).map(([n, v]) => ({ nome: n, v }))
    $('#secMb').hidden = !mb.length
    $('#mbDia').textContent = `· ${dd(alvo.dia)}`
    if (mb.length) barrasH('#gMb', mb)

    // domingo
    $('#secDomingo').hidden = !doms.length
    if (doms.length) {
      const mdom = med(doms.map(d => d.exames)), mut = med(uteis.slice(-10).map(d => d.exames))
      $('#notaDom').innerHTML = doms.length === 1
        ? `Só <b>1 domingo</b> na série até agora. Domingo tem uma rodada só e não entra na média dos dias úteis.`
        : `<b>${doms.length} domingos</b> · média ${mdom} exames` + (mut ? ` — <b>${Math.round(mdom * 100 / mut)}%</b> de um dia útil` : '')
      colunas('#gDom', doms)
    }

    $('#rodape').textContent = 'a série cresce todo dia · fonte: confirmações dos motoboys nos grupos de rota'
  }

  // ── interação ──────────────────────────────────────────────────────────────
  document.addEventListener('click', ev => {
    const c = ev.target.closest('.chip[data-dias]')
    if (c) { document.querySelectorAll('.chip').forEach(x => x.classList.remove('on')); c.classList.add('on'); dias = +c.dataset.dias; pintar(); return }
    const t = ev.target.closest('.verTabela')
    if (t) { const el = $('#' + t.dataset.tab); el.hidden = !el.hidden; t.textContent = el.hidden ? 'ver como tabela' : 'esconder tabela'; return }
  })
  $('#btTema').addEventListener('click', () => {
    const atual = document.documentElement.getAttribute('data-theme')
    const novo = atual === 'dark' ? 'light' : atual === 'light' ? '' : 'dark'
    if (novo) document.documentElement.setAttribute('data-theme', novo)
    else document.documentElement.removeAttribute('data-theme')
    try { localStorage.setItem('op_tema', novo) } catch {}
  })
  try { const t = localStorage.getItem('op_tema'); if (t) document.documentElement.setAttribute('data-theme', t) } catch {}

  // ── login ──────────────────────────────────────────────────────────────────
  $('#login').addEventListener('submit', async ev => {
    ev.preventDefault()
    const nome = $('#nome').value, senha = $('#senha').value
    $('#erroLogin').hidden = true
    if (!nome) { $('#erroLogin').textContent = 'Escolha seu nome'; $('#erroLogin').hidden = false; return }
    try { await rpc('inc_coleta_pegar', { p_nome: nome, p_senha: senha, p_id: 0, p_acao: 'ping' }) }
    catch (e) {
      $('#erroLogin').textContent = /não conferem|login/i.test(e.message) ? 'Senha não confere' : 'Erro: ' + e.message
      $('#erroLogin').hidden = false; return
    }
    try { localStorage.setItem('agenda_ultimo_nome', nome) } catch {}
    sessao = { nome, senha, ate: Date.now() + 12 * 3600e3 }
    gravarSes(sessao); entrar()
  })

  async function nomes() {
    try {
      const d = await rpc('sep_team_names', {})
      const L = (d || []).map(x => typeof x === 'string' ? x : (x.nome || '')).filter(Boolean).sort((a, b) => a.localeCompare(b, 'pt'))
      $('#nome').innerHTML = '<option value="">— escolha —</option>' + L.map(n => `<option>${n}</option>`).join('')
      const u = localStorage.getItem('agenda_ultimo_nome'); if (u && L.includes(u)) $('#nome').value = u
    } catch { $('#nome').outerHTML = '<input id="nome" placeholder="seu nome">' }
  }

  function entrar() { $('#login').hidden = true; $('#painel').hidden = false; carregar() }

  sessao = lerSes()
  if (sessao) entrar()
  else { $('#login').hidden = false; nomes() }
})()
