/* FILA DE AGENDAMENTO — Alpha Labs · 22/09/2026
   Reusa o que já existe: mesma tabela (inc_coletas), mesmo login (inc_sessao) e as MESMAS RPCs
   do Quadro de Inclusões (inc_publicar_rota, inc_coleta_acao). Nada novo no banco.

   O fluxo, do jeito que o Wal descreveu: a clínica pede → o sistema identifica e sugere a rota →
   o colaborador PEGA, confere e POSTA no grupo do motoboy. */
(() => {
  const URL_SB = 'https://lrwjcdvporaivxvfuiwt.supabase.co'
  const KEY = 'sb_publishable_fcodHc3AxR_HQ-aduMGzlg_CTBALng8'
  const SB = window.supabase && window.supabase.createClient ? window.supabase.createClient(URL_SB, KEY) : null
  const $ = s => document.querySelector(s)
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

  let sessao = lerSessao(), coletas = [], timer = null
  const ROTAS = ['rota 1','rota 2','rota 3','rota 4','rota 5','rota 6','rota 7','rota 8','rota 9',
                 'rota 10','rota 11','rota 12','rota angra','rota folguista','rota 7h manhã']

  function lerSessao() { try { const s = JSON.parse(localStorage.getItem('inc_sessao') || 'null'); return s && s.ate > Date.now() ? s : null } catch { return null } }
  function gravarSessao(s) { try { localStorage.setItem('inc_sessao', JSON.stringify(s)) } catch {} }

  async function rpc(nome, args) {
    const { data, error } = await SB.rpc(nome, args)
    if (error) throw new Error(/login/i.test(error.message) ? 'Nome ou senha não conferem' : error.message)
    return data
  }
  function toast(msg, erro) {
    const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (erro ? ' erro' : ''); t.hidden = false
    clearTimeout(t._t); t._t = setTimeout(() => { t.hidden = true }, 3400)
  }

  // ── ③ o relógio do card: o que espera há mais tempo grita ──
  function espera(quando) {
    const min = Math.max(0, Math.round((Date.now() - Date.parse(quando)) / 60000))
    const txt = min < 60 ? `${min} min` : `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`
    // faixas escolhidas com o histórico real: metade das paradas entra em 35 min, 3 de cada 4 em 93.
    const nivel = min >= 90 ? 'urgente' : min >= 35 ? 'atencao' : ''
    return { txt, nivel, min }
  }

  function cardHTML(c, minha) {
    const e = espera(c.quando || c.criado_em)
    const rotaSel = c.rota || c.rota_sug || ''
    const opcoes = ROTAS.map(r => `<option value="${esc(r)}"${r === rotaSel ? ' selected' : ''}>${esc(r)}</option>`).join('')
    const temEnd = !!(c._endereco)
    return `<article class="card ${minha ? 'minha' : e.nivel}" data-id="${c.id}">
      <div class="cab">
        <span class="clinica">${esc(c.clinica || c.grupo || 'clínica')}</span>
        <span class="espera ${e.nivel}">⏱ ${e.txt}</span>
      </div>
      ${c.texto ? `<div class="pedido">“${esc(String(c.texto).slice(0, 130))}”</div>` : ''}
      ${temEnd
        ? `<div class="endereco"><span class="ico">📍</span><span>${esc(c._endereco)}</span></div>`
        : `<div class="semend">⚠️ <span>Sem endereço conhecido — vai precisar montar à mão</span></div>`}
      ${c._alerta ? `<div class="alerta">⚠️ <span>${esc(c._alerta)}</span></div>` : ''}
      <div class="linhaRota">
        <label for="r${c.id}">Rota:</label>
        <select id="r${c.id}" data-rota="${c.id}">${opcoes}</select>
        ${c.rota_sug ? `<span class="sug">sugestão do sistema${c.fonte ? ` · ${esc(String(c.fonte).split('·').pop().trim())}` : ''}</span>` : ''}
      </div>
      <div class="acoes">
        ${minha
          ? `<button class="principal postar" data-acao="postar" data-id="${c.id}">📤 Postar na rota</button>
             <button class="secundaria" data-acao="devolver" data-id="${c.id}">devolver à fila</button>`
          : `<button class="principal" data-acao="pegar" data-id="${c.id}">🙋 Pegar</button>`}
      </div>
      ${(!minha && c.por) ? `<div class="travado">🔒 com <b>${esc(c.por)}</b></div>` : ''}
    </article>`
  }

  function pintar() {
    const eu = (sessao && sessao.nome || '').toLowerCase()
    const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
    const daFila = coletas.filter(c => c.status === 'nova' && !(c.por || '').trim())
    const minhas = coletas.filter(c => c.status === 'nova' && (c.por || '').toLowerCase() === eu)
    const feitas = coletas.filter(c => ['na_lista', 'agendada', 'coletada'].includes(c.status) && (c.na_lista_em || c.agendada_em || '').slice(0, 10) === hoje)

    $('#nEsperando').textContent = daFila.length
    $('#nMinhas').textContent = minhas.length
    $('#nFeitas').textContent = feitas.length

    // o que espera há mais tempo vem primeiro — benchmark ③
    const ord = (a, b) => Date.parse(a.quando || a.criado_em) - Date.parse(b.quando || b.criado_em)
    $('#minhas').hidden = !minhas.length
    $('#listaMinhas').innerHTML = minhas.sort(ord).map(c => cardHTML(c, true)).join('')
    $('#listaFila').innerHTML = daFila.sort(ord).map(c => cardHTML(c, false)).join('')
    $('#vazio').hidden = daFila.length > 0
    $('#listaFeitas').innerHTML = feitas.length
      ? feitas.slice(-40).map(c => `<span class="feita">✓ ${esc(c.clinica || c.grupo)}${c.rota ? ` · ${esc(c.rota)}` : ''}</span>`).join('')
      : '<span class="sug">nenhuma ainda hoje</span>'
  }

  async function carregar() {
    const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
    const { data, error } = await SB.from('inc_coletas').select('*')
      .gte('criado_em', `${hoje}T03:00:00Z`).order('criado_em', { ascending: true }).limit(400)
    if (error) { toast('Não consegui ler a fila: ' + error.message, true); return }
    coletas = (data || []).filter(c => c.tipo !== 'material')
    // endereço conhecido: a última parada que já foi postada para aquela clínica
    for (const c of coletas) { c._endereco = c.obs && /^END:/.test(c.obs) ? c.obs.slice(4) : null }
    pintar()
  }

  // ── ① PULL: o colaborador PEGA. ② CLAIM: trava e mostra quem está com o item ──
  async function pegar(id) {
    const c = coletas.find(x => String(x.id) === String(id)); if (!c) return
    if ((c.por || '').trim()) { toast(`Já está com ${c.por}`, true); return carregar() }
    c.por = sessao.nome; pintar()                                   // resposta imediata, sem esperar a rede
    try { const r = await rpc('inc_coleta_pegar', { p_nome: sessao.nome, p_senha: sessao.senha, p_id: Number(id), p_acao: 'pegar' })
      if (r && r.startsWith('ja_com:')) toast('Já está com ' + r.slice(7), true) }
    catch (e) { toast('Não consegui reservar: ' + e.message, true) }
    carregar()
  }
  async function devolver(id) {
    try { await rpc('inc_coleta_pegar', { p_nome: sessao.nome, p_senha: sessao.senha, p_id: Number(id), p_acao: 'devolver' }) }
    catch (e) { toast('Não consegui devolver: ' + e.message, true) }
    carregar()
  }
  async function postar(id, botao) {
    const sel = document.querySelector(`[data-rota="${id}"]`)
    const rota = sel ? sel.value : ''
    if (!rota) { toast('Escolha a rota primeiro', true); return }
    botao.disabled = true; botao.textContent = 'postando…'
    try {
      await rpc('inc_publicar_rota', { p_nome: sessao.nome, p_senha: sessao.senha, p_id: Number(id), p_rota: rota })
      toast(`Postado na ${rota} 🛵`)
    } catch (e) { toast('Não saiu: ' + e.message, true); botao.disabled = false; botao.textContent = '📤 Postar na rota' }
    carregar()
  }

  document.addEventListener('click', ev => {
    const b = ev.target.closest('[data-acao]'); if (!b) return
    const id = b.dataset.id
    if (b.dataset.acao === 'pegar') pegar(id)
    else if (b.dataset.acao === 'devolver') devolver(id)
    else if (b.dataset.acao === 'postar') postar(id, b)
  })

  // ── login (mesma sessão do Quadro de Inclusões; eu nunca guardo nem defino senha) ──
  // ⚠️ 22/set: o Wal não conseguiu entrar. Eu tinha feito campo de texto livre, e o nome dele
  // está cadastrado como "WAL" — qualquer diferença de maiúscula ou acento derruba o login.
  // O Quadro de Inclusões nunca teve esse problema porque ESCOLHE o nome numa lista. Mesma coisa
  // aqui: quem digita, erra; quem escolhe, não.
  async function mostrarLogin() {
    $('#painelLogin').hidden = false
    try {
      const { data } = await SB.rpc('sep_team_names')
      const nomes = (data || []).map(x => typeof x === 'string' ? x : (x.nome || '')).filter(Boolean).sort((a, b) => a.localeCompare(b, 'pt'))
      $('#inNome').innerHTML = '<option value="">escolha seu nome…</option>' +
        nomes.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('')
      const ultimo = localStorage.getItem('agenda_ultimo_nome')
      if (ultimo && nomes.includes(ultimo)) $('#inNome').value = ultimo
    } catch (e) {
      // sem a lista, volta para digitar — melhor entrar torto do que não entrar
      $('#inNome').outerHTML = '<input id="inNome" autocomplete="username" required placeholder="seu nome">'
    }
    $('#inNome').focus()
  }
  $('#formLogin').addEventListener('submit', async ev => {
    ev.preventDefault()
    const nome = $('#inNome').value.trim(), senha = $('#inSenha').value
    if (!nome) { $('#erroLogin').textContent = 'Escolha seu nome na lista'; $('#erroLogin').hidden = false; return }
    try { localStorage.setItem('agenda_ultimo_nome', nome) } catch {}
    try {
      await rpc('inc_coleta_pegar', { p_nome: nome, p_senha: senha, p_id: 0, p_acao: 'ping' })
    } catch (e) {
      $('#erroLogin').textContent = /não conferem|login/i.test(e.message)
        ? 'Senha não confere — é a mesma do Quadro de Inclusões' : ('Erro do sistema: ' + e.message)
      $('#erroLogin').hidden = false; return
    }
    sessao = { nome, senha, ate: Date.now() + 12 * 3600e3 }
    gravarSessao(sessao); $('#painelLogin').hidden = true; iniciar()
  })
  $('#btSair').addEventListener('click', () => { try { localStorage.removeItem('inc_sessao') } catch {}; location.reload() })

  function iniciar() {
    $('#euSou').textContent = sessao.nome
    $('#quemSou').hidden = false
    $('#btSair').hidden = false
    carregar()
    clearInterval(timer); timer = setInterval(carregar, 20000)   // a fila é compartilhada: atualiza sozinha
    // ao voltar para a aba, atualiza na hora — mesa física fica com a tela aberta o dia todo
    document.addEventListener('visibilitychange', () => { if (!document.hidden) carregar() })
  }

  if (!SB) { toast('Sem conexão com o banco', true) }
  else if (sessao) iniciar()
  else mostrarLogin()
})()
