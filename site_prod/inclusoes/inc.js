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
  // ORDEM (Thailan/Wal 16/set): atendimento registra → técnica vê se tem amostra → ATENDIMENTO confirma com a
  // clínica → escritório lança no HF → técnica faz e digita → escritório libera, envia e-mail e encerra
  const ETAPAS = {
    1: { nome: 'Registrar o pedido', dono: 'cc', prazo: '10 min' },
    2: { nome: 'Tem amostra?', dono: 'tec', prazo: '10 min' },
    3: { nome: 'Confirmar com a clínica', dono: 'cc', prazo: '5–10 min' },
    4: { nome: 'Lançar no HF', dono: 'esc', prazo: '10 min' },
    5: { nome: 'Exames feitos e digitados', dono: 'tec', prazo: 'por exame' },
    6: { nome: 'Liberar e enviar e-mail', dono: 'esc', prazo: '10 min' },
    7: { nome: 'Avisar a clínica: laudo enviado', dono: 'cc', prazo: '10 min' },
  }
  const ETAPA_EXAME = 5
  const CLIENTE = {
    autorizou: 'autorizou se tiver amostra',
    quer_saber_amostra: 'ainda não autorizou — quer saber se tem amostra',
    perguntou_preco: 'perguntou o preço — não autorizou',
    perguntou_ha_amostra: 'perguntou se ainda há amostra — não autorizou',
  }
  // etapa 4 = tempo do exame. PROVISÓRIO até medir no HF (Wal autorizou medir).
  const PRAZO_EXAME_MIN = { hemato: 120, bioquimica: 240, urina_fezes: 240, pcr_soro: 4320, cito_histo: 7200, outros: 1440 }
  const VALIDADE_H = { hemato: 24, bioquimica: 168, urina_fezes: 24, pcr_soro: 168, cito_histo: null, outros: 168 }
  const NOME_SETOR = { hemato: 'Hematologia', bioquimica: 'Bioquímica', urina_fezes: 'Urina / Fezes', pcr_soro: 'PCR / Sorologia', cito_histo: 'Citologia / Histo', outros: 'Outros' }
  const LEMBRETE_CLIENTE_MIN = 30       // Thailan 16/set: clínica informada e sem resposta há 30 min → alerta para cobrar de novo

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
      const abertos = await SB.from('inc_chamados').select('*').in('status', ['aberto', 'sem_amostra', 'enviado'])
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
      const sp = await SB.from('inc_suspeitas').select('*').gte('quando', new Date(agora() - 8 * 864e5).toISOString()).order('quando', { ascending: false }).range(0, 999)
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
      try { await rpc('inc_definir_setor', { p_nome: nome, p_senha: s1, p_setor: $('criarSetor').value }); sessao.setorInc = $('criarSetor').value } catch {}
      gravarLocal('inc_sessao', JSON.stringify(sessao)); gravarLocal('inc_ultimo_nome', nome)
      $('dlgCriar').close(); desenharLogin(); desenhar(); toast(`Login criado. Bem-vindo, ${nome}`)
      pedirLogin._res && pedirLogin._res(true)
    } catch (e) { $('criarErro').textContent = 'Sem conexão. Tente de novo.' }
    finally { $('criarOk').disabled = false }
  })
  async function garantirLogin() {
    if (!(sessao && sessao.ate > Date.now())) { if (!(await pedirLogin())) return false }
    return garantirSetor()
  }
  // cada login mexe só no SEU setor (Thailan 16/set). Sem setor ainda → a pessoa escolhe uma vez; admin corrige.
  async function garantirSetor() {
    if (DEMO) { sessao.setorInc = 'admin'; desenharLogin(); return true }
    if (!sessao.setorInc) {
      try { sessao.setorInc = await rpc('inc_meu_setor', { p_nome: sessao.nome, p_senha: sessao.senha }) || '' } catch (e) { toast(e.message); return false }
      gravarLocal('inc_sessao', JSON.stringify(sessao))
    }
    if (sessao.setorInc) { desenharLogin(); return true }
    $('dlgSetor').showModal()
    return new Promise(res => { garantirSetor._res = res })
  }
  document.querySelectorAll('#dlgSetor [data-set]').forEach(b => b.addEventListener('click', async () => {
    try {
      await rpc('inc_definir_setor', { p_nome: sessao.nome, p_senha: sessao.senha, p_setor: b.dataset.set })
      sessao.setorInc = b.dataset.set; gravarLocal('inc_sessao', JSON.stringify(sessao))
      $('dlgSetor').close(); desenharLogin(); desenhar(); toast(`Setor definido: ${SETORES[b.dataset.set].nome}`)
      garantirSetor._res && garantirSetor._res(true)
    } catch (e) { $('setorErro').textContent = e.message }
  }))
  function desenharLogin() {
    const set = sessao && sessao.setorInc ? (sessao.setorInc === 'admin' ? ' (admin)' : ` (${SETORES[sessao.setorInc]?.nome.toLowerCase() || ''})`) : ''
    $('btnLogin').textContent = sessao ? `${sessao.nome}${set} · Sair` : 'Entrar'
    $('btnEquipe').hidden = !(sessao && sessao.setorInc === 'admin' && !DEMO)
  }
  // ── admin: setor de cada pessoa ──
  $('btnEquipe').addEventListener('click', async () => {
    try {
      const lista = await rpc('inc_equipe_list', { p_nome: sessao.nome, p_senha: sessao.senha })
      const opts = v => ['', 'cc', 'tec', 'esc', 'admin'].map(k => `<option value="${k}" ${k === (v || '') ? 'selected' : ''}>${k === '' ? '— sem setor —' : k === 'admin' ? 'Administrador (todos)' : SETORES[k].nome}</option>`).join('')
      $('equipeLista').innerHTML = (lista || []).map(p => `<label class="eq"><span>${esc(p.nome)}</span><select data-nome="${esc(p.nome)}">${opts(p.setor)}</select></label>`).join('')
      $('dlgEquipe').showModal()
    } catch (e) { toast(e.message) }
  })
  $('equipeLista').addEventListener('change', async ev => {
    const sel = ev.target.closest('select'); if (!sel || !sel.value) return
    try { await rpc('inc_equipe_set', { p_nome: sessao.nome, p_senha: sessao.senha, p_alvo: sel.dataset.nome, p_setor: sel.value }); toast(`${sel.dataset.nome}: ${sel.options[sel.selectedIndex].text}`) } catch (e) { toast(e.message) }
  })
  $('btnLogin').addEventListener('click', () => {
    if (sessao) { sessao = null; gravarLocal('inc_sessao', null); desenharLogin(); desenhar(); toast('Saiu') } else garantirLogin().then(() => desenhar())
  })
  document.querySelectorAll('dialog [data-fechar]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()))

  // ── estado visual de cada cartão ──
  function minutosNaEtapa(c) { return (agora() - T(c.etapa_desde)) / 60000 }
  function donoAtual(c) { return c.status === 'sem_amostra' || c.status === 'enviado' ? 'cc' : ETAPAS[c.etapa]?.dono }
  const ativo = c => c.status === 'aberto' || c.status === 'sem_amostra' || c.status === 'enviado'
  const etapaVisivel = c => c.status === 'sem_amostra' ? 1 : c.status === 'enviado' ? 7 : c.etapa
  // última vez que a clínica foi informada (cada "Mensagem enviada" / "Cobrei de novo" reinicia a contagem)
  function ultimoEvento(c, acao) { const ev = eventos.filter(e => e.chamado_id === c.id && e.acao === acao).sort((a, b) => T(b.quando) - T(a.quando))[0]; return ev || null }
  function estado(c) {
    if (c.hf_alerta) return 's-v2'
    const m = minutosNaEtapa(c)
    if (c.pausado) { const u = ultimoEvento(c, 'aguardando_clinica'); const mm = u ? (agora() - T(u.quando)) / 60000 : m; return mm >= LEMBRETE_CLIENTE_MIN ? 's-v1' : 's-p' }
    if (c.status === 'sem_amostra') return m >= ESCALA[1] ? 's-v1' : 's-a2'
    const vence = amostraPct(c) >= 80
    if (c.etapa === ETAPA_EXAME) {
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
    const dono = donoAtual(c)
    if (sessao && sessao.setorInc && sessao.setorInc !== 'admin' && sessao.setorInc !== dono) return `<span class="so-setor">ação de ${SETORES[dono].nome}</span>`
    if (c.status === 'enviado') return `<button data-acao="avisou_envio">Clínica avisada do envio · concluir</button>`
    if (c.status === 'sem_amostra') return `<button data-acao="cliente_avisado">Clínica avisada · encerrar</button>`
    const cancelar = `<button class="leve" data-acao="cancelar">Cancelar</button>`
    switch (c.etapa) {
      case 2: return `<button data-acao="amostra_ok">Tem amostra suficiente</button><button class="nao" data-acao="sem_amostra">Não tem amostra → avisar clínica</button>${cancelar}`
      case 3: return `<button data-acao="clinica_confirmou">${c.cliente_status === 'autorizou' ? 'Clínica avisada · seguir' : 'Clínica autorizou · seguir'}</button><button class="leve" data-acao="aguardando_clinica">${c.pausado ? 'Cobrei a clínica de novo' : 'Mensagem enviada · aguardando clínica'}</button><button class="nao" data-acao="clinica_desistiu">Clínica não quer · cancelar</button>`
      case 4: return `<button data-acao="escritorio_ok">${c.novo_numero ? 'Lançado no HF com NOVO número' : 'Lançado no HF'}</button>${cancelar}`
      case 5: return `<button data-acao="exames_digitados">Exames feitos e digitados</button>${cancelar}`
      case 6: return `<button data-acao="encerrar">Liberado e e-mail enviado · encerrar</button>${cancelar}`
    }
    return cancelar
  }

  // ── desenho ──
  function desenhar() {
    document.querySelectorAll('#abas button').forEach(b => b.classList.toggle('on', b.dataset.setor === setor))
    const hist = setor === 'hist', todos = setor === 'todos', rast = setor === 'rast'
    $('vQuadro').hidden = hist || rast; $('vHist').hidden = !hist; $('vRast').hidden = !rast
    desenharLegenda()
    desenharRastreamento()
    if (hist) return desenharHistorico()
    if (rast) return
    const abertos = chamados.filter(ativo)

    // caminho da inclusão: 5 etapas, cor = dono, número = quantas estão ali (vermelho se alguma estourou)
    $('fluxo').innerHTML = Object.entries(ETAPAS).map(([n, e]) => {
      const s = SETORES[e.dono], aqui = abertos.filter(c => etapaVisivel(c) === +n)
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
    $('concluidas').innerHTML = conc.length ? `<div class="linhas">${conc.map(c => `<div class="lin ${c.hf_alerta ? 'atras' : ''}"><span>${c.hf_alerta ? '⚠ não está no HF · ' : ''}✓ <b>${esc(c.pet || '')}</b> +${esc(c.exame)}</span><span class="t">${fmt((T(c.concluido_em) - T(c.criado_em)) / 60000)}</span></div>`).join('')}</div>` : '<div class="lin mudo">nenhuma ainda</div>'

    explodir(meus)
  }
  function cartaoHTML(c) {
    const st = estado(c), m = minutosNaEtapa(c), pct = amostraPct(c), e = ETAPAS[etapaVisivel(c)]
    const prazoTxt = c.pausado ? 'esperando a clínica' : c.status === 'sem_amostra' ? 'avisar o cliente' : c.etapa === ETAPA_EXAME ? `prazo ${fmt(PRAZO_EXAME_MIN[c.setor])}` : ROTULO[st]
    const amostra = VALIDADE_H[c.setor] && c.amostra_entrada && pct >= 50
      ? `<div class="amostra ${pct >= 80 ? 'alerta' : ''}">amostra ${pct}% da validade<span class="barra"><i style="width:${pct}%"></i></span></div>` : ''
    return `<article class="cartao ${st}" data-id="${c.id}" title="aberta ${hm(c.criado_em)} por ${esc(c.aberto_por || '')}${c.obs ? ' · ' + esc(c.obs) : ''}">
      <div class="c-esq">
        <div class="c-etapa">${c.status === 'sem_amostra' ? '<span class="selo">sem amostra</span>' : `${etapaVisivel(c)} · ${e ? e.nome : ''}`}${c.novo_numero ? ` <span class="selo novo">${c.novo_req ? 'novo nº ' + esc(c.novo_req) : '🆕 amostra de outro dia: novo nº + nova requisição'}</span>` : ''}</div>
        <div class="c-pet">${esc(c.pet || 'sem nome')} <span class="req">${esc(c.req)}</span></div>
        <div class="c-exame">+ ${esc(c.exame)}</div>
        <div class="c-clin">${esc(c.clinica || '')} · ${NOME_SETOR[c.setor] || ''}${c.cliente_status && c.cliente_status !== 'autorizou' && c.etapa <= 3 ? ` · <b class="cli">cliente ${CLIENTE[c.cliente_status] || ''}</b>` : ''}</div>
        ${infoExtra(c)}
        ${hfLinha(c)}
        ${amostra}
      </div>
      <div class="c-dir"><div class="tempo">${fmt(m)}</div><div class="rot">${prazoTxt}</div></div>
      <div class="acao">${botoes(c)}</div>
    </article>`
  }
  function infoExtra(c) {
    const out = []
    if (c.status === 'sem_amostra') {
      const ev = ultimoEvento(c, 'sem_amostra')
      out.push(`<div class="info ruim">🔬 Técnica: <b>${esc(ev?.obs || 'sem motivo escrito')}</b>${ev ? ` · ${esc(ev.por)} às ${hm(ev.quando)}` : ''} → avisar a clínica</div>`)
    }
    if (c.etapa === 3 && c.pausado && c.status === 'aberto') {
      const ev = ultimoEvento(c, 'aguardando_clinica')
      const mm = ev ? (agora() - T(ev.quando)) / 60000 : 0
      out.push(`<div class="info ${mm >= LEMBRETE_CLIENTE_MIN ? 'ruim' : ''}">🕒 Clínica informada que HÁ amostra${ev ? ` às ${hm(ev.quando)} (${esc(ev.por)})` : ''} · aguardando autorização há ${fmt(mm)}${mm >= LEMBRETE_CLIENTE_MIN ? ' — <b>cobrar a clínica de novo</b>' : ''}</div>`)
    }
    if (c.status === 'enviado') {
      const ev = ultimoEvento(c, 'encerrar')
      out.push(`<div class="info ok">📧 Escritório liberou e enviou o e-mail${ev ? ` às ${hm(ev.quando)} (${esc(ev.por)})` : ''} → avisar a clínica</div>`)
    }
    return out.join('')
  }
  // FASE 2: o que o HF mostra sobre este cartão (conferência automática a cada 30 min)
  function hfLinha(c) {
    if (c.hf_alerta) return `<div class="hf ruim">⚠ ${esc(c.hf_alerta)}</div>`
    if (c.hf_lancado_em) return `<div class="hf ok">✅ HF: lançado por ${esc(c.hf_lancado_por || '?')} às ${hm(c.hf_lancado_em)}${c.hf_digitado ? ' · digitado' : ''}${c.hf_transmitido ? ' · transmitido ' + dataCurta(c.hf_transmitido + 'T12:00:00') : ''}</div>`
    if (c.etapa >= 4 && c.hf_conferido_em) return `<div class="hf">🔎 ainda não apareceu no HF (conferido às ${hm(c.hf_conferido_em)})</div>`
    return ''
  }
  function desenharKanban(abertos) {
    $('kanban').innerHTML = Object.entries(ETAPAS).map(([n, e]) => {
      const s = SETORES[e.dono]
      const lst = abertos.filter(c => etapaVisivel(c) === +n).sort((a, b) => T(a.etapa_desde) - T(b.etapa_desde))
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
      <span><i class="pt" style="--c:var(--cc)"></i>Atendimento registra e confirma com a clínica</span>
      <span><i class="pt" style="--c:var(--tec)"></i>Técnica vê a amostra e digita</span>
      <span><i class="pt" style="--c:var(--esc)"></i>Escritório lança, libera e encerra</span>
      <span>🆕 amostra de outro dia = novo nº + nova requisição</span>
      <span class="sep"></span>
      <span><i class="pt" style="--c:var(--amarelo)"></i>até ${b} min</span>
      <span><i class="pt" style="--c:var(--vermelho)"></i>${b} min atrasado · ${c} apita · ${d} explode</span>
      <span><i class="pt" style="--c:var(--pausa)"></i>esperando a clínica (cobrar após ${fmt(LEMBRETE_CLIENTE_MIN)})</span>
      <span class="mudo">· cartão só sai quando a clínica é avisada do envio</span>
      <span class="mudo">· 🔎 o sistema confere com o HF a cada 30 min</span>`
  }

  // ── contraprova: pedido de inclusão no WhatsApp sem cartão (o ouvinte lê os grupos das clínicas) ──
  const SUSPEITA_MIN = 15
  function desenharSuspeitas() {
    const caixa = $('suspeitas')
    const pend = pendentesInclusao()
    caixa.hidden = !(setor === 'cc') || !pend.length
    if (caixa.hidden) return
    caixa.innerHTML = `<h3>⚠ ${pend.length} pedido${pend.length > 1 ? 's' : ''} de inclusão no WhatsApp sem cartão</h3><button class="leve" id="irRast">Ver em Rastreamento de Inclusões →</button>`
    $('irRast').onclick = () => { setor = 'rast'; desenhar() }
  }
  const pendentesInclusao = () => suspeitas.filter(x => x.status === 'aberta' && (x.tipo || 'inclusao') === 'inclusao' && (agora() - T(x.quando)) / 60000 >= SUSPEITA_MIN && !temCartaoPara(x))
  // ── aba RASTREAMENTO DE INCLUSÕES (pedido do Thailan): tudo que o sistema captou no WhatsApp ──
  let periodoRast = 'dia'
  function desenharRastreamento() {
    const dias = periodoRast === 'dia' ? 0 : 7
    const ini = new Date(); ini.setHours(0, 0, 0, 0); ini.setDate(ini.getDate() - dias)
    const lista = suspeitas.filter(x => T(x.quando) >= ini.getTime()).sort((a, b) => T(b.quando) - T(a.quando))
    const pend = pendentesInclusao().length
    document.querySelectorAll('.rast-filtros button').forEach(b => b.classList.toggle('on', b.dataset.per === periodoRast))
    $('rastResumo').innerHTML = `<div><b>${lista.filter(x => (x.tipo || 'inclusao') === 'inclusao').length}</b><span>🧪 pedidos de inclusão</span></div><div><b>${lista.filter(x => x.tipo === 'amostra').length}</b><span>🔬 mensagens falando de amostra</span></div><div><b class="${pend ? 'vermelho' : ''}">${pend}</b><span>sem cartão há +${SUSPEITA_MIN} min</span></div>`
    $('rastLista').innerHTML = lista.length ? lista.map(x => {
      const tipo = (x.tipo || 'inclusao') === 'inclusao'
      const status = x.status === 'aberta' ? (tipo && pendentesInclusao().some(p => p.id === x.id) ? '<span class="st ruim">sem cartão</span>' : '<span class="st">aberta</span>')
        : x.status === 'registrada' ? `<span class="st ok">tratada · ${esc(x.resolvido_por || '')} ${x.resolvido_em ? hm(x.resolvido_em) : ''}</span>`
        : `<span class="st">não é inclusão · ${esc(x.resolvido_por || '')} ${x.resolvido_em ? hm(x.resolvido_em) : ''}</span>`
      return `<div class="rast ${tipo ? 'inc' : 'amo'}" data-id="${x.id}">
        <div class="r-cab"><span class="r-tipo">${tipo ? '🧪 Pedido de inclusão' : '🔬 Fala de amostra'}</span><b>${esc((x.grupo || '').replace(/^[^A-Za-z0-9]*Alpha-? ?-? ?/i, ''))}</b><span class="mudo">${dataCurta(x.quando)} ${hm(x.quando)} · ${esc(x.autor || '')}</span>${status}</div>
        <div class="r-txt">“${esc(x.texto)}”</div>
        ${x.status === 'aberta' ? `<div class="acao"><button data-sus="registrada">${tipo ? 'Já abri o cartão' : 'Visto · tratado'}</button>${tipo ? '<button data-sus="abrir">Abrir cartão agora</button>' : ''}<button class="leve" data-sus="nao_e_inclusao">Não é inclusão / cliente desistiu</button></div>` : ''}
      </div>`
    }).join('') : '<div class="vazio">Nada captado no período.</div>'
    const b = document.querySelector('#abas button[data-setor="rast"]')
    if (b) b.innerHTML = `Rastreamento de Inclusões${pend ? ` <span class="badge">${pend}</span>` : ''}`
  }
  function temCartaoPara(x) {
    const norm = t => (t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    const GEN = new Set(['alpha', 'labs', 'clinica', 'veterinaria', 'veterinario', 'consultorio', 'hospital', 'animal', 'centro'])
    const palavras = t => norm(t).split(/[^a-z0-9]+/).filter(w => w.length >= 5 && !GEN.has(w))
    const pg = palavras(x.grupo)
    return chamados.some(c => T(c.criado_em) >= T(x.quando) - 30 * 60000 && palavras((c.clinica || '') + ' ' + (c.pet || '')).some(w => pg.includes(w)))
  }
  $('rastLista').addEventListener('click', async ev => {
    const b = ev.target.closest('button[data-sus]'); if (!b) return
    if (!(await garantirLogin())) return
    const id = +b.closest('.rast').dataset.id
    if (b.dataset.sus === 'abrir') {
      const x = suspeitas.find(y => y.id === id)
      setor = 'cc'; desenhar(); $('btnNova').click()
      setTimeout(() => { $('nClinica').value = (x?.grupo || '').replace(/^[^A-Za-z0-9]*Alpha-? ?-? ?/i, '').trim(); $('nObs').value = x ? `WhatsApp ${hm(x.quando)}: ${x.texto.slice(0, 80)}` : '' }, 150)
      return
    }
    // "Já abri o cartão" sem cartão de verdade = a omissão continua escondida (caso Bandeirantes 16/set) → confere antes
    if (b.dataset.sus === 'registrada') {
      const x = suspeitas.find(y => y.id === id)
      if (x && (x.tipo || 'inclusao') === 'inclusao' && !temCartaoPara(x)) {
        if (!confirm('Não achei nenhum cartão dessa clínica aberto depois do pedido.\n\nOK = abrir o cartão agora\nCancelar = voltar')) return
        $('btnNova').click()
        setTimeout(() => { $('nClinica').value = (x.grupo || '').replace(/^[^A-Za-z0-9]*Alpha-? ?-? ?/i, '').trim() }, 150)
        return
      }
    }
    try {
      if (DEMO) { const x = suspeitas.find(y => y.id === id); if (x) { x.status = b.dataset.sus; x.resolvido_por = 'DEMO'; x.resolvido_em = new Date().toISOString() } }
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
        if (e.para == null || e.para > 7) continue
        const fim = prox ? T(prox.quando) : (ativo(c) ? agora() : T(c.concluido_em))
        const min = (fim - T(e.quando)) / 60000
        const lim = e.para === ETAPA_EXAME ? PRAZO_EXAME_MIN[c.setor] : ESCALA[1]
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
    const card = chamados.find(x => x.id === id)
    if (acao === 'cancelar' || acao === 'sem_amostra' || acao === 'clinica_desistiu') {
      obs = await pedirMotivo(acao === 'cancelar' ? 'Por que cancelar esta inclusão?' : acao === 'sem_amostra' ? 'O que aconteceu com a amostra?' : 'O que a clínica respondeu?')
      if (obs == null) return
    }
    if (acao === 'escritorio_ok' && card && card.novo_numero) {
      obs = await pedirMotivo('Qual o NOVO número da amostra no HF?', 'Número')
      if (obs == null) return
    }
    b.disabled = true
    try {
      await rpc('inc_acao', { p_nome: sessao.nome, p_senha: sessao.senha, p_id: id, p_acao: acao, p_obs: obs })
      toast('Registrado'); await carregar(); desenhar()
    } catch (e) {
      b.disabled = false
      if (/não conferem/.test(e.message)) { sessao = null; gravarLocal('inc_sessao', null); desenharLogin() }
      if (/outro setor|defina o seu setor/.test(e.message)) { sessao.setorInc = ''; gravarLocal('inc_sessao', JSON.stringify(sessao)) }
      toast(e.message)
    }
  })
  function pedirMotivo(titulo, rotulo = 'Motivo') {
    $('motivoTitulo').textContent = titulo; $('motivoRotulo').textContent = rotulo; $('motivoTexto').value = ''; $('motivoErro').textContent = ''
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
  // REGRA (Thailan 16/set): amostra de HOJE segue com o mesmo número; de dia anterior ganha NOVO número e precisa de
  // nova requisição para liberar o laudo. "Hoje" = data do calendário (fuso de Brasília).
  const diaBR = q => new Date(T(q)).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
  const outroDia = q => !!q && diaBR(q) < diaBR(new Date().toISOString())
  function avisoDia() {
    const q = entradaHF || ($('nData').value ? new Date($('nData').value + 'T12:00:00').toISOString() : null)
    const box = $('avisoDia')
    if (!q) { box.hidden = true; return }
    box.hidden = false
    box.className = 'aviso-dia ' + (outroDia(q) ? 'outro' : 'hoje')
    box.innerHTML = outroDia(q)
      ? `🆕 Amostra de <b>${dataCurta(q)}</b> (dia anterior): a inclusão vai ganhar <b>NOVO número</b> e precisa de <b>nova requisição</b> para liberar o laudo.`
      : `✅ Amostra de <b>hoje</b>: segue com o <b>mesmo número</b>.`
  }
  $('btnNova').addEventListener('click', async () => {
    if (!(await garantirLogin())) return
    $('formNova').reset(); $('puxado').hidden = true; $('novaErro').textContent = ''; entradaHF = null
    $('nData').value = diaBR(new Date().toISOString()); $('campoData').hidden = false; avisoDia()
    $('dlgNova').showModal(); $('nReq').focus()
  })
  $('btnBuscar').addEventListener('click', buscarHF)
  $('nData').addEventListener('change', avisoDia)
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
      $('campoData').hidden = !!entradaHF; avisoDia()
    } catch (e) { $('novaErro').textContent = e.message }
  }
  $('formNova').addEventListener('submit', async ev => {
    ev.preventDefault()
    const cliente = document.querySelector('input[name="nCliente"]:checked').value
    const entrada = entradaHF || ($('nData').value ? new Date($('nData').value + 'T12:00:00').toISOString() : null)
    const args = { p_nome: sessao.nome, p_senha: sessao.senha, p_req: $('nReq').value, p_pet: $('nPet').value.trim(), p_clinica: $('nClinica').value.trim(),
      p_exame: $('nExame').value.trim(), p_setor: $('nSetor').value, p_origem: $('nOrigem').value, p_cliente: cliente, p_entrada: entrada,
      p_novo_numero: outroDia(entrada), p_obs: $('nObs').value.trim() || null }
    if (!args.p_exame) { $('novaErro').textContent = 'Informe o exame a incluir.'; return }
    $('novaOk').disabled = true
    try { await rpc('inc_abrir2', args); $('dlgNova').close(); toast('Inclusão aberta'); await carregar(); desenhar() }
    catch (e) { $('novaErro').textContent = e.message }
    finally { $('novaOk').disabled = false }
  })

  // ── navegação / TV ──
  document.querySelectorAll('#abas button').forEach(b => b.addEventListener('click', () => { setor = b.dataset.setor; gravarLocal('inc_setor', setor); desenhar() }))
  document.querySelectorAll('.hist-filtros button').forEach(b => b.addEventListener('click', () => { periodo = b.dataset.per; desenhar() }))
  document.querySelectorAll('.rast-filtros button').forEach(b => b.addEventListener('click', () => { periodoRast = b.dataset.per; desenhar() }))
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
      c('LUNA', '640150', 'T4 total', 'bioquimica', 3, 45, { pausado: true, cliente_status: 'perguntou_preco' }),
      c('PIPOCA', '640171', 'Lipase', 'bioquimica', 1, 5, { status: 'sem_amostra' }),
      c('ZECA', '640133', 'Albumina', 'bioquimica', 7, 3, { status: 'enviado' }),
      c('FRED', '640099', 'Fósforo', 'bioquimica', 4, 6, { novo_numero: true, amostra_entrada: min(26 * 60) }),
      c('KIRA', '639871', 'Ureia', 'bioquimica', 2, 31),
      c('REX', '639800', 'Colesterol', 'bioquimica', 7, 0, { status: 'concluido', concluido_em: min(15), criado_em: min(200) }),
    ]
    suspeitas = [{ id: 1, status: 'aberta', tipo: 'inclusao', quando: min(22), grupo: 'Alpha - Pet Sorriso', autor: 'Dra. Ana', texto: 'Podem incluir fósforo no exame do Zeus por favor?' },
      { id: 2, status: 'aberta', tipo: 'amostra', quando: min(9), grupo: 'Alpha - Vet Horizonte', autor: 'Recepção', texto: 'Ainda tem amostra da Mel? Queria ver uma coisa' },
      { id: 3, status: 'registrada', tipo: 'inclusao', quando: min(95), grupo: 'Alpha - Bandeirantes', autor: 'Dra.', texto: 'Pode acrescentar fibrinogênio e colesterol', resolvido_por: 'DEMO', resolvido_em: min(80) }]
    eventos = chamados.flatMap(x => [{ chamado_id: x.id, quando: x.criado_em, para: 1, acao: 'abriu' }, { chamado_id: x.id, quando: x.etapa_desde, para: x.etapa, acao: 'avancou' }])
    eventos.push({ chamado_id: 6, quando: min(38), para: 3, acao: 'aguardando_clinica', por: 'DEMO' }, { chamado_id: 7, quando: min(5), para: 1, acao: 'sem_amostra', obs: 'soro hemolisado, não dá para fazer', por: 'DEMO' }, { chamado_id: 8, quando: min(3), para: 7, acao: 'encerrar', por: 'DEMO' })
  }
  function demoRpc(nome, a) {
    if (nome === 'inc_buscar_req') return { req: a.p_num, pet: 'THOR', especie: 'Canino', clinica: 'Clínica de exemplo', entrada: new Date(agora() - 6 * 3600e3).toISOString(), exames: ['Hemograma', 'ALT', 'Creatinina'] }
    if (nome === 'inc_abrir2') { const x = { id: chamados.length + 100, criado_em: new Date().toISOString(), req: a.p_req, pet: a.p_pet, clinica: a.p_clinica, exame: a.p_exame, setor: a.p_setor, etapa: 2, etapa_desde: new Date().toISOString(), status: 'aberto', pausado: false, aberto_por: a.p_nome, amostra_entrada: a.p_entrada, cliente_status: a.p_cliente, novo_numero: a.p_novo_numero }; chamados.push(x); eventos.push({ chamado_id: x.id, quando: x.criado_em, para: 2 }); return x.id }
    if (nome === 'inc_abrir') { const x = { id: chamados.length + 100, criado_em: new Date().toISOString(), req: a.p_req, pet: a.p_pet, clinica: a.p_clinica, exame: a.p_exame, setor: a.p_setor, etapa: a.p_autorizado ? 2 : 1, etapa_desde: new Date().toISOString(), status: 'aberto', pausado: !a.p_autorizado, aberto_por: a.p_nome, amostra_entrada: a.p_entrada }; chamados.push(x); eventos.push({ chamado_id: x.id, quando: x.criado_em, para: x.etapa }); return x.id }
    if (nome === 'inc_acao') {
      const x = chamados.find(y => y.id === a.p_id); const prox = { amostra_ok: 3, sem_amostra: 1, aguardando_clinica: 3, clinica_confirmou: 4, clinica_desistiu: 8, escritorio_ok: 5, exames_digitados: 6, encerrar: 7, avisou_envio: 7, cliente_avisado: 8, cancelar: 8 }[a.p_acao]
      x.status = a.p_acao === 'encerrar' ? 'enviado' : a.p_acao === 'avisou_envio' ? 'concluido' : prox === 8 ? 'cancelado' : a.p_acao === 'sem_amostra' ? 'sem_amostra' : 'aberto'
      x.etapa = Math.min(prox, 7); if (a.p_acao !== 'aguardando_clinica') x.etapa_desde = new Date().toISOString(); x.pausado = a.p_acao === 'aguardando_clinica'
      if (a.p_acao === 'escritorio_ok' && x.novo_numero) x.novo_req = a.p_obs
      if (x.status === 'concluido' || x.status === 'cancelado') x.concluido_em = x.etapa_desde
      eventos.push({ chamado_id: x.id, quando: new Date().toISOString(), para: prox, acao: a.p_acao, obs: a.p_obs, por: 'DEMO' }); return x.status
    }
  }

  // ── real × teste bem visível (pedido do Wal 16/set) ──
  ;(function selo() {
    const el = document.createElement('div')
    el.className = DEMO ? 'selo-modo demo' : 'selo-modo real'
    el.innerHTML = DEMO
      ? '🧪 MODO DEMONSTRAÇÃO — tudo nesta tela é EXEMPLO inventado. Nada é gravado. <a href="?setor=' + setor + '">ir para o quadro real</a>'
      : '● AO VIVO — inclusões reais da equipe'
    document.body.prepend(el)
  })()

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
