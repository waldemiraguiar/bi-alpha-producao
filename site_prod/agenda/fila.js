/* FILA DE AGENDAMENTO — Alpha Labs · 22/09/2026
   Reusa o que já existe: mesma tabela (inc_coletas), mesmo login (inc_sessao) e as MESMAS RPCs
   do Quadro de Inclusões (inc_publicar_rota, inc_coleta_acao). Nada novo no banco.

   O fluxo, do jeito que o Wal descreveu: a clínica pede → o sistema identifica e sugere a rota →
   o colaborador PEGA, confere e POSTA no grupo do motoboy. */
(() => {
  /* ═══ 🔄 VERSÃO NA TELA + BOTÃO ATUALIZAR ═══════════════════════════════════
     Wal, 23/set: "preciso de uma versão com data e horário chamando atenção e um
     botão de atualizar para evitar esse problema de cache velho."

     O problema real: a pessoa abre a página, o navegador serve o HTML guardado, e
     ela vê uma versão antiga sem saber. Some a diferença entre "está quebrado" e
     "está velho" — foi exatamente o que aconteceu hoje.

     Duas peças:
     ① O SELO diz a data/hora da versão que está NA TELA. Carimbo gerado no deploy.
     ② O VIGIA pergunta ao servidor, de 2 em 2 minutos, qual é a versão publicada.
        Se for diferente da que está na tela, o selo fica âmbar e pulsa.
     ③ O BOTÃO recarrega forçando o servidor (endereço novo), sem Cmd+Shift+R —
        atalho que o Wal não usa; ele pediu botão dentro do app. */
  const VERSAO = /*CARIMBO*/'23/09 13:15'
  const URL_SB = 'https://lrwjcdvporaivxvfuiwt.supabase.co'
  const KEY = 'sb_publishable_fcodHc3AxR_HQ-aduMGzlg_CTBALng8'
  // realtime: o banco AVISA quando muda. Antes eu perguntava a cada 20s — com 5 mesas abertas
  // 10h por dia dá 9.000 consultas/dia (198 mil/mês) para, quase sempre, ouvir "nada mudou".
  // Ouvindo, a tela fica mais rápida (aparece no instante) e o custo cai para perto de zero.
  const SB = window.supabase && window.supabase.createClient
    ? window.supabase.createClient(URL_SB, KEY, { realtime: { params: { eventsPerSecond: 3 } } }) : null
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

  // ── ③ o relógio do card ──
  // Wal, 23/set: 5 min = amarelo, 10 min = vermelho, e os cards se REAGRUPAM por faixa.
  // Benchmark: em fila de atendimento o agente prioriza pelo TEMPO QUE RESTA do acordo, não pela
  // ordem de chegada (Zendesk/Gorgias) — por isso o relógio é o elemento mais forte do card. E o
  // agrupamento por idade é o que os guias de "ticket aging" usam para atacar o atraso em bloco,
  // em vez de caçar item por item numa lista só.
  const SLA = { atencao: 5, urgente: 10 }        // minutos
  function espera(quando) {
    const ms = Math.max(0, Date.now() - Date.parse(quando))
    const min = Math.floor(ms / 60000), seg = Math.floor(ms / 1000) % 60
    const txt = min < 60 ? `${min}:${String(seg).padStart(2, '0')}` : `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`
    const nivel = min >= SLA.urgente ? 'urgente' : min >= SLA.atencao ? 'atencao' : ''
    return { txt, nivel, min }
  }
  // data e hora do pedido — o cronômetro diz HÁ QUANTO TEMPO, isto diz DESDE QUANDO.
  // Sem os dois, quem chega no meio do turno não sabe se "12:03" é de agora ou de ontem.
  function quandoTxt(iso) {
    const d = new Date(iso)
    if (isNaN(d)) return ''
    const o = { timeZone: 'America/Sao_Paulo' }
    const hoje = new Date().toLocaleDateString('sv-SE', o)
    const dia = d.toLocaleDateString('sv-SE', o)
    const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', ...o })
    if (dia === hoje) return `hoje ${hora}`
    const ontem = new Date(Date.now() - 864e5).toLocaleDateString('sv-SE', o)
    if (dia === ontem) return `ontem ${hora}`
    return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', ...o })} ${hora}`
  }

  function cardHTML(c, minha) {
    const e = espera(c.quando || c.criado_em)
    const rotaSel = c.rota || c.rota_sug || ''
    const opcoes = ROTAS.map(r => `<option value="${esc(r)}"${r === rotaSel ? ' selected' : ''}>${esc(r)}</option>`).join('')
    const temEnd = !!(c._endereco)
    const t0 = Date.parse(c.quando || c.criado_em) || Date.now()
    // 💚 Wal, 23/set: "pensando em separar por cores, exemplo agendamento azul e orçamento verde".
    // Assunto diferente, cor diferente — a pessoa bate o olho e sabe o que tem pela frente sem ler.
    const orc = c.tipo === 'orcamento'
    const sugeridos = orc && c.item ? String(c.item).split(' · ').filter(Boolean) : []
    return `<article class="card ${orc ? 'orcamento ' : ''}${minha ? 'minha' : e.nivel}" data-id="${c.id}" data-nivel="${e.nivel}">
      <div class="cab">
        <span class="assunto ${orc ? 'verde' : 'azul'}">${orc ? '💚 orçamento' : '🛵 coleta'}</span>
        <span class="clinica">${esc(c.clinica || c.grupo || 'clínica')}</span>
        <span class="espera ${e.nivel}" data-desde="${t0}"><i>⏱</i>${e.txt}</span>
      </div>
      <div class="desde">pedido <b>${esc(quandoTxt(c.quando || c.criado_em))}</b></div>
      ${c.texto ? `<div class="pedido">“${esc(String(c.texto).slice(0, 130))}”</div>` : ''}
      ${temEnd
        ? `<div class="endereco"><span class="ico">📍</span><span>${esc(c._endereco)}</span></div>`
        : `<div class="semend">⚠️ <span>Sem endereço conhecido — vai precisar montar à mão</span></div>`}
      ${c._alerta ? `<div class="alerta">⚠️ <span>${esc(c._alerta)}</span></div>` : ''}
      ${orc ? `<div class="sugeridos">
        ${sugeridos.length
          ? `<div class="sugTit">exames que eu achei parecidos — confira antes de mandar:</div>
             <ul>${sugeridos.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`
          : `<div class="sugTit">não identifiquei o exame no que ela escreveu — use a busca do orçamento aí em cima.</div>`}
      </div>` : ''}
      <div class="linhaRota"${orc ? ' hidden' : ''}>
        <label for="r${c.id}">Rota:</label>
        <select id="r${c.id}" data-rota="${c.id}">${opcoes}</select>
        ${c.rota_sug ? `<span class="sug">sugestão do sistema${c.fonte ? ` · ${esc(String(c.fonte).split('·').pop().trim())}` : ''}</span>` : ''}
      </div>
      <div class="acoes">
        ${minha
          ? (orc
             ? `<button class="principal responder" data-acao="responder" data-id="${c.id}">💬 Montar a resposta</button>
                <button class="secundaria" data-acao="devolver" data-id="${c.id}">devolver à fila</button>`
             : `<button class="principal postar" data-acao="postar" data-id="${c.id}">📤 Postar na rota</button>
                <button class="secundaria" data-acao="devolver" data-id="${c.id}">devolver à fila</button>`)
          : `<button class="principal" data-acao="pegar" data-id="${c.id}">🙋 Pegar</button>`}
      </div>
      ${(!minha && c.por) ? `<div class="travado">🔒 com <b>${esc(c.por)}</b></div>` : ''}
    </article>`
  }

  // ── timer ao vivo: atualiza o relógio de cada card a cada segundo, SEM tocar no banco.
  // Custo zero e a tela "respira" — o Wal pediu mais dinâmica, e dinâmica não precisa ser rede.
  function tiquetaque() {
    let virou = false
    for (const el of document.querySelectorAll('[data-desde]')) {
      const e = espera(Number(el.dataset.desde))
      el.innerHTML = `<i>⏱</i>${e.txt}`
      el.className = 'espera ' + e.nivel
      const card = el.closest('.card')
      if (!card) continue
      if (card.dataset.nivel !== e.nivel) { card.dataset.nivel = e.nivel; virou = true }
      if (!card.classList.contains('minha')) card.className = 'card ' + e.nivel
    }
    // ⓻ REAGRUPAR: o card que acabou de passar de 5 ou 10 min sai do bloco dele e vai para junto
    // dos outros da mesma faixa. É o ponto do pedido do Wal — ver os atrasados JUNTOS, não
    // espalhados. Só redesenha quando ALGUÉM vira de faixa; caso contrário a tela só tiquetaqueia.
    if (virou) pintar()
  }
  setInterval(tiquetaque, 1000)

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

    // ⓻ AGRUPAR POR FAIXA DE ESPERA — os atrasados ficam juntos, no topo.
    // Numa lista única o item de 11 min some no meio dos de 1 min; agrupado, o bloco vermelho é a
    // primeira coisa que a pessoa vê ao abrir a tela. Bloco vazio não aparece (não vira ruído).
    const faixas = [
      { nivel: 'urgente', titulo: 'Passou de 10 minutos', sub: 'atenda estes primeiro' },
      { nivel: 'atencao', titulo: 'Passou de 5 minutos', sub: 'começando a atrasar' },
      { nivel: '', titulo: 'Acabaram de chegar', sub: 'dentro do tempo' },
    ]
    $('#listaFila').innerHTML = faixas.map(f => {
      const desta = daFila.filter(c => espera(c.quando || c.criado_em).nivel === f.nivel).sort(ord)
      if (!desta.length) return ''
      return `<div class="faixa ${f.nivel || 'novo'}">
          <h3><span class="pino"></span>${f.titulo}<b>${desta.length}</b><small>${f.sub}</small></h3>
          <div class="cards">${desta.map(c => cardHTML(c, false)).join('')}</div>
        </div>`
    }).join('')
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
    coletas = (data || []).filter(c => c.tipo !== 'material')   // coleta E orçamento entram na fila
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

  // 💬 do card verde para o orçamento: marca os exames sugeridos e rola até lá.
  // Assim a pessoa não precisa digitar de novo o que eu já identifiquei.
  function responder(id) {
    const c = coletas.find(x => String(x.id) === String(id)); if (!c) return
    const nomes = String(c.item || '').split(' · ').map(x => x.split(' = ')[0].trim()).filter(Boolean)
    escolhidos.clear()
    for (const n of nomes) {
      const p = precos.find(p => p.nome === n)
      if (p) escolhidos.add(p.id)
    }
    $('#orcQ').value = ''
    pintarPrecos()
    $('#blocoOrc')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    toast(escolhidos.size
      ? `${escolhidos.size} exame(s) marcado(s) — confira e copie a mensagem 💚`
      : 'Não identifiquei o exame — busque pelo nome aí em cima', !escolhidos.size)
  }

  document.addEventListener('click', ev => {
    const b = ev.target.closest('[data-acao]'); if (!b) return
    const id = b.dataset.id
    if (b.dataset.acao === 'responder') responder(id)
    if (b.dataset.acao === 'pegar') pegar(id)
    else if (b.dataset.acao === 'devolver') devolver(id)
    else if (b.dataset.acao === 'postar') postar(id, b)
  })

  /* ═══ 💰 ORÇAMENTO DE EXAMES ═══════════════════════════════════════════════
     206 exames da tabela de março/2026, extraídos do PDF pela grade e conferidos
     item a item. Ficam NO BANCO, não em arquivo do site: o repositório é público.

     Carrega uma vez ao entrar e filtra no navegador — 206 linhas cabem de sobra na
     memória, e assim não há ida ao banco a cada letra digitada. */
  let precos = [], vigencia = '', escolhidos = new Set()
  // ⚠️ 23/set — o Wal abriu e disse "não funcionou". O card nascia em BRANCO: sem login os
  // preços não carregam e nada era escrito na tela. Retângulo vazio parece defeito, não espera.
  // Agora o card sempre diz em que pé está — carregando, pronto, ou com erro e botão de tentar.
  function estadoOrc(html) { const el = $('#orcLista'); if (el) el.innerHTML = `<div class="orcNada">${html}</div>` }
  estadoOrc('Entre com seu nome e senha para consultar os preços.')
  const semAcento = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const dinheiro = c => 'R$ ' + (c / 100).toFixed(2).replace('.', ',')

  async function carregarPrecos() {
    if (!sessao || precos.length) return
    estadoOrc('carregando a tabela de preços…')
    try {
      precos = await rpc('precos_listar', { p_nome: sessao.nome, p_senha: sessao.senha }) || []
      vigencia = await rpc('precos_vigencia', { p_nome: sessao.nome, p_senha: sessao.senha }) || ''
      for (const p of precos) p._b = semAcento(p.nome + ' ' + p.secao)
      $('#orcVig').innerHTML = vigencia ? `tabela de <b>${esc(vigencia)}</b>` : ''
      pintarPrecos()
    } catch (e) {
      const expirou = /login|senha/i.test(e.message)
      estadoOrc(`Não consegui carregar a tabela de preços.<br>
        <small>${esc(e.message)}</small><br><br>
        ${expirou ? 'Sua sessão pode ter expirado — <b>saia e entre de novo</b>.'
                  : '<button class="secundaria" id="orcTentar">tentar de novo</button>'}`)
    }
  }

  function pintarPrecos() {
    const q = semAcento($('#orcQ').value.trim())
    // busca por TODAS as palavras digitadas, em qualquer ordem ("t4 livre" acha "Tiroxina Livre (T4 livre)")
    const termos = q.split(/\s+/).filter(Boolean)
    const achados = !termos.length
      ? (escolhidos.size ? precos.filter(p => escolhidos.has(p.id)) : [])
      : precos.filter(p => termos.every(t => p._b.includes(t)))
    const el = $('#orcLista')
    if (!termos.length && !escolhidos.size) {
      el.innerHTML = `<div class="orcNada">Digite o nome do exame — são <b>${precos.length}</b> na tabela.<br>
        <small>Os parecidos aparecem juntos, para não trocar um pelo outro.</small></div>`
    } else if (!achados.length) {
      el.innerHTML = `<div class="orcNada">Nenhum exame com <b>“${esc($('#orcQ').value.trim())}”</b>.<br>
        <small>Tente uma palavra só, ou parte do nome.</small></div>`
    } else {
      let sec = ''
      el.innerHTML = achados.slice(0, 80).map(p => {
        const cab = p.secao !== sec ? `<div class="orcSec">${esc(sec = p.secao)}</div>` : ''
        const on = escolhidos.has(p.id)
        return `${cab}<label class="orcIt ${on ? 'on' : ''}">
          <input type="checkbox" data-orc="${p.id}"${on ? ' checked' : ''}>
          <span class="txt">
            <span class="nm">${esc(p.nome)}</span>
            <span class="det">${esc(p.material)}${p.prazo ? ' · ' + esc(p.prazo) : ''}</span>
          </span>
          <span class="vl">${dinheiro(p.centavos)}</span>
        </label>`
      }).join('')
    }
    montarOrcamento()
  }

  function montarOrcamento() {
    const itens = precos.filter(p => escolhidos.has(p.id))
    $('#orcCesta').hidden = !itens.length
    $('#orcN').textContent = itens.length
    const total = itens.reduce((a, p) => a + p.centavos, 0)
    $('#orcTotal').textContent = dinheiro(total)
    if (!itens.length) return
    // a mensagem leva SEMPRE preço, prazo e material — os três que mais faltavam — e a
    // vigência da tabela no rodapé, para o cliente e a equipe saberem de quando é o valor.
    const linhas = itens.map(p =>
      `• *${p.nome}*\n   ${dinheiro(p.centavos)}${p.prazo ? ` · resultado em ${p.prazo}` : ''}${p.material ? `\n   material: ${p.material}` : ''}`)
    const soma = itens.length > 1 ? `\n\n💰 *Total: ${dinheiro(total)}*` : ''
    $('#orcTexto').value =
      `Orçamento dos exames 🐾\n\n${linhas.join('\n\n')}${soma}\n\n` +
      `_Valores da tabela de ${vigencia || 'vigência atual'}. Prazo em dias úteis, contados a partir da chegada da amostra no laboratório._\n\n` +
      `Qualquer dúvida é só chamar! 🙏\n\n🧬 *Alpha Labs · Atendimento ao Cliente*`
  }

  document.addEventListener('input', ev => { if (ev.target.id === 'orcQ') pintarPrecos() })
  document.addEventListener('change', ev => {
    const id = ev.target.dataset && ev.target.dataset.orc
    if (!id) return
    ev.target.checked ? escolhidos.add(Number(id)) : escolhidos.delete(Number(id))
    pintarPrecos()
  })
  document.addEventListener('click', ev => {
    if (ev.target.id === 'orcTentar') { precos = []; carregarPrecos() }
    if (ev.target.id === 'orcLimpar') { escolhidos.clear(); $('#orcQ').value = ''; pintarPrecos() }
    if (ev.target.id === 'orcCopiar') {
      const t = $('#orcTexto')
      navigator.clipboard.writeText(t.value)
        .then(() => toast('Mensagem copiada — é só colar no grupo 📋'))
        .catch(() => { t.select(); document.execCommand('copy'); toast('Mensagem copiada 📋') })
    }
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
    carregarPrecos()          // a tabela de preços vem uma vez, no login
    // ouve a tabela: qualquer inserção/alteração repinta na hora. O intervalo longo fica só como
    // rede de segurança para o caso de a conexão cair sem avisar.
    try {
      SB.channel('fila-agendamento')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'inc_coletas' }, () => carregar())
        .subscribe()
    } catch (e) {}
    clearInterval(timer); timer = setInterval(carregar, 120000)
    // ao voltar para a aba, atualiza na hora — mesa física fica com a tela aberta o dia todo
    document.addEventListener('visibilitychange', () => { if (!document.hidden) carregar() })
  }

  // ── selo de versão ──
  const selo = document.querySelector('#selVersao')
  if (selo) selo.textContent = 'versão ' + VERSAO
  document.querySelector('#btAtualizar')?.addEventListener('click', ev => {
    ev.target.disabled = true; ev.target.textContent = 'buscando…'
    // endereço novo força o servidor a mandar o HTML fresco em vez do guardado
    location.replace(location.pathname + '?atualizar=' + Date.now())
  })
  // vigia: compara a versão da tela com a publicada, de 2 em 2 min
  async function conferirVersao() {
    try {
      const r = await fetch(location.pathname + '?checar=' + Date.now(), { cache: 'no-store' })
      const t = await r.text()
      const m = t.match(/versao-publicada="([^"]+)"/)
      if (m && m[1] && m[1] !== VERSAO && selo) {
        selo.classList.add('velha')
        selo.textContent = 'versão ' + VERSAO + ' — há uma nova!'
        selo.title = 'a versão publicada é ' + m[1] + ' — clique em Atualizar'
      }
    } catch {}
  }
  setTimeout(conferirVersao, 4000)
  setInterval(conferirVersao, 120000)

  if (!SB) { toast('Sem conexão com o banco', true) }
  else if (sessao) iniciar()
  else mostrarLogin()
})()
