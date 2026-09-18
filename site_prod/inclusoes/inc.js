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
  let terremotos = []
  let suspeitas = [], coletas = [], regras = [], rotasVivo = [], nps = [], npsConvites = [], chamados = [], eventos = [], sessao = lerSessao(), explodeCalado = new Set(), somLiberado = false, periodo = 'dia'
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
    if (DEMO) { if (!chamados.length) demoDados(); return }   // demo: dados em memória (inclusive os terremotos do ensaio)
    try {
      const lim = new Date(agora() - 31 * 864e5).toISOString()
      const abertos = await SB.from('inc_chamados').select('*').in('status', ['aberto', 'sem_amostra', 'enviado', 'rascunho'])
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
      const np = await SB.from('nps_respostas').select('*').gte('quando', new Date(agora() - 180 * 864e5).toISOString()).order('quando', { ascending: false }).range(0, 999)
      nps = np.error ? [] : (np.data || [])
      const nc = await SB.from('nps_convites').select('*').gte('criado_em', new Date(agora() - 180 * 864e5).toISOString()).range(0, 999)
      npsConvites = nc.error ? [] : (nc.data || [])
      const rv = await SB.from('rota_vivo').select('*').order('rota')
      rotasVivo = rv.error ? [] : (rv.data || [])
      const rg = await SB.from('inc_regras_clinica').select('*').eq('ativa', true)
      regras = rg.error ? [] : (rg.data || [])
      const cl = await SB.from('inc_coletas').select('*').gte('quando', new Date(agora() - 3 * 864e5).toISOString()).order('quando', { ascending: false }).range(0, 499)
      coletas = cl.error ? [] : (cl.data || [])
      const tr = await SB.from('inc_terremotos').select('*').gte('aberto_em', new Date(agora() - 3 * 864e5).toISOString())
      terremotos = tr.error ? [] : (tr.data || [])
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
  // números do topo (pedido do Wal 18/set: cara de BI)
  function desenharKpis(abertos) {
    const el = $('kpis'); if (!el) return
    const atrasados = abertos.filter(c => ['s-v1', 's-v2', 's-x'].includes(estado(c))).length
    const hoje0 = new Date(); hoje0.setHours(0, 0, 0, 0)
    const feitas = chamados.filter(c => c.status === 'concluido' && T(c.concluido_em) >= hoje0.getTime())
    const dur = feitas.map(c => (T(c.concluido_em) - T(c.criado_em)) / 60000).filter(m => m > 0)
    const media = dur.length ? fmt(dur.reduce((a, b) => a + b, 0) / dur.length) : '—'
    const iaPend = pendentesInclusao().length
    el.innerHTML = `<div class="kpi"><b>${abertos.length}</b><span>inclusões andando agora</span></div>
      <div class="kpi ${atrasados ? 'ruim' : ''}"><b>${atrasados}</b><span>atrasadas — passaram do prazo</span></div>
      <div class="kpi ia"><b>${iaPend}</b><span>🤖 pedidos no WhatsApp sem cartão</span></div>
      <div class="kpi bom"><b>${feitas.length}</b><span>concluídas hoje${dur.length ? ` · média ${media}` : ''}</span></div>`
  }
  // 🤖 rascunhos que a IA abriu sozinha a partir do WhatsApp — o Atendimento confere e confirma
  function desenharRascunhos() {
    const el = $('rascunhos'); if (!el) return
    const lista = chamados.filter(c => c.status === 'rascunho').sort((a, b) => T(a.criado_em) - T(b.criado_em))
    const mostrar = (setor === 'cc' || setor === 'todos') && lista.length
    el.hidden = !mostrar
    if (!mostrar) return
    el.innerHTML = `<h3>🤖 ${lista.length} cartão${lista.length > 1 ? 'ões' : ''} que a IA abriu sozinha — confira e confirme</h3>` + lista.map(c => `
      <div class="rasc" data-id="${c.id}">
        <div class="rasc-msg">${esc(c.obs || '')}</div>
        <div class="rasc-campos">
          <label>Requisição <input data-campo="req" value="${esc(c.req || '')}" inputmode="numeric"></label>
          <label>Pet <input data-campo="pet" value="${esc(c.pet || '')}"></label>
          <label>Exame <input data-campo="exame" value="${esc(c.exame || '')}"></label>
          <span class="rasc-clin">${esc(c.clinica || '')}${c.novo_numero ? ' · <b class="rosa">amostra de outro dia → novo nº</b>' : ''}</span>
        </div>
        <div class="acao"><button data-rasc="confirmar">✔ Confirmar e mandar para a Área Técnica</button><button class="nao" data-rasc="descartar">🚫 A IA errou — descartar</button></div>
      </div>`).join('')
  }
  $('rascunhos') && $('rascunhos').addEventListener('click', async ev => {
    const b = ev.target.closest('button[data-rasc]'); if (!b) return
    if (!(await garantirLogin())) return
    const cx = b.closest('.rasc'), id = +cx.dataset.id
    const val = campo => cx.querySelector(`input[data-campo="${campo}"]`).value.trim()
    try {
      if (b.dataset.rasc === 'descartar' && !confirm('Descartar este cartão? A IA não deveria ter aberto.')) return
      await rpc('inc_rascunho_acao', { p_nome: sessao.nome, p_senha: sessao.senha, p_id: id, p_acao: b.dataset.rasc, p_req: val('req'), p_pet: val('pet'), p_exame: val('exame') })
      toast(b.dataset.rasc === 'confirmar' ? 'Cartão confirmado — seguiu para a Área Técnica' : 'Rascunho descartado')
      await carregar(); desenhar()
    } catch (e) { toast(e.message) }
  })
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
    try { avisarNovidades() } catch {}
    document.querySelectorAll('#abas button').forEach(b => b.classList.toggle('on', b.dataset.setor === setor))
    const hist = setor === 'hist', todos = setor === 'todos', rast = setor === 'rast', col = setor === 'coleta', rot = setor === 'rotas', npsv = setor === 'nps', terr = setor === 'terremoto'
    $('vQuadro').hidden = hist || rast || col || rot || npsv || terr; $('vHist').hidden = !hist; $('vRast').hidden = !rast; $('vColeta').hidden = !col; $('vRotas').hidden = !rot; $('vNps').hidden = !npsv; $('vTerremoto').hidden = !terr
    desenharLegenda()
    desenharRastreamento()
    desenharColetas()
    desenharRotas()
    desenharNps()
    try { desenharTerremoto() } catch {}
    if (hist) return desenharHistorico()
    if (rast || col || rot || npsv || terr) return
    const abertos = chamados.filter(ativo)
    desenharKpis(abertos)
    desenharRascunhos()

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
        ${ehNovo(c) ? '<div class="selo-novo">🔔 NOVO</div>' : ''}
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
  // ── 🤖 aba da IA (Wal 17/set: cor ROSA fixa = reconhecimento automático) ──
  const EXAMES_IA = [[/f[oó]sforo/i, 'fósforo'], [/c[aá]lcio/i, 'cálcio'], [/s[oó]dio/i, 'sódio'], [/pot[aá]ssio/i, 'potássio'], [/ureia/i, 'ureia'], [/creatinina/i, 'creatinina'],
    [/\bsdma\b/i, 'SDMA'], [/\bt4\b/i, 'T4'], [/frutosamina/i, 'frutosamina'], [/glicose/i, 'glicose'], [/albumina/i, 'albumina'], [/prote[ií]na/i, 'proteína'],
    [/colesterol/i, 'colesterol'], [/triglic/i, 'triglicerídeos'], [/fibrinog/i, 'fibrinogênio'], [/\bggt\b/i, 'GGT'], [/\balt\b|\btgp\b/i, 'ALT'], [/\bast\b|\btgo\b/i, 'AST'],
    [/\bfa\b|fosfatase/i, 'FA'], [/bilirrub|bilibub/i, 'bilirrubinas'], [/lipase/i, 'lipase'], [/amilase/i, 'amilase'], [/\bck\b|cpk/i, 'CK'], [/reticul/i, 'reticulócitos'],
    [/4dx|snap/i, '4DX'], [/\bpcr\b/i, 'PCR'], [/sorolog/i, 'sorologia'], [/hemograma/i, 'hemograma'], [/urin[aá]lise|\beas\b|urina/i, 'urina'], [/cito/i, 'citologia'], [/histo/i, 'histopatologia'], [/cortisol/i, 'cortisol'], [/eletr[oó]litos/i, 'eletrólitos'], [/perfil/i, 'perfil']]
  // Wal 17/set (foto): "Tem amostra na Pet Golden / para buscar / Tenho amostra" = AGENDAMENTO DE COLETA, não inclusão → não mostra
  // (mesmo filtro do ouvinte; esconde também as que foram gravadas antes do filtro)
  const COLETA_RX = /\b(busc\w*|colet\w*|envi\w*|reenvi\w*|rota|retir\w*|recolh\w*|pegar|motoboy|motoca|passar (aqui|a[ií]|l[aá]))\b/i
  const SO_AVISO_RX = /^\W*((bom dia|boa tarde|boa noite|ol[aá]|oi)[\s,!.]*)*(tenho|tem|temos|t[oô] com|estou com|j[aá] tem|h[aá])\s+(\d+\s+)?amostras?\b[^?]*$/i
  const ehColeta = t => COLETA_RX.test(t || '') || SO_AVISO_RX.test((t || '').trim())
  const examesDoTexto = t => EXAMES_IA.filter(([rx]) => rx.test(t || '')).map(([, n]) => n)
  const nomeClinica = g => (g || '').replace(/^[^A-Za-z0-9]*Alpha-? ?-? ?/i, '').replace(/^[^A-Za-z0-9]+/, '').trim()
  function chipsIA(x) {
    const ch = []
    if (x.sug_req) {
      ch.push(`<span class="chip-ia">pet <b>${esc(x.sug_pet || '')}</b></span>`)
      ch.push(`<span class="chip-ia">requisição provável <b>${esc(x.sug_req)}</b> · entrou ${dataCurta(x.sug_entrada)} ${hm(x.sug_entrada)}</span>`)
      if (x.sug_n === 1) ch.push(`<span class="chip-ia">⚠ confira a clínica: ${esc(x.sug_cliente || '')}</span>`)
      if (x.sug_entrada && diaBR(x.sug_entrada) !== diaBR(x.quando)) ch.push('<span class="chip-ia">⚠ amostra de outro dia → novo nº</span>')
    } else if (x.sug_n === 0) ch.push('<span class="chip-ia">requisição: <b>não achei</b> — perguntar à clínica</span>')
    else ch.push('<span class="chip-ia">procurando a requisição…</span>')
    const ex = examesDoTexto(x.texto)
    if (ex.length) ch.push(`<span class="chip-ia">exame <b>${esc(ex.join(' + '))}</b></span>`)
    return `<div class="ia-achou"><span class="ia-tag">🤖 A IA ACHOU:</span>${ch.join('')}</div>`
  }
  function desenharRastreamento() {
    if ($('rastAjuda')) $('rastAjuda').innerHTML = '<b>✔ Já resolvi</b> = você tratou com a clínica, o item sai da lista. <b>🚫 A IA errou</b> = isso nem era pedido de inclusão; além de sair da lista, <b>a IA aprende e para de captar frases parecidas</b>.'
    const dias = periodoRast === 'dia' ? 0 : 7
    const ini = new Date(); ini.setHours(0, 0, 0, 0); ini.setDate(ini.getDate() - dias)
    const doPeriodo = suspeitas.filter(x => T(x.quando) >= ini.getTime())
    const pendIds = new Set(pendentesInclusao().map(p => p.id))
    const inc = doPeriodo.filter(x => (x.tipo || 'inclusao') === 'inclusao')
    const semCartao = inc.filter(x => pendIds.has(x.id))
    const agora_ = inc.filter(x => x.status === 'aberta' && !pendIds.has(x.id) && !temCartaoPara(x))
    const tratadas = inc.filter(x => !semCartao.includes(x) && !agora_.includes(x))
    const amo = doPeriodo.filter(x => x.tipo === 'amostra' && !ehColeta(x.texto)).sort((a, b) => T(b.quando) - T(a.quando))
    document.querySelectorAll('.rast-filtros button').forEach(b => b.classList.toggle('on', b.dataset.per === periodoRast))
    $('rastResumo').innerHTML = `<div class="n-ruim"><b>${semCartao.length}</b><span>sem cartão há mais de ${SUSPEITA_MIN} min</span></div><div class="n-novo"><b>${agora_.length}</b><span>chegou agora (até ${SUSPEITA_MIN} min)</span></div><div class="n-ok"><b>${tratadas.length}</b><span>com cartão / tratado</span></div>`
    const minDesde = x => (agora() - T(x.quando)) / 60000
    const bloco = (x, cls) => {
      const estado = cls === 'sem' ? 'SEM CARTÃO' : cls === 'novo' ? 'AGUARDANDO' : x.status === 'nao_e_inclusao' ? 'NÃO É INCLUSÃO' : 'COM CARTÃO'
      const quem = x.resolvido_por ? ` · ${esc(x.resolvido_por)} ${x.resolvido_em ? hm(x.resolvido_em) : ''}` : ''
      return `<div class="ia-item ${cls}" data-id="${x.id}">
        <div class="ia-clin">${esc(nomeClinica(x.grupo))} <span class="mudo">${dataCurta(x.quando)} ${hm(x.quando)} · ${esc(x.autor || '')}</span></div>
        <div class="ia-msg">“${esc(x.texto)}”</div>
        ${chipsIA(x)}
        <div class="ia-lado"><div class="ia-tempo">${cls === 'ok' ? '✓' : fmt(minDesde(x))}</div><div class="ia-estado">${estado}${cls === 'ok' ? quem : ''}</div></div>
        ${x.status === 'aberta' ? `<div class="acao"><button data-sus="abrir">Abrir cartão agora</button><button class="leve" data-sus="registrada">Já abri o cartão</button><button class="nao" data-sus="nao_e_inclusao" title="A IA não deveria ter captado isso. Frases parecidas deixam de aparecer.">🚫 A IA errou — não é inclusão</button></div>` : ''}
      </div>`
    }
    const porIdade = (a, b) => T(a.quando) - T(b.quando)
    $('rastLista').innerHTML = (inc.length ? [...semCartao.sort(porIdade).map(x => bloco(x, 'sem')), ...agora_.sort(porIdade).map(x => bloco(x, 'novo')), ...tratadas.sort((a, b) => T(b.quando) - T(a.quando)).map(x => bloco(x, 'ok'))].join('') : '<div class="vazio">Nenhum pedido de inclusão captado no período.</div>')
      + `<h3 class="ia-sub">Perguntas sobre amostra (sem pedido de exame)</h3>`
      + (amo.length ? amo.map(x => `<div class="ia-amo ${x.status !== 'aberta' ? 'ok' : ''}" data-id="${x.id}"><span class="mudo">${dataCurta(x.quando)} ${hm(x.quando)}</span><span><b>${esc(nomeClinica(x.grupo))}</b> “${esc(x.texto)}”</span>${x.status === 'aberta' ? '<span class="acao"><button class="leve" data-sus="registrada" title="Você já resolveu com a clínica. Some daqui.">✔ Já resolvi</button><button class="nao" data-sus="nao_e_inclusao" title="A IA não deveria ter captado isso. Frases parecidas deixam de aparecer.">🚫 A IA errou</button></span>' : `<span class="mudo">tratado · ${esc(x.resolvido_por || '')}</span>`}</div>`).join('') : '<div class="vazio">Nenhuma no período.</div>')
    const b = document.querySelector('#abas button[data-setor="rast"]')
    const abertos = inc.filter(x => x.status === 'aberta').length + amo.filter(x => x.status === 'aberta').length
    const urgente = semCartao.length
    if (b) b.innerHTML = `🤖 Rastreamento de Inclusões${abertos ? ` <span class="badge ${urgente ? '' : 'leve'}">${abertos}</span>` : ''}`
    if (b) b.classList.toggle('tem', !!abertos)
  }
  // ── ⭐ NPS DO ATENDIMENTO ──
  // NPS = % promotores (9-10) − % detratores (0-6). Neutros (7-8) não entram na conta. Régua clássica de mercado.
  const NPS_META = { bom: 50, otimo: 70, resposta: 30, recuperar: 48 }   // % e horas
  function desenharNps() {
    if (!$('npsPainel')) return
    const per = npsPeriodo === 30 ? 30 : npsPeriodo === 90 ? 90 : 9999
    const ini = agora() - per * 864e5
    const r = nps.filter(x => T(x.quando) >= ini)
    const conv = npsConvites.filter(x => T(x.criado_em) >= ini)
    const prom = r.filter(x => x.nota >= 9).length, neu = r.filter(x => x.nota >= 7 && x.nota <= 8).length, det = r.filter(x => x.nota <= 6).length
    const score = r.length ? Math.round((prom / r.length) * 100 - (det / r.length) * 100) : null
    const taxa = conv.length ? Math.round((r.length / conv.length) * 100) : null
    const zona = score === null ? ['sem dados', ''] : score >= NPS_META.otimo ? ['🏆 Excelente (classe mundial)', 'ex'] : score >= NPS_META.bom ? ['👍 Bom', 'bom'] : score >= 0 ? ['⚠️ Precisa melhorar', 'at'] : ['🚨 Crítico', 'cr']
    const abertos = r.filter(x => x.nota <= 6 && !x.tratado_em)
    document.querySelectorAll('.nps-filtros button').forEach(b => b.classList.toggle('on', +b.dataset.per === npsPeriodo))
    $('npsPainel').innerHTML = `
      <div class="numeros kpis">
        <div class="kpi"><b class="${zona[1] === 'ex' || zona[1] === 'bom' ? 'verde' : zona[1] === 'cr' ? 'vermelho' : ''}">${score === null ? '—' : score}</b><span>NPS ${zona[0]}</span></div>
        <div class="kpi bom"><b>${prom}</b><span>promotores (9–10)</span></div>
        <div class="kpi"><b>${neu}</b><span>neutros (7–8)</span></div>
        <div class="kpi ${det ? 'ruim' : ''}"><b>${det}</b><span>detratores (0–6)</span></div>
        <div class="kpi ${taxa !== null && taxa < NPS_META.resposta ? 'ruim' : ''}"><b>${taxa === null ? '—' : taxa + '%'}</b><span>responderam (${r.length}/${conv.length} convites)</span></div>
        <div class="kpi ${abertos.length ? 'ruim' : 'bom'}"><b>${abertos.length}</b><span>detratores sem retorno</span></div>
      </div>`
    $('npsLista').innerHTML = r.length ? r.map(x => {
      const cls = x.nota >= 9 ? 'ok' : x.nota >= 7 ? 'corte' : 'atras'
      return `<div class="ia-item ${cls}" data-nps="${x.id}">
        <div class="ia-clin">${esc(x.clinica || x.grupo || '')} <span class="mudo">${dataCurta(x.quando)} ${hm(x.quando)}</span></div>
        ${x.comentario ? `<div class="ia-msg">“${esc(x.comentario)}”</div>` : '<div class="ia-msg mudo">sem comentário</div>'}
        <div class="ia-lado"><div class="ia-tempo">${x.nota}</div><div class="ia-estado">${x.nota >= 9 ? 'PROMOTOR' : x.nota >= 7 ? 'NEUTRO' : 'DETRATOR'}</div></div>
        ${x.nota <= 6 ? (x.tratado_em ? `<div class="feito-linha">✅ retorno feito por ${esc(x.tratado_por || '')} em ${dataCurta(x.tratado_em)} ${hm(x.tratado_em)}</div>`
          : `<div class="acao"><button data-nps-tratar="${x.id}">✔ Falei com a clínica</button><span class="mudo">responder em até ${NPS_META.recuperar}h (regra de mercado)</span></div>`) : ''}
      </div>`
    }).join('') : '<div class="vazio">Nenhuma resposta ainda. Envie a pesquisa pelo cartão da coleta ou pelo botão acima.</div>'
    const b = document.querySelector('#abas button[data-setor="nps"]')
    if (b) { b.innerHTML = `⭐ NPS${abertos.length ? ` <span class="badge">${abertos.length}</span>` : ''}`; b.classList.toggle('tem', !!abertos.length) }
  }
  let npsPeriodo = 30
  document.querySelectorAll('.nps-filtros button').forEach(b => b.addEventListener('click', () => { npsPeriodo = +b.dataset.per; desenharNps() }))
  $('npsLista') && $('npsLista').addEventListener('click', async ev => {
    const b = ev.target.closest('button[data-nps-tratar]'); if (!b) return
    if (!(await garantirLogin())) return
    try { await rpc('nps_tratar', { p_nome: sessao.nome, p_senha: sessao.senha, p_id: +b.dataset.npsTratar }); toast('Retorno registrado'); await carregar(); desenhar() } catch (e) { toast(e.message) }
  })
  // ── 🛵 BI DAS ROTAS AO VIVO (torre de controle dos motoboys) ──
  const SILENCIO_MIN = 45
  function desenharRotas() {
    if (!$('rotasLista')) return
    const agoraMs = agora()
    const hojeIni = new Date(); hojeIni.setHours(0, 0, 0, 0)
    // ignora linha fantasma (formato antigo ou que o ouvinte parou de atualizar)
    const linhas = rotasVivo.filter(r => T(r.ciclo_aberto) >= hojeIni.getTime() - 20 * 3600e3 && / · /.test(r.rota || '') && (agora() - T(r.atualizado)) / 60000 < 20)
      .map(r => ({ ...r, nome: (r.rota || '').split(' · ')[0] }))
    const nOrd = r => { const m = /(\d+)/.exec(r.nome || ''); return /folguista/.test(r.nome) ? 100 + (m ? +m[1] : 0) : /angra/.test(r.nome) ? 90 : (m ? +m[1] : 50) }
    const ordTurno = t => /manh/.test(t) ? 0 : /tarde/.test(t) ? 1 : 2
    linhas.sort((a, b) => nOrd(a) - nOrd(b) || ordTurno(a.turno) - ordTurno(b.turno))
    const min = q => q ? (agoraMs - T(q)) / 60000 : null
    const hm2 = h => (h || '').slice(0, 5)
    const atrasada = r => { if (r.estado === 'finalizada' || !r.fim_previsto) return false; const agoraHM = new Date(agoraMs).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Sao_Paulo' }); return agoraHM > hm2(r.fim_previsto) }
    const muda = r => r.estado === 'em_rua' && min(r.ultima_conf) > SILENCIO_MIN
    const emRua = linhas.filter(r => r.estado === 'em_rua')
    const andando = linhas.filter(r => r.estado !== 'lista_postada')
    const total = andando.reduce((a, r) => a + r.paradas, 0)
    const infor = andando.reduce((a, r) => a + r.informadas, 0)
    const exames = linhas.reduce((a, r) => a + r.exames, 0)
    // só conta pendência de quem já saiu: lista recém-postada não é pendência
    const pend = linhas.filter(r => r.estado !== 'lista_postada').reduce((a, r) => a + r.faltam + r.sem_numero, 0)
    const ehAdmin = !!(sessao && sessao.setorInc === 'admin')
    const kpi = (id, n, txt, cls) => `<button class="kpi ${cls || ''} ${filtroRota === id ? 'sel' : ''}" data-filtro="${id}" ${id === 'nada' ? 'disabled' : ''}><b>${n}</b><span>${txt}</span>${id !== 'nada' ? `<i class="lupa">${filtroRota === id ? 'mostrando só estes ✕' : 'clique para ver quais'}</i>` : ''}</button>`
    $('rotasKpis').innerHTML = kpi('rua', emRua.length, 'rotas na rua agora') +
      kpi('nada', `${infor}/${total}`, 'paradas informadas hoje', 'bom') +
      (ehAdmin ? kpi('nada', exames, 'exames coletados hoje (só admin)') : '') +
      kpi('pend', pend, 'pendências (sem info + sem nº)', pend ? 'ruim' : '') +
      kpi('atraso', linhas.filter(atrasada).length, 'passaram do horário previsto', linhas.filter(atrasada).length ? 'ruim' : '') +
      kpi('mudo', linhas.filter(muda).length, `sem dar notícia há +${SILENCIO_MIN} min`, linhas.filter(muda).length ? 'ruim' : '') +
      (() => { let t = 0, ok = 0; for (const r of linhas) for (const p of (r.paradas_json || [])) if (p.obrig) { t++; if (p.estado === 'ok') ok++ } ; return t ? kpi('obr', `${ok}/${t}`, 'clínicas obrigatórias atendidas', ok === t ? 'bom' : 'ruim') : '' })()
    const porTurno = turnoView !== 'resumo' ? linhas.filter(r => r.turno === turnoView) : linhas
    const filtrada0 = porTurno
    const filtrada = filtroRota === 'rua' ? filtrada0.filter(r => r.estado === 'em_rua')
      : filtroRota === 'pend' ? filtrada0.filter(r => r.estado !== 'lista_postada' && (r.faltam || r.sem_numero))
      : filtroRota === 'atraso' ? filtrada0.filter(atrasada)
      : filtroRota === 'mudo' ? filtrada0.filter(muda)
      : filtroRota === 'obr' ? filtrada0.filter(r => (r.paradas_json || []).some(p => p.obrig && p.estado !== 'ok')) : filtrada0
    if (filtroRota) filtrada.forEach(r => abertas.add(r.rota))
    // seletor de visão: resumo (tabela) ou um turno por vez
    const turnosExistentes = [...new Set(linhas.map(r => r.turno))]
    $('rotasVisao').innerHTML = ['resumo', 'manhã', 'tarde', 'noite'].filter(v => v === 'resumo' || turnosExistentes.includes(v))
      .map(v => `<button class="${turnoView === v ? 'on' : ''}" data-visao="${v}">${v === 'resumo' ? '📊 Visão geral' : v === 'manhã' ? '🌅 Só manhã' : v === 'tarde' ? '🌇 Só tarde' : '🌙 Só noite'}</button>`).join('')
    const nomesFiltro = { rua: 'rotas na rua agora', pend: 'rotas com pendência', atraso: 'rotas que passaram do horário', mudo: `rotas sem notícia há +${SILENCIO_MIN} min`, obr: 'rotas com obrigatória em aberto' }
    $('rotasFiltro').innerHTML = filtroRota ? `<button class="voltar" id="voltarRotas">← voltar para todas as rotas</button><span class="mudo">mostrando <b>${nomesFiltro[filtroRota]}</b> (${filtrada.length})</span>` : ''
    const porRota = new Map()
    for (const r of filtrada) { if (!porRota.has(r.nome)) porRota.set(r.nome, []); porRota.get(r.nome).push(r) }
    const cartao = r => {
      const pct = v => r.paradas ? Math.round((v / r.paradas) * 100) : 0
      const st = r.estado === 'finalizada' ? ['✅ finalizada', 'ok'] : muda(r) ? ['🔇 sem notícia', 'ruim'] : atrasada(r) ? ['⏰ passou do horário', 'ruim'] : r.estado === 'em_rua' ? ['🛵 na rua', 'rua'] : ['📋 lista postada', 'lista']
      const ult = min(r.ultima_conf)
      return `<article class="rt ${st[1]}" data-rota="${esc(r.rota)}">
        <header><b class="tn-forte">${esc((r.turno || '').toUpperCase())}</b><span class="est ${st[1]}">${st[0]}</span></header>
        <div class="barra" title="${r.informadas} informadas · ${r.sem_numero} sem número · ${r.faltam} sem informação">
          <i style="width:${pct(r.informadas)}%" class="v"></i><i style="width:${pct(r.sem_numero)}%" class="a"></i><i style="width:${pct(r.faltam)}%" class="r"></i></div>
        ${extrasRota(r)}
        <div class="nums"><b>${r.informadas}/${r.paradas}</b> informadas · <b>${r.exames}</b> exames${r.sem_numero ? ` · <b class="amb">${r.sem_numero}</b> sem nº` : ''}${r.faltam ? ` · <b class="rub">${r.faltam}</b> sem info` : ''}</div>
        <div class="pe">${r.estado === 'finalizada' ? `terminou ${hm(r.fechado_em)}` : ult === null ? 'ainda não começou' : `última notícia há ${fmt(ult)}`}${r.fim_previsto ? ` · previsto até <b>${hm2(r.fim_previsto)}</b>` : ''}${r.ritmo ? ` · ritmo <b>${r.ritmo}</b> paradas/h` : ''}${r.eta && r.estado !== 'finalizada' ? ` · deve terminar <b>${hm2(r.eta)}</b>${r.fim_medio ? ` <span class="${r.eta > r.fim_medio ? 'rub' : 'verde'}">(média ${hm2(r.fim_medio)})</span>` : ''}` : ''}</div>
        ${mini7(r)}
        <button class="ver-mais" data-abrir="${esc(r.rota)}">${abertas.has(r.rota) ? '▾ fechar detalhe' : '▸ ver clínica por clínica'}</button>
        ${abertas.has(r.rota) ? detalheRota(r) : ''}
      </article>`
    }
    if (turnoView === 'resumo' && !filtroRota) { $('rotasLista').innerHTML = tabelaResumo(linhas, atrasada, muda); return finalRotas(linhas, atrasada, total, infor, linhas.filter(r => muda(r) || atrasada(r)).length) }
    $('rotasLista').innerHTML = porRota.size ? [...porRota.entries()].map(([nome, turnos]) => `
      <section class="linha-rota">
        <h3 class="rt-nome">${esc(nome.toUpperCase())}</h3>
        <div class="rt-turnos">${turnos.map(cartao).join('')}</div>
      </section>`).join('') : `<div class="vazio">${filtroRota ? 'Nenhuma rota nessa situação agora. <b>Clique no número de novo para ver todas.</b>' : 'Nenhuma rota aberta agora. A lista da manhã costuma ser postada a partir das 19h.'}</div>`
    finalRotas(linhas, atrasada, total, infor, linhas.filter(r => muda(r) || atrasada(r)).length)
  }
  function finalRotas(linhas, atrasada, total, infor, alertas) {
    desenharPlacarRotas(linhas, atrasada)
    const okPrazo = linhas.filter(r => r.estado === 'finalizada' && !atrasada(r)).length
    const fin = linhas.filter(r => r.estado === 'finalizada').length
    const pctInf = total ? Math.round((infor / total) * 100) : null
    const pctPrazo = fin ? Math.round((okPrazo / fin) * 100) : null
    const linha = (rot, v, alvo, txt) => `<tr><td>${rot}</td><td class="num"><b class="${v === null ? '' : v >= alvo ? 'verde' : 'vermelho'}">${v === null ? '—' : v + '%'}</b></td><td class="num mudo">${alvo}%</td><td>${txt}</td></tr>`
    $('rotasBench').innerHTML = `<h3>Comparação com o mercado <span class="mudo">· hoje, ${linhas.length} turnos</span></h3>
      <table class="tab-bench"><thead><tr><th>Indicador</th><th class="num">Alpha hoje</th><th class="num">Mercado</th><th>Referência</th></tr></thead><tbody>
      ${linha('Paradas com informação do motoboy', pctInf, 98, 'conferência de entrega/coleta (Loggi, Correios): 98% dos pontos com baixa registrada')}
      ${linha('Rotas fechadas dentro do horário previsto', pctPrazo, 95, 'OTIF de última milha (on time in full): 95%')}
      </tbody></table>
      <p class="mudo" style="font-size:12.5px;margin:0">Verde = dentro do padrão. O horário previsto vem do próprio histórico de cada rota (85% dos dias dos últimos 90).</p>`
    const b = document.querySelector('#abas button[data-setor="rotas"]')
    const alerta = alertas
    if (b) { b.innerHTML = `🛵 BI Rotas${alerta ? ` <span class="badge">${alerta}</span>` : ''}`; b.classList.toggle('tem', !!alerta) }
  }
  // mini gráfico dos últimos dias: exames por dia daquela rota/turno
  function mini7(r) {
    const h = Array.isArray(r.hist7) ? r.hist7.slice(-7) : []
    if (h.length < 2) return ''
    const max = Math.max(...h.map(d => d.exames || 0), r.exames || 0, 1)
    const barras = h.map(d => `<i style="height:${Math.max(6, Math.round(((d.exames || 0) / max) * 26))}px" title="${d.dia}: ${d.exames || 0} exames · ${d.informadas}/${d.paradas} informadas"></i>`).join('')
    const hoje = `<i class="hoje" style="height:${Math.max(6, Math.round(((r.exames || 0) / max) * 26))}px" title="hoje: ${r.exames} exames"></i>`
    const dif = r.exames_media ? Math.round(((r.exames - r.exames_media) / r.exames_media) * 100) : null
    return `<div class="mini7"><div class="barras">${barras}${hoje}</div><span class="mudo">últimos dias · hoje <b>${r.exames}</b> exames${dif !== null ? ` <b class="${dif >= 0 ? 'verde' : 'rub'}">${dif >= 0 ? '+' : ''}${dif}%</b> vs média ${r.exames_media}` : ''}${r.paradas_media ? ` · média ${r.paradas_media} paradas` : ''}</span></div>`
  }
  // visão geral: uma linha por rota, uma coluna por turno (o "mapa do dia")
  function tabelaResumo(linhas, atrasada, muda) {
    const porRota = new Map()
    for (const r of linhas) { if (!porRota.has(r.nome)) porRota.set(r.nome, {}); porRota.get(r.nome)[r.turno] = r }
    const cols = ['manhã', 'tarde', 'noite'].filter(t => linhas.some(r => r.turno === t))
    const cel = r => {
      if (!r) return '<td class="vaz">—</td>'
      const cls = r.estado === 'finalizada' ? (r.faltam || r.sem_numero ? 'at' : 'ex') : muda(r) || atrasada(r) ? 'cr' : r.estado === 'em_rua' ? 'rua' : 'lst'
      const ic = r.estado === 'finalizada' ? (r.faltam || r.sem_numero ? '⚠️' : '✅') : muda(r) ? '🔇' : atrasada(r) ? '⏰' : r.estado === 'em_rua' ? '🛵' : '📋'
      const pct = r.paradas ? Math.round((r.informadas / r.paradas) * 100) : 0
      const obr = (r.paradas_json || []).filter(p => p.obrig)
      const obrOk = obr.filter(p => p.estado === 'ok').length
      return `<td class="c-${cls}"><button class="cel" data-abrir="${esc(r.rota)}">
        <span class="ic">${ic}</span><b>${r.informadas}/${r.paradas}</b>
        <span class="mini">${pct}%${obr.length ? ` · obr ${obrOk}/${obr.length}` : ''}${r.exames ? ` · ${r.exames} ex` : ''}</span>
        <span class="mini mudo">${r.estado === 'finalizada' ? `fim ${hm(r.fechado_em)}` : r.ultima_conf ? `últ. ${hm(r.ultima_conf)}` : 'não começou'}</span>
      </button>${abertas.has(r.rota) ? detalheRota(r) : ''}</td>`
    }
    return `<table class="matriz"><thead><tr><th>Rota</th>${cols.map(c => `<th>${c === 'manhã' ? '🌅 MANHÃ' : c === 'tarde' ? '🌇 TARDE' : '🌙 NOITE'}</th>`).join('')}</tr></thead><tbody>
      ${[...porRota.entries()].map(([nome, t]) => `<tr><th class="rota">${esc(nome.toUpperCase())}</th>${cols.map(c => cel(t[c])).join('')}</tr>`).join('')}
    </tbody></table>
    <p class="mudo" style="font-size:12.5px;margin:6px 0 0">✅ fechou completa · ⚠️ fechou com pendência · 🛵 na rua · 📋 lista postada · ⏰ passou do horário · 🔇 sem notícia. Clique em qualquer quadrinho para abrir clínica por clínica.</p>`
  }
  // 🏆 placar das rotas — nota por QUALIDADE (não por volume), padrão scorecard de última milha
  function notaRota(r, atrasada) {
    const info = r.paradas ? r.informadas / r.paradas : 1              // informou tudo?
    const semN = r.paradas ? r.sem_numero / r.paradas : 0              // foi mas não mandou o nº
    const falta = r.paradas ? r.faltam / r.paradas : 0                 // não informou
    const prazo = r.estado === 'finalizada' ? (atrasada(r) ? 0 : 1) : (atrasada(r) ? 0 : 1)
    const nota = Math.round((info * 60) + (prazo * 25) - (semN * 15) - (falta * 20) + 15)
    return Math.max(0, Math.min(100, nota))
  }
  function desenharPlacarRotas(linhas, atrasada) {
    const el = $('rotasPlacar'); if (!el) return
    const com = linhas.filter(r => r.paradas > 0).map(r => ({ ...r, nota: notaRota(r, atrasada) })).sort((a, b) => b.nota - a.nota)
    if (com.length < 2) { el.innerHTML = ''; return }
    const faixa = n => n >= 90 ? ['🏆 Excelente', 'ex'] : n >= 75 ? ['👍 Bom', 'bom'] : n >= 55 ? ['⚠️ Atenção', 'at'] : ['🚨 Precisa de ajuda', 'cr']
    const linhaP = r => {
      const [rot, cls] = faixa(r.nota)
      const pontos = []
      if (r.faltam) pontos.push(`${r.faltam} sem informação`)
      if (r.sem_numero) pontos.push(`${r.sem_numero} sem nº`)
      if (atrasada(r)) pontos.push('passou do horário')
      if (!pontos.length) pontos.push('informou tudo no prazo')
      const vsMedia = r.exames_media ? Math.round(((r.exames - r.exames_media) / r.exames_media) * 100) : null
      return `<tr class="p-${cls}"><td><b>${esc((r.nome || r.rota || '').toUpperCase())}</b> <span class="mudo">${esc(r.turno || '')}</span></td>
        <td class="num"><b>${r.nota}</b></td><td><span class="fx ${cls}">${rot}</span></td>
        <td>${esc(pontos.join(' · '))}</td>
        <td class="num mudo">${vsMedia === null ? '' : `${vsMedia >= 0 ? '+' : ''}${vsMedia}% vs a própria média`}</td></tr>`
    }
    const top = com.slice(0, 3), baixo = com.slice(-3).reverse().filter(r => !top.includes(r))
    el.innerHTML = `<h3>🏆 Placar do dia <span class="mudo">· nota por qualidade da informação, não por volume</span></h3>
      <table class="tab-bench"><thead><tr><th>Rota</th><th class="num">Nota</th><th>Faixa</th><th>Por quê</th><th class="num">Volume</th></tr></thead>
      <tbody><tr class="sep"><td colspan="5">CAMPEÃS DE HOJE</td></tr>${top.map(linhaP).join('')}
      ${baixo.length ? `<tr class="sep"><td colspan="5">PRECISAM DE AJUDA</td></tr>${baixo.map(linhaP).join('')}` : ''}</tbody></table>
      <p class="mudo" style="font-size:12.5px;margin:0">Nota = informou todas as paradas (60) + fechou no horário (25) − sem número (15) − sem informação (20). Volume de exames entra só como comparação da rota <b>com ela mesma</b>, para não punir rota pequena.</p>`
  }
  // indicadores extras por rota: obrigatórias cumpridas e maior intervalo entre paradas
  function extrasRota(r) {
    const ps = Array.isArray(r.paradas_json) ? r.paradas_json : []
    const obr = ps.filter(p => p.obrig)
    const obrOk = obr.filter(p => p.estado === 'ok').length
    const horas = ps.map(p => T(p.hora)).filter(Boolean).sort((a, b) => a - b)
    let maior = 0, ondeMaior = ''
    for (let i = 1; i < horas.length; i++) if (horas[i] - horas[i - 1] > maior) { maior = horas[i] - horas[i - 1]; ondeMaior = hm(new Date(horas[i]).toISOString()) }
    const chips = []
    if (obr.length) chips.push(`<span class="mini-chip ${obrOk === obr.length ? 'ok' : 'ruim'}">obrigatórias ${obrOk}/${obr.length}</span>`)
    if (maior > 25 * 60000) chips.push(`<span class="mini-chip">maior parada ${fmt(maior / 60000)} (até ${ondeMaior})</span>`)
    if (r.primeira_conf) chips.push(`<span class="mini-chip">1ª clínica ${hm(r.primeira_conf)}</span>`)
    return chips.length ? `<div class="chips-rt">${chips.join('')}</div>` : ''
  }
  const abertas = new Set()
  let filtroRota = null, turnoView = 'resumo'    // resumo (tabela) · manhã · tarde · noite
  function detalheRota(r) {
    const ps = Array.isArray(r.paradas_json) ? r.paradas_json : []
    if (!ps.length) return '<div class="det vazio-det">Sem detalhe das paradas ainda.</div>'
    const ini = ps.map(p => T(p.hora)).filter(Boolean).sort()[0]
    let anterior = null
    const linhas = ps.map(p => {
      const ic = p.estado === 'ok' ? '✅' : p.estado === 'sem_numero' ? '🟡' : p.estado === 'falta' ? '🔴' : '⚪️'
      const selo = p.obrig ? '<span class="obr">obrigatória</span>' : ''
      const gap = p.hora && anterior ? (T(p.hora) - anterior) / 60000 : null
      if (p.hora) anterior = T(p.hora)
      return `<tr class="l-${p.estado}"><td class="h">${p.hora ? hm(p.hora) : '—'}</td><td>${ic} ${esc(p.nome)} ${selo}</td>
        <td class="num">${p.qtd === null || p.qtd === undefined ? (p.estado === 'sem_numero' ? 'sem nº' : '—') : p.qtd + ' ex'}</td>
        <td class="num mudo">${gap !== null ? '+' + fmt(gap) : ''}</td></tr>`
    }).join('')
    return `<div class="det"><table class="tab-det"><thead><tr><th>hora</th><th>clínica</th><th class="num">exames</th><th class="num">intervalo</th></tr></thead><tbody>${linhas}</tbody></table>
      <div class="mudo det-pe">${r.reconstruido ? '<b>só as pendências</b> (o detalhe completo aparece nos turnos a partir de agora) · ' : ini ? `começou ${hm(new Date(ini).toISOString())} · ` : ''}✅ informou · 🟡 foi mas não mandou o nº · 🔴 não informou · ⚪️ ainda não chegou · <b>obrigatória</b> = está na folha conferida pela equipe</div></div>`
  }
  $('rotasVisao') && $('rotasVisao').addEventListener('click', ev => {
    const b = ev.target.closest('button[data-visao]'); if (!b) return
    turnoView = b.dataset.visao; filtroRota = null; abertas.clear(); desenharRotas()
  })
  $('rotasFiltro') && $('rotasFiltro').addEventListener('click', ev => {
    if (!ev.target.closest('#voltarRotas')) return
    filtroRota = null; abertas.clear(); desenharRotas()
  })
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && filtroRota) { filtroRota = null; abertas.clear(); desenharRotas() } })
  $('rotasKpis') && $('rotasKpis').addEventListener('click', ev => {
    const b = ev.target.closest('button[data-filtro]'); if (!b || b.dataset.filtro === 'nada') return
    filtroRota = filtroRota === b.dataset.filtro ? null : b.dataset.filtro
    if (!filtroRota) abertas.clear()
    desenharRotas()
  })
  $('rotasLista') && $('rotasLista').addEventListener('click', ev => {
    const b = ev.target.closest('button[data-abrir]'); if (!b) return
    const k = b.dataset.abrir
    abertas.has(k) ? abertas.delete(k) : abertas.add(k)
    desenharRotas()
  })
  // ── 🛵 AGENDAMENTOS DE COLETA (passo 1) ──
  // ── dia 2: mensagem pronta para o cliente, com a janela real da rota ──
  // regra de mercado (iFood, Loggi, Uber): prometer FAIXA arredondada e curta — nunca minuto cravado, nunca mais de 3 h
  const hLabel = min => { const h = Math.floor(min / 60), m = min % 60; return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}hrs` }
  // Wal 18/set: a clínica precisa ver o DIA e o "hrs" do lado da hora
  const diaLabel = q => {
    const d = new Date(T(q)), hoje = new Date()
    const dd = x => x.toLocaleDateString('sv-SE')
    const amanha = new Date(hoje.getTime() + 864e5)
    const sem = d.toLocaleDateString('pt-BR', { weekday: 'long' })
    const nome = dd(d) === dd(hoje) ? 'Hoje' : dd(d) === dd(amanha) ? 'Amanhã' : sem[0].toUpperCase() + sem.slice(1)
    return `${nome}, ${dataCurta(q)}`
  }
  const horaLabel = q => `${hm(q)}hrs`
  function janelaTexto(rota, turno) {
    const j = JANELAS[(rota || '').toLowerCase()]
    const k = /manh/i.test(turno || '') ? 'manhã' : /noite/i.test(turno || '') ? 'noite' : 'tarde'
    const x = j && j[k]
    const quando = /amanh/i.test(turno || '') ? 'amanhã' : 'hoje'
    const periodo = k === 'manhã' ? 'de manhã' : k === 'noite' ? 'no fim do dia' : 'à tarde'
    if (!x) return { quando: `${quando} ${periodo}`, faixa: '' }
    const min = t => +t.slice(0, 2) * 60 + +t.slice(3, 5)
    let ini = Math.floor(min(x.de) / 60) * 60                     // arredonda para a hora cheia
    let fim = Math.ceil(min(x.ate) / 60) * 60
    if (fim - ini > 180) fim = ini + 180                          // no máximo 3 horas de janela
    if (fim - ini < 60) fim = ini + 60
    return { quando: `${quando} ${periodo}`, faixa: `${hLabel(ini)} e ${hLabel(fim)}` }
  }
  // mensagem curta, com título, dados em linha e assinatura (padrão de notificação de entrega)
  const ASSINATURA = '_Alpha Labs · Atendimento ao Cliente_'
  function mensagemCliente(c) {
    if (EH_MATERIAL(c)) return mensagemMaterial(c)
    const quem = c.clinica ? `, ${c.clinica}` : ''
    if (c.status === 'nova') return { t: 'Recebi o pedido', m:
      `👋 *Recebemos seu pedido de coleta*\n` +
      `${c.quando ? `📅 ${diaLabel(c.quando)} · 🕒 ${horaLabel(c.quando)}\n` : ''}` +
      `Estamos confirmando a rota e já voltamos com o horário. 😊\n\n${ASSINATURA}` }
    if (c.status === 'coletada') return { t: 'Coletamos', m:
      `✅ *Coleta realizada*\n` +
      `📅 ${diaLabel(c.coletada_em)} · 🕒 ${horaLabel(c.coletada_em)}\n` +
      `${c.coletada_qtd ? `📦 ${c.coletada_qtd} amostra${c.coletada_qtd > 1 ? 's' : ''} recolhida${c.coletada_qtd > 1 ? 's' : ''}\n` : ''}` +
      `🔬 O material já está a caminho do laboratório.\n\n` +
      `Obrigado pela parceria${quem}! Qualquer coisa é só chamar por aqui. 🐾\n\n${ASSINATURA}` }
    const j = janelaTexto(c.rota || c.rota_sug, c.turno || c.turno_sug)
    const amanha = new Date(Date.now() + 864e5)
    if (/amanh/i.test(c.turno || c.turno_sug || '')) return { t: 'Fica para amanhã', m:
      `📅 *Coleta agendada*\n` +
      `🗓️ Amanhã, ${dataCurta(amanha)} · 🛵 ${j.quando.replace(/^amanhã /, '')}${j.faixa ? `, entre *${j.faixa}*` : ''}\n\n` +
      `A lista de hoje dessa região já saiu. Se for urgente, me avise que tento encaixar. 🙏\n\n${ASSINATURA}` }
    return { t: 'Agendado', m:
      `✅ *Coleta agendada*\n` +
      `🗓️ ${diaLabel(Date.now())} · 🛵 ${j.quando.replace(/^hoje /, '')}${j.faixa ? `, entre *${j.faixa}*` : ''}\n\n` +
      `Assim que o motoboy recolher, confirmamos por aqui. 😊\n\n${ASSINATURA}` }
  }
  // Wal 18/set: quando a clínica pede LÂMINA/TUBO/KIT, quem se desloca é o mesmo motoboy — mas o texto é outro
  function mensagemMaterial(c) {
    const item = c.item ? ` (${c.item})` : ''
    if (c.status === 'nova') return { t: 'Recebi o pedido', m:
      `👋 *Recebemos seu pedido de material*${item}\n` +
      `📅 ${diaLabel(c.quando)} · 🕒 ${horaLabel(c.quando)}\n` +
      `Já estou vendo com a rota e volto com o dia da entrega. 😊\n\n${ASSINATURA}` }
    if (c.status === 'entregue') return { t: 'Entregamos', m:
      `📦 *Material entregue*${item}\n` +
      `📅 ${diaLabel(c.entregue_em)} · 🕒 ${horaLabel(c.entregue_em)}\n\n` +
      `Precisando de mais alguma coisa é só chamar por aqui${c.clinica ? `, ${c.clinica}` : ''}. 🐾\n\n${ASSINATURA}` }
    const j = janelaTexto(c.rota || c.rota_sug, c.turno || c.turno_sug)
    const amanha = new Date(Date.now() + 864e5)
    if (/amanh/i.test(c.turno || c.turno_sug || '')) return { t: 'Fica para amanhã', m:
      `📦 *Material a caminho*${item}\n` +
      `🗓️ Amanhã, ${dataCurta(amanha)} · 🛵 ${j.quando.replace(/^amanhã /, '')}${j.faixa ? `, entre *${j.faixa}*` : ''}\n\n` +
      `A rota de hoje dessa região já saiu. Se for urgente, me avise que tento encaixar. 🙏\n\n${ASSINATURA}` }
    return { t: 'A caminho', m:
      `📦 *Material a caminho*${item}\n` +
      `🗓️ ${diaLabel(Date.now())} · 🛵 ${j.quando.replace(/^hoje /, '')}${j.faixa ? `, entre *${j.faixa}*` : ''}\n\n` +
      `Assim que o motoboy deixar aí, confirmo por aqui. 😊\n\n${ASSINATURA}` }
  }
  // ── dia 3: relógios. Cada cartão tem um prazo; passou, vira cobrança na tela ──
  const PRAZO = { agendar: 20, corteAviso: 30, coletaFolga: 45 }   // minutos
  function fimDoTurno(c) {
    const j = JANELAS[(c.rota || c.rota_sug || '').toLowerCase()]
    const k = /manh/i.test(c.turno || c.turno_sug || '') ? 'manhã' : /noite/i.test(c.turno || c.turno_sug || '') ? 'noite' : 'tarde'
    const x = j && j[k]
    if (!x) return null
    const base = new Date(agora())
    const [h, m] = x.ate.split(':').map(Number)
    const d = new Date(base.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
    d.setHours(h, m + PRAZO.coletaFolga, 0, 0)
    if (/amanh/i.test(c.turno || c.turno_sug || '')) d.setDate(d.getDate() + 1)   // turno de amanhã só vence amanhã
    const off = new Date(base.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })).getTime() - base.getTime()
    return d.getTime() - off
  }
  // devolve { nivel: 'ok'|'atencao'|'cobrar', motivo } — é o que faz o cartão piscar e entrar na fila de ação
  function relogio(c) {
    const min = (agora() - T(c.quando)) / 60000
    if (c.status === 'nova') {
      if (c.respondido_em) return { nivel: 'ok', motivo: `respondido no WhatsApp ${hm(c.respondido_em)}${c.respondido_por ? ` por ${c.respondido_por}` : ''} — falta agendar aqui` }
      if (min >= PRAZO.agendar) return { nivel: 'cobrar', motivo: `pedido há ${fmt(min)} e ninguém agendou` }
      const fc = c.corte_em ? (T(c.corte_em) - agora()) / 60000 : null
      if (fc !== null && fc <= PRAZO.corteAviso) return { nivel: 'atencao', motivo: fc > 0 ? `a lista sai em ${fmt(fc)}` : 'a lista já saiu — precisa encaixar' }
      return { nivel: 'ok', motivo: '' }
    }
    if (c.status === 'agendada') {
      const fc = c.corte_em ? (T(c.corte_em) - agora()) / 60000 : null
      if (fc !== null && fc < 0) return { nivel: 'cobrar', motivo: 'a lista da rota já saiu e essa clínica não entrou' }
      if (fc !== null && fc <= PRAZO.corteAviso) return { nivel: 'atencao', motivo: `falta ${fmt(fc)} para a lista sair e ainda não entrou` }
      return { nivel: 'ok', motivo: '' }
    }
    if (c.status === 'entregue') return { nivel: 'ok', motivo: '' }
    if (c.status === 'na_lista') {
      if (T(c.na_lista_em) > agora() - 30 * 60000) return { nivel: 'ok', motivo: '' }   // acabou de entrar na lista
      const fim = fimDoTurno(c)
      if (fim && agora() > fim) return { nivel: 'cobrar', motivo: 'o turno acabou e o motoboy não informou essa clínica' }
      return { nivel: 'ok', motivo: '' }
    }
    return { nivel: 'ok', motivo: '' }
  }
  // ── dia 4: cada papel tem a SUA fila ──
  let papel = 'tudo'
  const PAPEIS = {
    tudo: { nome: 'Tudo', icone: '📋', ajuda: 'todos os pedidos do dia' },
    radar: { nome: 'Radar', icone: '👁️', ajuda: 'confirmar rota e turno, e garantir que a clínica entre na lista' },
    resolvedor: { nome: 'Resolvedor', icone: '💬', ajuda: 'falar com a clínica: avisar o horário e confirmar a coleta' },
    qualidade: { nome: 'Qualidade · Dono do dia', icone: '🎯', ajuda: 'corrigir a IA, cobrar o que ficou para trás e fechar o dia' },
  }
  function daFila(c, p) {
    const r = relogio(c)
    if (p === 'radar') return c.status === 'nova' || (c.status === 'agendada' && r.nivel !== 'ok')
    if (p === 'resolvedor') return !c.avisado_em && ['nova', 'agendada', 'coletada', 'entregue'].includes(c.status)
    if (p === 'qualidade') return r.nivel === 'cobrar' || (c.rota && c.rota_sug && c.rota.trim().toLowerCase() !== c.rota_sug.trim().toLowerCase()) || (c.status === 'na_lista' && r.nivel !== 'ok')
    return true
  }
  const EH_MATERIAL = c => c.tipo === 'material'
  const COLETA_ABERTA = c => c.status === 'nova'
  const COLETA_ANDANDO = c => ['nova', 'agendada', 'na_lista'].includes(c.status)
  let JANELAS = {}
  fetch('turnos.json').then(r => r.json()).then(j => { JANELAS = j; desenhar() }).catch(() => {})
  const ROTAS = ['rota 1', 'rota 2', 'rota 3', 'rota 4', 'rota 5', 'rota 6', 'rota 7', 'rota 8', 'rota 9', 'rota 10', 'rota 11', 'rota 12', 'rota angra', 'rota folguista 1', 'rota folguista 2', 'rota folguista 3', 'rota folguista 4']
  const TURNOS = ['manhã de hoje', 'tarde de hoje', 'noite de hoje', 'manhã de amanhã', 'tarde de amanhã']
  const turnoParecido = t => TURNOS.find(x => (t || '').toLowerCase().startsWith(x.split(' ')[0])) || 'tarde de hoje'
  // janela real daquele turno naquela rota (histórico de 90 dias): lista postada, motoboy de… até…
  function janela(rota, turno) {
    const j = JANELAS[(rota || '').toLowerCase()]
    const k = /manh/i.test(turno) ? 'manhã' : /noite/i.test(turno) ? 'noite' : 'tarde'
    const x = j && j[k]
    if (!x) return ''
    return `lista ${x.lista} · motoboy ${x.de}–${x.ate}`
  }
  const opcoesTurno = (rota, atual) => TURNOS.map(t => { const jj = janela(rota, t); return `<option value="${t}" ${t === atual ? 'selected' : ''}>${t}${jj ? ` · ${jj}` : ''}</option>` }).join('')
  function desenharColetas() {
    const todas = coletas.slice().sort((a, b) => T(b.quando) - T(a.quando))
    const lista = todas.filter(c => daFila(c, papel))
    const novas = todas.filter(COLETA_ABERTA)
    const agendadas = todas.filter(c => c.status === 'agendada')
    const naLista = todas.filter(c => c.status === 'na_lista')
    const coletadas = todas.filter(c => c.status === 'coletada')
    const atrasadas = novas.filter(c => (agora() - T(c.quando)) / 60000 >= 20).length
    const cobrar = todas.filter(c => relogio(c).nivel === 'cobrar')
    const atencao = todas.filter(c => relogio(c).nivel === 'atencao')
    if ($('colPapeis')) $('colPapeis').innerHTML = Object.entries(PAPEIS).map(([k, p]) => {
      const n = todas.filter(c => daFila(c, k)).length
      return `<button class="papel-bt ${papel === k ? 'on' : ''}" data-papel="${k}" title="${esc(p.ajuda)}">${p.icone} ${p.nome}${n ? ` <b>${n}</b>` : ''}</button>`
    }).join('') + `<span class="mudo papel-ajuda">${esc(PAPEIS[papel].ajuda)}</span>`
    if ($('colAcao')) {
      $('colAcao').hidden = !cobrar.length
      if (cobrar.length) $('colAcao').innerHTML = `<h3>⏰ ${cobrar.length} precisa${cobrar.length > 1 ? 'm' : ''} de ação agora</h3>` +
        cobrar.map(c => `<div class="acao-linha"><b>${esc(c.clinica || '')}</b> <span class="mudo">${esc(relogio(c).motivo)}</span> <span class="mudo">· pedido ${hm(c.quando)}${c.rota || c.rota_sug ? ` · ${esc(c.rota || c.rota_sug)}` : ''}</span></div>`).join('')
    }
    const perto = atencao.length
    const b = document.querySelector('#abas button[data-setor="coleta"]')
    const esperando = novas.length + agendadas.length
    if (b) b.innerHTML = `🛵 Agendamentos${esperando ? ` <span class="badge ${atrasadas || perto ? '' : 'leve'}">${esperando}</span>` : ''}`
    if (b) b.classList.toggle('tem', !!esperando)
    if ($('colResumo')) $('colResumo').innerHTML = `<div class="kpi ${novas.length ? 'ia' : ''}"><b>${novas.length}</b><span>🤖 pedidos de coleta esperando</span></div>
      <div class="kpi ${cobrar.length ? 'ruim' : ''}"><b>${cobrar.length}</b><span>⏰ precisam de ação agora</span></div>
      <div class="kpi ${atencao.length ? '' : ''}"><b>${atencao.length}</b><span>perto do corte da lista</span></div>
      <div class="kpi"><b>${agendadas.length}</b><span>agendadas, aguardando entrar na lista</span></div>
      <div class="kpi"><b>${naLista.length}</b><span>na lista, esperando o motoboy</span></div>
      <div class="kpi bom"><b>${coletadas.length}</b><span>✅ coleta confirmada pelo motoboy</span></div>
      <div class="kpi ${todas.filter(c => EH_MATERIAL(c) && c.status !== 'entregue' && c.status !== 'descartada').length ? 'mat' : ''}"><b>${todas.filter(EH_MATERIAL).length}</b><span>📦 pedidos de material (${todas.filter(c => EH_MATERIAL(c) && c.status === 'entregue').length} entregues)</span></div>
      <div class="kpi ${todas.filter(c => c.avisado_em).length < todas.filter(c => c.status !== 'nova' && c.status !== 'descartada').length ? 'ruim' : 'bom'}"><b>${todas.filter(c => c.avisado_em).length}</b><span>💬 clínicas avisadas</span></div>`
    const minutos = c => (agora() - T(c.quando)) / 60000
    const faltaCorte = c => c.corte_em ? (T(c.corte_em) - agora()) / 60000 : null
    const bloco = c => {
      const m = minutos(c), fc = faltaCorte(c)
      const rel = relogio(c)
      const mat = EH_MATERIAL(c)
      const cls = (c.status === 'coletada' || c.status === 'entregue') ? 'ok' : rel.nivel === 'cobrar' ? 'atras' : rel.nivel === 'atencao' ? 'corte' : c.status === 'na_lista' ? 'lista' : c.status === 'agendada' ? 'ag' : ''
      const chips = []
      const conf = /confiança (alta|média|baixa)/.exec(c.fonte || '')
      const motivo = (c.fonte || '').replace(/^confiança \S+ · /, '')
      if (c.rota_sug) chips.push(`<span class="chip-ia">🤖 palpite: <b>${esc(c.rota_sug)}</b>${conf ? ` <b class="cf-${conf[1] === 'média' ? 'media' : conf[1]}">confiança ${conf[1]}</b>` : ''}${motivo ? ` <span class="mudo">· porque ${esc(motivo)}</span>` : ''}</span>`)
      else chips.push('<span class="chip-ia">🤖 <b>não sei a rota dessa clínica</b> — escolha abaixo que eu aprendo</span>')
      if (fc !== null && c.status === 'nova') chips.push(`<span class="chip-ia ${fc <= 30 ? 'quente' : ''}">🛵 lista d${/manh/i.test(c.turno_sug || '') ? 'a manhã' : 'a tarde'} ${fc > 0 ? `sai em <b>${fmt(fc)}</b> (${hm(c.corte_em)})` : `<b>já saiu</b> (${hm(c.corte_em)})`}</span>`)
      if (c.status !== 'nova' && c.rota && c.rota_sug) chips.push(`<span class="chip-ia">${c.rota.trim().toLowerCase() === c.rota_sug.trim().toLowerCase() ? '✔ a IA acertou a rota' : `✏️ a equipe corrigiu: <b>${esc(c.rota)}</b> (a IA disse ${esc(c.rota_sug)}) — aprendido`}</span>`)
      const est = c.status === 'entregue' ? `📦 entregue ${hm(c.entregue_em)}`
        : c.status === 'coletada' ? `✅ coletado ${hm(c.coletada_em)}${c.coletada_qtd === null || c.coletada_qtd === undefined ? '' : ` · ${c.coletada_qtd} ex`}`
        : c.status === 'na_lista' ? `📋 na lista da ${esc(c.na_lista_rota || '')} ${hm(c.na_lista_em)} · aguardando o motoboy`
        : c.status === 'agendada' ? `🕒 agendada por ${esc(c.por || '')} · ${esc(c.rota || '')} ${esc(c.turno || '')}`
        : c.status === 'descartada' ? `— descartada por ${esc(c.por || '')}`
        : c.respondido_em ? `💬 respondido no WhatsApp ${hm(c.respondido_em)}` : (m >= 20 ? 'SEM AGENDAR' : mat ? 'PEDIU MATERIAL' : 'NOVO PEDIDO')
      return `<div class="ia-item ${cls}" data-col="${c.id}">
        <div class="ia-clin">${mat ? '<span class="tag-mat">📦 ENTREGA DE MATERIAL</span> ' : ''}${esc(c.clinica || '')}${mat && c.item ? ` <span class="tag-item">${esc(c.item)}</span>` : ''} <span class="mudo">${dataCurta(c.quando)} ${hm(c.quando)} · ${esc(c.autor || '')}</span></div>
        <div class="ia-msg">“${esc(c.texto || '')}”</div>
        <div class="ia-achou">${chips.join('')}${rel.motivo ? `<span class="chip-ia ${rel.nivel === 'cobrar' ? 'quente' : ''}">⏰ ${esc(rel.motivo)}</span>` : ''}</div>
        <div class="ia-lado"><div class="ia-tempo">${c.status === 'coletada' ? '✓' : c.status === 'na_lista' ? fmt(m) : fmt(m)}</div><div class="ia-estado">${est}</div></div>
        ${caixaMensagem(c)}
        ${regrasDaClinica(c)}
        ${COLETA_ABERTA(c) ? `<div class="escolha-linha">
          <label>Rota <select data-campo="rota">${['', ...ROTAS].map(r => `<option value="${r}" ${r === (c.rota_sug || '').toLowerCase() ? 'selected' : ''}>${r || '— escolher —'}</option>`).join('')}</select></label>
          <label>Turno <select data-campo="turno">${opcoesTurno(c.rota_sug, turnoParecido(c.turno_sug))}</select></label>
          <button data-col-acao="confirmar">✔ ${mat ? 'Confirmar entrega' : 'Confirmar agendamento'}</button>
        </div>
        <div class="acao"><button class="nao" data-col-acao="descartar" title="A IA não deveria ter captado isso">🚫 A IA errou</button></div>
        ` : `<div class="feito-linha">${c.status === 'entregue' ? `📦 <b>Material entregue pelo motoboy</b> às ${hm(c.entregue_em)} — ciclo fechado.`
            : c.status === 'coletada' ? `✅ <b>Coleta confirmada pelo motoboy</b> às ${hm(c.coletada_em)}${c.coletada_qtd === null || c.coletada_qtd === undefined ? '' : ` · <b>${c.coletada_qtd} exames</b>`} — ciclo fechado.`
            : c.status === 'na_lista' ? `📋 <b>Entrou na lista da ${esc(c.na_lista_rota || '')}</b> às ${hm(c.na_lista_em)} — esperando o motoboy ${mat ? 'deixar o material' : 'passar'}.`
            : c.status === 'agendada' ? `🕒 <b>Agendada por ${esc(c.por || '')}</b> · ${esc(c.rota || '')} ${esc(c.turno || '')} — esperando entrar na lista da rota.`
            : `— descartada por ${esc(c.por || '')}`}${podeDesfazer(c) ? ' <button class="leve" data-col-acao="desfazer">↩️ Desfazer</button>' : ''}</div>`}
        ${linhaEnsina(c)}
      </div>`
    }
    $('colLista').innerHTML = lista.length ? lista.map(bloco).join('') : `<div class="vazio">${papel === 'tudo' ? 'Nenhum pedido de coleta captado nos últimos 3 dias.' : `✅ Nada na fila d${papel === 'radar' ? 'o Radar' : papel === 'resolvedor' ? 'o Resolvedor' : 'a Qualidade'} agora.`}</div>`
    desenharHistColeta(todas)
    placarColeta(todas)
  }
  // ══ TERREMOTO (Wal 18/set): só toca quando uma PROMESSA COM O CLIENTE está quebrando. Teto de 3 por dia. ══
  const TERR_TETO = 3
  function terremotosAtivos() {
    const casos = [], dia = new Date().toLocaleDateString('sv-SE')
    for (const c of coletas) {
      if (['descartada', 'coletada', 'entregue'].includes(c.status)) continue
      const oque = EH_MATERIAL(c) ? 'entrega de material' : 'coleta'
      // ① prometemos e a lista da rota já saiu sem essa clínica
      if (c.status === 'agendada' && c.corte_em && T(c.corte_em) < agora()) {
        casos.push({ tipo: 'sem_lista', c, motivo: `prometemos ${oque} e a lista da ${c.rota || 'rota'} saiu sem ${c.clinica}` })
        continue
      }
      // ② entrou na lista e o motoboy não informou até o fim da rota
      if (c.status === 'na_lista') {
        const fim = fimDoTurno(c)
        if (fim && agora() > fim) { casos.push({ tipo: 'motoboy_mudo', c, motivo: `${c.clinica} está na lista da ${c.na_lista_rota || ''} desde ${hm(c.na_lista_em)} e o motoboy não informou` }); continue }
      }
      // ③ o cliente pediu e ninguém respondeu NO WHATSAPP em 1 hora (responder no grupo já para o relógio — caso Barão de Lucena, 18/set)
      if (c.status === 'nova' && !c.respondido_em && (agora() - T(c.quando)) / 60000 >= 60) {
        casos.push({ tipo: 'cliente_esperando', c, motivo: `${c.clinica} pediu ${oque} há ${fmt((agora() - T(c.quando)) / 60000)} e ninguém respondeu no WhatsApp` })
      }
    }
    return casos.map(x => ({ ...x, chave: `${x.tipo}:${x.c.id}:${dia}` }))
      .map(x => ({ ...x, reg: terremotos.find(t => t.chave === x.chave) || null }))
      .filter(x => !x.reg || !x.reg.resolvido_em)
      .sort((a, b) => T(a.c.quando) - T(b.c.quando))
  }
  function desenharTerremoto() {
    const ativos = terremotosAtivos()
    const bt = document.querySelector('#abas button[data-setor="terremoto"]')
    if (bt) { bt.hidden = !ativos.length && setor !== 'terremoto'; bt.innerHTML = `🚨 TERREMOTO${ativos.length ? ` <span class="badge">${ativos.length}</span>` : ''}`; bt.classList.toggle('tocando', !!ativos.length) }
    document.body.classList.toggle('terremoto-on', !!ativos.length)
    const el = $('terrLista'); if (!el) return
    el.innerHTML = ativos.length ? ativos.map(x => {
      const dono = x.reg && x.reg.assumido_por
      return `<div class="terr-item ${dono ? 'assumido' : ''}" data-terr="${esc(x.chave)}" data-terr-col="${x.c.id}" data-terr-tipo="${x.tipo}">
        <div class="terr-tit">${x.tipo === 'sem_lista' ? '📋 Prometido e fora da lista' : x.tipo === 'motoboy_mudo' ? '🛵 Motoboy não informou' : '⏳ Cliente esperando'}</div>
        <div class="terr-motivo">${esc(x.motivo)}</div>
        <div class="terr-msg">“${esc((x.c.texto || '').slice(0, 120))}” <span class="mudo">· ${dataCurta(x.c.quando)} ${hm(x.c.quando)}</span></div>
        ${dono ? `<div class="terr-dono">🙋 <b>${esc(dono)}</b> assumiu às ${hm(x.reg.assumido_em)} — só fecha escrevendo o que foi feito</div>
                  <div class="acao"><button data-terr-acao="resolver">✅ Resolvido — escrever o que fiz</button></div>`
                : `<div class="acao"><button class="grande" data-terr-acao="assumir">🙋 EU ASSUMO</button></div>`}
      </div>`
    }).join('') : '<div class="vazio">✅ Nenhum terremoto agora. Quando tocar, para tudo.</div>'
    const hoje0 = new Date(); hoje0.setHours(0, 0, 0, 0)
    const doDia = terremotos.filter(t => T(t.aberto_em) >= hoje0.getTime())
    const passou = doDia.length > TERR_TETO
    $('terrHist').innerHTML = `<h3>Hoje: ${doDia.length} terremoto${doDia.length === 1 ? '' : 's'} ${passou ? '<span class="fx cr">acima do teto de 3 — o critério vai ser revisto</span>' : '<span class="fx ex">dentro do teto de 3</span>'}</h3>` +
      (doDia.length ? `<table class="tb"><thead><tr><th>Hora</th><th>Caso</th><th>Quem assumiu</th><th>O que foi feito</th><th class="num">Tempo até resolver</th></tr></thead><tbody>` +
        doDia.map(t => `<tr><td>${hm(t.aberto_em)}</td><td>${esc(t.clinica || '')} <span class="mudo">${esc(t.motivo || '')}</span></td><td>${esc(t.assumido_por || '—')}</td><td>${esc(t.o_que_fez || '—')}</td><td class="num">${t.resolvido_em ? fmt((T(t.resolvido_em) - T(t.aberto_em)) / 60000) : 'em aberto'}</td></tr>`).join('') + '</tbody></table>' : '')
  }
  // ── dia 5: placar do agendamento (mesma régua do placar das rotas) ──
  function placarColeta(todas) {
    const el = $('colPlacar'); if (!el) return
    const hoje0 = new Date(); hoje0.setHours(0, 0, 0, 0)
    const doDia = todas.filter(c => T(c.quando) >= hoje0.getTime() && c.status !== 'descartada')
    const dia = doDia.filter(c => !EH_MATERIAL(c))                 // material tem outro fim (entregue), não entra na régua da coleta
    const mat = doDia.filter(EH_MATERIAL)
    if (!doDia.length) { el.innerHTML = ''; return }
    const med = arr => { if (!arr.length) return null; const a = arr.slice().sort((x, y) => x - y); return a[Math.floor(a.length / 2)] }
    const agendou = dia.filter(c => c.agendada_em), entrou = dia.filter(c => c.na_lista_em)
    const feita = dia.filter(c => c.coletada_em), avisou = dia.filter(c => c.avisado_em)
    const tAgendar = med(agendou.map(c => (T(c.agendada_em) - T(c.quando)) / 60000))
    const tColeta = med(feita.map(c => (T(c.coletada_em) - T(c.quando)) / 60000))
    const pct = (a, b) => b ? Math.round((a / b) * 100) : null
    const item = (rot, v, alvo, fmtv, menorMelhor) => {
      const bom = v === null ? null : menorMelhor ? v <= alvo : v >= alvo
      return `<div class="pl-item ${bom === null ? '' : bom ? 'bom' : 'ruim'}"><b>${v === null ? '—' : fmtv(v)}</b><span>${rot}</span><i>meta ${fmtv(alvo)}</i></div>`
    }
    if (!dia.length) {
      el.innerHTML = `<h3>🏆 Placar do agendamento — hoje</h3><div class="placar-grade">
        <div class="pl-item"><b>${mat.filter(c => c.status === 'entregue').length}/${mat.length}</b><span>📦 material entregue</span><i>meta 100%</i></div></div>`
      return
    }
    const nota = Math.round((pct(agendou.length, dia.length) || 0) * 0.3 + (pct(entrou.length, dia.length) || 0) * 0.3 + (pct(feita.length, dia.length) || 0) * 0.25 + (pct(avisou.length, dia.length) || 0) * 0.15)
    const faixa = nota >= 90 ? ['🏆 Excelente', 'ex'] : nota >= 75 ? ['👍 Bom', 'bom'] : nota >= 55 ? ['⚠️ Atenção', 'at'] : ['🚨 Precisa de ajuda', 'cr']
    el.innerHTML = `<h3>🏆 Placar do agendamento — hoje <span class="fx ${faixa[1]}">${faixa[0]} · nota ${nota}</span></h3>
      <div class="placar-grade">
        ${item('pedidos que viraram agendamento', pct(agendou.length, dia.length), 95, v => v + '%', false)}
        ${item('entraram na lista da rota', pct(entrou.length, dia.length), 95, v => v + '%', false)}
        ${item('coleta confirmada pelo motoboy', pct(feita.length, dia.length), 90, v => v + '%', false)}
        ${mat.length ? item('📦 material entregue', pct(mat.filter(c => c.status === 'entregue').length, mat.length), 100, v => v + '%', false) : ''}
        ${item('clínicas avisadas', pct(avisou.length, dia.length), 100, v => v + '%', false)}
        ${item('tempo até agendar', tAgendar, 5, v => fmt(v), true)}
        ${item('tempo do pedido até a coleta', tColeta, 240, v => fmt(v), true)}
      </div>
      <p class="mudo" style="font-size:12.5px;margin:0">${dia.length} pedidos hoje. Nota = agendou (30) + entrou na lista (30) + foi coletado (25) + clínica avisada (15). Metas: aceite em 5 min (praças de entrega), coleta em até 4 h e 95% de cumprimento (última milha).</p>`
  }
  // histórico + comparação com o mercado (benchmark de logística de coleta)
  const MERCADO = { aceite: 5, naLista: 60, agendados: 95, acerto: 85 }
  function desenharHistColeta(lista) {
    const el = $('colHist'); if (!el) return
    const tratadas = lista.filter(c => c.status !== 'nova')
    const agendadas = lista.filter(c => ['agendada', 'na_lista', 'informada', 'coletada'].includes(c.status))
    const naLista = lista.filter(c => c.na_lista_em)
    const feitas = lista.filter(c => c.coletada_em)
    const mediana = arr => { if (!arr.length) return null; const a = arr.slice().sort((x, y) => x - y); return a[Math.floor(a.length / 2)] }
    const tAceite = mediana(agendadas.filter(c => c.agendada_em).map(c => (T(c.agendada_em) - T(c.quando)) / 60000))
    const tLista = mediana(naLista.map(c => (T(c.na_lista_em) - T(c.quando)) / 60000))
    const pctAgendado = lista.length ? Math.round((agendadas.length / lista.length) * 100) : null
    const comSug = agendadas.filter(c => c.rota && c.rota_sug)
    const acerto = comSug.length ? Math.round((comSug.filter(c => c.rota.trim().toLowerCase() === c.rota_sug.trim().toLowerCase()).length / comSug.length) * 100) : null
    const linha = (rot, valor, alvo, fmtv, menorMelhor = true) => {
      if (valor === null) return `<tr><td>${rot}</td><td class="num">—</td><td class="num mudo">${fmtv(alvo)}</td><td>sem dados ainda</td></tr>`
      const bom = menorMelhor ? valor <= alvo : valor >= alvo
      return `<tr><td>${rot}</td><td class="num"><b class="${bom ? 'verde' : 'vermelho'}">${fmtv(valor)}</b></td><td class="num mudo">${fmtv(alvo)}</td><td>${bom ? '✅ dentro do padrão' : '⚠️ acima do padrão de mercado'}</td></tr>`
    }
    const ensinadas = regras.length
    const corrigidas = agendadas.filter(c => c.rota && c.rota_sug && c.rota.trim().toLowerCase() !== c.rota_sug.trim().toLowerCase()).length
    const errosIA = suspeitas.filter(x => x.status === 'nao_e_inclusao').length
    $('colPlacar') && ($('colPlacar').innerHTML = `<div class="placar"><b>📚 Placar do treino da IA</b>
      <span><b>${acerto === null ? '—' : acerto + '%'}</b> de acerto na rota</span>
      <span><b>${corrigidas}</b> correções da equipe</span>
      <span><b>${ensinadas}</b> regras fixas ensinadas</span>
      <span><b>${errosIA}</b> frases marcadas como "a IA errou"</span>
      <span class="mudo">cada clique de vocês entra no próximo palpite</span></div>`)
    el.innerHTML = `<h3>Histórico e comparação com o mercado <span class="mudo">· ${lista.length} pedidos nos últimos 3 dias</span></h3>
      <table class="tab-bench"><thead><tr><th>Indicador</th><th class="num">Alpha</th><th class="num">Mercado</th><th>Situação</th></tr></thead><tbody>
      ${linha('Tempo até o Atendimento agendar', tAceite, MERCADO.aceite, v => fmt(v))}
      ${linha('Tempo do pedido até entrar na lista', tLista, MERCADO.naLista, v => fmt(v))}
      ${linha('% dos pedidos que viraram agendamento', pctAgendado, MERCADO.agendados, v => v + '%', false)}
      ${linha('Acerto da IA na rota sugerida', acerto, MERCADO.acerto, v => v + '%', false)}
      ${(() => { const t = mediana(feitas.map(c => (T(c.coletada_em) - T(c.quando)) / 60000)); return linha('Tempo do pedido até o motoboy coletar', t, 240, v => fmt(v)) })()}
      ${(() => { const p = agendadas.length ? Math.round((feitas.length / agendadas.length) * 100) : null; return linha('Agendamentos que viraram coleta confirmada', p, 95, v => v + '%', false) })()}
      </tbody></table>
      <p class="mudo" style="font-size:12.5px;margin:0">Padrões de referência: aceite do pedido em até 5 min (praças de entrega — iFood, Rappi), coleta atribuída a uma rota em até 1 h (Loggi, 99), 95% dos pedidos atendidos no dia (coleta domiciliar de laboratório) e 85% de acerto de roteirização automática antes de exigir revisão humana.</p>`
  }
  // ensinar a IA — vale para qualquer cartão, inclusive depois de agendado
  function linhaEnsina(c) {
    const jaTem = regras.some(x => x.grupo === c.grupo && x.regra === 'rota_fixa')
    const rotaAtual = c.rota || c.rota_sug || ''
    const principal = rotaAtual && !jaTem
      ? `<button class="leve" data-regra="rota_fixa" data-valor="${esc(rotaAtual)}">📌 Essa clínica é SEMPRE ${esc(rotaAtual)}</button>`
      : `<button class="leve" data-regra="rota_fixa" data-valor="">📌 ${jaTem ? 'Trocar a rota fixa dessa clínica' : 'Dizer qual rota atende sempre essa clínica'}</button>`
    return `<details class="ensina-box"><summary>📚 Ensinar a IA sobre <b>${esc(c.clinica || '')}</b> <span class="mudo">— vale para os próximos pedidos</span></summary>
      <div class="acao ensina">${principal}
        <button class="leve" data-regra="so_manha">🌅 Só recebe de manhã</button>
        <button class="leve" data-regra="so_tarde">🌇 Só recebe à tarde</button>
        <button class="leve" data-regra="nao_atende">⛔ Não é mais cliente</button></div>
      <p class="mudo ensina-ajuda">Use quando a clínica tem regra própria: <b>só de manhã</b> ou <b>só à tarde</b> faz a IA parar de sugerir o turno errado; <b>não é mais cliente</b> faz a IA parar de abrir cartão para ela. Se não for o caso, ignore.</p></details>`
  }
  function caixaMensagem(c) {
    if (c.status === 'descartada') return ''
    const { t, m } = mensagemCliente(c)
    const jaAvisou = !!c.avisado_em
    return `<div class="msg-box ${jaAvisou ? 'ok' : ''}">
      <div class="msg-cab">💬 <b>${t}</b> <span class="mudo">— mensagem pronta para a clínica${jaAvisou ? ` · avisado ${hm(c.avisado_em)} por ${esc(c.avisado_por || '')}` : ''}</span></div>
      <div class="msg-txt" data-msg="${c.id}">${esc(m)}</div>
      <div class="acao"><button data-enviar="${c.id}" title="Envia agora no grupo de TESTE, identificando a clínica">📤 Enviar (grupo de teste)</button>${c.status === 'coletada' ? `<button class="leve" data-pesquisa="${c.id}" title="Gera o link da pesquisa de satisfação para esta clínica">⭐ Pesquisa de satisfação</button>` : ''}<button class="leve" data-copiar="${c.id}">📋 Copiar</button>${jaAvisou ? '' : `<button class="leve" data-avisei="${c.id}">✅ Avisei a clínica</button>`}</div>
    </div>`
  }
  const podeDesfazer = c => c.status !== 'na_lista' && (agora() - T(c.agendada_em || c.criado_em)) / 60000 <= 15
  function regrasDaClinica(c) {
    const r = regras.filter(x => x.grupo === c.grupo)
    if (!r.length) return ''
    const txt = r.map(x => x.regra === 'rota_fixa' ? `📌 sempre ${esc(x.valor)}` : x.regra === 'so_manha' ? '🌅 só de manhã' : x.regra === 'so_tarde' ? '🌇 só à tarde' : '⛔ não atendemos')
    return `<div class="ia-achou"><span class="ia-tag">📚 A EQUIPE ENSINOU:</span>${txt.map(t => `<span class="chip-ia">${t}</span>`).join('')}<button class="mini-x" data-apagar-regra="${esc(c.grupo)}">apagar regra</button></div>`
  }
  $('colPapeis') && $('colPapeis').addEventListener('click', ev => {
    const b = ev.target.closest('button[data-papel]'); if (!b) return
    papel = b.dataset.papel; desenharColetas()
  })
  $('terrLista') && $('terrLista').addEventListener('click', async ev => {
    const bt = ev.target.closest('button[data-terr-acao]'); if (!bt) return
    {
      if (!(await garantirLogin())) return
      const caixa = bt.closest('[data-terr]')
      const chave = caixa.dataset.terr, id = +caixa.dataset.terrCol, tipo = caixa.dataset.terrTipo
      const caso = terremotosAtivos().find(x => x.chave === chave)
      try {
        if (bt.dataset.terrAcao === 'assumir') {
          await rpc('terremoto_assumir', { p_nome: sessao.nome, p_senha: sessao.senha, p_chave: chave, p_tipo: tipo,
            p_clinica: caso ? caso.c.clinica : null, p_cartao: id, p_motivo: caso ? caso.motivo : null })
          toast('Você assumiu — a equipe está vendo seu nome')
        } else {
          const oque = (await pedirMotivo('O que foi feito?', 'Ex.: liguei na clínica e encaixei na rota 5 das 15h') || '').trim()
          if (!oque) return
          await rpc('terremoto_resolver', { p_nome: sessao.nome, p_senha: sessao.senha, p_chave: chave, p_texto: oque })
          toast('Terremoto encerrado')
        }
        await carregar(); desenhar()
      } catch (e) { toast(e.message) }
    }
  })
  $('colLista').addEventListener('change', ev => {
    const sel = ev.target.closest('select[data-campo="rota"]'); if (!sel) return
    const t = sel.closest('.escolha-linha').querySelector('select[data-campo="turno"]')
    t.innerHTML = opcoesTurno(sel.value, t.value)
  })
  $('colLista').addEventListener('click', async ev => {
    const cop = ev.target.closest('button[data-copiar]')
    if (cop) {
      const txt = cop.closest('.msg-box').querySelector('.msg-txt').textContent
      try { await navigator.clipboard.writeText(txt); toast('Mensagem copiada — cole no WhatsApp da clínica') } catch { toast('Copie o texto da caixa acima') }
      return
    }
    const env = ev.target.closest('button[data-enviar]')
    if (env) {
      if (!(await garantirLogin())) return
      const c = coletas.find(x => x.id === +env.dataset.enviar)
      const txt = env.closest('.msg-box').querySelector('.msg-txt').textContent
      if (!confirm(`Enviar esta mensagem no GRUPO DE TESTE?\n\nClínica: ${c.clinica}\n\n"${txt}"\n\n(nada vai para o grupo da clínica)`)) return
      try {
        await rpc('inc_envio_novo', { p_nome: sessao.nome, p_senha: sessao.senha, p_coleta: c.id, p_grupo: c.grupo, p_texto: txt })
        toast('Na fila — sai no grupo de teste em até 20 s')
        await carregar(); desenhar()
      } catch (e) { toast(e.message) }
      return
    }
    const pq = ev.target.closest('button[data-pesquisa]')
    if (pq) {
      if (!(await garantirLogin())) return
      const c = coletas.find(x => x.id === +pq.dataset.pesquisa)
      try {
        const cod = await rpc('nps_convite_novo', { p_nome: sessao.nome, p_senha: sessao.senha, p_grupo: c.grupo, p_clinica: c.clinica, p_motivo: 'coleta' })
        const link = `${location.origin}/nps/?c=${cod}`
        const txt = `⭐ *Como foi o nosso atendimento?*\nSua opinião leva 10 segundos e ajuda muito a equipe:\n${link}\n\n_Alpha Labs · Atendimento ao Cliente_`
        try { await navigator.clipboard.writeText(txt) } catch {}
        alert(`Pesquisa criada e copiada:\n\n${txt}`)
        await carregar(); desenhar()
      } catch (e) { toast(e.message) }
      return
    }
    const av = ev.target.closest('button[data-avisei]')
    if (av) {
      if (!(await garantirLogin())) return
      try { await rpc('inc_coleta_avisado', { p_nome: sessao.nome, p_senha: sessao.senha, p_id: +av.dataset.avisei }); toast('Registrado: clínica avisada'); await carregar(); desenhar() } catch (e) { toast(e.message) }
      return
    }
    const reg = ev.target.closest('button[data-regra]')
    const apg = ev.target.closest('button[data-apagar-regra]')
    if (reg || apg) {
      if (!(await garantirLogin())) return
      const item = ev.target.closest('[data-col]'); const c = coletas.find(x => x.id === +item.dataset.col)
      try {
        if (apg) {
          if (!confirm(`Apagar as regras ensinadas para ${c.clinica}?`)) return
          for (const x of regras.filter(y => y.grupo === c.grupo)) await rpc('inc_regra_clinica', { p_nome: sessao.nome, p_senha: sessao.senha, p_grupo: c.grupo, p_clinica: c.clinica, p_regra: x.regra, p_valor: 'apagar' })
          toast('Regras apagadas')
        } else {
          let valor = reg.dataset.valor ?? ''
          if (reg.dataset.regra === 'rota_fixa' && !valor) { valor = (await pedirMotivo(`Qual rota sempre atende ${c.clinica}?`, 'Rota') || '').trim(); if (!valor) return }
          await rpc('inc_regra_clinica', { p_nome: sessao.nome, p_senha: sessao.senha, p_grupo: c.grupo, p_clinica: c.clinica, p_regra: reg.dataset.regra, p_valor: valor })
          toast('Aprendido ✓ a IA já vai usar essa regra')
        }
        await carregar(); desenhar()
      } catch (e) { toast(e.message) }
      return
    }
    const b = ev.target.closest('button[data-col-acao]'); if (!b) return
    if (!(await garantirLogin())) return
    const id = +b.closest('[data-col]').dataset.col
    const c = coletas.find(x => x.id === id)
    let acao = b.dataset.colAcao, rota = b.dataset.rota || '', turno = b.dataset.turno || ''
    if (acao === 'confirmar') {
      const linha = b.closest('[data-col]')
      rota = linha.querySelector('select[data-campo="rota"]').value
      turno = linha.querySelector('select[data-campo="turno"]').value
      if (!rota) { toast('Escolha a rota na caixinha'); return }
      acao = 'agendar'
    }
    try {
      if (acao === 'outra') {
        rota = (await pedirMotivo(`Em qual rota vai entrar? (${c.clinica})`, 'Rota') || '').trim()
        if (!rota) return
        turno = (await pedirMotivo('Qual turno?', 'Turno (manhã / tarde / noite)') || '').trim()
        acao = 'agendar'
      }
      if (acao === 'desfazer') { await rpc('inc_coleta_desfazer', { p_nome: sessao.nome, p_senha: sessao.senha, p_id: id }); toast('Desfeito'); await carregar(); return desenhar() }
      if (acao === 'descartar') { if (!confirm(`Marcar como ERRO DA IA?\n\n"${(c.texto || '').slice(0, 90)}"\n\nIsso não era pedido de coleta.`)) return }
      await rpc('inc_coleta_acao', { p_nome: sessao.nome, p_senha: sessao.senha, p_id: id, p_acao: acao, p_rota: rota, p_turno: turno, p_obs: null })
      toast(acao === 'agendar' ? `Agendado: ${c.clinica} · ${rota} ${turno}` : 'Registrado')
      await carregar(); desenhar()
    } catch (e) { toast(e.message) }
  })
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
    const id = +b.closest('[data-id]').dataset.id
    if (b.dataset.sus === 'abrir') {
      const x = suspeitas.find(y => y.id === id)
      setor = 'cc'; desenhar(); $('btnNova').click()
      setTimeout(() => {
        $('nClinica').value = nomeClinica(x?.grupo); $('nObs').value = x ? `WhatsApp ${hm(x.quando)}: ${x.texto.slice(0, 80)}` : ''
        if (x && examesDoTexto(x.texto).length) $('nExame').value = examesDoTexto(x.texto).join(' + ')
        if (x && x.sug_req) { $('nReq').value = x.sug_req; buscarHF() }      // 🤖 sugestão da IA — a pessoa confere antes de salvar
      }, 150)
      return
    }
    // "Já abri o cartão" sem cartão de verdade = a omissão continua escondida (caso Bandeirantes 16/set) → confere antes
    if (b.dataset.sus === 'registrada') {
      const x = suspeitas.find(y => y.id === id)
      if (!confirm(`Marcar como RESOLVIDO?\n\n"${(x?.texto || '').slice(0, 90)}"\n\nO item fica verde e vai para o histórico da aba.`)) return
    }
    if (b.dataset.sus === 'nao_e_inclusao') {
      const x = suspeitas.find(y => y.id === id)
      if (!confirm(`Marcar como ERRO DA IA?\n\n"${(x?.texto || '').slice(0, 90)}"\n\nA IA vai parar de captar frases parecidas.`)) return
    }
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
  // Thailan/Wal 17/set: alerta SONORO quando chega coisa nova para o meu setor (e pedido de inclusão no WhatsApp)
  function tocar(notas) {
    if (!somLiberado) return
    try {
      ctx ||= new (window.AudioContext || window.webkitAudioContext)()
      notas.forEach(([hz, t], i) => {
        const o = ctx.createOscillator(), g = ctx.createGain()
        o.frequency.value = hz; o.type = 'sine'; o.connect(g); g.connect(ctx.destination)
        const t0 = ctx.currentTime + t; g.gain.setValueAtTime(.3, t0); g.gain.exponentialRampToValueAtTime(.001, t0 + .28)
        o.start(t0); o.stop(t0 + .3)
      })
    } catch {}
  }
  const SOM = { chegou: [[660, 0], [990, .18], [1320, .36]], ia: [[1320, 0], [1046, .16], [1320, .32], [1046, .48]],
    terremoto: [[880, 0], [440, .25], [880, .5], [440, .75], [880, 1], [440, 1.25], [880, 1.5]] }
  const vistosPor = new Map(); let novos = new Map()   // por setor: o que já estava na tela · chave → quando apareceu (selo NOVO)
  function chaveDe(c) { return `c${c.id}:${c.status === 'sem_amostra' ? 'sa' : c.status === 'enviado' ? 'env' : c.etapa}` }
  function avisarNovidades() {
    const meu = setor === 'todos' || setor === 'hist' || setor === 'rast' ? null : setor
    const agoraKeys = new Map()
    for (const c of chamados.filter(ativo)) if (!meu || donoAtual(c) === meu) agoraKeys.set(chaveDe(c), c)
    const sus = suspeitas.filter(x => x.status === 'aberta' && (x.tipo || 'inclusao') === 'inclusao' && !ehColeta(x.texto))
    for (const x of sus) if (!meu || meu === 'cc') agoraKeys.set('s' + x.id, x)
    if (!meu || meu === 'cc') for (const c of coletas.filter(COLETA_ABERTA)) agoraKeys.set('k' + c.id, c)
    if (!meu || meu === 'cc') for (const c of chamados.filter(x => x.status === 'rascunho')) agoraKeys.set('r' + c.id, c)
    if (!meu || meu === 'cc') for (const c of coletas) if (relogio(c).nivel === 'cobrar') agoraKeys.set('x' + c.id, c)
    try { for (const t of terremotosAtivos()) agoraKeys.set('T:' + t.chave, t.c) } catch {}   // terremoto vale para TODO setor
    const vistos = vistosPor.get(setor)
    if (!vistos) { vistosPor.set(setor, new Set(agoraKeys.keys())); return }   // 1ª vez nesta aba: não apita com o que já estava lá
    const chegaram = [...agoraKeys.keys()].filter(k => !vistos.has(k))
    vistosPor.set(setor, new Set(agoraKeys.keys()))
    if (!chegaram.length) return
    const agoraMs = agora()
    chegaram.forEach(k => novos.set(k, agoraMs))
    const terr = chegaram.filter(k => k.startsWith('T:'))
    if (terr.length) {
      const hoje0 = new Date(); hoje0.setHours(0, 0, 0, 0)
      const noDia = terremotos.filter(t => T(t.aberto_em) >= hoje0.getTime()).length
      if (noDia < TERR_TETO) tocar(SOM.terremoto)                 // passou do teto: continua na tela, mas para de apitar
      toast(`🚨 TERREMOTO — ${terr.length > 1 ? `${terr.length} casos` : 'pare o que estiver fazendo'}`)
    }
    const cobra = chegaram.filter(k => k[0] === 'x')
    if (cobra.length) { tocar(SOM.chegou); const c = agoraKeys.get(cobra[0]); toast(`⏰ ${c.clinica}: ${relogio(c).motivo}`) }
    const rasc = chegaram.filter(k => k[0] === 'r')
    if (rasc.length) { tocar(SOM.ia); const c = agoraKeys.get(rasc[0]); toast(`🤖 A IA abriu ${rasc.length > 1 ? `${rasc.length} cartões` : `um cartão: ${c.pet || ''} ${c.req} · +${c.exame}`} — confira`) }
    const col = chegaram.filter(k => k[0] === 'k')
    if (col.length) { tocar(SOM.ia); const c = agoraKeys.get(col[0]); toast(`🛵 ${col.length > 1 ? `${col.length} pedidos de coleta` : `Pedido de coleta · ${c.clinica}`}${c.rota_sug ? ` → ${c.rota_sug}` : ''}`) }
    const ia = chegaram.filter(k => k[0] === 's')
    const cartoes = chegaram.filter(k => k[0] === 'c').map(k => agoraKeys.get(k))
    if (ia.length) {
      tocar(SOM.ia)
      const x = agoraKeys.get(ia[0])
      toast(`🤖 ${ia.length > 1 ? `${ia.length} pedidos de inclusão no WhatsApp` : `Pedido de inclusão no WhatsApp · ${nomeClinica(x.grupo)}`}`)
    }
    if (cartoes.length) {
      tocar(SOM.chegou)
      const c = cartoes[0]
      toast(`🔔 Chegou para ${SETORES[donoAtual(c)].nome}: ${c.pet || ''} ${c.req} · +${c.exame}${cartoes.length > 1 ? ` (e mais ${cartoes.length - 1})` : ''}`)
    }
  }
  const ehNovo = c => { const t = novos.get(chaveDe(c)); return t && agora() - t < 5 * 60000 }
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
    suspeitas = [{ id: 1, status: 'aberta', tipo: 'inclusao', quando: min(22), grupo: 'Alpha - Pet Sorriso', autor: 'Dra. Ana', texto: 'Podem incluir fósforo e ureia no exame do Zeus por favor?', sug_req: '640912', sug_pet: 'ZEUS', sug_cliente: 'Pet Sorriso', sug_entrada: min(160), sug_n: 2 },
      { id: 4, status: 'aberta', tipo: 'inclusao', quando: min(6), grupo: 'Alpha - Clínica Aurora', autor: 'Recepção', texto: 'Consegue adicionar SDMA na requisição da Nina?', sug_n: 0 },
      { id: 5, status: 'aberta', tipo: 'inclusao', quando: min(31), grupo: 'Alpha - Vet Horizonte', autor: 'Dra. Lu', texto: 'Ainda tem sangue do Bob? Queria acrescentar T4', sug_req: '640877', sug_pet: 'BOB', sug_cliente: 'Vet Horizonte', sug_entrada: min(26 * 60), sug_n: 2 },
      { id: 2, status: 'aberta', tipo: 'amostra', quando: min(9), grupo: 'Alpha - Vet Horizonte', autor: 'Recepção', texto: 'Ainda tem amostra da Mel? Queria ver uma coisa' },
      { id: 3, status: 'registrada', tipo: 'inclusao', quando: min(95), grupo: 'Alpha - Bandeirantes', autor: 'Dra.', texto: 'Pode acrescentar fibrinogênio e colesterol', resolvido_por: 'DEMO', resolvido_em: min(80) }]
    coletas = [
      { id: 1, quando: min(22), grupo: 'Alpha - Vet Horizonte', clinica: 'Vet Horizonte', autor: 'Recepção', texto: 'Tenho amostra para buscar, dá para passar hoje?', rota_sug: 'rota 4', turno_sug: 'tarde de hoje', corte_em: new Date(agora() + 9 * 60000).toISOString(), status: 'nova' },
      { id: 2, quando: min(7), grupo: 'Alpha - Pet Sorriso', clinica: 'Pet Sorriso', autor: 'Dra. Ana', texto: 'Pode mandar o motoboy buscar duas amostras?', rota_sug: 'rota 2', turno_sug: 'tarde de hoje', corte_em: new Date(agora() + 52 * 60000).toISOString(), status: 'nova' },
      { id: 3, quando: min(64), grupo: 'Alpha - Clínica Aurora', clinica: 'Clínica Aurora', autor: 'Recepção', texto: 'Temos material aqui, podem vir amanhã cedo', rota_sug: null, turno_sug: 'manhã de amanhã', corte_em: new Date(agora() + 5 * 3600e3).toISOString(), status: 'nova' },
      { id: 4, quando: min(120), grupo: 'Alpha - Vet Prev', clinica: 'Vet Prev', autor: 'Dra.', texto: 'tem amostra para coletar', rota_sug: 'rota 4', turno_sug: 'tarde de hoje', status: 'agendada', rota: 'rota 4', turno: 'tarde', por: 'DEMO', agendada_em: min(115) },
      { id: 5, quando: min(190), grupo: 'Alpha - Su Vet', clinica: 'Su Vet', autor: 'Recepção', texto: 'podem buscar o material?', rota_sug: 'rota 5', turno_sug: 'tarde de hoje', status: 'na_lista', rota: 'rota 5', turno: 'tarde', por: 'DEMO', na_lista_em: min(150), na_lista_rota: 'rota 5' },
      { id: 6, quando: min(14), grupo: 'Alpha - Lillow petshop', clinica: 'Lillow petshop', autor: 'Dra. Paula', texto: 'Preciso de lâmina', rota_sug: 'rota 7', turno_sug: 'tarde de hoje', corte_em: new Date(agora() + 26 * 60000).toISOString(), status: 'nova', tipo: 'material', item: 'lâmina' },
      { id: 8, quando: min(95), grupo: 'Alpha - Vet Sol', clinica: 'Vet Sol', autor: 'Recepção', texto: 'temos coleta', rota_sug: 'rota 3', turno_sug: 'tarde de hoje', status: 'nova' },
      { id: 9, quando: min(300), grupo: 'Alpha - Pet Vida', clinica: 'Pet Vida', autor: 'Dra. Rita', texto: 'Podem buscar o material hoje?', rota_sug: 'rota 2', turno_sug: 'tarde de hoje', corte_em: new Date(agora() - 40 * 60000).toISOString(), status: 'agendada', rota: 'rota 2', turno: 'tarde', por: 'DEMO', agendada_em: min(280) },
      { id: 7, quando: min(240), grupo: 'Alpha - Nup Recreio', clinica: 'Nup Recreio', autor: 'Recepção', texto: 'Podem me mandar alguns tubos vermelhos???', rota_sug: 'rota 9', turno_sug: 'manhã de hoje', status: 'entregue', rota: 'rota 9', turno: 'manhã', por: 'DEMO', na_lista_em: min(200), na_lista_rota: 'rota 9', entregue_em: min(90), tipo: 'material', item: 'tubos' }]
    eventos = chamados.flatMap(x => [{ chamado_id: x.id, quando: x.criado_em, para: 1, acao: 'abriu' }, { chamado_id: x.id, quando: x.etapa_desde, para: x.etapa, acao: 'avancou' }])
    eventos.push({ chamado_id: 6, quando: min(38), para: 3, acao: 'aguardando_clinica', por: 'DEMO' }, { chamado_id: 7, quando: min(5), para: 1, acao: 'sem_amostra', obs: 'soro hemolisado, não dá para fazer', por: 'DEMO' }, { chamado_id: 8, quando: min(3), para: 7, acao: 'encerrar', por: 'DEMO' })
  }
  function demoRpc(nome, a) {
    // ensaio do TERREMOTO: a equipe treina o gesto (assumir → resolver) sem tocar na operação
    if (nome === 'terremoto_assumir') {
      const t = terremotos.find(x => x.chave === a.p_chave)
      if (t) { t.assumido_por = a.p_nome; t.assumido_em = new Date().toISOString() }
      else terremotos.push({ chave: a.p_chave, tipo: a.p_tipo, clinica: a.p_clinica, cartao_id: a.p_cartao, motivo: a.p_motivo, aberto_em: new Date().toISOString(), assumido_por: a.p_nome, assumido_em: new Date().toISOString() })
      return a.p_nome
    }
    if (nome === 'terremoto_resolver') {
      const t = terremotos.find(x => x.chave === a.p_chave)
      if (t) { t.resolvido_por = a.p_nome; t.resolvido_em = new Date().toISOString(); t.o_que_fez = a.p_texto }
      return true
    }
    if (nome === 'inc_coleta_acao') { const x = coletas.find(y => y.id === a.p_id); if (x) { x.status = a.p_acao === 'agendar' ? 'agendada' : 'descartada'; x.rota = a.p_rota; x.turno = a.p_turno; x.por = 'DEMO'; x.agendada_em = new Date().toISOString() } return x ? x.status : null }
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
