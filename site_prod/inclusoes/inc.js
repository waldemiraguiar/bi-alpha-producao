/* Quadro de Inclusões — Fase 1 (manual: cada setor avança o cartão com um toque).
   Dados: Supabase (inc_chamados / inc_eventos), escrita só por RPC com login da equipe (sep_team).
   ?setor=cc|esc|tec|todos   ?tv=1 (tela cheia, sem botões)   ?demo=1 (dados de exemplo, não grava nada) */
(function () {
  'use strict'
  const URL_SB = 'https://lrwjcdvporaivxvfuiwt.supabase.co'
  const KEY = 'sb_publishable_fcodHc3AxR_HQ-aduMGzlg_CTBALng8'
  const qs = new URLSearchParams(location.search)
  const DEMO = qs.get('demo') === '1'
  const SB = !DEMO && window.supabase && window.supabase.createClient ? window.supabase.createClient(URL_SB, KEY, { realtime: { params: { eventsPerSecond: 5 } } }) : null

  // ── CONFIGURAÇÃO (ajustável a pedido da equipe) ──
  const SETORES = {
    cc: { nome: 'ATENDIMENTO AO CLIENTE', cor: 'var(--cc)' },
    esc: { nome: 'ESCRITÓRIO', cor: 'var(--esc)' },
    tec: { nome: 'ÁREA TÉCNICA', cor: 'var(--tec)' },
  }
  // escalonamento em MINUTOS parado na etapa: [amarelo rápido, vermelho+protocolo, vermelho+topo+som, explode]
  const ESCALA = [5, 10, 15, 30]
  // ORDEM DO WAL (16/set): atendimento ao cliente registra → técnica vê se tem amostra → escritório lança no HF →
  // técnica faz e libera → escritório libera e encerra (e-mail)
  const ETAPAS = {
    1: { nome: 'Registrar e cliente autorizar', dono: 'cc', prazo: '10 min' },
    2: { nome: 'Tem amostra?', dono: 'tec', prazo: '10 min' },
    3: { nome: 'Lançar no HF', dono: 'esc', prazo: '10 min' },
    4: { nome: 'Fazer e liberar o exame', dono: 'tec', prazo: 'por exame' },
    5: { nome: 'Liberar e enviar e-mail', dono: 'esc', prazo: '10 min' },
  }
  // etapa 4 = tempo do exame. PROVISÓRIO até medir no HF (Wal autorizou medir).
  const PRAZO_EXAME_MIN = { hemato: 120, bioquimica: 240, urina_fezes: 240, pcr_soro: 4320, cito_histo: 7200, outros: 1440 }
  const VALIDADE_H = { hemato: 24, bioquimica: 168, urina_fezes: 24, pcr_soro: 168, cito_histo: null, outros: 168 }
  const NOME_SETOR = { hemato: 'Hematologia', bioquimica: 'Bioquímica', urina_fezes: 'Urina / Fezes', pcr_soro: 'PCR / Sorologia', cito_histo: 'Citologia / Histo', outros: 'Outros' }
  const LEMBRETE_CLIENTE_MIN = 120      // aguardando cliente há mais que isso → volta a piscar para o atendimento ao cliente

  // ── estado ──
  let setor = qs.get('setor') || lerLocal('inc_setor') || 'cc'
  let suspeitas = [], chamados = [], eventos = [], sessao = lerSessao(), explodeCalado = new Set(), somLiberado = false, periodo = 'dia'
  const $ = id => document.getElementById(id)
  const T = q => q ? Date.parse(q) : 0
  const agora = () => Date.now()
  const hm = q => new Date(T(q)).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  const dataCurta = q => new Date(T(q)).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
  const fmt = m => { m = Math.max(0, Math.round(m)); return m >= 1440 ? `${Math.floor(m / 1440)}d ${Math.floor(m % 1440 / 60)}h` : m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m} min` }
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  function lerLocal(k) { try { return localStorage.getItem(k) } catch { return null } }
  function gravarLocal(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v) } catch {} }
  function lerSessao() { try { const s = JSON.parse(localStorage.getItem('inc_sessao') || 'null'); return s && s.ate > Date.now() ? s : null } catch { return null } }
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 3200) }

  // ── dados ──
  async function pageAll(tab, ordem) {
    let all = [], from = 0
    for (let g = 0; g < 100; g++) {
      const { data, error } = await SB.from(tab).select('*').order(ordem, { ascending: false }).range(from, from + 999)
      if (error) throw error
      all = all.concat(data || []); if (!data || data.length < 1000) break; from += 1000
    }
    return all
  }
  async function carregar() {
    if (DEMO) { if (!chamados.length) demoDados(); return }
    try {
      const lim = new Date(agora() - 31 * 864e5).toISOString()
      const abertos = await SB.from('inc_chamados').select('*').in('status', ['aberto', 'sem_amostra'])
      const recentes = await SB.from('inc_chamados').select('*').gte('criado_em', lim).order('criado_em', { ascending: false }).range(0, 4999)
      if (abertos.error) throw abertos.error
      const mapa = new Map(); for (const c of [...(abertos.data || []), ...(recentes.data || [])]) mapa.set(c.id, c)
      chamados = [...mapa.values()]
      const ids = chamados.map(c => c.id)
      eventos = []
      for (let i = 0; i < ids.length; i += 300) {
        const { data } = await SB.from('inc_eventos').select('*').in('chamado_id', ids.slice(i, i + 300)).order('quando')
        eventos = eventos.concat(data || [])
      }
      const sp = await SB.from('inc_suspeitas').select('*').eq('status', 'aberta').order('quando', { ascending: false }).range(0, 199)
      suspeitas = sp.error ? [] : (sp.data || [])
      $('conexao').textContent = ''
    } catch (e) {
      $('conexao').textContent = /does not exist|42P01/.test(e.message || e.code || '') ? 'Banco ainda não criado (rodar o SQL). Abra com ?demo=1 para ver o exemplo.' : 'Sem conexão com o banco — tentando de novo…'
    }
  }
  async function rpc(nome, args) {
    if (DEMO) return demoRpc(nome, args)
    const { data, error } = await SB.rpc(nome, args)
    if (error) throw new Error(/login/.test(error.message) ? 'Nome ou senha não conferem' : error.message)
    return data
  }

  // ── login (mesma equipe do painel da Produção: sep_team) ──
  async function pedirLogin() {
    const sel = $('loginNome')
    let nomes = []
    if (DEMO) nomes = [{ nome: 'DEMO' }]
    else { const { data } = await SB.rpc('sep_team_names'); nomes = data || [] }
    sel.innerHTML = nomes.map(n => `<option>${esc(n.nome)}</option>`).join('')
    const ult = lerLocal('inc_ultimo_nome'); if (ult) sel.value = ult
    $('loginSenha').value = ''; $('loginErro').textContent = ''
    $('dlgLogin').showModal()
    return new Promise(res => { pedirLogin._res = res })
  }
  $('formLogin').addEventListener('submit', async ev => {
    ev.preventDefault()
    const nome = $('loginNome').value, senha = $('loginSenha').value
    try {
      let ok = DEMO
      if (!DEMO) { const { data } = await SB.rpc('sep_login', { p_nome: nome, p_pin: senha }); ok = !!(data && data[0] && data[0].ok) }
      if (!ok) { $('loginErro').textContent = 'Nome ou senha não conferem.'; return }
      sessao = { nome, senha, ate: Date.now() + 12 * 3600e3 }
      gravarLocal('inc_sessao', JSON.stringify(sessao)); gravarLocal('inc_ultimo_nome', nome)
      $('dlgLogin').close(); desenharLogin(); toast(`Olá, ${nome}`)
      pedirLogin._res && pedirLogin._res(true)
    } catch (e) { $('loginErro').textContent = 'Sem conexão. Tente de novo.' }
  })
  $('loginSenha').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('formLogin').requestSubmit() } })
  // autocadastro (mesmo sep_register do painel da Produção)
  $('btnCriar').addEventListener('click', () => {
    $('dlgLogin').close(); $('formCriar').reset(); $('criarErro').textContent = ''; $('dlgCriar').showModal(); $('criarNome').focus()
  })
  $('formCriar').addEventListener('submit', async ev => {
    ev.preventDefault()
    const nome = $('criarNome').value.trim(), s1 = $('criarSenha').value, s2 = $('criarSenha2').value
    if (nome.length < 2) { $('criarErro').textContent = 'Escreva seu nome.'; return }
    if (s1.length < 4) { $('criarErro').textContent = 'A senha precisa ter pelo menos 4 dígitos.'; return }
    if (s1 !== s2) { $('criarErro').textContent = 'As duas senhas não são iguais.'; return }
    if (DEMO) { $('criarErro').textContent = 'No modo demonstração não cria login.'; return }
    $('criarOk').disabled = true
    try {
      const { data, error } = await SB.rpc('sep_register', { p_nome: nome, p_papel: 'ambos', p_pin: s1 })
      const r = data && data[0]
      if (error || !r || !r.ok) { $('criarErro').textContent = (r && r.erro) || 'Não consegui criar. Tente de novo.'; return }
      sessao = { nome, senha: s1, ate: Date.now() + 12 * 3600e3 }
      gravarLocal('inc_sessao', JSON.stringify(sessao)); gravarLocal('inc_ultimo_nome', nome)
      $('dlgCriar').close(); desenharLogin(); toast(`Login criado. Bem-vindo, ${nome}`)
      pedirLogin._res && pedirLogin._res(true)
    } catch (e) { $('criarErro').textContent = 'Sem conexão. Tente de novo.' }
    finally { $('criarOk').disabled = false }
  })
  async function garantirLogin() { if (sessao && sessao.ate > Date.now()) return true; return pedirLogin() }
  function desenharLogin() { $('btnLogin').textContent = sessao ? `${sessao.nome} · Sair` : 'Entrar' }
  $('btnLogin').addEventListener('click', () => {
    if (sessao) { sessao = null; gravarLocal('inc_sessao', null); desenharLogin(); toast('Saiu') } else pedirLogin()
  })
  document.querySelectorAll('dialog [data-fechar]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()))

  // ── estado visual de cada cartão ──
  function minutosNaEtapa(c) { return (agora() - T(c.etapa_desde)) / 60000 }
  function donoAtual(c) { return c.status === 'sem_amostra' ? 'cc' : ETAPAS[c.etapa]?.dono }
  function estado(c) {
    const m = minutosNaEtapa(c)
    if (c.pausado) return m >= LEMBRETE_CLIENTE_MIN ? 's-a2' : 's-p'
    if (c.status === 'sem_amostra') return m >= ESCALA[1] ? 's-v1' : 's-a2'
    const vence = amostraPct(c) >= 80
    if (c.etapa === 4) {
      const r = m / (PRAZO_EXAME_MIN[c.setor] || 1440)
      return r >= 1.5 ? 's-v2' : r >= 1 ? 's-v1' : (r >= .8 || vence) ? 's-a2' : 's-a1'
    }
    if (m >= ESCALA[3]) return 's-x'
    if (m >= ESCALA[2]) return 's-v2'
    if (m >= ESCALA[1] || vence) return 's-v1'
    if (m >= ESCALA[0]) return 's-a2'
    return 's-a1'
  }
  function amostraPct(c) {
    const v = VALIDADE_H[c.setor]; if (!v || !c.amostra_entrada) return 0
    return Math.min(100, Math.round((agora() - T(c.amostra_entrada)) / 3600e3 / v * 100))
  }
  const ROTULO = { 's-a1': 'no prazo', 's-a2': 'atenção', 's-v1': 'estourou · protocolado', 's-v2': 'estourado', 's-x': 'EXPLODIU', 's-p': 'aguardando cliente' }
  function botoes(c) {
    if (c.status === 'sem_amostra') return `<button data-acao="cliente_avisado">Cliente avisado · encerrar</button>`
    const cancelar = `<button class="leve" data-acao="cancelar">Cancelar</button>`
    switch (c.etapa) {
      case 1: return `<button data-acao="cliente_autorizou">Cliente autorizou</button>${cancelar}`
      case 2: return `<button data-acao="amostra_ok">Tem amostra suficiente</button><button class="nao" data-acao="sem_amostra">Não tem amostra → avisar cliente</button>${cancelar}`
      case 3: return `<button data-acao="escritorio_ok">Lançado no HF</button>${cancelar}`
      case 4: return `<button data-acao="exame_liberado">Exame feito e liberado</button>${cancelar}`
      case 5: return `<button data-acao="encerrar">Liberado e e-mail enviado · encerrar</button>`
    }
    return ''
  }

  // ── desenho ──
  function desenhar() {
    document.querySelectorAll('#abas button').forEach(b => b.classList.toggle('on', b.dataset.setor === setor))
    const hist = setor === 'hist', todos = setor === 'todos'
    $('vQuadro').hidden = hist; $('vHist').hidden = !hist
    desenharLegenda()
    if (hist) return desenharHistorico()
    const abertos = chamados.filter(c => c.status === 'aberto' || c.status === 'sem_amostra')

    // caminho da inclusão: 5 etapas, cor = dono, número = quantas estão ali (vermelho se alguma estourou)
    $('fluxo').innerHTML = Object.entries(ETAPAS).map(([n, e]) => {
      const s = SETORES[e.dono], aqui = abertos.filter(c => c.etapa === +n && c.status === 'aberto')
      const ruins = aqui.filter(c => ['s-v1', 's-v2', 's-x'].includes(estado(c))).length
      return `<li class="${e.dono === setor ? 'minha' : ''}" style="--c:${s.cor}">
        <span class="conta ${ruins ? 'ruim' : ''}">${aqui.length}</span>
        <div><span class="quem">${n} · ${s.nome}</span><b>${e.nome}</b><small>${e.prazo}${+n === 2 ? ' · sem amostra ↩ atendimento' : ''}</small></div>
      </li>`
    }).join('')
    $('btnNova').hidden = !(setor === 'cc' || todos)

    $('corpoSetor').hidden = todos; $('kanban').hidden = !todos
    if (todos) { desenharKanban(abertos); return explodir(abertos) }

    const meus = abertos.filter(c => donoAtual(c) === setor)
    const outros = abertos.filter(c => donoAtual(c) !== setor)
    desenharSuspeitas()
    const s = SETORES[setor]
    $('tituloVez').textContent = `Sua vez — ${s.nome}`
    $('tituloVez').style.color = s.cor
    const est = meus.filter(c => ['s-v1', 's-v2', 's-x'].includes(estado(c))).length
    $('subVez').textContent = `${meus.length} esperando por você${est ? ` · ${est} fora do prazo` : ''}`

    const ordem = { 's-x': 0, 's-v2': 1, 's-v1': 2, 's-a2': 3, 's-a1': 4, 's-p': 5 }
    meus.sort((a, b) => ordem[estado(a)] - ordem[estado(b)] || T(a.etapa_desde) - T(b.etapa_desde))
    $('cartoes').innerHTML = meus.length ? meus.map(cartaoHTML).join('') : `<div class="vazio grande">✓ Tudo em dia — nada esperando por ${s.nome.toLowerCase()}</div>`

    // outros setores agrupados: fica claro QUEM está segurando
    $('outros').innerHTML = ['cc', 'esc', 'tec'].filter(k => k !== setor).map(k => {
      const d = SETORES[k], lst = outros.filter(c => donoAtual(c) === k)
      return `<div class="grupo-setor" style="--c:${d.cor}"><div class="gs-cab"><span>${d.nome}</span><span>${lst.length}</span></div>
        <div class="linhas">${lst.length ? lst.map(c => `<div class="lin ${['s-v1', 's-v2', 's-x'].includes(estado(c)) ? 'atras' : ''}"><span><b>${esc(c.pet || '')}</b> +${esc(c.exame)}</span><span class="t">${c.pausado ? 'cliente' : fmt(minutosNaEtapa(c))}</span></div>`).join('') : '<div class="lin mudo">—</div>'}</div></div>`
    }).join('')

    const hoje = new Date().toDateString()
    const conc = chamados.filter(c => c.status === 'concluido' && new Date(T(c.concluido_em)).toDateString() === hoje)
    $('concluidas').innerHTML = conc.length ? `<div class="linhas">${conc.map(c => `<div class="lin"><span>✓ <b>${esc(c.pet || '')}</b> +${esc(c.exame)}</span><span class="t">${fmt((T(c.concluido_em) - T(c.criado_em)) / 60000)}</span></div>`).join('')}</div>` : '<div class="lin mudo">nenhuma ainda</div>'

    explodir(meus)
  }
  function cartaoHTML(c) {
    const st = estado(c), m = minutosNaEtapa(c), pct = amostraPct(c), e = ETAPAS[c.etapa]
    const prazoTxt = c.pausado ? 'esperando o cliente' : c.status === 'sem_amostra' ? 'avisar o cliente' : c.etapa === 4 ? `prazo ${fmt(PRAZO_EXAME_MIN[c.setor])}` : ROTULO[st]
    const amostra = VALIDADE_H[c.setor] && c.amostra_entrada && pct >= 50
      ? `<div class="amostra ${pct >= 80 ? 'alerta' : ''}">amostra ${pct}% da validade<span class="barra"><i style="width:${pct}%"></i></span></div>` : ''
    return `<article class="cartao ${st}" data-id="${c.id}" title="aberta ${hm(c.criado_em)} por ${esc(c.aberto_por || '')}${c.obs ? ' · ' + esc(c.obs) : ''}">
      <div class="c-esq">
        <div class="c-etapa">${c.status === 'sem_amostra' ? '<span class="selo">sem amostra</span>' : `${c.etapa} · ${e ? e.nome : ''}`}</div>
        <div class="c-pet">${esc(c.pet || 'sem nome')} <span class="req">${esc(c.req)}</span></div>
        <div class="c-exame">+ ${esc(c.exame)}</div>
        <div class="c-clin">${esc(c.clinica || '')} · ${NOME_SETOR[c.setor] || ''}</div>
        ${amostra}
      </div>
      <div class="c-dir"><div class="tempo">${fmt(m)}</div><div class="rot">${prazoTxt}</div></div>
      <div class="acao">${botoes(c)}</div>
    </article>`
  }
  function desenharKanban(abertos) {
    $('kanban').innerHTML = Object.entries(ETAPAS).map(([n, e]) => {
      const s = SETORES[e.dono]
      const lst = abertos.filter(c => (c.status === 'sem_amostra' ? 1 : c.etapa) === +n).sort((a, b) => T(a.etapa_desde) - T(b.etapa_desde))
      return `<div class="coluna" style="--c:${s.cor}"><h3>${n}. ${e.nome}<span>${s.nome}</span></h3>
        ${lst.map(c => `<div class="mini ${estado(c)}"><b>${esc(c.pet || '')}</b><span>${esc(c.req)} · +${esc(c.exame)}</span><span class="mudo">${esc(c.clinica || '')}</span><span class="t">${c.status === 'sem_amostra' ? 'SEM AMOSTRA · ' : ''}${c.pausado ? 'aguardando cliente ' : ''}${fmt(minutosNaEtapa(c))}</span></div>`).join('') || '<span class="mudo">—</span>'}</div>`
    }).join('')
  }
  function explodir(lista) {
    // explosão: só para cartões DESTE setor (a TV de cada setor grita o que é dela)
    const pior = lista.filter(c => estado(c) === 's-x' && !explodeCalado.has(c.id + ':' + c.etapa)).sort((a, b) => minutosNaEtapa(b) - minutosNaEtapa(a))[0]
    $('explode').hidden = !pior
    if (pior) {
      $('explodeTitulo').textContent = `PARADA HÁ ${fmt(minutosNaEtapa(pior))}`
      $('explodeTexto').innerHTML = `<b>${esc(pior.pet || '')} ${esc(pior.req)}</b> · +${esc(pior.exame)} · ${ETAPAS[pior.etapa].nome} · ${SETORES[donoAtual(pior)].nome}`
      $('explode').dataset.chave = pior.id + ':' + pior.etapa
      bip(3)
    } else if (lista.some(c => estado(c) === 's-v2')) bip(1)
  }
  // LEGENDA fixa (pedido do Wal): as regras sempre à vista para o colaborador
  function desenharLegenda() {
    const [a, b, c, d] = ESCALA
    $('legenda').innerHTML = `
      <span><i class="pt" style="--c:var(--cc)"></i>Atendimento ao Cliente registra</span>
      <span><i class="pt" style="--c:var(--tec)"></i>Técnica vê amostra e faz</span>
      <span><i class="pt" style="--c:var(--esc)"></i>Escritório lança, libera e encerra</span>
      <span class="sep"></span>
      <span><i class="pt" style="--c:var(--amarelo)"></i>até ${b} min</span>
      <span><i class="pt" style="--c:var(--vermelho)"></i>${b} min atrasado · ${c} apita · ${d} explode</span>
      <span><i class="pt" style="--c:var(--pausa)"></i>esperando cliente (cobrar após ${fmt(LEMBRETE_CLIENTE_MIN)})</span>
      <span class="mudo">· cartão só sai com o e-mail enviado</span>`
  }

  // ── contraprova: pedido de inclusão no WhatsApp sem cartão (o ouvinte lê os grupos das clínicas) ──
  const SUSPEITA_MIN = 15
  function desenharSuspeitas() {
    const caixa = $('suspeitas')
    const ver = setor === 'cc' || setor === 'todos'
    // some sozinha se já abriram cartão dessa clínica depois do pedido (casa por palavra do nome do grupo)
    const norm = t => (t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    const GEN = new Set(['alpha', 'labs', 'clinica', 'veterinaria', 'veterinario', 'consultorio', 'hospital', 'animal', 'centro'])
    const palavras = t => norm(t).split(/[^a-z0-9]+/).filter(w => w.length >= 5 && !GEN.has(w))
    const temCartao = x => { const pg = palavras(x.grupo); return chamados.some(c => T(c.criado_em) >= T(x.quando) - 30 * 60000 && palavras((c.clinica || '') + ' ' + (c.pet || '')).some(w => pg.includes(w))) }
    const lista = suspeitas.filter(x => (agora() - T(x.quando)) / 60000 >= SUSPEITA_MIN && !temCartao(x))
    caixa.hidden = !ver || !lista.length
    if (caixa.hidden) return
    caixa.innerHTML = `<h3>⚠ Possível pedido de inclusão no WhatsApp SEM cartão (${lista.length})</h3>` + lista.map(x => `
      <div class="suspeita" data-id="${x.id}">
        <div><b>${esc((x.grupo || '').replace(/^[^A-Za-z0-9]*Alpha-? ?-? ?/i, ''))}</b> · ${hm(x.quando)} · há ${fmt((agora() - T(x.quando)) / 60000)}<br><span class="mudo">“${esc(x.texto)}”</span></div>
        <div class="acao"><button data-sus="registrada">Já abri o cartão</button><button class="leve" data-sus="nao_e_inclusao">Não é inclusão</button></div>
      </div>`).join('')
  }
  $('suspeitas').addEventListener('click', async ev => {
    const b = ev.target.closest('button[data-sus]'); if (!b) return
    if (!(await garantirLogin())) return
    const id = +b.closest('.suspeita').dataset.id
    try {
      if (DEMO) suspeitas = suspeitas.filter(x => x.id !== id)
      else await rpc('inc_suspeita_resolver', { p_nome: sessao.nome, p_senha: sessao.senha, p_id: id, p_status: b.dataset.sus })
      toast('Registrado'); await carregar(); desenhar()
    } catch (e) { toast(e.message) }
  })

  // ── histórico: dia / semana / mês ──
  function desenharHistorico() {
    document.querySelectorAll('.hist-filtros button').forEach(b => b.classList.toggle('on', b.dataset.per === periodo))
    const dias = periodo === 'dia' ? 0 : periodo === 'semana' ? 7 : 30
    const ini = new Date(); ini.setHours(0, 0, 0, 0); ini.setDate(ini.getDate() - dias)
    const lista = chamados.filter(c => T(c.criado_em) >= ini.getTime()).sort((a, b) => T(b.criado_em) - T(a.criado_em))
    const porEtapa = {}; let estouros = 0
    const linhas = lista.map(c => {
      const evs = eventos.filter(e => e.chamado_id === c.id).sort((a, b) => T(a.quando) - T(b.quando))
      const trechos = []
      for (let i = 0; i < evs.length; i++) {
        const e = evs[i], prox = evs[i + 1]
        if (e.para == null || e.para > 5) continue
        const fim = prox ? T(prox.quando) : (c.status === 'aberto' || c.status === 'sem_amostra' ? agora() : T(c.concluido_em))
        const min = (fim - T(e.quando)) / 60000
        const lim = e.para === 4 ? PRAZO_EXAME_MIN[c.setor] : ESCALA[1]
        const estourou = min > lim
        if (estourou) estouros++
        ;(porEtapa[e.para] ||= []).push(min)
        trechos.push(`<span class="etp ${estourou ? 'estourou' : ''}" title="${ETAPAS[e.para].nome}">${e.para}: ${fmt(min)}</span>`)
      }
      const total = c.concluido_em ? fmt((T(c.concluido_em) - T(c.criado_em)) / 60000) : '—'
      const status = { aberto: 'em andamento', sem_amostra: 'sem amostra', concluido: 'concluída', cancelado: 'cancelada' }[c.status] || c.status
      return `<tr><td class="num">${dataCurta(c.criado_em)} ${hm(c.criado_em)}</td><td class="num">${esc(c.req)}</td><td>${esc(c.pet || '')}<br><span class="mudo">${esc(c.clinica || '')}</span></td><td>${esc(c.exame)}<br><span class="mudo">${NOME_SETOR[c.setor] || ''}</span></td><td>${status}</td><td>${trechos.join('')}</td><td class="num">${total}</td></tr>`
    })
    const med = a => { if (!a || !a.length) return '—'; const s = [...a].sort((x, y) => x - y); return fmt(s[Math.floor(s.length / 2)]) }
    const concl = lista.filter(c => c.status === 'concluido')
    $('numeros').innerHTML = [
      [lista.length, 'inclusões abertas no período'],
      [concl.length, 'concluídas (e-mail enviado)'],
      [lista.filter(c => c.status === 'sem_amostra' || (c.status === 'cancelado')).length, 'sem amostra / canceladas'],
      [estouros, 'etapas que estouraram o prazo'],
      ...Object.keys(ETAPAS).map(n => [med(porEtapa[n]), `mediana etapa ${n} · ${SETORES[ETAPAS[n].dono].nome.toLowerCase()}`]),
    ].map(([v, r]) => `<div><b>${v}</b><span>${r}</span></div>`).join('')
    $('histLinhas').innerHTML = linhas.join('') || '<tr><td colspan="7" class="mudo">Nenhuma inclusão no período.</td></tr>'
  }

  // ── som (a TV precisa de um clique para liberar áudio) ──
  let ctx = null, ultimoBip = 0
  function bip(vezes) {
    if (!somLiberado || Date.now() - ultimoBip < 20000) return
    ultimoBip = Date.now()
    try {
      ctx ||= new (window.AudioContext || window.webkitAudioContext)()
      for (let i = 0; i < vezes; i++) {
        const o = ctx.createOscillator(), g = ctx.createGain()
        o.frequency.value = 880; o.connect(g); g.connect(ctx.destination)
        const t0 = ctx.currentTime + i * .35; g.gain.setValueAtTime(.25, t0); g.gain.exponentialRampToValueAtTime(.001, t0 + .3)
        o.start(t0); o.stop(t0 + .3)
      }
    } catch {}
  }
  $('btnSom').addEventListener('click', () => { somLiberado = !somLiberado; $('btnSom').textContent = somLiberado ? '🔊 Som ligado' : '🔈 Som'; if (somLiberado) { ultimoBip = 0; bip(1) } })
  $('explodeFechar').addEventListener('click', () => { explodeCalado.add($('explode').dataset.chave); desenhar() })

  // ── ações ──
  $('cartoes').addEventListener('click', async ev => {
    const b = ev.target.closest('button[data-acao]'); if (!b) return
    const id = +b.closest('.cartao').dataset.id, acao = b.dataset.acao
    if (!(await garantirLogin())) return
    let obs = null
    if (acao === 'cancelar' || acao === 'sem_amostra') {
      obs = await pedirMotivo(acao === 'cancelar' ? 'Por que cancelar esta inclusão?' : 'O que aconteceu com a amostra?')
      if (obs == null) return
    }
    b.disabled = true
    try {
      await rpc('inc_acao', { p_nome: sessao.nome, p_senha: sessao.senha, p_id: id, p_acao: acao, p_obs: obs })
      toast('Registrado'); await carregar(); desenhar()
    } catch (e) {
      b.disabled = false
      if (/não conferem/.test(e.message)) { sessao = null; gravarLocal('inc_sessao', null); desenharLogin() }
      toast(e.message)
    }
  })
  function pedirMotivo(titulo) {
    $('motivoTitulo').textContent = titulo; $('motivoTexto').value = ''; $('motivoErro').textContent = ''
    $('dlgMotivo').showModal()
    return new Promise(res => {
      const ok = e => { e.preventDefault(); const v = $('motivoTexto').value.trim(); if (!v) { $('motivoErro').textContent = 'Escreva o motivo.'; return } limpar(); $('dlgMotivo').close(); res(v) }
      const fechar = () => { limpar(); res(null) }
      const limpar = () => { $('formMotivo').removeEventListener('submit', ok); $('dlgMotivo').removeEventListener('close', fechar) }
      $('formMotivo').addEventListener('submit', ok); $('dlgMotivo').addEventListener('close', fechar, { once: true })
    })
  }

  // ── nova inclusão ──
  let entradaHF = null
  $('btnNova').addEventListener('click', async () => {
    if (!(await garantirLogin())) return
    $('formNova').reset(); $('puxado').hidden = true; $('novaErro').textContent = ''; entradaHF = null
    $('dlgNova').showModal(); $('nReq').focus()
  })
  $('btnBuscar').addEventListener('click', buscarHF)
  $('nReq').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); buscarHF() } })
  async function buscarHF() {
    const n = $('nReq').value.replace(/\D/g, ''); if (!n) return
    $('novaErro').textContent = 'Buscando no HF…'
    try {
      const r = await rpc('inc_buscar_req', { p_nome: sessao.nome, p_senha: sessao.senha, p_num: n })
      if (!r) { $('novaErro').textContent = 'Requisição não encontrada nos últimos 10 dias (o espelho do HF atualiza a cada 30 min). Preencha pet e clínica à mão.'; $('puxado').hidden = true; return }
      $('novaErro').textContent = ''
      $('nPet').value = r.pet || ''; $('nClinica').value = r.clinica || ''; entradaHF = r.entrada || null
      $('puxado').innerHTML = `<dt>Pet</dt><dd>${esc(r.pet || '')} · ${esc(r.especie || '')}</dd><dt>Clínica</dt><dd>${esc(r.clinica || '')}</dd><dt>Entrada</dt><dd>${r.entrada ? dataCurta(r.entrada) + ' ' + hm(r.entrada) : '—'}</dd><dt>Já tem</dt><dd>${(r.exames || []).map(esc).join(' · ') || '—'}</dd>`
      $('puxado').hidden = false
    } catch (e) { $('novaErro').textContent = e.message }
  }
  $('formNova').addEventListener('submit', async ev => {
    ev.preventDefault()
    const autorizado = document.querySelector('input[name="nCliente"]:checked').value === 'sim'
    const args = { p_nome: sessao.nome, p_senha: sessao.senha, p_req: $('nReq').value, p_pet: $('nPet').value.trim(), p_clinica: $('nClinica').value.trim(),
      p_exame: $('nExame').value.trim(), p_setor: $('nSetor').value, p_origem: $('nOrigem').value, p_autorizado: autorizado, p_entrada: entradaHF, p_obs: $('nObs').value.trim() || null }
    if (!args.p_exame) { $('novaErro').textContent = 'Informe o exame a incluir.'; return }
    $('novaOk').disabled = true
    try { await rpc('inc_abrir', args); $('dlgNova').close(); toast('Inclusão aberta'); await carregar(); desenhar() }
    catch (e) { $('novaErro').textContent = e.message }
    finally { $('novaOk').disabled = false }
  })

  // ── navegação / TV ──
  document.querySelectorAll('#abas button').forEach(b => b.addEventListener('click', () => { setor = b.dataset.setor; gravarLocal('inc_setor', setor); desenhar() }))
  document.querySelectorAll('.hist-filtros button').forEach(b => b.addEventListener('click', () => { periodo = b.dataset.per; desenhar() }))
  function modoTV(on) { document.body.classList.toggle('tv', on); $('btnTV').textContent = on ? 'Sair do modo TV' : 'Modo TV'; if (on && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {}) }
  $('btnTV').addEventListener('click', () => modoTV(!document.body.classList.contains('tv')))
  if (qs.get('tv') === '1') modoTV(true)
  setInterval(() => { $('relogio').textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) }, 1000)

  // ── DEMO (não grava nada) ──
  function demoDados() {
    const min = m => new Date(agora() - m * 60000).toISOString()
    let id = 1
    const c = (pet, req, exame, set, etapa, parado, extra = {}) => ({ id: id++, criado_em: min(parado + 40), req, pet, clinica: 'Clínica de exemplo', exame, setor: set, origem: 'whatsapp', etapa, etapa_desde: min(parado), status: 'aberto', pausado: false, aberto_por: 'DEMO', amostra_entrada: min(parado + 120), ...extra })
    chamados = [
      c('BOB', '639990', 'Reticulócitos', 'hemato', 3, 12, { amostra_entrada: min(20 * 60) }),
      c('THOR', '640112', 'Fósforo', 'bioquimica', 3, 3),
      c('MEL', '640087', 'Frutosamina', 'bioquimica', 2, 8),
      c('TOBY', '640005', 'SDMA', 'bioquimica', 5, 4),
      c('NINA', '640021', 'PCR Erliquiose', 'pcr_soro', 4, 1560),
      c('LUNA', '640150', 'T4 total', 'bioquimica', 1, 22, { pausado: true }),
      c('KIRA', '639871', 'Ureia', 'bioquimica', 2, 31),
      c('REX', '639800', 'Colesterol', 'bioquimica', 7, 0, { status: 'concluido', concluido_em: min(15), criado_em: min(200) }),
    ]
    suspeitas = [{ id: 1, quando: min(22), grupo: 'Alpha - Clínica de exemplo', texto: 'Podem incluir fósforo no exame do Zeus por favor?' }]
    eventos = chamados.flatMap(x => [{ chamado_id: x.id, quando: x.criado_em, para: 1, acao: 'abriu' }, { chamado_id: x.id, quando: x.etapa_desde, para: x.etapa, acao: 'avancou' }])
  }
  function demoRpc(nome, a) {
    if (nome === 'inc_buscar_req') return { req: a.p_num, pet: 'THOR', especie: 'Canino', clinica: 'Clínica de exemplo', entrada: new Date(agora() - 6 * 3600e3).toISOString(), exames: ['Hemograma', 'ALT', 'Creatinina'] }
    if (nome === 'inc_abrir') { const x = { id: chamados.length + 100, criado_em: new Date().toISOString(), req: a.p_req, pet: a.p_pet, clinica: a.p_clinica, exame: a.p_exame, setor: a.p_setor, etapa: a.p_autorizado ? 2 : 1, etapa_desde: new Date().toISOString(), status: 'aberto', pausado: !a.p_autorizado, aberto_por: a.p_nome, amostra_entrada: a.p_entrada }; chamados.push(x); eventos.push({ chamado_id: x.id, quando: x.criado_em, para: x.etapa }); return x.id }
    if (nome === 'inc_acao') {
      const x = chamados.find(y => y.id === a.p_id); const prox = { cliente_autorizou: 2, amostra_ok: 3, sem_amostra: 1, escritorio_ok: 4, exame_liberado: 5, encerrar: 7, cliente_avisado: 8, cancelar: 8 }[a.p_acao]
      x.status = prox === 7 ? 'concluido' : prox === 8 ? 'cancelado' : a.p_acao === 'sem_amostra' ? 'sem_amostra' : 'aberto'
      x.etapa = Math.min(prox, 7); x.etapa_desde = new Date().toISOString(); x.pausado = false; if (prox >= 7) x.concluido_em = x.etapa_desde
      eventos.push({ chamado_id: x.id, quando: x.etapa_desde, para: prox, acao: a.p_acao }); return x.status
    }
  }

  // ── liga ──
  desenharLogin()
  carregar().then(desenhar)
  setInterval(desenhar, 15000)                         // relógio dos cartões (sem ir ao banco)
  if (SB) {
    SB.channel('inc_quadro').on('postgres_changes', { event: '*', schema: 'public', table: 'inc_chamados' }, () => carregar().then(desenhar))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inc_suspeitas' }, () => carregar().then(desenhar))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inc_eventos' }, () => {}).subscribe()
    setInterval(() => carregar().then(desenhar), 5 * 60000)   // rede de segurança se o tempo real cair
  }
})()
