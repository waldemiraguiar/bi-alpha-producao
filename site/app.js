/* BI Alpha — dashboard de produção e faturamento */
const C = {navy:'#0A1628',cyan:'#00D4FF',green:'#00E5A0',amber:'#FFB020',red:'#FF5470',purple:'#A78BFA',mut:'#8aa2bd',petlove:'#FF6AD5'};
const PAL = [C.cyan,C.green,C.amber,C.purple,C.red,'#5B8DEF','#4ECDC4','#F472B6','#FBBF24','#34D399','#818CF8','#FB7185'];
const brl = n => 'R$ '+Math.round(n).toLocaleString('pt-BR');
const brlk = n => n>=1e6 ? 'R$ '+(n/1e6).toFixed(2)+'M' : n>=1e3 ? 'R$ '+(n/1e3).toFixed(0)+'k' : 'R$ '+Math.round(n);
const num = n => Math.round(n).toLocaleString('pt-BR');
const pct = n => (n>0?'+':'')+n.toFixed(1)+'%';
const MES = ['','Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const fmtYM = ym => { const [y,m]=ym.split('-'); return MES[+m]+'/'+y.slice(2); };

Chart.defaults.color = C.mut;
Chart.defaults.font.family = 'Inter';
Chart.defaults.font.size = 11;
/* --- polimento premium global --- */
Chart.defaults.elements.bar.borderRadius = 6;
Chart.defaults.elements.bar.borderSkipped = false;
Chart.defaults.elements.point.radius = 0;
Chart.defaults.elements.point.hoverRadius = 5;
Chart.defaults.elements.point.hitRadius = 8;
Chart.defaults.elements.line.tension = .35;
Chart.defaults.elements.line.borderWidth = 2.2;
Chart.defaults.plugins.legend.labels.usePointStyle = true;
Chart.defaults.plugins.legend.labels.pointStyle = 'circle';
Chart.defaults.plugins.legend.labels.boxWidth = 8;
Chart.defaults.plugins.legend.labels.padding = 14;
Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(10,22,40,.96)';
Chart.defaults.plugins.tooltip.borderColor = 'rgba(0,212,255,.3)';
Chart.defaults.plugins.tooltip.borderWidth = 1;
Chart.defaults.plugins.tooltip.cornerRadius = 9;
Chart.defaults.plugins.tooltip.padding = 11;
Chart.defaults.plugins.tooltip.titleColor = '#fff';
Chart.defaults.plugins.tooltip.usePointStyle = true;
Chart.defaults.plugins.tooltip.boxPadding = 4;
const GRID = {color:'rgba(255,255,255,.05)'};
const noGrid = {grid:{display:false}};

function gradient(ctx, area, color, a1=.35, a2=0){
  if(!area) return color;
  const g = ctx.createLinearGradient(0, area.top, 0, area.bottom);
  g.addColorStop(0, color.replace(')',`,${a1})`).replace('rgb','rgba'));
  g.addColorStop(1, color.replace(')',`,${a2})`).replace('rgb','rgba'));
  return g;
}
const hex2rgb = h => { const x=h.replace('#','');return `rgb(${parseInt(x.slice(0,2),16)},${parseInt(x.slice(2,4),16)},${parseInt(x.slice(4,6),16)})`; };

function el(tag, cls, html){ const e=document.createElement(tag); if(cls)e.className=cls; if(html!=null)e.innerHTML=html; return e; }
function section(title, sub){ const s=el('div','sec-title'); s.innerHTML=`<span class="bar"></span>${title} ${sub?`<small>· ${sub}</small>`:''}`; return s; }
function card(title, cap){ const c=el('div','card'); if(title)c.appendChild(el('h3',null,title)); if(cap)c.appendChild(el('div','cap',cap)); return c; }
function canvasIn(parent, h='chartbox'){ const b=el('div',h); const cv=document.createElement('canvas'); b.appendChild(cv); parent.appendChild(b); return cv; }

/* --- KPIs executivos: variação 12-sobre-12, chip e sparkline --- */
function last12prev12(arr, key){
  const v=(arr||[]).map(x=>x[key]||0), n=v.length;
  const cur=v.slice(Math.max(0,n-12)).reduce((a,b)=>a+b,0);
  const pv=v.slice(Math.max(0,n-24),Math.max(0,n-12)).reduce((a,b)=>a+b,0);
  return {yoy: pv>0 ? 100*(cur-pv)/pv : null, spark: v.slice(Math.max(0,n-12))};
}
function chip(yoy){
  if(yoy==null) return '';
  return `<span class="chip ${yoy>=0?'up':'down'}">${yoy>=0?'▲':'▼'} ${Math.abs(yoy).toFixed(1)}%</span>`;
}
let _sid=0;
function kspark(vals, color){
  if(!vals || vals.length<2) return '';
  const w=100,h=30,mx=Math.max(...vals),mn=Math.min(...vals,0),rng=(mx-mn)||1,n=vals.length;
  const pts=vals.map((v,i)=>`${(i/(n-1)*w).toFixed(1)},${(h-2-((v-mn)/rng)*(h-4)).toFixed(1)}`).join(' ');
  const id='ks'+(++_sid);
  return `<div class="kspark"><svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${color}" stop-opacity=".4"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    <polygon points="0,${h} ${pts} ${w},${h}" fill="url(#${id})"/>
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.8" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg></div>`;
}

/* ---------- Portão de acesso (AES-256-GCM + PBKDF2 via Web Crypto) ---------- */
const b64dec = s => Uint8Array.from(atob(s), c=>c.charCodeAt(0));
let ENC = null; // envelope cifrado, carregado sob demanda

// Busca o .enc da FUNÇÃO (/api/enc — atualizado sem deploy) e CAI no estático data/dashboard.enc se falhar.
async function fetchEncF(name, fallbackUrl){
  try{ const h = window.__TK ? {authorization:'Bearer '+window.__TK} : {};
    const r = await fetch('/api/enc?f='+name+'&_='+Date.now(), {headers:h});
    if(r.status===401){ try{ sessionStorage.removeItem('bi_tk'); }catch(_){}
      if(!window.__avisou401){ window.__avisou401=1;
        alert('Sua sessão não vale mais (o BI agora entra com usuário e senha). Entre de novo.');
        window.__TK=null; window.__PW=null; location.reload(); }
      throw new Error('sessão expirada — entre novamente'); }
    if(r.ok){ const j = await r.json(); if(j && j.ct && j.salt && j.iv) return j; } }catch(e){}
  return await fetch(fallbackUrl+'?_='+Date.now()).then(r=>{ if(!r.ok) throw new Error('arquivo de dados não encontrado'); return r.json(); });
}
async function decryptDashboard(pwd){
  if(!ENC){ ENC = await fetchEncF('dashboard','data/dashboard.enc'); }
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(pwd), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    {name:'PBKDF2', salt:b64dec(ENC.salt), iterations:ENC.iter, hash:'SHA-256'},
    baseKey, {name:'AES-GCM', length:256}, false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({name:'AES-GCM', iv:b64dec(ENC.iv)}, key, b64dec(ENC.ct));
  return JSON.parse(new TextDecoder().decode(plain)); // lança se a senha estiver errada
}

(function gate(){
  const form=document.getElementById('gateForm'), pwd=document.getElementById('gatePwd'),
        err=document.getElementById('gateErr'), btn=document.getElementById('gateBtn');
  const gbio=document.getElementById('gateBio'), bset=document.getElementById('bioSetup');
  const BIO=window.BI_BIO;
  // segurança: some com o esquema ANTIGO (senha em texto no localStorage) — agora é PRF cifrado
  try{ localStorage.removeItem('bi_fin_bio'); localStorage.removeItem('bi_fin_pw'); }catch(_){}

  // --- login individual (19/set/2026): confere no servidor e abre o "envelope" com a chave do painel ---
  const b64d=s=>Uint8Array.from(atob(String(s).replace(/-/g,'+').replace(/_/g,'/')), c=>c.charCodeAt(0));
  const b64e=b=>btoa(String.fromCharCode(...new Uint8Array(b)));
  async function abreEnvelope(env, senha){                 // env = {salt,iv,ct} cifrado com a senha da pessoa
    const base=await crypto.subtle.importKey('raw', new TextEncoder().encode(senha), 'PBKDF2', false, ['deriveKey']);
    const k=await crypto.subtle.deriveKey({name:'PBKDF2',salt:b64d(env.salt),iterations:env.iter||250000,hash:'SHA-256'},
      base, {name:'AES-GCM',length:256}, false, ['decrypt']);
    return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:b64d(env.iv)}, k, b64d(env.ct)));
  }
  async function fechaEnvelope(chave, senha){              // usado na troca de senha
    const salt=crypto.getRandomValues(new Uint8Array(16)), iv=crypto.getRandomValues(new Uint8Array(12));
    const base=await crypto.subtle.importKey('raw', new TextEncoder().encode(senha), 'PBKDF2', false, ['deriveKey']);
    const k=await crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:250000,hash:'SHA-256'}, base, {name:'AES-GCM',length:256}, false, ['encrypt']);
    const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv}, k, new TextEncoder().encode(chave));
    return {salt:b64e(salt), iv:b64e(iv), ct:b64e(ct), iter:250000};
  }
  window.__BI_ENVELOPE = fechaEnvelope;
  async function entrarComUsuario(usuario, senha){
    const r = await fetch('/api/login', {method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({acao:'entrar', usuario, senha})});
    const j = await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(j.erro || 'usuário ou senha inválidos');
    window.__TK = j.token; window.__USER = {usuario, nome:j.nome, papel:j.papel, abas:j.abas};
    try{ sessionStorage.setItem('bi_tk', j.token); }catch(_){}
    const chave = await abreEnvelope(j.envelope, senha);   // a chave do painel só existe aqui, no navegador
    await enter(chave);
    const id=document.getElementById('quemEntrou'), box=document.getElementById('sessaoBox');
    if(id) id.textContent = j.nome || usuario;
    if(box) box.style.display='flex';
    const ba=document.getElementById('btAcessos'); if(ba && j.papel==='dono') ba.style.display='';
    if(j.trocar_senha) setTimeout(()=>alert('Sua senha é provisória. Troque em "Trocar senha" no rodapé do painel.'), 800);
    return true;
  }

  // ENTRA no painel com a senha decifrada (usado por: senha digitada · Touch ID · boot)
  async function enter(pwStr){
    const D = await decryptDashboard(pwStr);   // lança se a senha estiver errada
    window.__PW = pwStr;                        // só em memória (nunca no disco)
    document.getElementById('gate').style.display='none';
    document.getElementById('dash').style.display='';
    render(D);
    // oferece ativar a digital (PRF) depois de entrar com a senha, se o Mac suportar e ainda não estiver ativa
    if(bset && BIO && !BIO.enabled() && await BIO.platformAvailable()) bset.style.display='';
    return true;
  }

  form.addEventListener('submit', async e=>{
    e.preventDefault(); err.textContent=''; btn.disabled=true; btn.textContent='Verificando…';
    const usr=(document.getElementById('gateUser')||{}).value||'';
    try{
      if(!usr.trim()) throw new Error('Informe o usuário.');
      await entrarComUsuario(usr.trim(), pwd.value);     // só entra com usuário e senha próprios
    }
    catch(ex){
      const m=String(ex.message||'');
      err.textContent = /Informe o usuário/.test(m) ? m
        : /não encontrado/.test(m) ? 'Dados indisponíveis. Tente recarregar.'
        : /tentativas/.test(m) ? m : /sessão/.test(m) ? m : 'Usuário ou senha inválidos.';
      btn.disabled=false; btn.textContent='Entrar'; pwd.select();
    }
  });

  /* ---- Touch ID (WebAuthn PRF): a digital DECIFRA a senha; senha nunca fica em texto ---- */
  async function porDigital(){
    if(!BIO || !BIO.enabled()) return;
    try{ gbio.textContent='👆 Toque o Touch ID…';
      const seg = await BIO.unlock();          // Touch ID → PRF → credencial decifrada em memória
      if(seg.indexOf('\n')>0){ const [u,s]=seg.split('\n'); await entrarComUsuario(u,s); }
      else {                                    // digital gravada no formato antigo (só a senha do painel)
        try{ BIO.disable(); }catch(_){}
        gbio.style.display='none';
        err.textContent='Sua digital era do formato antigo. Entre com usuário e senha e ative a digital de novo.';
        return;
      }
    }catch(e){ console.warn(e); gbio.textContent='👆 Entrar com digital';
      if(!/não está ativo/.test(e.message||'')) err.textContent='Touch ID cancelado — toque de novo ou use a senha.'; }
  }
  if(gbio) gbio.onclick=porDigital;

  // --- trocar a própria senha (a chave do painel é re-embrulhada no navegador) ---
  const btT=document.getElementById('btTrocaSenha'), btS=document.getElementById('btSair');
  if(btT) btT.onclick=async()=>{
    const u=(window.__USER||{}).usuario; if(!u){ alert('Entre com usuário e senha para trocar a senha.'); return; }
    const atual=prompt('Senha ATUAL:'); if(!atual) return;
    const nova=prompt('Senha NOVA (mínimo 10 caracteres):'); if(!nova) return;
    if(nova.length<10){ alert('A senha nova precisa de pelo menos 10 caracteres.'); return; }
    if(prompt('Repita a senha nova:')!==nova){ alert('As senhas não batem.'); return; }
    try{
      const env=await window.__BI_ENVELOPE(window.__PW, nova);            // chave do painel embrulhada na senha nova
      const enc=new TextEncoder();
      const salt=crypto.getRandomValues(new Uint8Array(16));
      const base=await crypto.subtle.importKey('raw', enc.encode(nova), 'PBKDF2', false, ['deriveBits']);
      const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:250000,hash:'SHA-256'}, base, 256);
      const b64=b=>btoa(String.fromCharCode(...new Uint8Array(b)));
      const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({acao:'trocar_senha', usuario:u, senha:atual, salt_auth:b64(salt), hash_auth:b64(bits), envelope:env})});
      const j=await r.json().catch(()=>({}));
      alert(r.ok? 'Senha trocada. Use a nova no próximo acesso.' : ('Não deu: '+(j.erro||'erro')));
    }catch(e){ alert('Não deu: '+(e.message||e)); }
  };
  // --- 👥 gestão de acessos pelo próprio BI (só para quem é dono) ---
  const acM=document.getElementById('acessosModal'), acL=document.getElementById('acLista'),
        acLog=document.getElementById('acLog'), acSenha=document.getElementById('acSenha');
  const api = async (corpo)=>{
    const r = await fetch('/api/login', {method:'POST', headers:{'Content-Type':'application/json',
      ...(window.__TK?{authorization:'Bearer '+window.__TK}:{})}, body:JSON.stringify(corpo)});
    const j = await r.json().catch(()=>({})); if(!r.ok) throw new Error(j.erro||('erro '+r.status)); return j;
  };
  function senhaForte(){
    const p='alpha bravo carbono delta enzima ferro gama hemo iodo jade kelvin lipase magneta neon osmio platina quartzo radon sigma titanio uranio vetor xenon zinco'.split(' ');
    const r=n=>p[crypto.getRandomValues(new Uint32Array(1))[0]%p.length];
    return [r(),r(),r(),r()].join('-')+'-'+(10+crypto.getRandomValues(new Uint32Array(1))[0]%90);
  }
  async function credenciais(senha){                       // hash p/ o servidor + envelope com a chave do painel
    const enc=new TextEncoder(), b64=b=>btoa(String.fromCharCode(...new Uint8Array(b)));
    const salt=crypto.getRandomValues(new Uint8Array(16));
    const base=await crypto.subtle.importKey('raw', enc.encode(senha), 'PBKDF2', false, ['deriveBits']);
    const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:250000,hash:'SHA-256'}, base, 256);
    return {salt_auth:b64(salt), hash_auth:b64(bits), envelope: await window.__BI_ENVELOPE(window.__PW, senha)};
  }
  async function pintaAcessos(){
    try{
      const j = await api({acao:'listar'});
      acL.innerHTML = `<table class="atab" style="width:100%"><thead><tr><th>Usuário</th><th>Nome</th><th>Papel</th><th>Último acesso</th><th></th></tr></thead><tbody>
        ${j.usuarios.map(u=>`<tr><td><b>${esc(u.usuario)}</b></td><td>${esc(u.nome||'')}</td><td>${esc(u.papel||'')}</td>
          <td style="color:var(--mut)">${u.ultimo_acesso?u.ultimo_acesso.slice(0,16).replace('T',' '):'nunca entrou'}</td>
          <td style="text-align:right;white-space:nowrap">
            <button data-senha="${esc(u.usuario)}" style="background:transparent;border:1px solid var(--line);color:var(--amber);border-radius:7px;padding:3px 8px;font-size:11px;cursor:pointer;font-family:inherit">nova senha</button>
            <button data-remove="${esc(u.usuario)}" style="background:transparent;border:1px solid var(--line);color:var(--red);border-radius:7px;padding:3px 8px;font-size:11px;cursor:pointer;font-family:inherit;margin-left:4px">tirar acesso</button>
          </td></tr>`).join('')}</tbody></table>`;
      acLog.innerHTML = `<div style="font-weight:800;font-size:13px;margin-bottom:6px">Últimos acessos</div>
        <div style="max-height:200px;overflow:auto"><table class="atab" style="width:100%"><tbody>
        ${(j.acessos||[]).slice(0,30).map(a=>`<tr><td style="color:var(--mut);white-space:nowrap">${a.quando.slice(0,16).replace('T',' ')}</td>
          <td><b>${esc(a.usuario)}</b></td><td style="color:${/falha/.test(a.evento)?'var(--red)':'var(--ink)'}">${esc(a.evento)}</td>
          <td style="color:var(--mut);font-size:11px">${esc((a.ip||'').slice(0,20))}</td></tr>`).join('')}</tbody></table></div>`;
      acL.querySelectorAll('[data-remove]').forEach(b=>b.onclick=async()=>{
        if(!confirm('Tirar o acesso de '+b.dataset.remove+'? Ele perde o login na hora.')) return;
        try{ await api({acao:'remover_usuario', usuario:b.dataset.remove}); pintaAcessos(); }catch(e){ alert(e.message); }});
      acL.querySelectorAll('[data-senha]').forEach(b=>b.onclick=()=>criar(b.dataset.senha, null, null, true));
    }catch(e){ acL.innerHTML='<div style="color:var(--amber)">Não consegui listar: '+esc(e.message)+'</div>'; }
  }
  async function criar(usuario, nome, papel, so_senha){
    try{
      const u=(usuario||'').trim().toLowerCase(); if(!u) { alert('Informe o usuário.'); return; }
      const senha=senhaForte();
      const c=await credenciais(senha);
      await api({acao:'salvar_usuario', usuario:u, nome:(nome||u), papel:(papel||'socio'), abas:['*'], trocar_senha:true, ...c});
      acSenha.style.display='';
      acSenha.innerHTML = `<div style="font-size:12px;color:var(--mut)">${so_senha?'Nova senha de':'Acesso criado para'} <b style="color:var(--ink)">${esc(u)}</b> — anote agora, ela não aparece de novo:</div>
        <div style="display:flex;gap:10px;align-items:center;margin-top:6px;flex-wrap:wrap">
          <code style="font-size:18px;font-weight:800;letter-spacing:.02em;color:var(--green)">${esc(senha)}</code>
          <button id="acCopiar" style="background:transparent;border:1px solid var(--line);color:var(--ink);border-radius:8px;padding:5px 10px;cursor:pointer;font-family:inherit;font-size:12px">Copiar</button>
        </div>
        <div style="font-size:11.5px;color:var(--mut);margin-top:6px">Mande por um canal seguro e peça para trocar no primeiro acesso (botão “Trocar senha”).</div>`;
      const cp=document.getElementById('acCopiar');
      if(cp) cp.onclick=()=>{ navigator.clipboard.writeText(senha).then(()=>{ cp.textContent='Copiado ✓'; }); };
      pintaAcessos(); setTimeout(pintaAcessos, 1500);     // a lista do servidor demora 1s a atualizar
    }catch(e){ alert('Não deu: '+e.message); }
  }
  const btA=document.getElementById('btAcessos');
  if(btA) btA.onclick=()=>{ acM.style.display=''; acSenha.style.display='none'; pintaAcessos(); };
  const acF=document.getElementById('acFechar'); if(acF) acF.onclick=()=>{ acM.style.display='none'; };
  const acC=document.getElementById('acCriar');
  if(acC) acC.onclick=()=>criar(document.getElementById('acUser').value,
                                document.getElementById('acNome').value,
                                document.getElementById('acPapel').value, false);

  if(btS) btS.onclick=()=>{ try{ sessionStorage.removeItem('bi_tk'); }catch(_){}
    window.__TK=null; window.__PW=null; location.reload(); };

  if(bset) bset.onclick=async()=>{
    const pw = window.__PW; if(!pw){ alert('Entre com a senha primeiro.'); return; }
    const usr=(document.getElementById('gateUser')||{}).value||'', sen=(document.getElementById('gatePwd')||{}).value||'';
    const guardar = (usr.trim() && sen) ? (usr.trim()+'\n'+sen) : pw;
    try{ bset.textContent='👆 Toque p/ ativar…';
      await BIO.register(guardar);                   // cria passkey + cifra a senha com a chave do Touch ID
      bset.textContent='✅ Digital ativa neste Mac';
      try{ localStorage.setItem('bi_bio_v','2'); }catch(_){} setTimeout(()=>{ bset.style.display='none'; }, 1800);
    }catch(e){ console.warn(e); bset.textContent='👆 Proteger com digital'; alert('Touch ID: '+(e.message||e)); }
  };

  // ABRE DIRETO NA DIGITAL ao carregar (igual aos outros apps), se já estiver ativa neste Mac.
  if(BIO && BIO.enabled() && gbio){
    gbio.style.display=''; pwd.placeholder='ou use a senha';
    setTimeout(porDigital, 250);   // se o navegador exigir gesto, o botão fica ali pra 1 toque
  }
})();

function render(D){
  const k=D.kpis, m=D.meta;
  document.getElementById('period').innerHTML =
    `Janela principal: <b>${fmtYM(m.janela12_ini.slice(0,7))} – ${fmtYM(m.janela12_fim.slice(0,7))}</b><br>Dados até ${m.max_data} · gerado ${m.gerado_em}`;
  document.getElementById('noteFin').innerHTML =
    `<b>⚠ Escopo financeiro:</b> ${m.obs_financeiro} Para margem, inadimplência e fluxo de caixa, é preciso que o desenvolvedor do sistema sincronize valor recebido, custo e status de pagamento.`;
  document.getElementById('foot').innerHTML =
    `BI Alpha · fonte: ${m.fonte} · ${num(k.total_exames)} exames analisados (R$ ${num(k.total_faturamento)} faturados no histórico). Valores = faturamento (valor cobrado).`;

  const app = document.getElementById('app'); app.innerHTML='';
  app.insertAdjacentHTML('beforeend', alertStripHTML(D));

  /* ---------- KPIs executivos ---------- */
  // usa meses COMPLETOS (exclui o mês corrente parcial) — bate com a janela do KPI e com a Projeção
  const _partial = D.mensal && D.mensal.length && D.mensal[D.mensal.length-1].ym===(m.max_data||'').slice(0,7);
  const _mmS = _partial ? D.mensal.slice(0,-1) : (D.mensal||[]);
  const f12 = last12prev12(_mmS,'fat'), e12 = last12prev12(_mmS,'qtd');
  const an2025 = (D.anual||[]).find(a=>a.ano==='2025')||{};
  const spark2025 = (D.mensal||[]).filter(x=>x.ym>='2025-01'&&x.ym<='2025-12').map(x=>x.fat);
  // ticket médio 12m + variação vs 12m anteriores (mesma janela de meses completos)
  const _s12=k2=>_mmS.slice(-12).reduce((a,x)=>a+x[k2],0), _p12=k2=>_mmS.slice(-24,-12).reduce((a,x)=>a+x[k2],0);
  const tick12=_s12('qtd')?_s12('fat')/_s12('qtd'):k.ticket_medio_exame;
  const tickPrev=_p12('qtd')?_p12('fat')/_p12('qtd'):null;
  const tickYoY=tickPrev?100*(tick12-tickPrev)/tickPrev:null;
  const novosTrend=(D.novos_clientes||[]).slice(-12).map(x=>x.novos);
  // ---- faturamento TOTAL (sistema + Pet Love) p/ os KPIs headline ----
  const plL12 = _mmS.slice(-12).reduce((a,x)=>a+(x.petlove||0),0);
  const totRev12 = k.faturamento_l12 + plL12;
  const pl2025 = (D.mensal||[]).filter(x=>x.ym>='2025-01'&&x.ym<='2025-12').reduce((a,x)=>a+(x.petlove||0),0);
  const tot2025 = k.faturamento_2025 + pl2025;
  const kpis = el('div','kpis');
  const kdata = [
    {l:'Faturamento total · 12m', v:brlk(totRev12), d:`sistema ${brlk(k.faturamento_l12)} + Pet Love ${brlk(plL12)} · ${num(k.exames_l12)} exames`, c:'',  yoy:f12.yoy, spark:f12.spark, col:C.cyan},
    {l:'Exames · últ. 12m',      v:num(k.exames_l12),       d:`${k.exames_por_req_l12} por requisição · vs 12m anterior`, c:'g', yoy:e12.yoy, spark:e12.spark, col:C.green},
    {l:'Faturamento total · 2025',v:brlk(tot2025),d:`sistema ${brlk(k.faturamento_2025)} + Pet Love ${brlk(pl2025)}`, c:'',  yoy:an2025.yoy_fat, spark:spark2025, col:C.cyan},
    {l:'Ticket médio / exame',   v:brl(tick12),             d:`requisição: ${brl(k.ticket_medio_req_l12)} · vs 12m anterior`, c:'a', yoy:tickYoY},
    {l:'Clientes ativos · 12m',  v:num(k.clientes_ativos_l12), d:`de ${num(k.clientes_total)} cadastrados`, c:'p', spark:novosTrend, col:C.purple},
    {l:'Faturamento histórico',  v:brlk(k.total_faturamento), d:`desde 2014 · sistema (direto)`, c:'a'},
  ];
  kdata.forEach(d=>{ const e=el('div','kpi'+(d.c?' '+d.c:''));
    e.innerHTML=`<div class="lbl">${d.l}</div><div class="krow"><div class="val">${d.v}</div>${chip(d.yoy)}</div><div class="delta">${d.d}</div>${d.spark?kspark(d.spark,d.col):''}`;
    kpis.appendChild(e); });
  app.appendChild(kpis);

  /* ---------- Destaques executivos ---------- */
  const conc=D.concentracao||{}, pe=D.perdidos||{}, nvres=D.novos||{};
  const yoyTxt = f12.yoy!=null ? `<b>${f12.yoy>=0?'▲ ':'▼ '}${Math.abs(f12.yoy).toFixed(1)}%</b> vs 12m anterior` : 'janela em produção';
  const insArr=[{ic:'💰', cls:'good', h:brlk(totRev12),
    t: plL12>0 ? `<b>Receita total 12m</b> (sistema + Pet Love) · orgânico ${yoyTxt}` : `Receita dos últimos 12 meses · ${yoyTxt}`}];
  if(plL12>0) insArr.push({ic:'🐾', cls:'', h:brlk(plL12),
    t:`<b>Pet Love</b> (receita externa) · exames contados pelo HF mas com valor zerado · incluído desde Jan/25`});
  insArr.push(
    {ic:'🎯', cls:'', h:(conc.top10_pct!=null?conc.top10_pct+'%':'—'), t:`da receita vem dos <b>Top 10 clientes</b> · Top 50 = ${conc.top50_pct||'—'}%`},
    {ic:'⚠️', cls:'warn', h:brlk(pe.fat_em_risco||0), t:`/ano <b>em risco</b> · ${(pe.sumidos||[]).length} sumidos + ${(pe.queda||[]).length} em queda forte`},
    {ic:'🌱', cls:'good', h:num(nvres.total||0), t:`novos clientes (90d) · <b>${nvres.esfriando||0} esfriando</b> precisam de atenção`});
  const ins = el('div','insights');
  insArr.forEach(d=>{ const e=el('div','insight'+(d.cls?' '+d.cls:''));
    e.innerHTML=`<div class="ic">${d.ic}</div><div><div class="h">${d.h}</div><div class="t">${d.t}</div></div>`; ins.appendChild(e); });
  app.appendChild(ins);

  /* ---------- Composição do faturamento: exames normais × Pet Love ---------- */
  if(plL12>0){
    const sysPct=100*k.faturamento_l12/totRev12, plPct=100*plL12/totRev12;
    const rc=card('Composição do faturamento · últimos 12 meses','exames normais (sistema) × Pet Love (receita externa)');
    rc.classList.add('revsplit');
    const inner=el('div'); inner.innerHTML=`
      <div class="split-bar">
        <div style="width:${sysPct.toFixed(2)}%;background:${C.cyan};color:${C.navy}">${sysPct>=12?'Exames normais':''}</div>
        <div style="width:${plPct.toFixed(2)}%;background:${C.petlove};color:#fff">${plPct>=12?'Pet Love':''}</div>
      </div>
      <div class="split-legend">
        <span class="it"><span class="dot" style="background:${C.cyan}"></span><span><b>Exames normais</b> (sistema): <span class="big">${brlk(k.faturamento_l12)}</span> · <span class="pc" style="color:${C.cyan}">${sysPct.toFixed(1)}%</span></span></span>
        <span class="it"><span class="dot" style="background:${C.petlove}"></span><span><b>Pet Love</b> (externo): <span class="big">${brlk(plL12)}</span> · <span class="pc" style="color:${C.petlove}">${plPct.toFixed(1)}%</span></span></span>
        <span class="it t-mut">Total: <span class="big" style="color:var(--ink);margin-left:6px">${brlk(totRev12)}</span></span>
      </div>`;
    rc.appendChild(inner); app.appendChild(rc);

    // participação % da Pet Love no faturamento, mês a mês
    const plRows=D.mensal.filter(x=>(x.petlove||0)>0);
    if(plRows.length){
      const startYm=plRows[0].ym, endYm=plRows[plRows.length-1].ym, ser=D.mensal.filter(x=>x.ym>=startYm&&x.ym<=endYm);
      const labels=ser.map(x=>fmtYM(x.ym));
      const pctSer=ser.map(x=>{const t=(x.fat||0)+(x.petlove||0); return t>0?+(100*(x.petlove||0)/t).toFixed(1):0;});
      const pc=card('Participação da Pet Love no faturamento · % mês a mês','quanto a Pet Love representou do total a cada mês (desde a 1ª competência)');
      pc.style.marginBottom='8px'; const pcv=canvasIn(pc,'chartbox sm'); app.appendChild(pc);
      new Chart(pcv,{type:'line',data:{labels,datasets:[{label:'% Pet Love',data:pctSer,borderColor:C.petlove,
        backgroundColor:ctx=>gradient(ctx.chart.ctx,ctx.chart.chartArea,hex2rgb(C.petlove)),fill:true,tension:.3,borderWidth:2,pointRadius:2,pointBackgroundColor:C.petlove}]},
        options:{...baseOpts(),plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>' '+c.raw.toFixed(1)+'% do faturamento do mês'}}},
          scales:{x:{...noGrid,ticks:{maxTicksLimit:12}},y:{grid:GRID,ticks:{callback:v=>v+'%'}}}}});
    }
  }

  /* ===================== CRESCIMENTO ===================== */
  app.appendChild(section('Crescimento & Tendência','produção e faturamento mês a mês'));
  const g1 = el('div','grid g2');
  // mensal dual
  const c1 = card('Faturamento e volume mensal','Barras = faturamento (R$) · linha = nº de exames');
  const cv1 = canvasIn(c1,'chartbox lg'); g1.appendChild(c1);
  // anual + yoy
  const c2 = card('Faturamento anual','Crescimento ano a ano (YoY %)');
  const cv2 = canvasIn(c2,'chartbox lg'); g1.appendChild(c2);
  app.appendChild(g1);

  const mm = D.mensal;
  const hasPL = mm.some(x=>x.petlove);
  const cv1ds=[
    {type:'bar',label:'Faturamento',data:mm.map(x=>x.fat),yAxisID:'y',stack:'fat',
      backgroundColor:(c)=>gradient(c.chart.ctx,c.chart.chartArea,hex2rgb(C.cyan),.85,.25),borderRadius:hasPL?0:4,order:2},
    {type:'line',label:'Exames',data:mm.map(x=>x.qtd),yAxisID:'y1',borderColor:C.green,
      backgroundColor:C.green,tension:.35,borderWidth:2,pointRadius:0,order:1}
  ];
  if(hasPL) cv1ds.splice(1,0,{type:'bar',label:'Pet Love (externo)',data:mm.map(x=>x.petlove||0),yAxisID:'y',stack:'fat',
    backgroundColor:hex2rgb(C.petlove).replace('rgb','rgba').replace(')',',.9)'),borderRadius:3,order:2});
  const o1=dualOpts(); o1.scales.x.stacked=true; o1.scales.y.stacked=true;
  new Chart(cv1,{data:{labels:mm.map(x=>fmtYM(x.ym)),datasets:cv1ds},options:o1});

  const an = D.anual.filter(a=>a.ano>='2016');
  new Chart(cv2,{type:'bar',data:{labels:an.map(a=>a.ano+(a.ano==='2026'?'*':'')),datasets:[
    {label:'Faturamento',data:an.map(a=>a.fat),backgroundColor:an.map(a=>a.ano==='2026'?'rgba(138,162,189,.4)':hex2rgb(C.cyan).replace('rgb','rgba').replace(')',',.85)')),borderRadius:4}
  ]},options:{...baseOpts(),plugins:{...baseOpts().plugins,
    tooltip:{callbacks:{label:c=>{const a=an[c.dataIndex];return [' '+brl(a.fat), a.yoy_fat!=null?' YoY '+pct(a.yoy_fat):''];}}},
    legend:{display:false}},
    scales:{x:noGrid,y:{grid:GRID,ticks:{callback:v=>brlk(v)}}}}});

  // sazonalidade + setores
  const g2 = el('div','grid g2');
  const c3 = card('Sazonalidade','Volume médio mensal (2022–2025)');
  const cv3 = canvasIn(c3,'chartbox sm'); g2.appendChild(c3);
  const c4 = card('Faturamento por setor','Distribuição últ. 12m');
  const cv4 = canvasIn(c4,'chartbox sm'); g2.appendChild(c4);
  app.appendChild(g2);

  const sz=D.sazonalidade;
  new Chart(cv3,{type:'line',data:{labels:sz.map(s=>MES[+s.mes]),datasets:[
    {label:'Exames (média)',data:sz.map(s=>s.media_qtd),borderColor:C.amber,
     backgroundColor:c=>gradient(c.chart.ctx,c.chart.chartArea,hex2rgb(C.amber)),fill:true,tension:.4,borderWidth:2,pointRadius:3,pointBackgroundColor:C.amber}
  ]},options:{...baseOpts(),plugins:{legend:{display:false},tooltip:bt()},scales:{x:noGrid,y:{grid:GRID,ticks:{callback:v=>num(v)}}}}});

  donut(cv4, D.setores.slice(0,6).map(s=>s.setor), D.setores.slice(0,6).map(s=>s.fat), true);

  /* ===================== CLIENTES ===================== */
  app.appendChild(section('Clientes','concentração, ranking, novos e em risco · últ. 12m'));
  const gc = el('div','grid g3');
  const cc1 = card('Top 15 clientes por faturamento','últimos 12 meses');
  const cvc1 = canvasIn(cc1,'chartbox lg'); gc.appendChild(cc1);
  const cc2 = card('Concentração de receita','% do faturamento acumulado');
  cc2.appendChild(concBox(D.concentracao)); gc.appendChild(cc2);
  app.appendChild(gc);

  const tc=D.top_clientes.slice(0,15).reverse();
  new Chart(cvc1,{type:'bar',data:{labels:tc.map(t=>t.nome?t.nome.slice(0,26):('#'+t.cod)),datasets:[
    {label:'Faturamento',data:tc.map(t=>t.fat),backgroundColor:hex2rgb(C.cyan).replace('rgb','rgba').replace(')',',.8)'),borderRadius:3}
  ]},options:{...baseOpts(),indexAxis:'y',plugins:{legend:{display:false},
    tooltip:{callbacks:{label:c=>{const t=tc[c.dataIndex];return [' '+brl(t.fat),' '+num(t.qtd)+' exames · ticket '+brl(t.ticket)];}}}},
    scales:{x:{grid:GRID,ticks:{callback:v=>brlk(v)}},y:noGrid}}});

  // tabelas: top clientes detalhe + novos + churn
  const gc2 = el('div','grid g2');
  const tcard = card('Ranking detalhado de clientes','Top 30 · últ. 12m');
  tcard.appendChild(tblClientes(D.top_clientes)); gc2.appendChild(tcard);
  const rcol = el('div','grid'); rcol.style.gridTemplateColumns='1fr'; rcol.style.alignContent='start';
  const ncard = card('Novos clientes por mês','Primeira requisição registrada');
  const cvn = canvasIn(ncard,'chartbox sm'); rcol.appendChild(ncard);
  const chcard = card('⚠ Clientes em risco (sumidos)',`Faturaram no último ano, sem exames desde ${D.churn.corte_inatividade} · ${D.churn.total_sumidos} clientes`);
  chcard.appendChild(tblChurn(D.churn.clientes)); rcol.appendChild(chcard);
  gc2.appendChild(rcol);
  app.appendChild(gc2);

  const nv=D.novos_clientes;
  new Chart(cvn,{type:'bar',data:{labels:nv.map(x=>fmtYM(x.ym)),datasets:[
    {label:'Novos',data:nv.map(x=>x.novos),backgroundColor:hex2rgb(C.green).replace('rgb','rgba').replace(')',',.75)'),borderRadius:3}
  ]},options:{...baseOpts(),plugins:{legend:{display:false},tooltip:bt()},scales:{x:{...noGrid,ticks:{maxTicksLimit:10}},y:{grid:GRID}}}});

  /* ===================== MIX DE EXAMES ===================== */
  app.appendChild(section('Mix de Exames','o que mais rende e o que tem mais volume · últ. 12m'));
  const gm = el('div','grid g2');
  const m1=card('Top exames por faturamento','25 maiores em receita');
  m1.appendChild(tblExames(D.mix_exames_fat,'fat')); gm.appendChild(m1);
  const m2=card('Top exames por volume','25 mais realizados');
  m2.appendChild(tblExames(D.mix_exames_vol,'qtd')); gm.appendChild(m2);
  app.appendChild(gm);

  // categorias
  const gcat=el('div','grid g13');
  const catc=card('Categorias por faturamento','Top categorias · últ. 12m');
  const cvcat=canvasIn(catc,'chartbox lg'); gcat.appendChild(catc);
  const catt=card('Detalhe por categoria',''); catt.appendChild(tblCategorias(D.categorias)); gcat.appendChild(catt);
  app.appendChild(gcat);
  const ct=D.categorias.slice(0,12).reverse();
  new Chart(cvcat,{type:'bar',data:{labels:ct.map(c=>c.categoria.slice(0,24)),datasets:[
    {data:ct.map(c=>c.fat),backgroundColor:hex2rgb(C.purple).replace('rgb','rgba').replace(')',',.8)'),borderRadius:3}
  ]},options:{...baseOpts(),indexAxis:'y',plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>' '+brl(ct[c.dataIndex].fat)+' · '+num(ct[c.dataIndex].qtd)+' ex'}}},scales:{x:{grid:GRID,ticks:{callback:v=>brlk(v)}},y:noGrid}}});

  /* ===================== ANIMAL ===================== */
  app.appendChild(section('Perfil dos Pacientes','espécie, sexo e raça · últ. 12m'));
  const ga=el('div','grid'); ga.style.gridTemplateColumns='1.2fr 1fr 1.4fr';
  const a1=card('Espécie','Volume de exames'); const cva1=canvasIn(a1,'chartbox'); ga.appendChild(a1);
  const a2=card('Sexo',''); const cva2=canvasIn(a2,'chartbox'); ga.appendChild(a2);
  const a3=card('Top raças','15 mais frequentes'); a3.appendChild(tblSimple(D.racas,'raca','qtd','Raça')); ga.appendChild(a3);
  app.appendChild(ga);
  const esp=mergeByName(D.especies,'especie').slice(0,7);
  donut(cva1, esp.map(e=>e.especie), esp.map(e=>e.qtd), false);
  const sx=mergeByName(D.sexos,'sexo').slice(0,5);
  donut(cva2, sx.map(s=>s.sexo.toUpperCase()), sx.map(s=>s.qtd), false);

  /* ===================== GEOGRAFIA ===================== */
  app.appendChild(section('Geografia & Rota','onde está a receita · últ. 12m'));
  const mapCard=card('Mapa — faturamento por município (RJ)','intensidade = faturamento dos últimos 12 meses');
  const mapBox=el('div','chartbox lg'); mapBox.innerHTML='<canvas id="mapaRJ"></canvas>'; mapCard.appendChild(mapBox);
  app.appendChild(mapCard); renderMapaRJ(D);
  const gg=el('div','grid g2');
  const g1c=card('Faturamento por UF',''); const cvuf=canvasIn(g1c,'chartbox sm'); gg.appendChild(g1c);
  const gtc=card('Top 20 cidades','Faturamento e clientes'); gtc.appendChild(tblCidades(D.cidades)); gg.appendChild(gtc);
  app.appendChild(gg);
  const uf=D.uf.filter(u=>u.uf&&u.uf!=='(N/I)'&&u.uf!=='').slice(0,8);
  new Chart(cvuf,{type:'bar',data:{labels:uf.map(u=>u.uf||'?'),datasets:[
    {data:uf.map(u=>u.fat),backgroundColor:PAL.map(c=>hex2rgb(c).replace('rgb','rgba').replace(')',',.8)')),borderRadius:4}
  ]},options:{...baseOpts(),plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>' '+brl(uf[c.dataIndex].fat)+' · '+num(uf[c.dataIndex].clientes)+' clientes'}}},scales:{x:noGrid,y:{grid:GRID,ticks:{callback:v=>brlk(v)}}}}});

  /* ===================== OPERACIONAL ===================== */
  app.appendChild(section('Indicadores Operacionais','últ. 12m'));
  const op=D.operacional; const go=card('');
  go.innerHTML=`<div class="mini">
    <div class="m"><div class="v" style="color:${C.amber}">${num(op.exames_urgencia)}</div><div class="l">exames em urgência (${op.pct_urgencia}%)</div></div>
    <div class="m"><div class="v" style="color:${C.purple}">${brlk(op.valor_desconto_total)}</div><div class="l">em descontos (${num(op.exames_com_desconto)} exames · ${op.pct_com_desconto}%)</div></div>
    <div class="m"><div class="v" style="color:${C.green}">${num(op.exames_terceirizados)}</div><div class="l">exames terceirizados (${op.pct_terceirizado}%)</div></div>
  </div>`;
  app.appendChild(go);

  window.__D = D;
  renderProjecao(D);
  renderClientes(D);
  renderNovos(D);
  renderPerdidos(D);
  renderAnalises(D);
  renderAlertas(D);
  renderPetlove(D);
  renderMargem(D);
  renderEstudo(D);
  renderCustos(D);
  wireFTabs();
  wireTools();
}

/* ---------- Modo TV (rotação) + Resumo PDF ---------- */
async function atualizarBI(){
  const b=document.getElementById('btnReload'); if(b){b.disabled=true;b.textContent='Atualizando…';}
  try{ if(window.caches){ const ks=await caches.keys(); await Promise.all(ks.map(k=>caches.delete(k))); } }catch(e){}
  try{ if(navigator.serviceWorker&&navigator.serviceWorker.getRegistrations){ const rs=await navigator.serviceWorker.getRegistrations(); rs.forEach(r=>r.unregister()); } }catch(e){}
  location.replace(location.origin+location.pathname+'?r='+Date.now());
}
function wireTools(){
  const rl=document.getElementById('btnReload'); if(rl && !rl.__w){ rl.__w=1; rl.addEventListener('click',atualizarBI); }
  const tv=document.getElementById('btnTV'), pr=document.getElementById('btnPrint');
  if(pr && !pr.__w){ pr.__w=1; pr.addEventListener('click',()=>{
    const g=[...document.querySelectorAll('.ftab')].find(x=>x.dataset.v==='geral');
    if(g && !g.classList.contains('on')) g.click();
    setTimeout(()=>window.print(), 250);
  });}
  if(tv && !tv.__w){ tv.__w=1; let timer=null, i=0;
    const order=['geral','alertas','projecao','clientes','novos','perdidos','analises'];
    const tick=()=>{ const v=order[i%order.length]; i++;
      const t=[...document.querySelectorAll('.ftab')].find(x=>x.dataset.v===v); if(t)t.click();
      window.scrollTo({top:0,behavior:'smooth'}); };
    tv.addEventListener('click',()=>{
      if(timer){ clearInterval(timer); timer=null; tv.classList.remove('on'); tv.textContent='📺 Modo TV'; return; }
      tv.classList.add('on'); tv.textContent='⏹ Parar TV'; i=0; tick(); timer=setInterval(tick, 12000);
    });
  }
}

/* ===================== ABA CLIENTES · TIERS ===================== */
const AZUL='#4D9DFF';
const TIERINFO={AAA:'≥ R$10k/mês',A:'R$5–10k/mês',B:'R$2–5k/mês',C:'R$800–2k/mês',D:'R$300–800/mês',E:'< R$300/mês'};
function spark(vals,color){
  const w=88,h=26,mx=Math.max(...vals,1),n=vals.length;
  if(n<2) return '';
  const pts=vals.map((v,i)=>`${(i/(n-1)*w).toFixed(1)},${(h-(v/mx)*(h-5)-2.5).toFixed(1)}`).join(' ');
  const lastx=w, lasty=(h-(vals[n-1]/mx)*(h-5)-2.5).toFixed(1);
  return `<svg width="${w}" height="${h}" class="spark"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2"/><circle cx="${lastx}" cy="${lasty}" r="2.5" fill="${color}"/></svg>`;
}
function deltaTxt(e){
  if(e.flag==='up') return `<div class="cli-delta up">▲ ${Math.abs(e.delta)}%</div>`;
  if(e.flag==='down') return `<div class="cli-delta down">▼ ${Math.abs(e.delta)}%</div>`;
  return `<div class="cli-delta">${e.delta>0?'+':''}${e.delta}%</div>`;
}
function cliRow(e){
  const col=e.flag==='down'?C.red:e.flag==='up'?AZUL:C.mut;
  return `<div class="cli-row">
    <div class="cli-info"><div class="cli-nome">${esc(e.nome||'#'+e.cod)}</div>
      <div class="cli-sub">${esc(e.cidade||'—')} · ${brl(e.mensal)}/mês · 12m ${brlk(e.fat12m)}</div></div>
    ${spark(e.semanas||[],col)}
    ${deltaTxt(e)}</div>`;
}
function renderClientes(D){
  const wrap=document.getElementById('clientes'); if(!wrap) return;
  const rs=D.tiers_resumo||{}, tiers=D.tiers||[], radar=D.radar||[];
  let html='';
  // radar de movimentações
  if(radar.length){
    html+=`<div class="radar"><h3>📡 Radar da semana — variações ≥10% <span style="color:var(--mut);font-weight:400;font-size:12px">(semana vs média das 4 anteriores · <span class="movup">▲ alta</span> / <span class="movdown">▼ queda</span>)</span></h3>
      <div class="grid">${radar.map(e=>`<div class="rad"><span class="tb">${e.tier}</span><span class="nm">${esc(e.nome||'#'+e.cod)}</span>${spark(e.semanas||[],e.flag==='down'?C.red:AZUL)}<span class="cli-delta ${e.flag}">${e.flag==='up'?'▲':'▼'} ${Math.abs(e.delta)}%</span></div>`).join('')}</div></div>`;
  } else html+=`<div class="radar"><h3>📡 Radar da semana</h3><div style="color:var(--green)">✓ Nenhuma variação ≥10% nesta semana.</div></div>`;
  // seções por tier
  ['AAA','A','B','C','D','E'].forEach(t=>{
    const grp=tiers.filter(x=>x.tier===t); const r=rs[t]||{clientes:0,fat12m:0,subiram:0,cairam:0};
    const parcial = (t==='E' && r.clientes>grp.length);
    html+=`<div class="tier-sec tier-${t}">
      <div class="tier-head"><span class="tier-badge">${t}</span>
        <span class="info">${r.clientes} clientes · ${brlk(r.fat12m)}/ano · ${TIERINFO[t]}</span>
        <span class="mov"><span class="movup">▲${r.subiram}</span> &nbsp; <span class="movdown">▼${r.cairam}</span></span></div>
      <div class="tier-grid">${grp.map(cliRow).join('')||'<div style="color:var(--mut)">—</div>'}</div>
      ${parcial?`<div style="color:var(--mut);font-size:11.5px;margin-top:8px">mostrando ${grp.length} de ${r.clientes} (cauda longa)</div>`:''}
    </div>`;
  });
  wrap.innerHTML=html;
}
function wireFTabs(){
  const tabs=[...document.querySelectorAll('.ftab')]; if(!tabs.length||tabs[0].__w) return;
  const map={geral:'app',alertas:'alertas',projecao:'projecao',clientes:'clientes',novos:'novos',perdidos:'perdidos',analises:'analises',petlove:'petlove',margem:'margem',estudo:'estudo',custos:'custos',ccia:'ccia',financeiro:'financeiro',socios:'socios',apoio:'apoio',apoiot:'apoiot'};
  tabs.forEach(t=>{t.__w=1; t.addEventListener('click',()=>{
    tabs.forEach(o=>o.classList.toggle('on',o===t));
    const v=t.dataset.v;
    Object.entries(map).forEach(([k,id])=>{const el=document.getElementById(id); if(el)el.style.display=(k===v)?'':'none';});
    if(v==='projecao') drawProjCharts();
    if(v==='analises'){ drawAnalisesChart(); drawDailyChart(); }
    if(v==='petlove'){ drawPetloveChart(); drawPetloveYearChart(); }
    if(v==='estudo') drawEstudoChart();
    if(v==='financeiro') renderCustosFin();
    if(v==='custos') renderCustosIA();
    if(v==='ccia') renderCustosCC();
    if(v==='apoio') renderApoio();
    if(v==='apoiot') renderApoioT();
    if(v==='socios') renderSocios();
  });});
}

/* ===================== ABA NOVOS (maturação) ===================== */
function novoRow(e){
  const col=e.esfriando?C.amber:C.green;
  return `<div class="cli-row">
    <div class="cli-info"><div class="cli-nome">${esc(e.nome||'#'+e.cod)}</div>
      <div class="cli-sub">${esc(e.cidade||'—')} · ${e.dias_cad}d de cadastro · acum. ${brl(e.fat)}</div></div>
    ${spark(e.semanas||[],col)}
    <div class="cli-badge ${e.esfriando?'warn':'ok'}">${e.esfriando?'esfriando '+e.dias_inativo+'d':'ativo'}</div></div>`;
}
function renderNovos(D){
  const wrap=document.getElementById('novos'); if(!wrap) return;
  const nv=D.novos||{recem:[],maturando:[],esfriando:0,total:0};
  let html=`<div class="fbanner">
    <div class="b"><div class="v">${nv.total}</div><div class="l">novos (≤90 dias)</div></div>
    <div class="b"><div class="v" style="color:var(--cyan)">${nv.recem.length}</div><div class="l">recém (0–30d)</div></div>
    <div class="b"><div class="v" style="color:var(--green)">${nv.maturando.length}</div><div class="l">maturando (31–90d)</div></div>
    <div class="b"><div class="v" style="color:var(--amber)">${nv.esfriando}</div><div class="l">⚠ esfriando (14d+ sem envio)</div></div></div>`;
  const sec=(t,lst)=>`<div class="tier-sec"><div class="tier-head"><span class="tier-badge" style="background:var(--cyan);color:var(--navy)">${t.split(' ')[0]}</span><span class="info">${t} · ${lst.length} clientes</span></div><div class="tier-grid">${lst.map(novoRow).join('')||'<div style="color:var(--mut)">—</div>'}</div></div>`;
  html+=sec('Recém-chegados (0–30 dias)',nv.recem);
  html+=sec('Em maturação (31–90 dias)',nv.maturando);
  wrap.innerHTML=html;
}

/* ===================== ABA PERDIDOS / RISCO ===================== */
function perdidoRow(e){
  const sub = e.motivo==='sumido'
    ? `${esc(e.cidade||'—')} · ${brl(e.mensal)}/mês · última ${e.ultima?e.ultima.split('-').reverse().slice(0,2).join('/'):'—'}`
    : `${esc(e.cidade||'—')} · ${brl(e.mensal)}/mês · queda ${e.delta}%`;
  const badge = e.motivo==='sumido'
    ? `<div class="cli-badge lost">${e.dias_inativo}d sem envio</div>`
    : `<div class="cli-delta down">▼ ${Math.abs(e.delta)}%</div>`;
  return `<div class="cli-row">
    <div class="cli-info"><div class="cli-nome">${esc(e.nome||'#'+e.cod)}</div><div class="cli-sub">${sub}</div></div>
    ${spark(e.semanas||[],C.red)} ${badge}</div>`;
}
function renderPerdidos(D){
  const wrap=document.getElementById('perdidos'); if(!wrap) return;
  const pe=D.perdidos||{sumidos:[],queda:[],fat_em_risco:0};
  let html=`<div class="fbanner">
    <div class="b"><div class="v" style="color:var(--red)">${brlk(pe.fat_em_risco)}</div><div class="l">faturamento/ano em risco</div></div>
    <div class="b"><div class="v">${pe.sumidos.length}</div><div class="l">sumidos (35d+ sem envio)</div></div>
    <div class="b"><div class="v">${pe.queda.length}</div><div class="l">queda forte (≥40%)</div></div></div>`;
  const sec=(t,lst,bg)=>`<div class="tier-sec"><div class="tier-head"><span class="tier-badge" style="background:${bg};color:#fff">!</span><span class="info">${t} · ${lst.length} clientes (relevantes ≥R$300/mês)</span></div><div class="tier-grid">${lst.map(perdidoRow).join('')||'<div style="color:var(--green)">✓ Nenhum.</div>'}</div></div>`;
  html+=sec('🔴 Sumidos — era relevante e parou',pe.sumidos,'#E03131');
  html+=sec('🟠 Em risco — queda forte na semana',pe.queda,'#FF8A00');
  wrap.innerHTML=html;
}

/* ===================== ABA PROJEÇÃO ===================== */
let PROJ=null;
function renderProjecao(D){
  const wrap=document.getElementById('projecao'); if(!wrap) return;
  const mensal=D.mensal||[], maxData=(D.meta&&D.meta.max_data)||'';
  if(mensal.length<25){ wrap.innerHTML='<div class="card" style="margin-top:18px;color:var(--mut)">Histórico insuficiente para projeção.</div>'; return; }
  const partial = mensal[mensal.length-1].ym===maxData.slice(0,7);
  const hist = partial ? mensal.slice(0,-1) : mensal.slice();
  const byYm={}; hist.forEach(x=>byYm[x.ym]={fat:x.fat,qtd:x.qtd});
  const fv=hist.map(x=>x.fat), qv=hist.map(x=>x.qtd), S=a=>a.reduce((x,y)=>x+y,0);
  const gFat=S(fv.slice(-12))/S(fv.slice(-24,-12))-1, gQtd=S(qv.slice(-12))/S(qv.slice(-24,-12))-1;
  const gB=gFat, gC=gFat*0.6, gO=gFat*1.4;
  const addM=(ym,k)=>{const [y,m]=ym.split('-').map(Number); const t=y*12+(m-1)+k; return Math.floor(t/12)+'-'+String(t%12+1).padStart(2,'0');};
  const lastYm=hist[hist.length-1].ym, fc=[];
  for(let i=1;i<=12;i++){ const ym=addM(lastYm,i), py=addM(ym,-12);
    const bf=byYm[py]?byYm[py].fat:fv[fv.length-1], bq=byYm[py]?byYm[py].qtd:qv[qv.length-1];
    fc.push({ym,base:bf*(1+gB),cons:bf*(1+gC),otim:bf*(1+gO),qtd:bq*(1+gQtd)}); }
  const next12=S(fc.map(x=>x.base));
  const total26=(g,key)=>{let s=0;for(let mo=1;mo<=12;mo++){const ym='2026-'+String(mo).padStart(2,'0');
    if(byYm[ym])s+=byYm[ym][key]; else{const py='2025-'+String(mo).padStart(2,'0'); s+=(byYm[py]?byYm[py][key]:0)*(1+g);}}return s;};
  const p26=total26(gB,'fat'), q26=total26(gQtd,'qtd'), c26=total26(gC,'fat'), o26=total26(gO,'fat');
  const fat2025=S(hist.filter(x=>x.ym>='2025-01'&&x.ym<='2025-12').map(x=>x.fat));
  const anual=(D.anual||[]).filter(a=>a.ano>='2019'&&a.ano<='2025');
  const a25=anual.find(a=>a.ano==='2025'), a22=anual.find(a=>a.ano==='2022');
  const cagr=(a25&&a22&&a22.fat>0)?Math.pow(a25.fat/a22.fat,1/3)-1:gFat;
  const p27=p26*(1+cagr);
  // ---- Pet Love (fonte externa): real + projeção pela run-rate (últimos 3 meses) ----
  const PL=(D.petlove&&D.petlove.mensal)||{}; const plYms=Object.keys(PL).sort();
  const plM=plYms.map(k=>PL[k]); const plFwd=plM.length?plM.slice(-3).reduce((a,b)=>a+b,0)/Math.min(3,plM.length):0;
  const firstPL=plYms[0]||'2026-01'; const plOf=ym=>(PL[ym]!=null?PL[ym]:(ym>=firstPL?plFwd:0));
  let plReal26=0, plProj26=0;
  for(let mo=1;mo<=12;mo++){ const ym='2026-'+String(mo).padStart(2,'0'); if(PL[ym]!=null) plReal26+=PL[ym]; else plProj26+=plFwd; }
  const pl2026=plReal26+plProj26, pl2027=plFwd*12;
  const pl2025=plYms.filter(k=>k.startsWith('2025')).reduce((a,k)=>a+PL[k],0);
  let pl12=0; for(let i=1;i<=12;i++) pl12+=plOf(addM(lastYm,i));
  const hasPL=plM.length>0;
  const totP26=p26+pl2026, totNext12=next12+pl12, tot2025=fat2025+pl2025;
  const d26tot=tot2025>0?100*(totP26-tot2025)/tot2025:null;
  PROJ={fc,hist,anual,p26,p27,plOf,pl2026,pl2027,hasPL,plByYear:(D.petlove&&D.petlove.por_ano)||{},drawn:false};
  const pf=v=>(v>=0?'+':'')+(v*100).toFixed(1)+'%';
  const kHead = hasPL ? 'Projeção 2026 · TOTAL' : 'Projeção 2026 · ano cheio';
  const kSub  = hasPL ? `sistema ${brlk(p26)} (${(100*p26/totP26).toFixed(0)}%) + Pet Love ${brlk(pl2026)} (${(100*pl2026/totP26).toFixed(0)}%)` : `vs 2025 ${brlk(fat2025)}`;
  wrap.innerHTML=`
  <div class="kpis" style="margin-top:18px">
    <div class="kpi"><div class="lbl">${kHead}</div><div class="krow"><div class="val">${brlk(totP26)}</div>${chip(d26tot)}</div><div class="delta">${kSub}</div></div>
    <div class="kpi g"><div class="lbl">Próximos 12 meses</div><div class="krow"><div class="val">${brlk(totNext12)}</div></div><div class="delta">${hasPL?'sistema + Pet Love (run-rate)':'ritmo atual projetado'}</div></div>
    <div class="kpi a"><div class="lbl">Crescimento orgânico</div><div class="krow"><div class="val">${pf(gFat)}</div></div><div class="delta">sistema · 12m vs 12m (sem Pet Love)</div></div>
    ${hasPL?`<div class="kpi" style="--pl"><div class="lbl">🐾 Pet Love 2026</div><div class="krow"><div class="val">${brlk(pl2026)}</div></div><div class="delta">real ${brlk(plReal26)} + proj ${brlk(plProj26)}</div></div>`:''}
    <div class="kpi p"><div class="lbl">Exames projetados 2026</div><div class="krow"><div class="val">${num(q26)}</div>${chip(gQtd*100)}</div><div class="delta">volume · vs 2025</div></div>
  </div>
  <div class="note-fin" style="border-color:rgba(0,212,255,.3);background:rgba(0,212,255,.06);color:#bfe9ff">
    <b>ℹ Como é calculado:</b> <b>sistema</b> — cada mês futuro = o mesmo mês do ano anterior (sazonalidade real) × o crescimento orgânico (${pf(gFat)}); cenários conservador (×0,6) / base / otimista (×1,4).${hasPL?` <b>Pet Love</b> (externa, fora do HF) — real até ${plYms[plYms.length-1]||'—'}, depois projetada pela <b>run-rate</b> (~${brlk(plFwd)}/mês, média dos últimos 3 meses, pois 2025 foi rampa de contrato).`:''} Projeção do track record, não garantia.
  </div>`;
  wrap.appendChild(section('Projeção mensal',`histórico + próximos 12 meses · banda conservador↔otimista${hasPL?' · linha rosa = com Pet Love':''}`));
  const c1=card('Faturamento mensal — realizado e projetado',''); const b1=el('div','chartbox lg'); b1.innerHTML='<canvas id="projMensal"></canvas>'; c1.appendChild(b1); wrap.appendChild(c1);
  wrap.appendChild(section('Projeção anual','realizado + 2026 / 2027 projetados'));
  const g2=el('div','grid g2');
  const c2=card('Faturamento anual',`CAGR sistema 3 anos: ${pf(cagr)} ao ano${hasPL?' · Pet Love empilhada':''}`); const b2=el('div','chartbox lg'); b2.innerHTML='<canvas id="projAnual"></canvas>'; c2.appendChild(b2); g2.appendChild(c2);
  const c3=card('Cenários para 2026',hasPL?'total (sistema + Pet Love)':'faturamento do ano cheio'); c3.appendChild(scenBox(c26+pl2026,p26+pl2026,o26+pl2026,tot2025)); g2.appendChild(c3);
  wrap.appendChild(g2);
}
function scenBox(c,b,o,base){
  const box=el('div'),mx=Math.max(c,b,o,1);
  const row=(l,v,col)=>`<div style="margin:12px 0"><div style="display:flex;justify-content:space-between;font-size:13px"><span style="color:var(--mut);font-weight:600">${l}</span><b>${brlk(v)}</b></div><div style="height:13px;background:rgba(255,255,255,.06);border-radius:7px;margin-top:5px;overflow:hidden"><div style="height:13px;width:${Math.round(100*v/mx)}%;background:${col};border-radius:7px"></div></div><div style="font-size:11px;color:var(--mut);margin-top:3px">vs 2025: ${base>0?((v-base)/base*100>=0?'+':'')+((v-base)/base*100).toFixed(1)+'%':'—'}</div></div>`;
  box.innerHTML=row('Conservador',c,C.amber)+row('Base',b,C.cyan)+row('Otimista',o,C.green);
  return box;
}
function drawProjCharts(){
  if(!PROJ||PROJ.drawn||typeof Chart==='undefined') return; PROJ.drawn=true;
  const {fc,hist,anual,p26,p27,plOf,pl2026,pl2027,hasPL,plByYear}=PROJ;
  const tail=hist.slice(-18), N=tail.length;
  const labels=tail.map(x=>fmtYM(x.ym)).concat(fc.map(x=>fmtYM(x.ym)));
  const ymsAll=tail.map(x=>x.ym).concat(fc.map(x=>x.ym));
  const actual=tail.map(x=>x.fat).concat(Array(12).fill(null));
  const pad=Array(N-1).fill(null), lastF=tail[N-1].fat;
  const mk=key=>pad.concat([lastF], fc.map(x=>x[key]));
  const sysCont=tail.map(x=>x.fat).concat(fc.map(x=>x.base));
  const datasets=[
    {type:'line',label:'Realizado',data:actual,borderColor:C.cyan,backgroundColor:ctx=>gradient(ctx.chart.ctx,ctx.chart.chartArea,hex2rgb(C.cyan)),fill:true,tension:.3,borderWidth:2.6,pointRadius:0},
    {type:'line',label:'cons',data:mk('cons'),borderColor:'rgba(0,0,0,0)',pointRadius:0,tension:.3,fill:false},
    {type:'line',label:'otim',data:mk('otim'),borderColor:'rgba(0,0,0,0)',pointRadius:0,tension:.3,backgroundColor:'rgba(0,212,255,.12)',fill:'-1'},
    {type:'line',label:'Projeção (base)',data:mk('base'),borderColor:C.cyan,borderDash:[6,4],pointRadius:0,tension:.3,borderWidth:2,fill:false},
  ];
  if(hasPL) datasets.push({type:'line',label:'Com Pet Love',data:sysCont.map((v,i)=>v+(plOf(ymsAll[i])||0)),borderColor:C.petlove,borderWidth:2,pointRadius:0,tension:.3,fill:false});
  const cv=document.getElementById('projMensal');
  if(cv) new Chart(cv,{data:{labels,datasets},options:{...baseOpts(),interaction:{mode:'index',intersect:false},
    plugins:{legend:{labels:{boxWidth:12,padding:12,filter:i=>['Realizado','Projeção (base)','Com Pet Love'].includes(i.text)}},
      tooltip:{...bt(),filter:c=>c.dataset.label!=='cons'&&c.dataset.label!=='otim'&&c.raw!=null,callbacks:{label:c=>' '+c.dataset.label+': '+brl(c.raw)}}},
    scales:{x:{...noGrid,ticks:{maxTicksLimit:12}},y:{grid:GRID,ticks:{callback:v=>brlk(v)}}}}});
  // anual empilhado: sistema + Pet Love
  const aLabels=anual.map(a=>a.ano).concat(['2026 *','2027 *']);
  const sysData=anual.map(a=>a.fat).concat([p26,p27]);
  const cyR=hex2rgb(C.cyan).replace('rgb','rgba').replace(')',',.85)'), amR=hex2rgb(C.amber).replace('rgb','rgba').replace(')',',.85)');
  const sysCol=anual.map(()=>cyR).concat([amR,amR]);
  const aDs=[{label:'Sistema',data:sysData,backgroundColor:sysCol,borderRadius:hasPL?0:5,stack:'a'}];
  if(hasPL){ const plData=anual.map(a=>plByYear[a.ano]||0).concat([pl2026,pl2027]);
    aDs.push({label:'Pet Love',data:plData,backgroundColor:hex2rgb(C.petlove).replace('rgb','rgba').replace(')',',.85)'),borderRadius:5,stack:'a'}); }
  const cv2=document.getElementById('projAnual');
  if(cv2) new Chart(cv2,{type:'bar',data:{labels:aLabels,datasets:aDs},
    options:{...baseOpts(),plugins:{legend:{display:hasPL,labels:{boxWidth:10}},tooltip:{callbacks:{label:c=>' '+c.dataset.label+': '+brl(c.raw)+(c.dataIndex>=anual.length?' (proj)':'')}}},
      scales:{x:{...noGrid,stacked:true},y:{grid:GRID,stacked:true,ticks:{callback:v=>brlk(v)}}}}});
}

/* ---------- helpers de tabela ---------- */
function tblClientes(rows){
  const box=el('div','scrolly'); const t=el('table');
  t.innerHTML='<thead><tr><th>#</th><th>Cliente</th><th>Cidade</th><th class="num">Exames</th><th class="num">Faturamento</th><th class="num">Ticket</th></tr></thead>';
  const tb=el('tbody');
  rows.forEach(r=>{const tr=el('tr');tr.innerHTML=`<td><span class="rk">${r.rank}</span></td><td>${esc(r.nome||'#'+r.cod)}</td><td style="color:var(--mut)">${esc(r.Cidade||'-')}</td><td class="num">${num(r.qtd)}</td><td class="num">${brl(r.fat)}</td><td class="num" style="color:var(--mut)">${brl(r.ticket)}</td>`;tb.appendChild(tr);});
  t.appendChild(tb); box.appendChild(t); return box;
}
function tblChurn(rows){
  const box=el('div','scrolly');box.style.maxHeight='240px'; const t=el('table');
  t.innerHTML='<thead><tr><th>Cliente</th><th>Cidade</th><th class="num">Últ. exame</th><th class="num">Fat. último ano</th></tr></thead>';
  const tb=el('tbody');
  rows.forEach(r=>{const tr=el('tr');tr.innerHTML=`<td>${esc(r.nome||'#'+r.cod)}</td><td style="color:var(--mut)">${esc(r.Cidade||'-')}</td><td class="num"><span class="pill r">${r.ultima}</span></td><td class="num">${brl(r.fat_ult_ano)}</td>`;tb.appendChild(tr);});
  t.appendChild(tb); box.appendChild(t); return box;
}
function tblExames(rows,key){
  const box=el('div','scrolly'); const t=el('table');
  t.innerHTML=`<thead><tr><th>Exame</th><th class="num">Qtd</th><th class="num">Faturamento</th>${key==='fat'?'<th class="num">Ticket</th>':''}</tr></thead>`;
  const tb=el('tbody');
  rows.forEach(r=>{const tr=el('tr');tr.innerHTML=`<td>${esc(r.Exame)}</td><td class="num">${num(r.qtd)}</td><td class="num">${brl(r.fat)}</td>${key==='fat'?`<td class="num" style="color:var(--mut)">${brl(r.ticket)}</td>`:''}`;tb.appendChild(tr);});
  t.appendChild(tb); box.appendChild(t); return box;
}
function tblCategorias(rows){
  const box=el('div','scrolly'); const t=el('table');
  t.innerHTML='<thead><tr><th>Categoria</th><th class="num">Qtd</th><th class="num">Faturamento</th></tr></thead>';
  const tb=el('tbody');
  rows.slice(0,30).forEach(r=>{const tr=el('tr');tr.innerHTML=`<td>${esc(r.categoria)}</td><td class="num">${num(r.qtd)}</td><td class="num">${brl(r.fat)}</td>`;tb.appendChild(tr);});
  t.appendChild(tb); box.appendChild(t); return box;
}
function tblCidades(rows){
  const box=el('div','scrolly'); const t=el('table');
  t.innerHTML='<thead><tr><th>Cidade</th><th>UF</th><th class="num">Clientes</th><th class="num">Faturamento</th></tr></thead>';
  const tb=el('tbody');
  rows.forEach(r=>{const tr=el('tr');tr.innerHTML=`<td>${esc(r.cidade||'-')}</td><td style="color:var(--mut)">${esc(r.uf||'')}</td><td class="num">${num(r.clientes)}</td><td class="num">${brl(r.fat)}</td>`;tb.appendChild(tr);});
  t.appendChild(tb); box.appendChild(t); return box;
}
function tblSimple(rows,kk,vv,head){
  const box=el('div','scrolly');box.style.maxHeight='300px'; const t=el('table');
  t.innerHTML=`<thead><tr><th>${head}</th><th class="num">Exames</th></tr></thead>`;
  const tb=el('tbody');
  rows.forEach(r=>{const tr=el('tr');tr.innerHTML=`<td>${esc(r[kk])}</td><td class="num">${num(r[vv])}</td>`;tb.appendChild(tr);});
  t.appendChild(tb); box.appendChild(t); return box;
}

/* ---------- concentração ---------- */
function concBox(c){
  const box=el('div');
  box.innerHTML=`<div class="mini" style="margin-bottom:14px">
    <div class="m"><div class="v" style="color:${C.cyan}">${c.top10_pct}%</div><div class="l">Top 10 clientes</div></div>
    <div class="m"><div class="v" style="color:${C.green}">${c.top20_pct}%</div><div class="l">Top 20 clientes</div></div>
    <div class="m"><div class="v" style="color:${C.amber}">${c.top50_pct}%</div><div class="l">Top 50 clientes</div></div>
  </div>`;
  const cv=canvasIn(box,'chartbox sm');
  const p=c.pareto;
  new Chart(cv,{type:'line',data:{labels:p.map(x=>x.cliente_pct+'%'),datasets:[
    {label:'Faturamento acumulado',data:p.map(x=>x.fat_acum_pct),borderColor:C.cyan,
     backgroundColor:ctx=>gradient(ctx.chart.ctx,ctx.chart.chartArea,hex2rgb(C.cyan)),fill:true,tension:.3,borderWidth:2,pointRadius:0}
  ]},options:{...baseOpts(),plugins:{legend:{display:false},tooltip:{callbacks:{title:i=>'Top '+i[0].label+' dos clientes',label:c=>' '+c.raw+'% do faturamento'}}},
    scales:{x:{...noGrid,ticks:{maxTicksLimit:6,callback:function(v){return this.getLabelForValue(v)}}},y:{grid:GRID,max:100,ticks:{callback:v=>v+'%'}}}}});
  return box;
}

/* ---------- mapa choropleth do RJ (chartjs-chart-geo) ---------- */
function loadScript(src){ return new Promise((res,rej)=>{ const s=document.createElement('script'); s.src=src; s.onload=()=>res(); s.onerror=()=>rej(new Error('falha '+src)); document.head.appendChild(s); }); }
async function renderMapaRJ(D){
  const cv=document.getElementById('mapaRJ'); if(!cv) return; const box=cv.parentElement;
  try{
    if(!window.__geoLoaded){ await loadScript('https://cdn.jsdelivr.net/npm/chartjs-chart-geo@4.3.4/build/index.umd.min.js'); window.__geoLoaded=true; }
    const geo=await fetch('https://raw.githubusercontent.com/tbrugz/geodata-br/master/geojson/geojs-33-mun.json').then(r=>{if(!r.ok)throw new Error('geo'); return r.json();});
    const feats=geo.features;
    const norm=s=>String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase().replace(/[^A-Z]/g,'');
    const byCity={}; (D.cidades||[]).forEach(c=>{ const k=norm(c.cidade); byCity[k]=(byCity[k]||0)+(c.fat||0); });
    const data=feats.map(f=>({feature:f, value: byCity[norm(f.properties.name)]||0}));
    new Chart(cv,{type:'choropleth',data:{labels:feats.map(f=>f.properties.name),
      datasets:[{label:'Faturamento',outline:feats,data}]},
      options:{responsive:true,maintainAspectRatio:false,
        plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>{const v=c.raw.value; return ' '+c.raw.feature.properties.name+': '+(v>0?brl(v):'sem faturamento'); }}}},
        scales:{ projection:{axis:'x',projection:'mercator'},
          color:{axis:'x',quantize:6,interpolate:t=>`rgba(0,212,255,${(0.05+0.95*t).toFixed(3)})`,missing:'rgba(255,255,255,.04)',legend:{display:false}} }}});
  }catch(e){ console.warn('mapaRJ',e); box.innerHTML='<div style="height:100%;display:flex;align-items:center;justify-content:center;color:var(--mut);font-size:13px;text-align:center;padding:24px">🗺️ Mapa indisponível agora — veja o ranking de cidades abaixo.</div>'; }
}

/* ---------- donut ---------- */
function donut(cv, labels, data, money){
  new Chart(cv,{type:'doughnut',data:{labels,datasets:[
    {data,backgroundColor:PAL.map(c=>hex2rgb(c)),borderColor:C.navy,borderWidth:2,hoverOffset:6}
  ]},options:{responsive:true,maintainAspectRatio:false,cutout:'62%',
    plugins:{legend:{position:'right',labels:{boxWidth:10,boxHeight:10,padding:8,font:{size:10.5}}},
      tooltip:{callbacks:{label:c=>{const tot=c.dataset.data.reduce((a,b)=>a+b,0);const p=(100*c.raw/tot).toFixed(1);return ' '+(money?brl(c.raw):num(c.raw))+' ('+p+'%)';}}}}}});
}

/* ---------- opções base ---------- */
function bt(){ return {backgroundColor:'rgba(10,22,40,.95)',borderColor:'rgba(0,212,255,.3)',borderWidth:1,padding:10,titleColor:'#fff',bodyColor:'#cfe',cornerRadius:6}; }
function baseOpts(){ return {responsive:true,maintainAspectRatio:false,
  plugins:{legend:{labels:{boxWidth:12,padding:12}},tooltip:bt()},
  scales:{x:noGrid,y:{grid:GRID}}}; }
function dualOpts(){ return {responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
  plugins:{legend:{labels:{boxWidth:12,padding:12}},tooltip:{...bt(),callbacks:{label:c=>c.dataset.yAxisID==='y'?' '+c.dataset.label+': '+brl(c.raw):' '+c.dataset.label+': '+num(c.raw)}}},
  scales:{x:{...noGrid,ticks:{maxTicksLimit:14}},
    y:{position:'left',grid:GRID,ticks:{callback:v=>brlk(v)}},
    y1:{position:'right',grid:{display:false},ticks:{callback:v=>num(v)}}}}; }

/* junta variações de mesmo nome (acentos/espaços/maiúsculas ocultas) */
function mergeByName(rows, field){
  const map={};
  rows.forEach(r=>{const raw=String(r[field]||'');
    const key=raw.normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^A-Z0-9]/gi,'').toUpperCase();
    if(!map[key])map[key]={[field]:raw.trim(),qtd:0,fat:0};
    map[key].qtd+=r.qtd; map[key].fat+=r.fat||0;});
  return Object.values(map).sort((a,b)=>b.qtd-a.qtd);
}
function esc(s){ return String(s==null?'':s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }

/* ===================== ALERTAS & RECOMENDAÇÕES ===================== */
function alertStripHTML(D){
  const A=(D.alertas||[]); if(!A.length) return '';
  const ord={danger:0,warn:1,info:2};
  const top=[...A].sort((a,b)=>(ord[a.nivel]??3)-(ord[b.nivel]??3)).slice(0,4);
  return `<div class="alert-strip">${top.map(a=>`<div class="alert-chip ${a.nivel}" onclick="(function(){const t=[...document.querySelectorAll('.ftab')].find(x=>x.dataset.v==='alertas');if(t)t.click();})()">${a.icone} ${esc(a.titulo)}</div>`).join('')}</div>`;
}
function renderAlertas(D){
  const wrap=document.getElementById('alertas'); if(!wrap) return;
  const A=(D.alertas||[]); const ord={danger:0,warn:1,info:2};
  const sorted=[...A].sort((a,b)=>(ord[a.nivel]??3)-(ord[b.nivel]??3));
  wrap.innerHTML=`<div style="margin-bottom:14px;color:var(--mut);font-size:13px">💡 Pontos de atenção e recomendações — gerados automaticamente a partir dos dados, atualizados a cada 30 min.</div>`+
    sorted.map(a=>`<div class="alert-card ${a.nivel}"><div class="ai">${a.icone}</div><div><div class="at">${esc(a.titulo)}</div><div class="ax">${esc(a.texto)}</div></div></div>`).join('')
    || '<div style="color:var(--green)">✓ Nenhum alerta no momento.</div>';
}

/* ===================== ABA PET LOVE (análise em paralelo) ===================== */
const MES3PL=['','jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
function ymLabel(ym){const [y,m]=ym.split('-');return MES3PL[+m]+'/'+y.slice(2);}
let _plchart=null,_plYearChart=null,_PLY=null;
const MESFULL=['','jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
/* estatísticas Pet Love por ano: mensal por ano, YTD equalizado, projeção sazonal do ano corrente */
function plYearStats(D){
  const men=(D.petlove||{}).mensal||{};
  const byYear={};
  Object.entries(men).forEach(([ym,v])=>{const [y,m]=ym.split('-').map(Number);(byYear[y]=byYear[y]||{m:{},total:0}); byYear[y].m[m]=v; byYear[y].total+=v;});
  const years=Object.keys(byYear).map(Number).sort();
  const curY=years[years.length-1], prevY=curY-1;
  const cur=byYear[curY]||{m:{}}, prev=byYear[prevY]||null;
  const lastM=Math.max(0,...Object.keys(cur.m).map(Number));
  let ytdCur=0,ytdPrev=0; for(let m=1;m<=lastM;m++){ytdCur+=cur.m[m]||0; if(prev)ytdPrev+=prev.m[m]||0;}
  const ytdPct=(prev&&ytdPrev>0)?100*(ytdCur/ytdPrev-1):null;
  const ytdRatio=(prev&&ytdPrev>0)?ytdCur/ytdPrev:1;
  // ritmo BASE = momentum dos ÚLTIMOS 3 meses (mais responsivo que o YTD inteiro)
  const w0=Math.max(1,lastM-2); let m3Cur=0,m3Prev=0;
  for(let m=w0;m<=lastM;m++){m3Cur+=cur.m[m]||0; if(prev)m3Prev+=prev.m[m]||0;}
  const ratio=(prev&&m3Prev>0)?m3Cur/m3Prev:ytdRatio; const g=ratio-1;
  const winLabel=(lastM>w0?MESFULL[w0]+'–'+MESFULL[lastM]:MESFULL[lastM]);
  // 3 cenários (padrão skin): conservador g×0,6 · base g · otimista g×1,4
  const rC=1+g*0.6, rB=ratio, rO=1+g*1.4;
  // projeção sazonal: meses restantes = mês equivalente do ano anterior × razão do cenário
  function projWith(r){let t=ytdCur,mon={};for(let m=1;m<=12;m++){mon[m]=m<=lastM?(cur.m[m]||0):(prev?(prev.m[m]||0)*r:0); if(m>lastM)t+=mon[m];}return {t,mon};}
  const PB=projWith(rB),PC=projWith(rC),PO=projWith(rO);
  const pct=t=>(prev&&prev.total>0)?100*(t/prev.total-1):null;
  return {byYear,years,curY,prevY,cur,prev,lastM,ytdCur,ytdPrev,ytdPct,ratio,ytdRatio,winLabel,m3Cur,m3Prev,
    projTotal:PB.t,projMon:PB.mon,projPct:pct(PB.t),
    projCons:PC.t,projMonC:PC.mon,projConsPct:pct(PC.t),
    projOtim:PO.t,projMonO:PO.mon,projOtimPct:pct(PO.t)};
}
function renderPetlove(D){
  const wrap=document.getElementById('petlove'); if(!wrap) return;
  const pl=D.petlove||{}; const men=pl.mensal||{}; const at=pl.atend_mensal||{};
  const mensalLab={}; (D.mensal||[]).forEach(x=>mensalLab[x.ym]={fat:x.fat||0,qtd:x.qtd||0});
  const yms=Object.keys(men).sort();
  const ult=yms[yms.length-1]||''; const ultV=men[ult]||0;
  const labFatUlt=(mensalLab[ult]||{}).fat||0;
  const pctUlt=labFatUlt+ultV>0?100*ultV/(labFatUlt+ultV):0;
  const total=pl.total||Object.values(men).reduce((a,b)=>a+b,0);
  const Y=plYearStats(D); _PLY=Y;
  let html=`<div class="fbanner">
    <div class="b"><div class="v" style="color:var(--cyan)">${brlk(total)}</div><div class="l">Pet Love acumulado (${pl.desde?ymLabel(pl.desde):''}→${ult?ymLabel(ult):''})</div></div>
    <div class="b"><div class="v">${brlk(ultV)}</div><div class="l">último mês (${ult?ymLabel(ult):'—'})</div></div>
    <div class="b"><div class="v" style="color:var(--green)">${pctUlt.toFixed(1)}%</div><div class="l">do faturamento total do lab</div></div>
    <div class="b"><div class="v" style="color:${Y.ytdPct==null?'var(--mut)':(Y.ytdPct>=0?AZUL2:'var(--red)')}">${Y.ytdPct==null?'—':(Y.ytdPct>=0?'▲ +':'▼ ')+Y.ytdPct.toFixed(0)+'%'}</div><div class="l">${Y.curY} vs ${Y.prevY} (mesmo período, jan–${MESFULL[Y.lastM]})</div></div></div>`;
  const pj=pl.proj_atual;
  if(pj){
    const vc=pj.vs_mes_ant_pct>=0?AZUL2:'var(--red)';
    html+=`<div class="card" style="margin:6px 0 16px;border-color:rgba(255,176,32,.45)">
      <h3>📅 Projeção de fechamento — ${ymLabel(pj.ym)} <span class="cap">parcial até dia ${pj.ate_dia} · base: ${esc(pj.base)}</span></h3>
      <div style="display:flex;gap:30px;flex-wrap:wrap">
        <div><div class="acmp-l">Repasse projetado (fim do mês)</div><div class="acmp-v" style="color:var(--amber)">${brl(pj.proj_repasse)}</div><div class="acmp-s" style="color:${vc}">${pj.vs_mes_ant_pct>=0?'+':''}${pj.vs_mes_ant_pct}% vs mês anterior · faixa ${brlk(pj.piso_repasse)}–${brlk(pj.proj_repasse)}</div></div>
        <div><div class="acmp-l">Realizado até dia ${pj.ate_dia}</div><div class="acmp-v">${brl(pj.parcial_repasse)}</div><div class="acmp-s">${num(pj.parcial_atend)} atend · ${num(pj.parcial_exames)} exames</div></div>
        <div><div class="acmp-l">Produção projetada (mês)</div><div class="acmp-v">${num(pj.proj_atend)} <span style="font-size:13px;color:var(--mut)">atend</span></div><div class="acmp-s">${num(pj.proj_exames)} exames</div></div>
      </div>
      <div style="color:var(--mut);font-size:11px;margin-top:8px">${esc(pj.obs||'')}</div></div>`;
  }
  html+=`<div class="alert-card info" style="margin:6px 0 16px"><div class="ai">🐾</div><div><div class="at">Receita externa que ENTRA no total dos meses</div>
    <div class="ax">O sistema (HF) conta os exames Pet Love mas zera o valor (reembolso vem por fora). Estes R$ — Contas Médicas + Recurso de Glosa, por competência — são somados ao faturamento total do laboratório. ${esc(pl.obs||'')}</div></div></div>`;
  html+=`<div class="card" style="margin-bottom:16px"><h3>Pet Love dentro do faturamento total <span class="cap">barras (R$, eixo esq.): cinza = produção interna (sistema HF) · ciano = Pet Love · linha verde (eixo dir.) = % Pet Love no total · últimos 24 meses</span></h3>
    <div class="chartbox lg"><canvas id="plChart"></canvas></div></div>`;
  // ---- crescimento equalizado (mesmo período + projeção) ----
  const eqColor=Y.ytdPct==null?'var(--mut)':(Y.ytdPct>=0?AZUL2:'var(--red)');
  const prjColor=Y.projPct==null?'var(--mut)':(Y.projPct>=0?AZUL2:'var(--red)');
  const mxP=Math.max(Y.projCons,Y.projTotal,Y.projOtim,1);
  const srow=(l,v,vp,col)=>`<div style="margin:9px 0"><div style="display:flex;justify-content:space-between;font-size:13px"><span style="color:var(--mut);font-weight:600">${l}</span><b>${brlk(v)}</b></div><div style="height:12px;background:rgba(255,255,255,.06);border-radius:7px;margin-top:5px;overflow:hidden"><div style="height:12px;width:${Math.round(100*v/mxP)}%;background:${col};border-radius:7px"></div></div><div style="font-size:11px;color:var(--mut);margin-top:3px">vs ${Y.prevY} fechado: ${vp==null?'—':(vp>=0?'+':'')+vp.toFixed(0)+'%'}</div></div>`;
  html+=`<div class="card" style="margin-bottom:16px"><h3>Pet Love — crescimento equalizado <span class="cap">comparar ano cheio contra parcial engana; aqui igualamos pelo mesmo período</span></h3>
    <div class="grid g2" style="margin-bottom:14px">
      <div><div style="display:flex;gap:28px;flex-wrap:wrap">
        <div><div class="acmp-l">${Y.curY} até ${MESFULL[Y.lastM]} (YTD)</div><div class="acmp-v">${brl(Y.ytdCur)}</div><div class="acmp-s">mesmo período ${Y.prevY}: ${brl(Y.ytdPrev)}</div></div>
        <div><div class="acmp-l">Crescimento real (mesmo período)</div><div class="acmp-v" style="color:${eqColor}">${Y.ytdPct==null?'—':(Y.ytdPct>=0?'▲ +':'▼ ')+Y.ytdPct.toFixed(0)+'%'}</div><div class="acmp-s">jan–${MESFULL[Y.lastM]} ${Y.curY} vs ${Y.prevY}</div></div>
      </div></div>
      <div><div class="acmp-l" style="margin-bottom:2px">Projeção ${Y.curY} — ano cheio · 3 cenários</div>
        ${srow('Conservador',Y.projCons,Y.projConsPct,C.amber)+srow('Base',Y.projTotal,Y.projPct,C.cyan)+srow('Otimista',Y.projOtim,Y.projOtimPct,C.green)}</div>
    </div>
    <div class="chartbox lg"><canvas id="plYearChart"></canvas></div>
    <div style="background:rgba(0,212,255,.06);border:1px solid rgba(0,212,255,.25);border-radius:8px;padding:11px 14px;margin-top:10px;font-size:12px;line-height:1.5">
      <b style="color:var(--cyan)">📐 Como os cenários são calculados</b> — cada mês que falta = o <b>mesmo mês de ${Y.prevY}</b> × o <b>ritmo dos últimos 3 meses</b> (${Y.winLabel}: a Pet Love faturou <b>×${Y.ratio.toFixed(2)}</b> o que fez no mesmo trecho de ${Y.prevY}).
      <div style="display:flex;gap:18px;flex-wrap:wrap;margin-top:8px">
        <span style="color:var(--amber)">● <b>Conservador</b> = 60% do ritmo (×${(1+(Y.ratio-1)*0.6).toFixed(2)})</span>
        <span style="color:var(--cyan)">● <b>Base</b> = ritmo cheio (×${Y.ratio.toFixed(2)})</span>
        <span style="color:var(--green)">● <b>Otimista</b> = 140% do ritmo (×${(1+(Y.ratio-1)*1.4).toFixed(2)})</span>
      </div>
      <div style="color:var(--mut);margin-top:7px">No gráfico: <b>faixa sombreada</b> = entre conservador e otimista · <b>linha tracejada</b> = base · linhas cheias = realizado (${Y.curY} ciano, ${Y.prevY} cinza). Ritmo de 3 meses é mais responsivo que o YTD (×${Y.ytdRatio.toFixed(2)}).</div>
    </div></div>`;
  // por ano (com mesmo-período a/a e flag de parcial)
  const anos=Y.years;
  html+=`<div class="card" style="margin-bottom:16px"><h3>Pet Love por ano <span class="cap">a "var. mesmo período" compara só os meses já decorridos do ano corrente — leitura justa</span></h3>
    <table class="atab"><thead><tr><th>Ano</th><th class="num">Pet Love (realizado)</th><th class="num">var. a/a (ano cheio)</th><th class="num">var. mesmo período</th></tr></thead><tbody>`+
    anos.map((a,i)=>{const v=Y.byYear[a].total;const pv=i>0?Y.byYear[anos[i-1]].total:null;const g=pv?100*(v/pv-1):null;
      const parcial=(a===Y.curY); let same=null;
      if(parcial&&Y.ytdPct!=null) same=Y.ytdPct;
      return `<tr><td>${a}${parcial?` <span style="color:var(--amber);font-size:10px;font-weight:700">parcial até ${MESFULL[Y.lastM]}</span>`:''}</td>
        <td class="num">${brl(v)}</td>
        <td class="num" style="color:${g==null?'var(--mut)':(g>=0?AZUL2:'var(--red)')};${parcial?'opacity:.45':'font-weight:700'}">${g==null?'—':(g>=0?'+':'')+g.toFixed(0)+'%'}${parcial?' ⚠':''}</td>
        <td class="num" style="color:${same==null?'var(--mut)':(same>=0?AZUL2:'var(--red)')};font-weight:700">${same==null?'—':(same>=0?'+':'')+same.toFixed(0)+'%'}</td></tr>`;}).join('')+
    `<tr style="border-top:2px solid var(--line)"><td>${Y.curY} <span style="color:var(--cyan);font-size:10px;font-weight:700">PROJEÇÃO ano cheio</span></td><td class="num" style="color:var(--cyan);font-weight:700">${brl(Y.projTotal)}</td><td class="num" style="color:${prjColor};font-weight:700">${Y.projPct==null?'—':(Y.projPct>=0?'+':'')+Y.projPct.toFixed(0)+'%'}</td><td class="num">—</td></tr>`+
    `</tbody></table><div style="color:var(--mut);font-size:11px;margin-top:8px">⚠ A "var. ano cheio" do ano corrente é enganosa (compara meses parciais contra 12 meses). Use a coluna "mesmo período".</div></div>`;
  // detalhe mensal — agora com produção interna do sistema
  // Exames Pet Love/mês (dos relatórios .xls do sistema, plano 'Petlove%'). ATUALIZAR quando o Wal manda mês novo.
  const PL_EXAMES={'2026-06':7605,'2026-07':8758};
  // inclui os meses de Exames PL como linhas (mesmo sem repasse fechado ainda), senão jun/jul não apareceriam
  const rec=[...new Set([...yms, ...Object.keys(PL_EXAMES)])].sort().slice(-18).reverse();
  html+=`<div class="card"><h3>Detalhe mensal <span class="cap">produção interna (sistema HF) + Pet Love · % = participação Pet Love no total do mês</span></h3>
    <table class="atab"><thead><tr><th>Mês</th><th class="num">Produção interna (R$)</th><th class="num">Exames (sistema)</th><th class="num">Pet Love (R$)</th><th class="num">Atend. PL</th><th class="num" style="color:#00D4FF">Exames PL</th><th class="num">Total mês</th><th class="num">% Pet Love</th></tr></thead><tbody>`+
    rec.map(ym=>{const v=men[ym]||0;const lab=(mensalLab[ym]||{}).fat||0;const q=(mensalLab[ym]||{}).qtd||0;const p=lab+v>0?100*v/(lab+v):0;const n=(at[ym]||{}).n_atend;
      return `<tr><td>${ymLabel(ym)}</td><td class="num">${lab?brl(lab):'—'}</td><td class="num">${q?num(q):'—'}</td><td class="num" style="color:var(--cyan)">${v?brl(v):'—'}</td><td class="num">${n?num(n):'—'}</td><td class="num" style="color:#00D4FF;font-weight:700">${PL_EXAMES[ym]?num(PL_EXAMES[ym]):'—'}</td><td class="num">${(lab+v)?brl(lab+v):'—'}</td><td class="num" style="font-weight:700">${v?p.toFixed(1)+'%':'—'}</td></tr>`;}).join('')+
    `</tbody></table><div style="color:var(--mut);font-size:11px;margin-top:8px">Produção interna e exames vêm do sistema (inclui 2026). "Atend. PL" e "Exames PL" (produção Pet Love, plano Petlove%) só constam dos meses cujos relatórios Pet Love foram importados. Mande o export do mês que eu adiciono.</div></div>`;
  wrap.innerHTML=html;
}
function drawPetloveChart(){
  const D=window.__D; if(!D) return; const cv=document.getElementById('plChart'); if(!cv||typeof Chart==='undefined') return;
  if(_plchart) _plchart.destroy();
  const men=(D.petlove||{}).mensal||{}; const mensalLab={}; (D.mensal||[]).forEach(x=>mensalLab[x.ym]=x.fat||0);
  const yms=[...new Set([...Object.keys(men),...Object.keys(mensalLab)])].sort().slice(-24);
  const pctArr=yms.map(y=>{const s=mensalLab[y]||0,p=men[y]||0;return s+p>0?100*p/(s+p):null;});
  _plchart=new Chart(cv,{data:{labels:yms.map(ymLabel),datasets:[
    {type:'bar',label:'Produção interna (sistema)',data:yms.map(y=>mensalLab[y]||0),backgroundColor:'rgba(120,140,170,.45)',stack:'s',yAxisID:'y'},
    {type:'bar',label:'Pet Love',data:yms.map(y=>men[y]||0),backgroundColor:'#00D4FF',stack:'s',yAxisID:'y'},
    {type:'line',label:'% Pet Love no total',data:pctArr,borderColor:'#00E5A0',backgroundColor:'#00E5A0',borderWidth:2,tension:.3,pointRadius:2,yAxisID:'pct',spanGaps:true}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#9fb0c8'}},tooltip:{callbacks:{label:c=>c.dataset.yAxisID==='pct'?' '+c.dataset.label+': '+(c.raw==null?'—':c.raw.toFixed(1)+'%'):' '+c.dataset.label+': '+brl(c.raw)}}},
      scales:{x:{ticks:{color:'#7f90a8',maxRotation:90,minRotation:90,font:{size:9}},stacked:true,grid:{display:false}},
        y:{stacked:true,position:'left',ticks:{color:'#7f90a8',callback:v=>brlk(v)},grid:{color:'rgba(255,255,255,.05)'}},
        pct:{position:'right',min:0,suggestedMax:50,ticks:{color:'#00E5A0',callback:v=>v+'%'},grid:{display:false}}}}});
}
function drawPetloveYearChart(){
  const cv=document.getElementById('plYearChart'); if(!cv||typeof Chart==='undefined'||!_PLY) return;
  if(_plYearChart) _plYearChart.destroy();
  const Y=_PLY; const labels=MESFULL.slice(1);
  const acc=(src,upto)=>{let s=0;const out=[];for(let m=1;m<=12;m++){if(upto&&m>upto){out.push(null);continue;} s+=(src[m]||0); out.push(s);}return out;};
  const prevCum=Y.prev?acc(Y.prev.m,0):labels.map(()=>null);
  const curCum=acc(Y.cur.m,Y.lastM);
  // projeção: nula antes do último mês, conecta no último real e segue com projMon
  const scCum=mon=>{let s=0;const out=[];for(let m=1;m<=12;m++){s+=(m<=Y.lastM?(Y.cur.m[m]||0):(mon[m]||0)); out.push(m<Y.lastM?null:s);}return out;};
  const projCum=scCum(Y.projMon), consCum=Y.prev?scCum(Y.projMonC):labels.map(()=>null), otimCum=Y.prev?scCum(Y.projMonO):labels.map(()=>null);
  _plYearChart=new Chart(cv,{type:'line',data:{labels,datasets:[
    {label:`${Y.prevY} (acum.)`,data:prevCum,borderColor:'rgba(160,176,200,.8)',backgroundColor:'rgba(160,176,200,.08)',borderWidth:2,tension:.3,pointRadius:0},
    {label:'cons',data:consCum,borderColor:'rgba(0,0,0,0)',pointRadius:0,tension:.3,fill:false},
    {label:'otim',data:otimCum,borderColor:'rgba(0,0,0,0)',pointRadius:0,tension:.3,backgroundColor:'rgba(0,212,255,.12)',fill:'-1'},
    {label:`${Y.curY} (acum. real)`,data:curCum,borderColor:'#00D4FF',backgroundColor:'rgba(0,212,255,.10)',borderWidth:3,tension:.3,pointRadius:2,fill:false},
    {label:`${Y.curY} (projeção base)`,data:projCum,borderColor:'#00D4FF',borderDash:[6,4],borderWidth:2,tension:.3,pointRadius:0}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#9fb0c8',filter:i=>i.text!=='cons'&&i.text!=='otim'}},
      tooltip:{filter:c=>c.dataset.label!=='cons'&&c.dataset.label!=='otim'&&c.raw!=null,callbacks:{label:c=>' '+c.dataset.label+': '+brl(c.raw)}}},
      scales:{x:{ticks:{color:'#7f90a8'},grid:{display:false}},y:{ticks:{color:'#7f90a8',callback:v=>brlk(v)},grid:{color:'rgba(255,255,255,.05)'}}}}});
}

/* ===================== ABA MARGEM PET LOVE (reembolso vs tabela varejo) ===================== */
function renderMargem(D){
  const wrap=document.getElementById('margem'); if(!wrap) return;
  const M=D.petlove_margem||{};
  if(M.erro){ wrap.innerHTML=`<div class="card" style="margin-top:18px;color:var(--red)">Falha ao carregar margem: ${esc(M.erro)}</div>`; return; }
  const ag=M.agregado||{}; const exs=(M.exames||[]).filter(x=>x.tabela!=null);
  exs.forEach(x=>x.impacto=Math.round((x.delta||0)*x.volume));
  const prem=ag.premio_pct;
  let html=`<div class="fbanner">
    <div class="b"><div class="v" style="color:${prem>=0?AZUL2:'var(--red)'}">${prem>=0?'+':''}${prem}%</div><div class="l">Pet Love paga vs NOSSA tabela (varejo)</div></div>
    <div class="b"><div class="v">${brlk(ag.receita_petlove)}</div><div class="l">reembolso Pet Love (exames casados)</div></div>
    <div class="b"><div class="v" style="color:var(--mut)">${brlk(ag.receita_tabela)}</div><div class="l">se cobrado pela tabela varejo</div></div>
    <div class="b"><div class="v" style="color:var(--green)">${ag.n_match}</div><div class="l">exames casados (de ${ag.n_total})</div></div></div>`;
  html+=`<div class="alert-card ${prem>=0?'info':'warn'}" style="margin:6px 0 16px"><div class="ai">⚖️</div><div>
    <div class="at">No agregado, a Pet Love nos paga ${prem>=0?'ACIMA':'ABAIXO'} do varejo (${prem>=0?'+':''}${prem}%)</div>
    <div class="ax">Compara o <b>reembolso</b> que a Pet Love paga por exame com a <b>nossa tabela de varejo (Mar/2026)</b>. Onde paga acima, ganhamos ${brl(ag.ganho_acima)} (${ag.n_acima} exames); onde paga abaixo, abrimos mão de ${brl(ag.perda_abaixo)} (${ag.n_abaixo} exames). <b>Atenção:</b> isto é preço × preço — a margem REAL precisa do custo do exame (pendente do dev). ${esc(M.obs||'')}</div></div></div>`;
  html+=`<div style="display:flex;align-items:center;gap:14px;margin:0 0 16px;flex-wrap:wrap">
    <button class="toolbtn" id="btnReneg" style="background:var(--cyan);color:var(--navy);font-weight:700">📧 Exportar lista de renegociação por e-mail</button>
    <span id="renegStatus" style="color:var(--mut);font-size:13px"></span></div>`;
  // dois blocos: acima e abaixo
  const acima=exs.filter(x=>x.delta>0).sort((a,b)=>b.impacto-a.impacto);
  const abaixo=exs.filter(x=>x.delta<0).sort((a,b)=>a.delta_pct-b.delta_pct);
  const rowsT=(lst)=>lst.map(x=>`<tr>
    <td>${esc(x.exame)}${x.nota?` <span style="color:var(--amber);font-size:10px">(${esc(x.nota)})</span>`:''}<div style="color:var(--mut);font-size:10px">→ ${esc(x.tabela_exame||'')}</div></td>
    <td class="num">${num(x.volume)}</td>
    <td class="num">${brl(x.petlove)}</td>
    <td class="num" style="color:var(--mut)">${brl(x.tabela)}</td>
    <td class="num" style="color:${x.delta>=0?AZUL2:'var(--red)'};font-weight:700">${x.delta>=0?'+':''}${x.delta_pct}%</td>
    <td class="num" style="color:${x.impacto>=0?AZUL2:'var(--red)'};font-weight:700">${x.impacto>=0?'+':''}${brl(x.impacto)}</td></tr>`).join('');
  const thead=`<thead><tr><th>Exame</th><th class="num">Volume</th><th class="num">Pet Love paga</th><th class="num">Nossa tabela</th><th class="num">Δ%</th><th class="num">Impacto (Δ×vol)</th></tr></thead>`;
  html+=`<div class="card" style="margin-bottom:16px"><h3>🟦 Pet Love paga ACIMA do varejo — favorável <span class="cap">${acima.length} exames · ordenado por impacto</span></h3>
    <table class="atab">${thead}<tbody>${rowsT(acima)}</tbody></table></div>`;
  html+=`<div class="card" style="margin-bottom:16px"><h3>🟥 Pet Love paga ABAIXO do varejo — desconto que damos <span class="cap">${abaixo.length} exames · maior desconto primeiro</span></h3>
    <table class="atab">${thead}<tbody>${rowsT(abaixo)}</tbody></table></div>`;
  // sem correspondência
  const sem=(M.exames||[]).filter(x=>x.tabela==null).sort((a,b)=>b.volume-a.volume);
  if(sem.length){
    html+=`<div class="card"><h3>Sem correspondência direta na tabela <span class="cap">${sem.length} exames — nome Pet Love não bateu com a tabela varejo</span></h3>
      <table class="atab"><thead><tr><th>Exame (Pet Love)</th><th class="num">Volume</th><th class="num">Pet Love paga</th></tr></thead><tbody>`+
      sem.slice(0,30).map(x=>`<tr><td>${esc(x.exame)}</td><td class="num">${num(x.volume)}</td><td class="num">${x.petlove?brl(x.petlove):'—'}</td></tr>`).join('')+
      `</tbody></table></div>`;
  }
  html+=`<div style="color:var(--mut);font-size:11px;margin-top:10px">${esc(M.fonte||'')}</div>`;
  wrap.innerHTML=html;
  const bt=document.getElementById('btnReneg');
  if(bt) bt.addEventListener('click',()=>enviarRenegociacao(M));
}

/* monta a lista priorizada de renegociação (espelha gera_renegociacao.py) */
function renegLista(M){
  const EXC=new Set(['sódio','potássio','sodio','potassio']);
  const ab=(M.exames||[]).filter(x=>x.tabela!=null && x.delta<0 && x.volume>=15
      && !EXC.has((x.exame||'').trim().toLowerCase()));
  ab.forEach(x=>{x._gap=Math.round((-x.delta)*x.volume*1.2);
    const alvo=Math.round(0.8*x.tabela*100)/100; x._alvo=alvo>x.petlove?alvo:x.petlove;
    x._recup=Math.round(Math.max(0,(x._alvo-x.petlove))*x.volume*1.2);});
  ab.sort((a,b)=>b._gap-a._gap);
  return ab;
}
function renegEmailHTML(M){
  const ab=renegLista(M); const teto=ab.reduce((s,x)=>s+x._gap,0), recup=ab.reduce((s,x)=>s+x._recup,0);
  const td='style="padding:6px 8px;border:1px solid #1C2F4A;font-size:13px"';
  const tdr='style="padding:6px 8px;border:1px solid #1C2F4A;font-size:13px;text-align:right"';
  const rows=ab.map((x,i)=>`<tr${i%2?' style="background:#0E1E36"':''}>
    <td ${td}>${i+1}</td><td ${td}>${esc(x.exame)}</td><td ${tdr}>${num(x.volume)}</td>
    <td ${tdr}>${brl(x.petlove)}</td><td ${tdr}>${brl(x.tabela)}</td>
    <td ${tdr} ><span style="color:#C92A2A;font-weight:700">${x.delta_pct}%</span></td>
    <td ${tdr}><b>${brl(x._gap)}</b></td><td ${tdr}>${brl(x._alvo)}</td><td ${tdr}>${brl(x._recup)}</td></tr>`).join('');
  return `<div style="font-family:Inter,Arial,sans-serif;background:#0A1628;color:#E8EEF6;padding:22px">
   <h2 style="color:#00D4FF;margin:0 0 4px">Renegociação Pet Love — exames subprecificados</h2>
   <div style="color:#9FB0C8;font-size:12px;margin-bottom:14px">Gerado pelo painel BI Alpha · base relatórios Pet Love jan–nov/2025 × Tabela Mar/2026</div>
   <div style="background:#0E1E36;border:1px solid #1C2F4A;border-radius:8px;padding:14px;margin-bottom:16px">
     <b>Em jogo: até ${brl(teto)}/ano</b> · recuperável ~${brl(recup)}/ano (alvo: desconto máx 20% do varejo) · ${ab.length} exames.<br>
     <span style="color:#9FB0C8;font-size:12px">No agregado a Pet Love paga +20% acima do varejo (rotina de alto volume). O ajuste é só nos especializados/endócrinos abaixo.</span>
   </div>
   <table style="border-collapse:collapse;width:100%">
     <thead><tr style="background:#13294A;color:#fff">
       <th ${td}>#</th><th ${td} align="left">Exame</th><th ${tdr}>Vol.</th><th ${tdr}>PL paga</th>
       <th ${tdr}>Varejo</th><th ${tdr}>Desc.</th><th ${tdr}>R$/ano em jogo</th><th ${tdr}>Alvo −20%</th><th ${tdr}>Recupera/ano</th></tr></thead>
     <tbody>${rows}</tbody></table>
   <div style="color:#868E96;font-size:11px;margin-top:14px">Sódio/Potássio excluídos (tabela só vende o par R$23). Margem real precisa do custo do exame (pendente do dev). Volume anualizado ×1,2 (~10 meses observados).</div>
  </div>`;
}
async function enviarRenegociacao(M){
  const st=document.getElementById('renegStatus'); const bt=document.getElementById('btnReneg');
  if(!window.__PW){ if(st)st.textContent='Sessão sem senha — recarregue e entre novamente.'; return; }
  if(bt){bt.disabled=true;} if(st){st.style.color='var(--mut)';st.textContent='Enviando…';}
  try{
    const r=await fetch('/api/enviar-renegociacao',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({senha:window.__PW,assunto:'Renegociação Pet Love — exames subprecificados',html:renegEmailHTML(M)})});
    const j=await r.json().catch(()=>({}));
    if(r.ok&&j.ok){ if(st){st.style.color='var(--green)';st.textContent='✅ Enviado para '+(j.to||'seu e-mail')+'.'; } }
    else { if(st){st.style.color='var(--red)';st.textContent='❌ '+(j.erro||('falha '+r.status))+(j.detalhe?' — '+j.detalhe:'');} }
  }catch(e){ if(st){st.style.color='var(--red)';st.textContent='❌ erro de rede: '+e.message;} }
  finally{ if(bt) bt.disabled=false; }
}

/* ===================== ABA ESTUDO PET LOVE × COPA (admin) ===================== */
let _estChart=null;
function renderEstudo(D){
  const wrap=document.getElementById('estudo'); if(!wrap) return;
  const E=D.estudo||{};
  if(E.erro){ wrap.innerHTML=`<div class="card" style="margin-top:18px;color:var(--red)">Falha ao carregar estudo: ${esc(E.erro)}</div>`; return; }
  const dc=E.decomp||{};
  let html=`<div class="card" style="margin-bottom:16px"><h3>📚 ${esc(E.titulo||'Estudo')}</h3>
    <div style="color:var(--mut);font-size:13px;line-height:1.55">${esc(E.objetivo||'')}</div></div>`;
  if(dc.split_pc_pct!=null){
    const copa=dc.split_copa_pct, pc=dc.split_pc_pct;
    html+=`<div class="card" style="margin-bottom:16px"><h3>Decomposição da queda — ${ymLabel(dc.cur_ym)} (dias 1–${dc.ate_dia}) <span class="cap">vs ${ymLabel(dc.prev_ym)} mesma janela · atualiza sozinha</span></h3>
      <div style="display:flex;gap:28px;flex-wrap:wrap;margin-bottom:14px">
        <div><div class="acmp-l">Lab inteiro</div><div class="acmp-v" style="color:${gcol(dc.lab_pct)}">${gtxt(dc.lab_pct)}</div><div class="acmp-s">${num(dc.lab_prev)}→${num(dc.lab_cur)} exames</div></div>
        <div><div class="acmp-l">Resto do lab (sem Pet Carioca)</div><div class="acmp-v" style="color:${gcol(dc.resto_pct)}">${gtxt(dc.resto_pct)}</div><div class="acmp-s">= Copa+feriado puro</div></div>
        <div><div class="acmp-l">Pet Carioca</div><div class="acmp-v" style="color:${gcol(dc.pc_pct)}">${gtxt(dc.pc_pct)}</div><div class="acmp-s">${num(dc.pc_prev)}→${num(dc.pc_cur)} · ${dc.pc_mig_pct}% migração</div></div>
      </div>
      <div style="font-size:13px;margin-bottom:6px">Split da queda total (${num(dc.queda_total)} exames):</div>
      <div style="display:flex;height:28px;border-radius:7px;overflow:hidden;font-size:12px;font-weight:700">
        <div style="width:${copa}%;background:var(--cyan);color:#0A1628;display:flex;align-items:center;justify-content:center">Copa/feriado ${copa}%</div>
        <div style="width:${pc}%;background:var(--amber);color:#0A1628;display:flex;align-items:center;justify-content:center">Pet Carioca ${pc}%</div>
      </div>
      <div style="color:var(--mut);font-size:11px;margin-top:6px">🔵 Copa/feriado = temporário (deve reverter) · 🟠 Pet Carioca lab próprio = estrutural (não volta sozinho).</div></div>`;
  }
  html+=`<div class="card" style="margin-bottom:16px"><h3>Pet Carioca — produção mensal (exames) <span class="cap">o degrau de junho = corte da rede pro laboratório próprio</span></h3>
    <div class="chartbox lg"><canvas id="estChart"></canvas></div></div>`;
  const lst=arr=>(arr||[]).map(x=>`<li style="margin:5px 0">${esc(x)}</li>`).join('');
  html+=`<div class="card" style="margin-bottom:16px"><h3>🔎 Achados</h3><ul style="margin:0;padding-left:20px;font-size:13px;line-height:1.55">${lst(E.achados)}</ul></div>`;
  html+=`<div class="alert-card warn" style="margin-bottom:16px"><div class="ai">🎯</div><div><div class="at">Conclusão</div><div class="ax">${esc(E.conclusao||'')}</div></div></div>`;
  html+=`<div class="card" style="margin-bottom:16px"><h3>👀 O que vigiar nos próximos meses</h3><ul style="margin:0;padding-left:20px;font-size:13px;line-height:1.55">${lst(E.vigiar)}</ul></div>`;
  const pcm={}; (E.petcarioca_mensal||[]).forEach(x=>pcm[x.ym]=x);
  const labm={}; (D.mensal||[]).forEach(x=>labm[x.ym]=x);
  const plm=(D.petlove||{}).mensal||{}, pla=(D.petlove||{}).atend_mensal||{};
  const yms=[...new Set([...Object.keys(pcm),...Object.keys(plm)])].filter(y=>y>='2026-01').sort().reverse();
  const trow=yms.map(ym=>`<tr><td>${ymLabel(ym)}</td><td class="num">${labm[ym]?num(labm[ym].qtd):'—'}</td><td class="num" style="color:var(--amber)">${pcm[ym]?num(pcm[ym].ex):'—'}</td><td class="num" style="color:var(--cyan)">${plm[ym]?brl(plm[ym]):((pla[ym]||{}).valor?brl(pla[ym].valor):'—')}</td><td class="num">${(pla[ym]||{}).n_atend?num(pla[ym].n_atend):'—'}</td></tr>`).join('');
  html+=`<div class="card"><h3>📅 Acompanhamento mensal <span class="cap">fechar no fim de cada mês</span></h3>
    <table class="atab"><thead><tr><th>Mês</th><th class="num">Lab exames</th><th class="num">Pet Carioca exames</th><th class="num">Pet Love R$</th><th class="num">Pet Love atend.</th></tr></thead><tbody>${trow}</tbody></table>
    <div style="color:var(--mut);font-size:11px;margin-top:8px">${esc(E.obs||'')}</div></div>`;
  wrap.innerHTML=html;
}
function renderCustos(D){
  const wrap=document.getElementById('custosFinops'); if(!wrap) return;
  const C=D.custos||{};
  if(C.erro){ wrap.innerHTML=`<div class="card" style="margin-top:18px;color:var(--red)">Falha ao carregar custos: ${esc(C.erro)}</div>`; return; }
  // ===== estrutura NOVA (FinOps por SETOR) — custo do ECOSSISTEMA inteiro, separado e catalogado =====
  if(Array.isArray(C.setores)){
    const cb=Number(C.cambio_brl)||5.8;
    const U=v=>'US$ '+(Number(v)||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
    const R=v=>'R$ '+(Number(v)||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
    const g=C.governanca||{};
    const hh=m=>m==null?'':(m<60?m+' min':(m/60).toFixed(1)+' h');
    const fresh=g.stale_min!=null?`<span style="color:${g.stale?'var(--amber)':'var(--green)'}">${g.stale?'⚠ dado parado há '+hh(g.stale_min):'● atualizado há '+hh(g.stale_min)}</span>`:'';
    const dref=g.dia_ref?g.dia_ref.slice(8,10)+'/'+g.dia_ref.slice(5,7):'';
    // cor da etiqueta da BASE (governança da qualidade do número)
    const BCOL={'MEDIDO':'var(--green)','INSTRUMENTADO':'var(--amber)','CATÁLOGO+rateio':'var(--blue,#6ab0ff)','FREE TIER':'var(--mut)','TERCEIRO':'var(--mut)'};
    const bdg=b=>`<span style="font-size:10px;font-weight:700;letter-spacing:.4px;padding:1px 6px;border-radius:4px;border:1px solid ${BCOL[b]||'var(--mut)'};color:${BCOL[b]||'var(--mut)'}">${esc(b)}</span>`;
    const SCOL={'ATIVO':'var(--green)','INSTRUMENTADO':'var(--amber)','CONGELADO':'var(--mut)','FORA DA OPERAÇÃO':'var(--mut)'};
    // ---- PAINEL EXECUTIVO (FinOps: manchete + KPIs de mercado + budget×actual + tendência) ----
    const E=C.executivo||{};
    const chip=(v,inv)=>v==null?'':`<span class="chip ${(inv? -v: v)>=0?'up':'down'}">${v>=0?'▲':'▼'} ${Math.abs(v).toFixed(1)}%</span>`;
    const kpi=(rot,val,sub,cor)=>`<div style="min-width:150px"><div class="acmp-l">${rot}</div><div class="acmp-v"${cor?` style="color:${cor}"`:''}>${val}</div><div class="acmp-s">${sub}</div></div>`;
    const bstat={ok:'var(--green)',alerta:'var(--amber)',estouro:'var(--red)'}[E.status_budget]||'var(--mut)';
    const spark=(typeof kspark==='function'&&Array.isArray(C.serie))?kspark(C.serie.map(x=>Number(x.usd)||0),'var(--blue,#6ab0ff)'):'';
    let html=`<div class="card" style="margin-bottom:14px">
      <h3>💸 ${esc(C.titulo||'Custos por Setor')} <span class="cap">FinOps · atualizado ${esc((C.atualizado||'').replace('T',' ').replace('Z',' UTC'))} · câmbio R$ ${cb} · ${fresh}</span></h3>
      ${E.manchete?`<div style="font-size:13.5px;line-height:1.5;color:var(--txt);background:linear-gradient(90deg,rgba(106,176,255,.10),transparent);border-left:3px solid var(--blue,#6ab0ff);padding:8px 12px;border-radius:6px;margin:10px 0 4px">${esc(E.manchete)}</div>`:''}
      <div style="display:flex;gap:26px;flex-wrap:wrap;margin-top:14px;align-items:flex-start">
        ${kpi('Run-rate mensal',R(E.run_rate_mes_brl||C.projecao_mes_brl),'≈ '+R(E.run_rate_ano_brl)+'/ano · regime',null)}
        ${kpi('Custo unitário',E.custo_chamada_brl!=null?R(E.custo_chamada_brl):'—','por chamada de IA · '+num(E.chamadas_mes||0)+'/mês',null)}
        ${kpi('Economia capturada',E.economia_pct!=null?E.economia_pct+'%':'—','vs baseline '+R(E.baseline_dia_brl)+'/dia','var(--green)')}
        ${kpi('Cobertura de alocação',(E.cobertura_pct!=null?E.cobertura_pct:100)+'%','custo atribuído a centro de custo',null)}
        ${kpi('Setores medidos',(E.setores_medidos||0)+'/'+(E.setores_total||0),'IA medida ponta-a-ponta',null)}
        ${kpi('Realizado no mês',R(C.total_mes_brl),'gasto acumulado ('+esc(dref)+')',null)}
      </div>
      <div style="margin-top:16px;display:flex;gap:22px;flex-wrap:wrap;align-items:flex-end">
        <div style="flex:1;min-width:260px">
          <div class="acmp-l" style="margin-bottom:5px">Consumo do budget · <b style="color:${bstat}">${E.consumo_teto_pct!=null?E.consumo_teto_pct+'%':'—'}</b> do teto (${R(E.teto_dia_brl)}/dia)</div>
          <div style="height:12px;border-radius:7px;background:var(--bg2,#1a1f2b);overflow:hidden;border:1px solid var(--line)">
            <div style="height:100%;width:${Math.min(100,E.consumo_teto_pct||0)}%;background:${bstat};border-radius:7px"></div></div>
          <div class="acmp-s" style="margin-top:4px">Atual ${R(E.media_dia_brl)}/dia · baseline pré-otimização ${R(E.baseline_dia_brl)}/dia ${chip(E.var_dia_pct,true)} <span class="cap">dia vs dia</span></div>
        </div>
        ${spark?`<div style="min-width:150px"><div class="acmp-l" style="margin-bottom:2px">Custo/dia (série)</div>${spark}</div>`:''}
      </div>
      ${Array.isArray(E.metodologia)?`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;border-top:1px solid var(--line);padding-top:11px">
        <span class="cap" style="align-self:center">Metodologia FinOps Foundation:</span>
        ${E.metodologia.map((m,i)=>`<span title="${esc(m.feito)}" style="font-size:11px;padding:3px 9px;border-radius:6px;background:var(--bg2,#1a1f2b);border:1px solid var(--line)"><b style="color:var(--blue,#6ab0ff)">${i+1}. ${esc(m.fase)}</b> · ${esc(m.pt)}</span>`).join('')}
      </div>`:''}
    </div>`;
    // ---- faixa de GOVERNANÇA ----
    html+=`<div class="card" style="margin-bottom:14px;border-left:3px solid var(--green)">
      <div style="font-size:12px;color:var(--mut);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Governança do medidor</div>
      <div style="font-size:13px;line-height:1.7">
        <b>${g.setores_medidos||0}/${g.setores_total||0}</b> setores com custo de IA MEDIDO · Netlify catalogado (<b>${g.netlify_ativos||0}</b> sites ativos de ${g.netlify_sites||0}, snapshot ${esc((g.netlify_snapshot||'').slice(0,10))})${Array.isArray(g.instrumentados)&&g.instrumentados.length?` · instrumentado aguardando produção: <b>${g.instrumentados.map(esc).join(', ')}</b>`:''}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">${(g.fontes||[]).map(f=>`<span title="${esc(f.detalhe||'')}" style="font-size:11px;padding:3px 8px;border-radius:6px;background:var(--bg2,#1a1f2b)">${bdg(f.base)} ${esc(f.fonte)}</span>`).join('')}</div>
      <div style="font-size:11px;color:var(--mut);margin-top:8px">Netlify é <b>plano fixo (US$ 19/mês)</b>: o valor por setor é <i>rateio de footprint</i> (showback por site ativo), não custo marginal. Claude é o único custo que cresce com uso.</div>
    </div>`;
    // ---- cards por setor (ordenados por custo) ----
    html+=`<div style="margin:16px 4px 8px;font-size:12px;color:var(--mut);text-transform:uppercase;letter-spacing:.6px">Centros de custo · Showback <span style="text-transform:none;letter-spacing:0">(alocação por setor, ordenado por custo)</span></div>`;
    (C.setores||[]).forEach(s=>{
      const scol=SCOL[s.status]||'var(--mut)';
      html+=`<div class="card" style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap">
          <h3 style="margin:0">${s.emoji||''} ${esc(s.nome)} <span style="font-size:10px;font-weight:700;color:${scol};border:1px solid ${scol};border-radius:4px;padding:1px 6px;margin-left:4px">${esc(s.status)}</span></h3>
          <div style="text-align:right"><div class="acmp-v" style="font-size:20px">${R(s.mes_brl)}</div><div class="acmp-s">${U(s.mes_usd)} · <b style="color:var(--txt)">${s.pct_mes}%</b> do total</div></div>
        </div>
        ${s.nota?`<div style="color:var(--mut);font-size:12px;margin-top:4px">${esc(s.nota)}</div>`:''}`;
      // fontes do setor
      if(Array.isArray(s.fontes)&&s.fontes.length){
        html+=`<table style="width:100%;margin-top:10px;font-size:12.5px;border-collapse:collapse">
          <tr style="color:var(--mut);text-align:left"><th style="padding:5px 4px">Fonte</th><th>Base</th><th style="text-align:right">Mês</th><th style="padding-left:12px">Detalhe</th></tr>
          ${s.fontes.map(f=>`<tr style="border-top:1px solid var(--line)">
            <td style="padding:5px 4px"><b>${esc(f.tipo)}</b></td>
            <td>${bdg(f.base)}</td>
            <td style="text-align:right"><b>${R(f.mes_brl)}</b></td>
            <td style="padding-left:12px;color:var(--mut)">${esc(f.obs||'')}${Array.isArray(f.sites)&&f.sites.length?`<div style="font-size:11px;margin-top:2px">${f.sites.map(x=>esc(x)).join(' · ')}</div>`:''}</td>
          </tr>`).join('')}
        </table>`;
      }
      // detalhe por mesa (Claude medido)
      if(Array.isArray(s.por_mesa)&&s.por_mesa.length){
        html+=`<table style="width:100%;margin-top:10px;font-size:12.5px;border-collapse:collapse">
          <tr style="color:var(--mut);text-align:left"><th style="padding:5px 4px">Agente</th><th>Chamadas IA (dia ${esc(dref)})</th><th style="text-align:right">Custo do dia</th><th style="text-align:right">No mês</th></tr>
          ${s.por_mesa.map(m=>`<tr style="border-top:1px solid var(--line)"><td style="padding:5px 4px"><b>${esc(m.agente)}</b></td><td>${num(m.chamadas)}</td><td style="text-align:right">${R(m.dia_brl)}</td><td style="text-align:right"><b>${R(m.mes_brl)}</b></td></tr>`).join('')}
        </table>`;
      }
      html+=`</div>`;
    });
    wrap.innerHTML=html; return;
  }
  // ===== estrutura ANTIGA (fallback — até o build novo rodar) =====
  if(!C.titulo){ wrap.innerHTML=`<div class="card" style="margin-top:18px;color:var(--mut)">Sem dados de custo.</div>`; return; }
  const p=C.plano||{}; const lst=a=>(a||[]).map(x=>`<li style="margin:6px 0">${esc(x)}</li>`).join('');
  let html=`<div class="card" style="margin-bottom:16px"><h3>💸 ${esc(C.titulo)} <span class="cap">atualizado ${esc(C.atualizado||'')}</span></h3>
    <div style="color:var(--mut);font-size:13px;line-height:1.6">${esc(C.objetivo||'')}</div></div>`;
  html+=`<div class="card" style="margin-bottom:16px"><h3>Onde estava o dinheiro</h3>
    <div style="display:flex;gap:32px;flex-wrap:wrap">${(C.numeros||[]).map(n=>`<div><div class="acmp-l">${esc(n.label)}</div><div class="acmp-v">${esc(n.valor)}</div><div class="acmp-s">${esc(n.sub)}</div></div>`).join('')}</div></div>`;
  const cas=C.cascata||[]; const mx=Math.max(...cas.map(c=>c.usd_max||0),1);
  html+=`<div class="card" style="margin-bottom:16px"><h3>Cascata de economia <span class="cap">custo/mês estimado por etapa — quanto mais baixo, melhor</span></h3>${cas.map((c,i)=>{
    const w=Math.round(100*(c.usd_max||0)/mx); const col=i===0?'var(--red)':(i===cas.length-1?'var(--green)':'var(--amber)');
    return `<div style="margin:11px 0"><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px"><b>${esc(c.etapa)}</b><b style="color:${col}">US$ ${c.usd_min}${c.usd_max!==c.usd_min?'–'+c.usd_max:''}/mês</b></div>
      <div style="height:22px;background:rgba(255,255,255,.07);border-radius:7px;overflow:hidden"><div style="width:${w}%;height:100%;background:${col};transition:width .4s"></div></div>
      <div style="color:var(--mut);font-size:11.5px;margin-top:4px">${esc(c.desc)}</div></div>`;
  }).join('')}</div>`;
  html+=`<div class="card" style="margin-bottom:16px"><h3>Plano & economia da conta</h3><div style="font-size:13px;line-height:1.8">
    <b>${esc(p.nome||'')}</b> · ${num(p.creditos_inclusos)} créditos inclusos (≈ US$ ${Math.round((p.creditos_inclusos||0)*(p.valor_credito_usd||0))}) · base ~US$ ${p.base_mes_usd}/mês · ${p.apps} apps na conta<br>
    1 crédito = US$ ${p.valor_credito_usd} · recarga = ${esc(p.recarga||'')}</div></div>`;
  html+=`<div class="card" style="margin-bottom:16px"><h3>🔎 Achados</h3><ul style="margin:0;padding-left:20px;font-size:13px;line-height:1.6">${lst(C.achados)}</ul></div>`;
  html+=`<div class="alert-card warn" style="margin-bottom:16px"><div class="ai">🎯</div><div><div class="at">Conclusão</div><div class="ax">${esc(C.conclusao||'')}</div></div></div>`;
  html+=`<div class="card" style="margin-bottom:16px"><h3>👀 O que vigiar / próximos passos</h3><ul style="margin:0;padding-left:20px;font-size:13px;line-height:1.6">${lst(C.vigiar)}</ul></div>`;
  html+=`<div class="card"><div style="color:var(--mut);font-size:11px">Fonte: ${esc(C.fonte||'')}</div></div>`;
  wrap.innerHTML=html;
}
function drawEstudoChart(){
  const D=window.__D; if(!D||!D.estudo) return; const cv=document.getElementById('estChart'); if(!cv||typeof Chart==='undefined') return;
  if(_estChart) _estChart.destroy();
  const s=D.estudo.petcarioca_mensal||[]; const cur=(D.estudo.decomp||{}).cur_ym;
  _estChart=new Chart(cv,{type:'bar',data:{labels:s.map(x=>ymLabel(x.ym)),datasets:[{label:'Exames Pet Carioca',data:s.map(x=>x.ex),backgroundColor:s.map(x=>x.ym===cur?'#FFB020':'#00D4FF')}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>' '+num(c.raw)+' exames'}}},
      scales:{x:{ticks:{color:'#7f90a8',maxRotation:90,minRotation:90,font:{size:9}},grid:{display:false}},y:{ticks:{color:'#7f90a8',callback:v=>num(v)},grid:{color:'rgba(255,255,255,.05)'}}}}});
}

/* ===================== ABA CUSTOS (Financeiro de Saída · cifrado à parte) ===================== */
async function decryptEncObj(env, pwd){
  const bk=await crypto.subtle.importKey('raw', new TextEncoder().encode(pwd), 'PBKDF2', false, ['deriveKey']);
  const key=await crypto.subtle.deriveKey({name:'PBKDF2', salt:b64dec(env.salt), iterations:env.iter, hash:'SHA-256'}, bk, {name:'AES-GCM', length:256}, false, ['decrypt']);
  const plain=await crypto.subtle.decrypt({name:'AES-GCM', iv:b64dec(env.iv)}, key, b64dec(env.ct));
  return JSON.parse(new TextDecoder().decode(plain));
}
let _custosSel=null, _custosConf=true;
async function renderCustosFin(){
  const wrap=document.getElementById('financeiro'); if(!wrap) return; const D=window.__D;
  if(!D.custosFin){
    wrap.innerHTML='<div class="card" style="margin-top:16px;color:var(--mut)">Carregando custos (cifrado)…</div>';
    try{ const env=await fetchEncF('custos','data/custos.enc'); D.custosFin=await decryptEncObj(env, window.__PW||''); }
    catch(e){ wrap.innerHTML='<div class="card" style="margin-top:16px;color:var(--red)">Falha ao carregar custos: '+esc(e.message||e)+'</div>'; return; }
  }
  drawCustos(D);
}
function _custVal(D,emp,m){ const d=((D.custosFin.dados||{})[emp]||{})[m]; if(!d) return 0; return _custosConf? d.total : (d.operacional||0); }
// Imposto trimestral (Lucro Presumido: IRPJ+CSLL) — Alpha 2 e Cabo Frio apuram no fim do trimestre (Mar/Jun/Set/Dez).
function _trimQ(m){ const mm=(m||'').slice(5,7); return mm==='03'||mm==='06'||mm==='09'||mm==='12'; }
function drawCustos(D){
  const wrap=document.getElementById('financeiro'); const C=D.custosFin; if(!wrap||!C) return;
  const emps=C.empresas||[]; if(!_custosSel) _custosSel=new Set(emps);
  wrap.innerHTML=`<div id="estudoCustosBox" style="margin-bottom:16px"></div><div class="card" style="margin-bottom:16px"><h3>💼 Custos por empresa · mês <span class="cap">com provisão · ambiente fechado (você + Fúlvio) · snapshot ${esc(C.gerado||'')}</span></h3>
    <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
      <span style="color:var(--mut);font-size:12px">somar empresas:</span>
      ${emps.map(e=>`<label style="cursor:pointer;font-weight:600"><input type="checkbox" class="cust-emp" value="${esc(e)}" ${_custosSel.has(e)?'checked':''}> ${esc(e)}</label>`).join('')}
      <label style="cursor:pointer;margin-left:auto;font-size:13px"><input type="checkbox" id="cust-conf" ${_custosConf?'checked':''}> incluir camada confidencial (impostos/retiradas)</label>
    </div>
    <div style="color:var(--mut);font-size:11px;margin-bottom:8px">${esc(C.obs||'')}</div>
    <div id="custTable"></div></div>`;
  wrap.querySelectorAll('.cust-emp').forEach(cb=>cb.addEventListener('change',()=>{ cb.checked?_custosSel.add(cb.value):_custosSel.delete(cb.value); drawCustTable(D); }));
  const cf=wrap.querySelector('#cust-conf'); if(cf) cf.addEventListener('change',()=>{ _custosConf=cf.checked; drawCustTable(D); });
  drawCustTable(D);
  renderEstudoCustos();
}
function drawCustTable(D){
  const el=document.getElementById('custTable'); if(!el) return; const C=D.custosFin; const emps=C.empresas||[];
  const prod={}; (D.mensal||[]).forEach(x=>prod[x.ym]=(x.fat||0)+(x.petlove||0));
  const meses=(C.meses||[]).slice().reverse(); const sel=emps.filter(e=>_custosSel.has(e));
  const rows=meses.map(m=>{
    const soma=sel.reduce((a,e)=>a+_custVal(D,e,m),0);
    const priv=sel.reduce((a,e)=>a+(((C.dados[e]||{})[m]||{}).sigiloso||0),0);
    const pr=prod[m]||0, marg=pr-soma, mp=pr?100*marg/pr:null;
    return `<tr><td>${ymLabel(m)}${_trimQ(m)?` <span title="Imposto trimestral (Lucro Presumido): IRPJ + CSLL apurados no fim do trimestre — Alpha 2 e Cabo Frio. Recolhimento no mês seguinte." style="display:inline-block;font-size:9px;font-weight:800;letter-spacing:.4px;color:var(--amber);border:1px solid var(--amber);border-radius:4px;padding:1px 4px;margin-left:5px;vertical-align:middle">◆ TRIM.</span>`:''}</td>
      ${emps.map(e=>`<td class="num" style="${_custosSel.has(e)?'':'opacity:.35'}">${brl(_custVal(D,e,m))}</td>`).join('')}
      <td class="num" style="font-weight:800;color:var(--amber)">${brl(soma)}</td>
      <td class="num" style="color:var(--mut)">${_custosConf?brl(priv):'—'}</td>
      <td class="num" style="color:var(--cyan)">${pr?brl(pr):'—'}</td>
      <td class="num" style="font-weight:700;color:${marg>=0?AZUL2:'var(--red)'}">${pr?brl(marg):'—'}</td>
      <td class="num" style="color:${mp==null?'var(--mut)':(mp>=0?AZUL2:'var(--red)')};font-weight:700">${mp==null?'—':mp.toFixed(0)+'%'}</td></tr>`;
  }).join('');
  el.innerHTML=`<div style="overflow-x:auto"><table class="atab"><thead><tr><th>Mês</th>${emps.map(e=>`<th class="num">${esc(e)}</th>`).join('')}<th class="num">SOMA custos</th><th class="num">(confid.)</th><th class="num">Produção lab</th><th class="num">Margem</th><th class="num">%</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div style="color:var(--mut);font-size:11px;margin-top:8px">SOMA = empresas marcadas${_custosConf?' (inclui confidencial: impostos/retiradas)':' (só operacional)'}. Produção lab = sistema+Pet Love (todo o lab). <b>Margem = Produção − Custos</b> (aprox.: produção é do lab Matriz; custos das empresas marcadas).</div>
    <div style="color:var(--mut);font-size:11px;margin-top:4px"><span style="color:var(--amber);font-weight:800">◆ TRIM.</span> = fim de trimestre com <b>imposto trimestral</b> (IRPJ + CSLL, Lucro Presumido) de <b>Alpha 2 + Cabo Frio</b> — apurado em Mar/Jun/Set/Dez, recolhido no mês seguinte. Peso extra de caixa nesses meses.</div>`;
}

/* ===================== ABA 🔐 SÓCIOS (cofre cifrado · 2ª senha · editável) =====================
   BLINDAGEM: conteúdo cifrado com uma 2ª senha (só Wal+Fúlvio). Nunca Supabase, nunca texto puro.
   Ler = 2ª senha; Salvar = recifra no browser + POST /api/enc?f=socios (x-pwd = senha do painel). */
let _socD=null, _socPW=null, _socMsg='', _socDirty=false;
async function encryptEncObj(obj, pwd){
  const te=new TextEncoder();
  const salt=crypto.getRandomValues(new Uint8Array(16)), iv=crypto.getRandomValues(new Uint8Array(12));
  const bk=await crypto.subtle.importKey('raw', te.encode(pwd),'PBKDF2',false,['deriveKey']);
  const key=await crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:250000,hash:'SHA-256'}, bk, {name:'AES-GCM',length:256}, false, ['encrypt']);
  const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv}, key, te.encode(JSON.stringify(obj)));
  const b64=b=>btoa(String.fromCharCode.apply(null,new Uint8Array(b)));
  return {v:1,kdf:'PBKDF2-SHA256',iter:250000,salt:b64(salt),iv:b64(iv),ct:b64(ct)};
}
function _sn(v){return (v==null||v==='')?null:(isNaN(+v)?v:+v);}
function renderSocios(){
  const wrap=document.getElementById('socios'); if(!wrap) return;
  if(_socD){ drawSocios(); return; }
  wrap.innerHTML=`<div class="card" style="max-width:460px;margin:34px auto;text-align:center">
    <div style="font-size:32px;margin-bottom:4px">🔐</div>
    <h3 style="justify-content:center">Cofre dos Sócios</h3>
    <div style="color:var(--mut);font-size:13px;margin:6px 0 16px">Camada extra de sigilo — só você e o Fúlvio. Digite a 2ª senha do cofre.</div>
    <input id="soc-pw" type="password" autocomplete="off" placeholder="2ª senha do cofre" style="width:100%;padding:12px;border-radius:10px;border:1px solid var(--line);background:#0E1E36;color:#E8EEF6;font-size:15px;margin-bottom:10px">
    <button id="soc-enter" class="toolbtn" style="width:100%;padding:12px;font-weight:700">Abrir cofre 🔓</button>
    <div id="soc-err" style="color:var(--red);font-size:12px;margin-top:10px;min-height:16px">${esc(_socMsg)}</div></div>`;
  const go=async()=>{
    const el=document.getElementById('soc-pw'), err=document.getElementById('soc-err'); const pw=el.value;
    if(!pw){err.textContent='Digite a senha.';return;}
    err.textContent='Abrindo…';
    try{
      const r=await fetch('/api/enc?f=socios&_='+Date.now());
      if(!r.ok) throw new Error('cofre vazio');
      const env=await r.json();
      _socD=await decryptEncObj(env, pw); _socPW=pw; _socMsg=''; _socDirty=false; drawSocios();
    }catch(e){ err.textContent='Senha incorreta ou cofre indisponível.'; }
  };
  document.getElementById('soc-enter').onclick=go;
  document.getElementById('soc-pw').addEventListener('keydown',e=>{if(e.key==='Enter')go();});
}
function _socRet(m){ // retirada total do sócio no mês
  return {wal:(+m.sal_wal||0)+(+m.pl_wal||0), ful:(+m.sal_ful||0)+(+m.pl_ful||0)};
}
function drawSocios(){
  const wrap=document.getElementById('socios'); const D=_socD; if(!wrap||!D) return;
  const M=D.meses||[];
  const order=M.map((m,i)=>i).sort((a,b)=>(M[b].ym||'').localeCompare(M[a].ym||''));
  // agregados do ano corrente (2026)
  const yr=(M.map(m=>(m.ym||'').slice(0,4)).sort().pop())||'2026';
  let ytdW=0,ytdF=0; M.forEach(m=>{ if((m.ym||'').slice(0,4)===yr){const r=_socRet(m); ytdW+=r.wal; ytdF+=r.ful;} });
  const inp=(i,f,val,col)=>`<input class="soc-in" data-i="${i}" data-f="${f}" value="${val==null?'':val}" inputmode="decimal" autocomplete="off" style="width:88px;text-align:right;padding:5px 6px;border-radius:6px;border:1px solid var(--line);background:#0E1E36;color:${col||'#E8EEF6'};font-size:12px">`;
  const rows=order.map(i=>{const m=M[i];
    return `<tr><td style="font-weight:700;white-space:nowrap">${ymLabel(m.ym)}</td>
      <td class="num">${inp(i,'receita',m.receita)}</td>
      <td class="num">${inp(i,'sal_wal',m.sal_wal,'#4D9DFF')}</td>
      <td class="num">${inp(i,'pl_wal',m.pl_wal,'#4D9DFF')}</td>
      <td class="num">${inp(i,'sal_ful',m.sal_ful,'#00E5A0')}</td>
      <td class="num">${inp(i,'pl_ful',m.pl_ful,'#00E5A0')}</td>
      <td class="num">${inp(i,'total',m.total)}</td>
      <td><button class="soc-it toolbtn" data-i="${i}" style="padding:4px 9px;font-size:11px">itens ${(m.itens||[]).length}</button></td></tr>`;
  }).join('');
  wrap.innerHTML=`<div class="card" style="margin-bottom:16px">
    <h3>🔐 Cofre dos Sócios · retiradas Wal + Fúlvio <span class="cap">SIGILOSO · só você + Fúlvio · snapshot ${esc(D.gerado||'')}</span></h3>
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px">
      <div class="b" style="background:rgba(77,157,255,.10);border:1px solid rgba(77,157,255,.35);border-radius:10px;padding:9px 14px">
        <div style="font-size:11px;color:var(--mut)">Retiradas Wal · ${yr}</div><div style="font-size:19px;font-weight:800;color:#4D9DFF">${brl(ytdW)}</div></div>
      <div class="b" style="background:rgba(0,229,160,.10);border:1px solid rgba(0,229,160,.35);border-radius:10px;padding:9px 14px">
        <div style="font-size:11px;color:var(--mut)">Retiradas Fúlvio · ${yr}</div><div style="font-size:19px;font-weight:800;color:#00E5A0">${brl(ytdF)}</div></div>
      <div class="b" style="background:rgba(255,176,32,.08);border:1px solid rgba(255,176,32,.3);border-radius:10px;padding:9px 14px">
        <div style="font-size:11px;color:var(--mut)">Meses no cofre</div><div style="font-size:19px;font-weight:800;color:var(--amber)">${M.length}</div></div>
      <div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <button id="soc-save" class="toolbtn" style="padding:9px 16px;font-weight:700;background:linear-gradient(135deg,#00D4FF,#00E5A0);color:#04121f">💾 Salvar</button>
        <button id="soc-report" class="toolbtn" style="padding:9px 14px">📄 Relatório contábil</button>
        <button id="soc-add" class="toolbtn" style="padding:9px 14px">➕ Mês</button>
        <button id="soc-pw2" class="toolbtn" style="padding:9px 14px">🔑 Trocar senha</button>
      </div>
    </div>
    <div id="soc-status" style="font-size:12px;min-height:16px;margin-bottom:6px;color:${_socDirty?'var(--amber)':'var(--mut)'}">${_socDirty?'● alterações não salvas':'✓ tudo salvo'}</div>
    <div style="overflow-x:auto"><table class="atab"><thead><tr>
      <th>Mês</th><th class="num">Receita</th>
      <th class="num" style="color:#4D9DFF">Salário Wal</th><th class="num" style="color:#4D9DFF">Pró-labore Wal</th>
      <th class="num" style="color:#00E5A0">Salário Fúlvio</th><th class="num" style="color:#00E5A0">Pró-labore Fúlvio</th>
      <th class="num">Total mês</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    <div style="color:var(--mut);font-size:11px;margin-top:8px">Edite qualquer valor e clique 💾 Salvar (recifra no seu navegador e grava só no cofre — jamais em texto puro). Azul = Wal · Verde = Fúlvio. "itens" abre o detalhe de lançamentos do mês.</div>
  </div>`;
  // wiring
  wrap.querySelectorAll('.soc-in').forEach(el=>el.addEventListener('input',()=>{
    const i=+el.dataset.i, f=el.dataset.f; _socD.meses[i][f]=_sn(el.value); _socDirty=true;
    const st=document.getElementById('soc-status'); if(st){st.textContent='● alterações não salvas';st.style.color='var(--amber)';}
  }));
  wrap.querySelector('#soc-save').onclick=socSave;
  wrap.querySelector('#soc-report').onclick=socReport;
  wrap.querySelector('#soc-add').onclick=socAddMonth;
  wrap.querySelector('#soc-pw2').onclick=socChangePw;
  wrap.querySelectorAll('.soc-it').forEach(b=>b.onclick=()=>socItens(+b.dataset.i));
}
async function socSave(){
  const st=document.getElementById('soc-status'); if(st){st.textContent='Salvando (cifrando)…';st.style.color='var(--cyan)';}
  try{
    const env=await encryptEncObj(_socD, _socPW);
    const r=await fetch('/api/enc?f=socios',{method:'POST',headers:{'Content-Type':'application/json','x-pwd':(window.__PW||'')},body:JSON.stringify(env)});
    if(!r.ok) throw new Error('POST '+r.status);
    _socDirty=false; if(st){st.textContent='✓ salvo no cofre '+new Date().toLocaleTimeString('pt-BR');st.style.color='var(--green)';}
  }catch(e){ if(st){st.textContent='✗ falhou ao salvar: '+(e.message||e);st.style.color='var(--red)';} }
}
function socAddMonth(){
  const ym=prompt('Novo mês (AAAA-MM):',''); if(!ym||!/^\d{4}-\d{2}$/.test(ym))return;
  if(_socD.meses.some(m=>m.ym===ym)){alert('Esse mês já existe no cofre.');return;}
  _socD.meses.push({ym,receita:null,sal_wal:null,pl_wal:null,sal_ful:null,pl_ful:null,total:null,obs:'',itens:[]});
  _socDirty=true; drawSocios();
}
async function socChangePw(){
  const p1=prompt('Nova 2ª senha do cofre (mín. 6):',''); if(!p1)return;
  if(p1.length<6){alert('Muito curta.');return;}
  if(prompt('Confirme a nova senha:','')!==p1){alert('Não conferem.');return;}
  const st=document.getElementById('soc-status');
  try{ const env=await encryptEncObj(_socD, p1);
    const r=await fetch('/api/enc?f=socios',{method:'POST',headers:{'Content-Type':'application/json','x-pwd':(window.__PW||'')},body:JSON.stringify(env)});
    if(!r.ok) throw new Error('POST '+r.status);
    _socPW=p1; _socDirty=false; if(st){st.textContent='✓ senha do cofre trocada e salva';st.style.color='var(--green)';}
    alert('Senha do cofre trocada. Guarde bem — sem ela ninguém (nem eu) lê o cofre.');
  }catch(e){ alert('Falhou: '+(e.message||e)); }
}
function socItens(i){
  const m=_socD.meses[i]; const its=m.itens||(m.itens=[]);
  const modal=document.createElement('div');
  modal.style.cssText='position:fixed;inset:0;background:rgba(4,10,22,.8);z-index:9999;display:flex;align-items:center;justify-content:center;padding:18px';
  const row=(it,j)=>`<tr>
    <td><input class="it-d" data-j="${j}" value="${escA(it.d||'')}" style="width:260px;padding:4px 6px;border-radius:6px;border:1px solid var(--line);background:#0E1E36;color:#E8EEF6;font-size:12px"></td>
    <td><input class="it-v" data-j="${j}" value="${it.v==null?'':it.v}" inputmode="decimal" style="width:100px;text-align:right;padding:4px 6px;border-radius:6px;border:1px solid var(--line);background:#0E1E36;color:#E8EEF6;font-size:12px"></td>
    <td><input class="it-dt" data-j="${j}" value="${escA(it.dt||'')}" placeholder="AAAA-MM-DD" style="width:110px;padding:4px 6px;border-radius:6px;border:1px solid var(--line);background:#0E1E36;color:#E8EEF6;font-size:12px"></td>
    <td><button class="it-del" data-j="${j}" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:15px">✕</button></td></tr>`;
  modal.innerHTML=`<div class="card" style="max-width:640px;width:100%;max-height:82vh;display:flex;flex-direction:column">
    <h3>🗒 Lançamentos · ${ymLabel(m.ym)} <button id="it-close" style="margin-left:auto;background:none;border:none;color:var(--mut);cursor:pointer;font-size:18px">✕</button></h3>
    <div style="overflow:auto;flex:1"><table class="atab"><thead><tr><th>Descrição</th><th class="num">Valor</th><th>Data</th><th></th></tr></thead><tbody id="it-body">${its.map(row).join('')||'<tr><td colspan="4" style="color:var(--mut);padding:12px">Sem lançamentos.</td></tr>'}</tbody></table></div>
    <div style="display:flex;gap:8px;margin-top:10px"><button id="it-add" class="toolbtn" style="padding:7px 12px">➕ Lançamento</button>
      <button id="it-ok" class="toolbtn" style="padding:7px 14px;margin-left:auto;background:linear-gradient(135deg,#00D4FF,#00E5A0);color:#04121f;font-weight:700">Aplicar</button></div></div>`;
  document.body.appendChild(modal);
  const close=()=>modal.remove();
  modal.querySelector('#it-close').onclick=close;
  modal.addEventListener('click',e=>{if(e.target===modal)close();});
  modal.querySelectorAll('.it-del').forEach(b=>b.onclick=()=>{its.splice(+b.dataset.j,1);_socDirty=true;close();socItens(i);});
  modal.querySelector('#it-add').onclick=()=>{its.push({d:'',v:null,dt:''});_socDirty=true;close();socItens(i);};
  modal.querySelector('#it-ok').onclick=()=>{
    modal.querySelectorAll('.it-d').forEach(el=>its[+el.dataset.j].d=el.value);
    modal.querySelectorAll('.it-v').forEach(el=>its[+el.dataset.j].v=_sn(el.value));
    modal.querySelectorAll('.it-dt').forEach(el=>its[+el.dataset.j].dt=el.value||null);
    _socDirty=true; const st=document.getElementById('soc-status'); if(st){st.textContent='● alterações não salvas';st.style.color='var(--amber)';}
    close(); drawSocios();
  };
}
function socReport(){
  const M=(_socD.meses||[]).slice().sort((a,b)=>(a.ym||'').localeCompare(b.ym||''));
  const yr=(M.map(m=>(m.ym||'').slice(0,4)).sort().pop())||'2026';
  const rows=M.filter(m=>(m.ym||'').slice(0,4)===yr).map(m=>`<tr>
    <td>${ymLabel(m.ym)}</td>
    <td class="r">${_rbrl(m.pl_wal)}</td><td class="r">${_rbrl(m.pl_ful)}</td>
    <td class="r">${_rbrl(m.sal_wal)}</td><td class="r">${_rbrl(m.sal_ful)}</td></tr>`).join('');
  const sum=f=>M.filter(m=>(m.ym||'').slice(0,4)===yr).reduce((a,m)=>a+(+m[f]||0),0);
  const html=`<!doctype html><html><head><meta charset="utf-8"><title>Relatório Sócios ${yr}</title>
  <style>body{font-family:-apple-system,Segoe UI,Arial,sans-serif;color:#111;padding:26px;max-width:760px;margin:auto}
  h1{font-size:18px;margin:0 0 2px}h2{font-size:12px;font-weight:400;color:#666;margin:0 0 18px}
  table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #ccc;padding:6px 9px}
  th{background:#f2f4f7;text-align:left}.r{text-align:right}tfoot td{font-weight:700;background:#fafafa}
  .note{font-size:11px;color:#777;margin-top:14px}@media print{button{display:none}}</style></head><body>
  <h1>Pró-labore e retiradas dos sócios — ${yr}</h1>
  <h2>Sócios: Waldemir e Fúlvio · valores por mês · documento interno para a contabilidade</h2>
  <table><thead><tr><th>Mês</th><th class="r">Pró-labore Wal</th><th class="r">Pró-labore Fúlvio</th><th class="r">Salário/Distrib. Wal</th><th class="r">Salário/Distrib. Fúlvio</th></tr></thead>
  <tbody>${rows}</tbody>
  <tfoot><tr><td>Total ${yr}</td><td class="r">${_rbrl(sum('pl_wal'))}</td><td class="r">${_rbrl(sum('pl_ful'))}</td><td class="r">${_rbrl(sum('sal_wal'))}</td><td class="r">${_rbrl(sum('sal_ful'))}</td></tr></tfoot></table>
  <p class="note">Gerado do Cofre dos Sócios em ${new Date().toLocaleDateString('pt-BR')}. Pró-labore e salário/distribuições lançados separadamente. Confidencial.</p>
  <button onclick="window.print()" style="margin-top:16px;padding:9px 16px;font-size:14px;cursor:pointer">🖨 Imprimir / Salvar PDF</button>
  </body></html>`;
  const w=window.open('','_blank'); if(!w){alert('Permita pop-up para abrir o relatório.');return;}
  w.document.write(html); w.document.close();
}
function _rbrl(v){return (v==null||v==='')?'—':(+v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});}

/* ===================== ABA ANÁLISES (janelas 5/10/15/20 dias + mês a mês) ===================== */
let _AD=null, selWin='5', _achart=null, _dayMap=null, _manMetric='q', _manChart=null;
const AZUL2='#4D9DFF';
const INP='background:#0E1E36;border:1px solid var(--line);color:#E8EEF6;border-radius:8px;padding:7px 9px;font-size:13px';
function gcol(v){return v==null?'var(--mut)':(v>=0?AZUL2:'var(--red)');}
function gtxt(v){return v==null?'—':(v>0?'▲ +':v<0?'▼ ':'')+v+'%';}
// helpers de data (string YYYY-MM-DD)
function _d1(s){return new Date(s+'T00:00:00');}
function _fmt(dt){return dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0')+'-'+String(dt.getDate()).padStart(2,'0');}
function _addD(s,n){const d=_d1(s);d.setDate(d.getDate()+n);return _fmt(d);}
function _addY(s,n){const d=_d1(s);d.setFullYear(d.getFullYear()+n);return _fmt(d);}
function _ndays(a,b){return Math.round((_d1(b)-_d1(a))/864e5)+1;}
function _dmy(s){const[y,m,d]=s.split('-');return d+'/'+m+'/'+y.slice(2);}
function _daysInMonth(ym){const[y,m]=ym.split('-').map(Number);return new Date(y,m,0).getDate();}
function _prevYmS(ym){let[y,m]=ym.split('-').map(Number);m--;if(m<1){m=12;y--;}return y+'-'+String(m).padStart(2,'0');}
function renderAnalises(D){
  _AD=D; const wrap=document.getElementById('analises'); if(!wrap) return;
  const wins=[['5','5 dias'],['10','10 dias'],['15','15 dias'],['20','20 dias'],['mes','Mês a mês']];
  _dayMap={}; (D.serie_diaria||[]).forEach(x=>_dayMap[x.d]={q:x.q,f:x.f});
  const days=(D.serie_diaria||[]).map(x=>x.d); const dMin=days[0]||'2023-01-01', dMax=days[days.length-1]||'';
  const dDe=dMax?dMax.slice(0,7)+'-01':dMin;  // default = mês corrente até a data (mostra a comparação com meses anteriores)
  wrap.innerHTML=`
    <div class="card" style="margin-bottom:16px"><h3>Faturamento total e produção desde 2014 <span class="cap">${(D.serie_mensal_full||[]).length} meses · área = faturamento (sistema + Pet Love) · linha = exames (eixo dir.)</span></h3>
      <div class="chartbox lg"><canvas id="anHist"></canvas></div></div>
    <div class="card" style="margin-bottom:16px"><h3>📅 Período manual · produção por dia <span class="cap">escolha as datas (ou um atalho) e veja produção e faturamento do intervalo, comparado</span></h3>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:4px">
        <div><div class="acmp-l">De</div><input type="date" id="anDe" min="${dMin}" max="${dMax}" value="${dDe}" style="${INP}"></div>
        <div><div class="acmp-l">Até</div><input type="date" id="anAte" min="${dMin}" max="${dMax}" value="${dMax}" style="${INP}"></div>
        <button class="wbtn on" id="anApply" style="padding:8px 16px">Analisar</button>
        <span style="color:var(--mut);font-size:12px;align-self:center">atalhos:</span>
        <button class="wbtn" data-preset="7">7 dias</button>
        <button class="wbtn" data-preset="30">30 dias</button>
        <button class="wbtn" data-preset="90">90 dias</button>
        <button class="wbtn" data-preset="mes">Este mês</button>
        <button class="wbtn" data-preset="mesant">Mês passado</button>
        <button class="wbtn" data-preset="ano">Este ano</button>
      </div>
      <div style="color:var(--mut);font-size:11px;margin-bottom:10px">Dados diários desde ${dMin?_dmy(dMin):'—'} (sistema HF, sem Pet Love).</div>
      <div id="anManualOut"></div>
    </div>
    ${mesesRecentes(D,(dMax||'2026').slice(0,4)+'-01')}
    <div class="wsel">${wins.map(([k,l])=>`<button class="wbtn ${k===selWin?'on':''}" data-w="${k}">${l}</button>`).join('')}</div>
    <div id="anTable"></div>`;
  wrap.querySelectorAll('.wbtn[data-w]').forEach(b=>b.addEventListener('click',()=>{
    selWin=b.dataset.w; wrap.querySelectorAll('.wbtn[data-w]').forEach(o=>o.classList.toggle('on',o===b)); renderAnTable();}));
  const setRange=(de,ate)=>{document.getElementById('anDe').value=de; document.getElementById('anAte').value=ate; renderManual();};
  wrap.querySelector('#anApply').addEventListener('click',renderManual);
  wrap.querySelectorAll('.wbtn[data-preset]').forEach(b=>b.addEventListener('click',()=>{
    const p=b.dataset.preset;
    if(p==='mes') setRange(dMax.slice(0,7)+'-01',dMax);
    else if(p==='mesant'){const f=_addD(dMax.slice(0,7)+'-01',-1); setRange(f.slice(0,7)+'-01',f);}
    else if(p==='ano') setRange(dMax.slice(0,4)+'-01-01',dMax);
    else setRange(_addD(dMax,-(+p-1)),dMax);
  }));
  renderAnTable(); renderManual();
}
function mesesRecentes(D,fromYm){
  const s=D.serie_mensal_full||[]; if(!s.length) return '';
  const by={}; s.forEach(x=>by[x.ym]={q:x.qtd,f:x.fat});
  const plm=(D.petlove||{}).mensal||{}, pla=(D.petlove||{}).atend_mensal||{};
  const prevYm=ym=>{let[y,m]=ym.split('-').map(Number);m--;if(m<1){m=12;y--;}return y+'-'+String(m).padStart(2,'0');};
  const yoyYm=ym=>{const[y,m]=ym.split('-');return (+y-1)+'-'+m;};
  const pc=(a,b)=>(b>0)?100*(a/b-1):null;
  const maxd=(D.meta&&D.meta.max_data)||''; const partYm=maxd.slice(0,7);
  const yms=s.map(x=>x.ym).filter(ym=>ym>=fromYm).sort().reverse();
  const rows=yms.map(ym=>{const c=by[ym],p=by[prevYm(ym)],y=by[yoyYm(ym)];const part=ym===partYm;
    const dmq=p?pc(c.q,p.q):null,dmf=p?pc(c.f,p.f):null,dyf=y?pc(c.f,y.f):null;
    const plf=plm[ym]||((pla[ym]||{}).valor)||0, pln=(pla[ym]||{}).n_atend;
    return `<tr${part?' style="opacity:.6"':''}><td>${ymLabel(ym)}${part?' <span style="color:var(--amber);font-size:10px;font-weight:700">parcial</span>':''}</td>
      <td class="num">${num(c.q)}</td><td class="num" style="color:${gcol(dmq==null?null:+dmq.toFixed(1))};font-weight:700">${gtxt(dmq==null?null:+dmq.toFixed(1))}</td>
      <td class="num">${brl(c.f)}</td><td class="num" style="color:${gcol(dmf==null?null:+dmf.toFixed(1))};font-weight:700">${gtxt(dmf==null?null:+dmf.toFixed(1))}</td>
      <td class="num" style="color:${gcol(dyf==null?null:+dyf.toFixed(1))};font-weight:700">${gtxt(dyf==null?null:+dyf.toFixed(1))}</td>
      <td class="num" style="color:var(--cyan)">${plf?brl(plf):'—'}</td><td class="num">${pln?num(pln):'—'}</td>
      <td class="num" style="font-weight:700">${brl(c.f+plf)}</td></tr>`;}).join('');
  return `<div class="card" style="margin-bottom:16px"><h3>📊 Meses desde ${ymLabel(fromYm)} — visão rápida <span class="cap">produção e faturamento por mês (sistema + Pet Love) · variação vs mês anterior e vs mesmo mês do ano passado</span></h3>
    <div style="overflow-x:auto"><table class="atab"><thead><tr><th>Mês</th><th class="num">Exames (sist.)</th><th class="num">vs mês ant.</th><th class="num">Faturam. (sist.)</th><th class="num">vs mês ant.</th><th class="num">fat. vs ano ant.</th><th class="num" style="color:var(--cyan)">Pet Love (R$)</th><th class="num" style="color:var(--cyan)">Pet Love (atend.)</th><th class="num">Total fat.</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div style="color:var(--mut);font-size:11px;margin-top:8px">azul = sobe · vermelho = cai · variações referem-se ao faturamento do sistema. <b>Pet Love (R$)</b> = reembolso externo (entra no Total). <b>Pet Love (atend.)</b> só consta dos meses com relatório importado (2025); 2026 ainda não importado. Exames (sist.) já inclui os exames Pet Love. Mês corrente parcial.</div></div>`;
}
function renderManual(){
  const out=document.getElementById('anManualOut'); if(!out||!_dayMap) return;
  const de=(document.getElementById('anDe')||{}).value, ate=(document.getElementById('anAte')||{}).value;
  if(!de||!ate||de>ate){ out.innerHTML='<div style="color:var(--amber);font-size:13px">Selecione um intervalo válido (De ≤ Até).</div>'; return; }
  const sumR=(d1,d2)=>{let q=0,f=0,n=0; for(const k in _dayMap){ if(k>=d1&&k<=d2){q+=_dayMap[k].q;f+=_dayMap[k].f;n++;} } return {q,f,n};};
  const len=_ndays(de,ate);
  const cur=sumR(de,ate);
  const prevDe=_addD(de,-len), prevAte=_addD(de,-1);    // janela imediatamente anterior, mesmo tamanho
  const yDe=_addY(de,-1), yAte=_addY(ate,-1);           // mesmas datas no ano anterior
  const prev=sumR(prevDe,prevAte);
  const yo=sumR(yDe,yAte);
  const pc=(a,b)=>b>0?100*(a/b-1):null;
  const kpi=(l,v,s)=>`<div><div class="acmp-l">${l}</div><div class="acmp-v">${v}</div><div class="acmp-s">${s}</div></div>`;
  const cmp=(l,a,b)=>{const p=pc(a,b);return `<div><div class="acmp-l">${l}</div><div class="acmp-v" style="color:${gcol(p)}">${gtxt(p==null?null:+p.toFixed(1))}</div><div class="acmp-s">base ${num(b)}</div></div>`;};
  // ---- PROJEÇÃO de fechamento: BASE = curva do PRÓPRIO mês (run-rate), pareada com outros meses ----
  const _maxd=(_AD&&_AD.meta&&_AD.meta.max_data)||ate;
  const ateYm=ate.slice(0,7), PY=+ateYm.slice(0,4), PM=+ateYm.slice(5,7);
  const diM=_daysInMonth(ateYm), isCur=ateYm===_maxd.slice(0,7);
  const Nd=isCur?+_maxd.slice(8,10):diM;
  let mFat=0,mEx=0; for(let d=1;d<=Nd;d++){const v=_dayMap[ateYm+'-'+String(d).padStart(2,'0')]; if(v){mFat+=v.f;mEx+=v.q;}}
  const perDia=Nd?mFat/Nd:0, faltam=diM-Nd;
  const projSys=isCur?Math.round(mFat/Nd*diM):mFat;   // faturamento DIRETO (sistema), curva do próprio mês
  const projEx =isCur?Math.round(mEx/Nd*diM):mEx;
  // Pet Love do mês (externo — sistema zera o ValorExame): soma p/ faturamento TOTAL real
  const _pl=_AD.petlove||{};
  const plOf=ym=>(_pl.mensal&&_pl.mensal[ym])|| (_pl.proj_atual&&_pl.proj_atual.ym===ym&&_pl.proj_atual.proj_repasse)|| ((_pl.atend_mensal&&_pl.atend_mensal[ym]&&_pl.atend_mensal[ym].valor)||0);
  const plMonth=plOf(ateYm);
  const projTot=projSys+plMonth;
  const projbox=`<div class="projbox">
    <div class="projttl">◆ PROJEÇÃO ESTIMADA</div>
    <div class="projsub">${isCur?`fechamento de ${MESFULL[PM]}/${String(PY).slice(2)} · curva do mês (dia ${Nd}/${diM})`:`${MESFULL[PM]}/${String(PY).slice(2)} · mês fechado`}</div>
    <div class="projrow"><span style="color:var(--mut)">Faturamento</span><b>${brl(projTot)}</b></div>
    <div class="projrow"><span style="color:var(--mut)">Produção</span><b>${num(projEx)} ex.</b></div>
    <div class="projfaixa">sistema ${brlk(projSys)} + Pet Love ${brlk(plMonth)}${isCur?` · ritmo ${brlk(perDia)}/dia · faltam ${faltam} dias`:' · realizado'}</div>
  </div>`;
  // pareamento rápido: projeção do mês vs faturamento REAL fechado dos últimos meses + mesmo mês ano passado
  let pareamento='';
  if(isCur){
    const sm=(_AD.serie_mensal_full||[]).slice().sort((a,b)=>a.ym<b.ym?-1:1); const tot={}; sm.forEach(x=>tot[x.ym]=x.fat+plOf(x.ym));
    const hist=sm.filter(x=>x.ym<ateYm).slice(-6).map(x=>({ym:x.ym,v:tot[x.ym],proj:false}));
    const yoyYm=(+PY-1)+'-'+String(PM).padStart(2,'0'); const yoy=tot[yoyYm];
    const bars=hist.concat([{ym:ateYm,v:projTot,proj:true}]);
    const mxb=Math.max(...bars.map(b=>b.v),1);
    const prevC=hist.length?hist[hist.length-1]:null;
    const vsPrev=prevC&&prevC.v?Math.round(100*(projTot/prevC.v-1)):null;
    const vsYoy=yoy?Math.round(100*(projTot/yoy-1)):null;
    pareamento=`<div style="margin:12px 0 4px;border-top:1px solid var(--line);padding-top:12px">
      <div style="font-weight:700;font-size:13px;margin-bottom:8px">📊 Projeção × outros meses <span style="color:var(--mut);font-weight:400;font-size:11px">— onde o fechamento estimado (★) se encaixa · faturamento mensal TOTAL (sistema + Pet Love)</span></div>
      ${bars.map(b=>`<div style="display:flex;align-items:center;gap:10px;margin:4px 0">
        <span style="width:52px;color:${b.proj?'var(--cyan)':'var(--mut)'};font-size:12px;font-weight:${b.proj?800:400}">${ymLabel(b.ym)}${b.proj?' ★':''}</span>
        <div style="flex:1;background:rgba(255,255,255,.05);border-radius:6px;height:18px;overflow:hidden"><div style="height:18px;width:${Math.round(100*b.v/mxb)}%;background:${b.proj?'var(--cyan)':'rgba(120,140,170,.5)'};border-radius:6px"></div></div>
        <span style="width:66px;text-align:right;font-size:12px;font-weight:${b.proj?800:400};color:${b.proj?'#fff':'var(--mut)'}">${brlk(b.v)}</span></div>`).join('')}
      <div style="color:var(--mut);font-size:11px;margin-top:7px">★ projeção do mês · ${vsPrev!=null?`vs ${ymLabel(prevC.ym)}: <b style="color:${gcol(vsPrev)}">${gtxt(vsPrev)}</b>`:''}${vsYoy!=null?` · vs ${ymLabel(yoyYm)} (ano passado): <b style="color:${gcol(vsYoy)}">${gtxt(vsYoy)}</b>`:''}. Meses fechados = faturamento real do sistema.</div>
    </div>`;
  }
  // mesmo trecho de dias nos meses anteriores (desde jan/26) — só faz sentido p/ intervalo dentro de 1 mês
  const sameMonth=de.slice(0,7)===ate.slice(0,7);
  let sliceHtml='';
  if(sameMonth){
    const dd1=+de.slice(8,10), dd2=+ate.slice(8,10), endYm=de.slice(0,7);
    const yStart=endYm.slice(0,4)+'-01';   // até o início do ano vigente da seleção
    const rows=[]; for(let ym=endYm; ym>=yStart; ym=_prevYmS(ym)){
      const last=_daysInMonth(ym);
      const a=ym+'-'+String(Math.min(dd1,last)).padStart(2,'0'), b=ym+'-'+String(Math.min(dd2,last)).padStart(2,'0');
      const s=sumR(a,b); rows.push({ym,q:s.q,f:s.f,sel:ym===endYm});
    }
    const ref=rows[0];
    const body=rows.map(r=>{const sq=(!r.sel&&r.q)?pc(ref.q,r.q):null, sf=(!r.sel&&r.f)?pc(ref.f,r.f):null;
      return `<tr${r.sel?' style="background:rgba(0,212,255,.08)"':''}><td>${ymLabel(r.ym)}${r.sel?' <span style="color:var(--cyan);font-size:10px;font-weight:700">selecionado</span>':''}</td>
        <td class="num">${num(r.q)}</td><td class="num">${brl(r.f)}</td>
        <td class="num" style="color:${gcol(sq==null?null:+sq.toFixed(1))};font-weight:700">${r.sel?'—':gtxt(sq==null?null:+sq.toFixed(1))}</td>
        <td class="num" style="color:${gcol(sf==null?null:+sf.toFixed(1))};font-weight:700">${r.sel?'—':gtxt(sf==null?null:+sf.toFixed(1))}</td></tr>`;}).join('');
    sliceHtml=`<div style="margin-top:14px;border-top:1px solid var(--line);padding-top:12px">
      <div style="font-weight:700;margin-bottom:6px">📆 Mesmo trecho (dias ${dd1}–${dd2}) nos meses anteriores <span style="color:var(--mut);font-weight:400;font-size:12px">— quanto o selecionado está acima/abaixo de cada mês</span></div>
      <table class="atab"><thead><tr><th>Mês (dias ${dd1}–${dd2})</th><th class="num">Exames</th><th class="num">Faturamento</th><th class="num">sel. vs mês (exames)</th><th class="num">sel. vs mês (fat.)</th></tr></thead><tbody>${body}</tbody></table></div>`;
  } else {
    sliceHtml=`<div style="margin-top:12px;color:var(--mut);font-size:12px;border-top:1px solid var(--line);padding-top:10px">💡 Selecione um intervalo <b>dentro de um mesmo mês</b> (ex.: atalho "Este mês") para comparar o mesmo trecho de dias com os meses anteriores. Para meses inteiros, veja o quadro "📊 Meses desde jan/26" abaixo.</div>`;
  }
  out.innerHTML=`
    <div style="display:flex;gap:20px;flex-wrap:wrap;align-items:stretch;margin-bottom:6px">
      <div style="display:flex;gap:26px;flex-wrap:wrap;flex:1;align-items:flex-start">
        ${kpi('Produção (exames)',num(cur.q),de===ate?'no dia':`${len} dias · ${(cur.q/len).toFixed(0)}/dia`)}
        ${kpi('Faturamento (direto)',brl(cur.f),`sem Pet Love · ticket ${cur.q?brl(cur.f/cur.q):'—'}/exame`)}
        ${kpi('Média diária',brl(cur.f/len),`${cur.n} dias com produção`)}
      </div>
      ${projbox}
    </div>
    ${pareamento}
    <div style="display:flex;gap:26px;flex-wrap:wrap;margin:10px 0 6px;border-top:1px solid var(--line);padding-top:12px">
      ${cmp(`vs período anterior (exames)`,cur.q,prev.q)}
      ${cmp(`vs período anterior (fat.)`,cur.f,prev.f)}
      ${cmp(`vs ano anterior (exames)`,cur.q,yo.q)}
      ${cmp(`vs ano anterior (fat.)`,cur.f,yo.f)}
    </div>
    <div style="color:var(--mut);font-size:11px;margin-bottom:4px">período anterior = os ${len} dias imediatamente antes (${_dmy(prevDe)}–${_dmy(prevAte)}) · ano anterior = ${_dmy(yDe)}–${_dmy(yAte)}. Comparação mês a mês (mesmo trecho) logo abaixo.</div>
    ${sliceHtml}
    <div style="display:flex;gap:8px;align-items:center;margin:12px 0 6px">
      <span style="color:var(--mut);font-size:12px">por dia · barras azuis = exames · linha verde = faturamento</span>
      <button class="wbtn" id="anTblToggle" style="margin-left:auto">Ver tabela diária</button>
    </div>
    <div class="chartbox"><canvas id="anDayChart"></canvas></div>
    <div id="anDayTbl" style="display:none;margin-top:12px"></div>`;
  const tg=out.querySelector('#anTblToggle');
  tg.addEventListener('click',()=>{const t=out.querySelector('#anDayTbl'); const show=t.style.display==='none'; t.style.display=show?'':'none'; tg.textContent=show?'Ocultar tabela diária':'Ver tabela diária'; if(show&&!t.dataset.done){t.innerHTML=manTable(de,ate); t.dataset.done='1';}});
  drawDailyChart();
}
function manTable(de,ate){
  const rows=[]; for(let k=ate;k>=de;k=_addD(k,-1)){const v=_dayMap[k]; if(v) rows.push(`<tr><td>${_dmy(k)}</td><td class="num">${num(v.q)}</td><td class="num">${brl(v.f)}</td><td class="num">${v.q?brl(v.f/v.q):'—'}</td></tr>`);}
  return `<table class="atab"><thead><tr><th>Dia</th><th class="num">Exames</th><th class="num">Faturamento</th><th class="num">Ticket</th></tr></thead><tbody>${rows.join('')||'<tr><td colspan=4 style="color:var(--mut)">Sem produção no intervalo.</td></tr>'}</tbody></table>`;
}
function drawDailyChart(){
  const cv=document.getElementById('anDayChart'); if(!cv||typeof Chart==='undefined') return;
  const de=(document.getElementById('anDe')||{}).value, ate=(document.getElementById('anAte')||{}).value;
  if(!de||!ate||de>ate||!_dayMap) return;
  if(_manChart) _manChart.destroy();
  const labels=[],qd=[],fd=[]; for(let k=de;k<=ate;k=_addD(k,1)){labels.push(_dmy(k)); const v=_dayMap[k]; qd.push(v?v.q:0); fd.push(v?v.f:0);}
  _manChart=new Chart(cv,{data:{labels,datasets:[
    {type:'bar',label:'Exames/dia',data:qd,backgroundColor:'#00D4FF',yAxisID:'q'},
    {type:'line',label:'Faturamento/dia',data:fd,borderColor:'#00E5A0',backgroundColor:'#00E5A0',borderWidth:2,tension:.3,pointRadius:1,yAxisID:'f'}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#9fb0c8'}},tooltip:{callbacks:{label:c=>c.dataset.yAxisID==='f'?' Faturamento: '+brl(c.raw):' Exames: '+num(c.raw)}}},
      scales:{x:{ticks:{color:'#7f90a8',maxTicksLimit:16,maxRotation:90,minRotation:0,font:{size:9}},grid:{display:false}},
        q:{position:'left',ticks:{color:'#00D4FF',callback:v=>num(v)},grid:{color:'rgba(255,255,255,.05)'},title:{display:true,text:'exames',color:'#00D4FF'}},
        f:{position:'right',ticks:{color:'#00E5A0',callback:v=>brlk(v)},grid:{display:false},title:{display:true,text:'R$',color:'#00E5A0'}}}}});
}
function renderAnTable(){
  const D=_AD; if(!D) return; const items=(D.analises||{})[selWin]||[];
  const comp=items.find(x=>!x.parcial)||items[0]; const el=document.getElementById('anTable'); if(!el) return;
  let head=`<div class="radar" style="margin-bottom:14px"><h3>📌 Período comparado ${comp?'· '+esc(comp.label):''}</h3>`;
  if(comp){
    head+=`<div style="display:flex;gap:30px;flex-wrap:wrap">
      <div><div class="acmp-l">Faturamento</div><div class="acmp-v">${brl(comp.fat)}</div><div class="acmp-s">${num(comp.qtd)} exames</div></div>
      <div><div class="acmp-l">vs mesmo período do MÊS anterior</div><div class="acmp-v" style="color:${gcol(comp.mom_fat)}">${gtxt(comp.mom_fat)}</div><div class="acmp-s">faturamento</div></div>
      <div><div class="acmp-l">vs mesmo período do ANO anterior</div><div class="acmp-v" style="color:${gcol(comp.yoy_fat)}">${gtxt(comp.yoy_fat)}</div><div class="acmp-s">faturamento · prod. ${gtxt(comp.yoy_qtd)}</div></div></div>`;
  } else head+='<div style="color:var(--mut)">Sem dados.</div>';
  head+=`</div>`;
  const rows=items.map(x=>`<tr ${x.parcial?'style="opacity:.5"':''}>
    <td>${esc(x.label)}${x.parcial?' <span style="color:var(--amber);font-size:10px;font-weight:700">parcial</span>':''}</td>
    <td class="num">${num(x.qtd)}</td><td class="num">${brl(x.fat)}</td>
    <td class="num" style="color:${gcol(x.mom_fat)};font-weight:700">${gtxt(x.mom_fat)}</td>
    <td class="num" style="color:${gcol(x.yoy_fat)};font-weight:700">${gtxt(x.yoy_fat)}</td></tr>`).join('');
  el.innerHTML=head+`<div class="card"><h3>${selWin==='mes'?'Mês a mês':'Blocos de '+selWin+' dias'} <span class="cap">azul = crescimento · vermelho = queda · vs mesma janela · faturamento DIRETO do sistema (Pet Love não entra aqui)</span></h3>
    <table class="atab"><thead><tr><th>Período</th><th class="num">Exames</th><th class="num">Faturamento</th><th class="num">vs mês ant.</th><th class="num">vs ano ant.</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
function drawAnalisesChart(){
  const D=_AD; if(!D) return; const cv=document.getElementById('anHist'); if(!cv||typeof Chart==='undefined') return;
  if(_achart) _achart.destroy();
  const s=D.serie_mensal_full||[];
  const _pl={}; (D.mensal||[]).forEach(x=>_pl[x.ym]=x.petlove||0);   // Pet Love por mês (só 2025+)
  _achart=new Chart(cv,{data:{labels:s.map(x=>x.ym),datasets:[
    {type:'line',label:'Faturamento total (sist.+Pet Love)',data:s.map(x=>x.fat+(_pl[x.ym]||0)),borderColor:'#00D4FF',backgroundColor:'rgba(0,212,255,.10)',fill:true,tension:.3,pointRadius:0,borderWidth:2,yAxisID:'f'},
    {type:'line',label:'Exames',data:s.map(x=>x.qtd),borderColor:'#00E5A0',backgroundColor:'#00E5A0',fill:false,tension:.3,pointRadius:0,borderWidth:1.5,yAxisID:'q'}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#9fb0c8'}},tooltip:{callbacks:{label:c=>c.dataset.yAxisID==='q'?' Exames: '+num(c.raw):' Faturamento total: '+brl(c.raw)}}},
      scales:{x:{ticks:{maxTicksLimit:14,color:'#8aa2bd'},grid:{display:false}},
        f:{position:'left',ticks:{callback:v=>brlk(v),color:'#00D4FF'},grid:{color:'rgba(255,255,255,.05)'}},
        q:{position:'right',ticks:{callback:v=>num(v),color:'#00E5A0'},grid:{display:false}}}}});
}

/* ===================== 🔐 ESTUDO DE CUSTO POR SETOR (topo da aba 💼 Custos) =====================
   Conteúdo cifrado com a 2ª senha do Cofre dos Sócios (Wal + Fúlvio). Publicado SÓ no Blob
   (/api/enc?f=estudo_custos) a partir do Mac do Wal — nunca neste repositório (público).
   A senha do painel NÃO abre. Mostra a data de inclusão em destaque no topo. */
let _estD=null, _estMsg='', _estFull=false, _estPW=null;
async function _estFetch(){ const r=await fetch('/api/enc?f=estudo_custos&_='+Date.now()); if(!r.ok) throw new Error('vazio'); return r.json(); }
async function renderEstudoCustos(){
  const box=document.getElementById('estudoCustosBox'); if(!box) return;
  if(!_estD && _socPW){ try{ _estD=await decryptEncObj(await _estFetch(), _socPW); _estPW=_socPW; }catch(e){} }   // aberto pela aba Sócios: guarda a senha em memória p/ oferecer a digital
  if(_estD){ drawEstudoCustos(); return; }
  let env=null; try{ env=await _estFetch(); }catch(e){ box.innerHTML=''; return; }
  box.innerHTML=`<div class="card" style="border:1px solid rgba(255,106,213,.5)"><h3>🔐 Estudo de custo por setor <span class="cap">cofre · só você + Fúlvio · 2ª senha (a mesma da aba Sócios)</span></h3>
    ${_estBioOn()?'<button id="est-bio" class="toolbtn" style="width:100%;padding:13px;font-weight:800;font-size:15px;margin-bottom:10px">👆 Abrir com a digital</button>':''}
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
      <input id="est-pw" type="password" autocomplete="off" placeholder="2ª senha do cofre" style="flex:1;min-width:220px;padding:11px;border-radius:10px;border:1px solid var(--line);background:#0E1E36;color:#E8EEF6;font-size:14px">
      <button id="est-go" class="toolbtn" style="padding:11px 16px;font-weight:700">Abrir estudo 🔓</button></div>
    <div id="est-err" style="color:var(--red);font-size:12px;margin-top:8px;min-height:14px">${esc(_estMsg)}</div></div>`;
  const go=async()=>{ const pw=document.getElementById('est-pw').value, err=document.getElementById('est-err');
    if(!pw){ err.textContent='Digite a senha.'; return; } err.textContent='Abrindo…';
    try{ _estD=await decryptEncObj(env, pw); _estPW=pw; _estMsg=''; drawEstudoCustos(); }
    catch(e){ err.textContent='Senha incorreta.'; } };
  document.getElementById('est-go').addEventListener('click',go);
  document.getElementById('est-pw').addEventListener('keydown',e=>{ if(e.key==='Enter') go(); });
  const bb=document.getElementById('est-bio');
  if(bb) bb.addEventListener('click',async()=>{ const err=document.getElementById('est-err');
    err.style.color='var(--mut)'; err.textContent='👆 Encoste o dedo no Touch ID — o pedido abre na tela principal do Mac…';
    let pw=null;
    try{ pw=await estBioAbrir(); }catch(e){ err.style.color='var(--red)'; err.textContent='Digital cancelada ou indisponível — use a senha.'; return; }
    try{ _estD=await decryptEncObj(env,pw); _estPW=pw; drawEstudoCustos(); }
    catch(e){ err.style.color='var(--red)'; err.textContent='A digital guardou uma senha antiga (o cofre mudou de senha): digite a 2ª senha e ative a digital de novo.'; }
  });
}
function drawEstudoCustos(){
  const box=document.getElementById('estudoCustosBox'); const E=_estD; if(!box||!E) return;
  box.innerHTML=`<div class="card" style="border:2px solid #38bdf8">
    <div style="display:flex;flex-wrap:wrap;gap:8px 18px;align-items:center;background:linear-gradient(90deg,#0c2a3d,#0f1f2e);border:1px solid #38bdf8;border-radius:10px;padding:12px 16px;margin-bottom:12px">
      <span style="font-size:17px">📅 Estudo incluído em <b style="color:#7dd3fc;font-size:22px">${esc(E.incluido_em_br||E.incluido_em||'')}</b></span>
      <span style="color:var(--mut);font-size:12px">${esc(E.titulo||'')} · ${esc(E.periodo||'')}</span>
      <span style="margin-left:auto"></span>
      ${_estBioOn()?'<span style="font-size:12px;color:var(--green)">✅ digital ativa neste aparelho</span>':(window.PublicKeyCredential?'<button id="est-bioset" class="toolbtn" style="border-color:#38bdf8;font-weight:800">👆 Ativar digital neste aparelho</button>':'<span style="font-size:12px;color:var(--mut)">digital indisponível neste navegador — use o Chrome do Mac</span>')}
      <button id="est-full" class="toolbtn">${_estFull?'Reduzir':'Tela cheia'}</button>
      <button id="est-close" class="toolbtn">Fechar 🔒</button></div>
    <iframe id="est-frame" sandbox="" title="Estudo de custo por setor" style="width:100%;height:${_estFull?'92vh':'72vh'};border:1px solid var(--line);border-radius:10px;background:#0b0f14"></iframe></div>`;
  document.getElementById('est-frame').srcdoc=E.html||'';
  document.getElementById('est-full').addEventListener('click',()=>{ _estFull=!_estFull; drawEstudoCustos(); });
  document.getElementById('est-close').addEventListener('click',()=>{ _estD=null; _estPW=null; _estFull=false; renderEstudoCustos(); });
  const bs=document.getElementById('est-bioset');
  if(bs) bs.addEventListener('click',async()=>{ bs.disabled=true; bs.textContent='👆 Encoste o dedo (tela principal do Mac)…';
    try{ if(!_estPW) throw new Error('feche o estudo e abra de novo digitando a 2ª senha'); await estBioRegistrar(_estPW); bs.textContent='✅ Digital ativada neste aparelho'; }
    catch(e){ bs.disabled=false; bs.textContent='👆 Ativar digital neste aparelho'; alert('Não deu para ativar a digital: '+(e.message||e)); } });
}

/* 👆 DIGITAL DO COFRE (estudo de custos) — mesma técnica do bio.js (WebAuthn PRF), em slot PRÓPRIO
   ('bi:bio:cofre'): não mexe no Touch ID do painel. A 2ª senha fica cifrada por uma chave que só o
   Touch ID deste aparelho libera; nunca em texto puro. */
const _EST_BIO='bi:bio:cofre';
const _eb64e=buf=>btoa(String.fromCharCode(...new Uint8Array(buf))), _eb64d=x=>Uint8Array.from(atob(x),c=>c.charCodeAt(0)), _erand=n=>crypto.getRandomValues(new Uint8Array(n));
function _estBioOn(){ try{ return !!localStorage.getItem(_EST_BIO); }catch(_){ return false; } }
async function _estAes(prf){ return crypto.subtle.importKey('raw', prf, {name:'AES-GCM'}, false, ['encrypt','decrypt']); }
async function estBioRegistrar(pw){
  if(!(window.PublicKeyCredential && navigator.credentials)) throw new Error('este navegador não tem Touch ID (WebAuthn) — use o Chrome do Mac');
  if(!pw) throw new Error('abra o estudo com a 2ª senha antes');
  const salt=_erand(32);
  const cred=await navigator.credentials.create({publicKey:{challenge:_erand(32),rp:{name:'BI Alpha — Cofre',id:location.hostname},
    user:{id:_erand(16),name:'cofre@bi-alpha',displayName:'Cofre (estudo de custos)'},
    pubKeyCredParams:[{type:'public-key',alg:-7},{type:'public-key',alg:-257}],
    authenticatorSelection:{authenticatorAttachment:'platform',userVerification:'required',residentKey:'required'},
    timeout:60000, extensions:{prf:{eval:{first:salt}}}}});
  if(!cred) throw new Error('credencial não criada');
  let prf=cred.getClientExtensionResults?.().prf?.results?.first;
  if(!prf){ const a=await navigator.credentials.get({publicKey:{challenge:_erand(32),allowCredentials:[{id:cred.rawId,type:'public-key'}],userVerification:'required',timeout:60000,extensions:{prf:{eval:{first:salt}}}}});
    prf=a.getClientExtensionResults?.().prf?.results?.first; }
  if(!prf) throw new Error('o navegador não liberou a chave da digital (PRF) — use o Chrome do Mac');
  const iv=_erand(12); const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv}, await _estAes(prf), new TextEncoder().encode(pw));
  localStorage.setItem(_EST_BIO, JSON.stringify({credId:_eb64e(cred.rawId),salt:_eb64e(salt),iv:_eb64e(iv),ct:_eb64e(ct)}));
  return true;
}
async function estBioAbrir(){
  const c=JSON.parse(localStorage.getItem(_EST_BIO)||'null'); if(!c) throw new Error('digital não ativada');
  const a=await navigator.credentials.get({publicKey:{challenge:_erand(32),allowCredentials:[{id:_eb64d(c.credId),type:'public-key'}],userVerification:'required',timeout:60000,extensions:{prf:{eval:{first:_eb64d(c.salt)}}}}});
  const prf=a.getClientExtensionResults?.().prf?.results?.first; if(!prf) throw new Error('a digital não liberou a chave');
  return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:_eb64d(c.iv)}, await _estAes(prf), _eb64d(c.ct)));
}

/* ===================== 💸 CUSTO DE IA — PAINEL DIÁRIO (Wal 15/set) =====================
   Dado REAL do medidor de cada mesa, coletado no Air às 06h (custos_ia/coletor_custos_ia.py),
   cifrado e publicado no Blob f=custos_ia — sem deploy. Selo "última atualização" no topo. */
let _custosIAok=false, _ciaCharts=[];
async function renderCustosIA(force){
  const wrap=document.getElementById('custosIA'); if(!wrap) return;
  if(_custosIAok && !force) return;
  wrap.innerHTML='<div class="card" style="margin-top:18px;color:var(--mut)">Carregando o custo de IA…</div>';
  let D;
  try{ const env=await fetchEncF('custos_ia','data/custos_ia.enc'); D=await decryptEncObj(env, window.__PW||''); }
  catch(e){ wrap.innerHTML=`<div class="card" style="margin-top:18px;color:var(--amber)">O painel diário de IA ainda não foi publicado (${esc(String(e.message||e))}). O robô roda às 06h no Air.</div>`; return; }
  _custosIAok=true; _ciaCharts.forEach(c=>{try{c.destroy()}catch(e){}}); _ciaCharts=[];
  const R=(v,d=2)=>v==null?'—':'R$ '+Number(v).toLocaleString('pt-BR',{minimumFractionDigits:d,maximumFractionDigits:d});
  const N=v=>v==null?'—':Math.round(v).toLocaleString('pt-BR');
  const dm=s=>s?s.slice(8,10)+'/'+s.slice(5,7):'';
  const COR={verde:'var(--green)',amarelo:'var(--amber)',vermelho:'var(--red)'};
  const ROT={verde:'🟢 SOB CONTROLE',amarelo:'🟡 ATENÇÃO',vermelho:'🔴 ESTOUROU / FORA DO AR'};
  // selo de frescor: publicado hoje depois das 06h = em dia
  const g=D.gerado||''; const hoje=new Date(); const hs=hoje.getFullYear()+'-'+String(hoje.getMonth()+1).padStart(2,'0')+'-'+String(hoje.getDate()).padStart(2,'0');
  const emDia=g.slice(0,10)===hs;
  const selo=`<span style="font-weight:800;color:${emDia?'var(--green)':'var(--red)'}">${emDia?'✔':'⚠ ATRASADO —'} última atualização ${dm(g)}/${g.slice(0,4)} às ${g.slice(11,16)}</span>`;
  const st=D.status||'verde';
  let h=`<div class="card" style="margin-top:18px;border-color:${COR[st]}">
    <h3>💸 Custo de IA — painel diário <span class="cap">${selo} · dia analisado: <b>${dm(D.dia)}</b> · atualiza todo dia às 06h · câmbio R$ ${String(D.cambio).replace('.',',')}</span></h3>
    <div style="display:flex;flex-wrap:wrap;gap:22px;align-items:flex-start;margin-top:10px">
      <div style="min-width:190px"><div class="acmp-l">Situação</div><div class="acmp-v" style="color:${COR[st]};font-size:22px">${ROT[st]}</div><div class="acmp-s">${(D.alertas||[]).length} aviso(s)</div></div>
      ${(D.farejadores||[]).filter(f=>f.u_dia!==undefined&&f.meta).map(f=>{const u=f.u_dia; const pouco=(f.n_dia||0)<10; const c=(u==null||pouco)?'var(--mut)':(u>f.teto?'var(--red)':(u>f.meta*1.08?'var(--amber)':'var(--green)'));
        return `<div style="min-width:170px"><div class="acmp-l">${f.emoji} ${esc(f.nome)} · ontem</div><div class="acmp-v" style="color:${c}">${R(u,3)}</div><div class="acmp-s">${pouco?'<b>volume baixo — vale a média 7d</b> · ':''}meta ${R(f.meta)} · teto ${R(f.teto)} · 7 dias ${R(f.u7,3)} · ${N(f.n_dia)} un. = ${R(f.rs_dia)}</div></div>`;}).join('')}
      <div style="min-width:170px"><div class="acmp-l">Total de IA ontem</div><div class="acmp-v">${R((D.serie||[]).slice(-1)[0]?.total)}</div><div class="acmp-s">4 mesas · requisição + hemograma</div></div>
    </div>
    <div style="margin-top:14px;font-size:13.5px;line-height:1.6;background:linear-gradient(90deg,rgba(0,212,255,.08),transparent);border-left:3px solid var(--cyan);padding:10px 14px;border-radius:6px">
      <b>🧠 Interpretação</b><br>${(D.texto||[]).map(esc).join('<br>')}</div>`;
  if((D.alertas||[]).length){
    h+=`<div style="margin-top:12px">${D.alertas.map(a=>`<div style="border-left:3px solid ${COR[a.nivel]};padding:7px 12px;margin:6px 0;background:rgba(255,255,255,.02);border-radius:6px">
      <b style="color:${COR[a.nivel]}">${a.nivel==='vermelho'?'🔴':'🟡'} ${esc(a.titulo)}</b><div style="font-size:12.5px;color:var(--mut);margin-top:2px">Por quê: ${esc(a.porque)}</div></div>`).join('')}</div>`;
  } else h+=`<div style="margin-top:10px;color:var(--green);font-size:13px">✔ Nenhum aviso: travas de custo ligadas nas 4 mesas e unitários dentro do teto.</div>`;
  h+=`</div>`;

  // ---- farejadores (os 4) ----
  h+=`<div class="card" style="margin-top:14px"><h3>🐾 Por farejador <span class="cap">o que usa IA, quanto custa por unidade, o que ainda não usa</span></h3>
    <table class="atab"><thead><tr><th>Farejador</th><th>Situação</th><th class="num">Ontem (un.)</th><th class="num">R$ ontem</th><th class="num">R$/un. ontem</th><th class="num">R$/un. 7 dias</th><th class="num">Meta</th></tr></thead><tbody>
    ${(D.farejadores||[]).map(f=>f.meta?`<tr><td>${f.emoji} <b>${esc(f.nome)}</b></td><td>${esc(f.status)}</td><td class="num">${N(f.n_dia)}</td><td class="num">${R(f.rs_dia)}</td><td class="num"><b>${R(f.u_dia,3)}</b></td><td class="num">${R(f.u7,3)}</td><td class="num">${R(f.meta)}</td></tr>`
      :`<tr><td>${f.emoji} <b>${esc(f.nome)}</b></td><td>${esc(f.status)}</td><td colspan="5" style="color:var(--mut)">${esc(f.nota||'')}${f.rs7?` · <b style="color:var(--amber)">apareceu R$ ${f.rs7} de IA nos últimos 7 dias</b>`:''}</td></tr>`).join('')}
    </tbody></table></div>`;

  // ---- cenário 500 + 300 ----
  const C2=D.cenario||{};
  h+=`<div class="card" style="margin-top:14px"><h3>📐 Simulação: ${N(C2.req_dia)} requisições + ${N(C2.hemo_dia)} hemogramas por dia × ${C2.dias} dias <span class="cap">com o custo unitário REAL dos últimos 7 dias</span></h3>
    <table class="atab"><thead><tr><th>Farejador</th><th class="num">por dia</th><th class="num">R$/un.</th><th class="num">R$/dia</th><th class="num">R$/mês</th></tr></thead><tbody>
    ${(C2.linhas||[]).map(l=>`<tr><td>${esc(l.f)}</td><td class="num">${l.n==null?'—':N(l.n)}</td><td class="num">${R(l.u,3)}</td><td class="num">${R(l.dia)}</td><td class="num"><b>${R(l.mes)}</b></td></tr>`).join('')}
    <tr style="border-top:1px solid var(--line)"><td><b>TOTAL (real 7 dias)</b></td><td></td><td></td><td class="num">${R(C2.mes_real/C2.dias)}</td><td class="num" style="font-size:16px"><b>${R(C2.mes_real)}</b></td></tr>
    </tbody></table>
    <div style="display:flex;flex-wrap:wrap;gap:22px;margin-top:12px">
      <div><div class="acmp-l">Na meta (R$ ${String(D.meta.req).replace('.',',')} + R$ ${String(D.meta.hemo).replace('.',',')})</div><div class="acmp-v" style="color:var(--green);font-size:20px">${R(C2.mes_meta)}</div></div>
      <div><div class="acmp-l">No teto (estourou acima disso)</div><div class="acmp-v" style="color:var(--red);font-size:20px">${R(C2.mes_teto)}</div></div>
      <div><div class="acmp-l">Com a sugestão de patologista (fora do medidor)</div><div class="acmp-v" style="color:var(--amber);font-size:20px">${R(C2.mes_real_com_lacuna)}</div></div>
      <div><div class="acmp-l">Como era em agosto</div><div class="acmp-v" style="color:var(--mut);font-size:20px;text-decoration:line-through">${R(C2.mes_agosto)}</div></div>
    </div></div>`;

  // ---- gráficos ----
  h+=`<div class="grid g2" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px;margin-top:14px">
    <div class="card"><h3>📈 R$ por unidade, dia a dia <span class="cap">linha tracejada = meta · cai quando a trava funciona</span></h3><div class="chartbox"><canvas id="ciaU"></canvas></div></div>
    <div class="card"><h3>💰 R$ de IA por dia, por mesa <span class="cap">quem está gerando e quem não está</span></h3><div class="chartbox"><canvas id="ciaM"></canvas></div></div></div>`;

  // ---- mesas ----
  h+=`<div class="card" style="margin-top:14px"><h3>🖥️ Mesa a mesa — ontem <span class="cap">trava = leitura única + freio de releitura ligados E o servidor rodando esse código</span></h3>
    <table class="atab"><thead><tr><th>Mesa</th><th>Trava de custo</th><th class="num">Folhas</th><th class="num">Leituras/folha</th><th class="num">R$/req</th><th class="num">R$/req 7d</th><th class="num">Hemogramas</th><th class="num">R$/hemo</th><th class="num">Total R$</th><th>Última leitura</th></tr></thead><tbody>
    ${(D.mesas||[]).map(m=>{const t=m.trava||{}; const tv=m.acesso?`<span style="color:var(--red)">🔴 sem acesso</span>`:(t.ok?(t.git_sujo?'<span style="color:var(--amber)">🟡 ligada (sem commit)</span>':'<span style="color:var(--green)">🟢 ligada</span>'):'<span style="color:var(--red)">🔴 DESLIGADA</span>');
      const rc=m.rel==null?'':(m.rel>D.teto.rel?'color:var(--red)':'');
      return `<tr><td><b>${esc(m.mesa)}</b></td><td>${tv}</td><td class="num">${N(m.folhas)}</td><td class="num" style="${rc}">${m.rel==null?'—':String(m.rel).replace('.',',')+'×'}</td><td class="num">${R(m.u_req,3)}</td><td class="num">${R(m.u7,3)}</td><td class="num">${N(m.hemos)}</td><td class="num">${R(m.u_hemo,3)}</td><td class="num"><b>${R(m.total)}</b></td><td style="color:var(--mut)">${m.ultima?dm(m.ultima)+' '+m.ultima.slice(11,16):'—'}</td></tr>`;}).join('')}
    </tbody></table></div>`;

  // ---- benchmark ----
  const B=D.benchmark||{}; const eu=B.farejador_usd_1k;
  const merc=[...(B.mercado||[]), ...(eu?[{srv:'🔬 Farejador Alpha (7 dias)',usd:eu,eu:true}]:[])].sort((a,b)=>b.usd-a.usd);
  const mx=Math.max(...merc.map(x=>x.usd),1);
  h+=`<div class="grid g2" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px;margin-top:14px">
    <div class="card"><h3>🏁 Benchmark: custo de ler 1.000 páginas <span class="cap">US$ · tabela pública 2026 · o Farejador faz mais que extrair (casa com o catálogo do HF)</span></h3>
      ${merc.map(x=>`<div style="display:flex;align-items:center;gap:8px;margin:6px 0;font-size:12.5px"><div style="width:190px;${x.eu?'font-weight:800;color:var(--cyan)':''}">${esc(x.srv)}</div>
        <div style="flex:1;background:rgba(255,255,255,.05);border-radius:4px;height:14px"><div style="width:${(x.usd/mx*100).toFixed(1)}%;height:100%;border-radius:4px;background:${x.eu?'var(--cyan)':'rgba(138,162,189,.5)'}"></div></div>
        <div style="width:70px;text-align:right">US$ ${x.usd.toFixed(2).replace('.',',')}</div></div>`).join('')}
      <div style="font-size:12px;color:var(--mut);margin-top:8px">Em agosto o Farejador custava US$ 67,52 (igual ao Textract completo). ${eu?`Hoje: <b style="color:var(--cyan)">US$ ${eu.toFixed(2).replace('.',',')}</b> — ${eu<30?'abaixo do Azure e do Google.':'ainda acima do Azure/Google.'}`:''}</div></div>
    <div class="card"><h3>🧪 Quanto a leitura pesa no MATERIAL do exame <span class="cap">régua do Wal: ler não pode custar o mesmo que fazer</span></h3>
      <table class="atab"><thead><tr><th>Setor</th><th class="num">Material/exame</th><th class="num">Ler 1 requisição (7d)</th><th class="num">pesa</th></tr></thead><tbody>
      ${(B.material||[]).map(x=>{const u=(D.sete||{}).u_req||D.meta.req; const p=u/x.m*100; return `<tr><td>${esc(x.s)}</td><td class="num">${R(x.m)}</td><td class="num">${R(u,3)}</td><td class="num" style="color:${p>15?'var(--red)':p>5?'var(--amber)':'var(--green)'}"><b>${p.toFixed(1).replace('.',',')}%</b></td></tr>`;}).join('')}
      </tbody></table>
      <div style="font-size:12px;color:var(--mut);margin-top:8px">Uma requisição tem em média ~2,2 exames — por exame o peso é menos da metade disso.</div>
      <table class="atab" style="margin-top:10px"><thead><tr><th>Histórico</th><th class="num">R$/req</th><th class="num">R$/hemo</th></tr></thead><tbody>
      ${(B.historico||[]).map(x=>`<tr><td>${esc(x.q)}</td><td class="num">${R(x.req,3)}</td><td class="num">${R(x.hemo,3)}</td></tr>`).join('')}</tbody></table></div></div>`;

  // ---- lacunas + netlify ----
  const NT=D.netlify||{};
  h+=`<div class="grid g2" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px;margin-top:14px">
    <div class="card"><h3>🕳️ O que ainda NÃO entra no medidor <span class="cap">custo que existe mas não aparece no número acima</span></h3>
      ${(D.lacunas||[]).map(l=>`<div style="margin:6px 0"><b style="color:var(--amber)">${esc(l.titulo)}</b><div style="font-size:12.5px;color:var(--mut)">${esc(l.detalhe)}</div></div>`).join('')||'<div style="color:var(--green)">Nenhuma.</div>'}</div>
    <div class="card"><h3>☁️ Netlify — deploys de produção em ${dm(NT.dia)} <span class="cap">cada deploy ≈ 15 créditos · a sangria vem daqui</span></h3>
      ${NT.erro?`<div style="color:var(--amber)">${esc(NT.erro)}</div>`:`<div class="acmp-v" style="font-size:22px;color:${NT.creditos>450?'var(--red)':NT.creditos>150?'var(--amber)':'var(--green)'}">${N(NT.creditos)} créditos ≈ US$ ${String(NT.usd_estimado).replace('.',',')}</div>
      <table class="atab" style="margin-top:8px"><thead><tr><th>Site</th><th class="num">Deploys</th><th class="num">Créditos</th></tr></thead><tbody>
      ${(NT.sites||[]).map(s=>`<tr><td>${esc(s.site)}</td><td class="num">${s.deploys}</td><td class="num">${s.creditos}</td></tr>`).join('')}</tbody></table>
      <div style="font-size:11.5px;color:var(--mut);margin-top:6px">${esc(NT.obs||'')}</div>`}</div></div>`;
  h+=`<div style="font-size:11px;color:var(--mut);margin:10px 2px">Fonte: ${esc(D.fonte||'')}. Meta medida em ${esc((D.ref||{}).periodo||'')}. Requisições lidas = folhas × imagens por chamada ÷ 2 (aproximação; conferida contra o portal HF).</div>`;
  wrap.innerHTML=h;

  if(window.Chart){
    const S=D.serie||[]; const lab=S.map(x=>dm(x.d));
    const tick={color:'#8aa2bd',font:{size:10}}, grid={color:'rgba(255,255,255,.05)'};
    _ciaCharts.push(new Chart(document.getElementById('ciaU'),{type:'line',data:{labels:lab,datasets:[
      {label:'R$/requisição',data:S.map(x=>x.u_req),borderColor:'#00D4FF',backgroundColor:'#00D4FF',tension:.25,spanGaps:true,pointRadius:2},
      {label:'R$/hemograma',data:S.map(x=>x.u_hemo),borderColor:'#FF6AD5',backgroundColor:'#FF6AD5',tension:.25,spanGaps:true,pointRadius:2},
      {label:'meta req',data:S.map(()=>D.meta.req),borderColor:'rgba(0,229,160,.7)',borderDash:[5,4],pointRadius:0,borderWidth:1},
      {label:'teto req',data:S.map(()=>D.teto.req),borderColor:'rgba(255,84,112,.6)',borderDash:[2,4],pointRadius:0,borderWidth:1}]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#8aa2bd',font:{size:10}}}},scales:{x:{ticks:tick,grid},y:{ticks:{...tick,callback:v=>'R$ '+Number(v).toFixed(2).replace('.',',')},grid,suggestedMax:.4,min:0}}}}));
    const cores={'Mesa 1':'#00D4FF','Mesa 2':'#A78BFA','Mesa 3':'#00E5A0','Mesa 4':'#FFB020'};
    _ciaCharts.push(new Chart(document.getElementById('ciaM'),{type:'bar',data:{labels:lab,datasets:Object.keys(cores).map(m=>({label:m,data:S.map(x=>(x.mesas||{})[m]||0),backgroundColor:cores[m]}))},
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#8aa2bd',font:{size:10}}}},scales:{x:{stacked:true,ticks:tick,grid},y:{stacked:true,ticks:{...tick,callback:v=>'R$ '+v},grid}}}}));
  }
}

/* ===================== 🧪 APOIO · VET LAB (Wal 16/set) =====================
   Faturas + boletos da Vet Lab cruzados com o que a Alpha produziu e cobrou (HF). Dado cifrado no Blob
   f=apoio_vetlab (publicado do Air por apoio_vetlab/publicar_apoio.py) — sem deploy por atualização. */
let _apoioOk=false, _apoioCharts=[];
async function renderApoio(force){
  const wrap=document.getElementById('apoio'); if(!wrap) return;
  if(_apoioOk && !force) return;
  wrap.innerHTML='<div class="card" style="margin-top:18px;color:var(--mut)">Carregando o apoio (Vet Lab)…</div>';
  let D;
  try{ const env=await fetchEncF('apoio_vetlab','data/apoio_vetlab.enc'); D=await decryptEncObj(env, window.__PW||''); }
  catch(e){ wrap.innerHTML=`<div class="card" style="margin-top:18px;color:var(--amber)">Painel do apoio ainda não publicado (${esc(String(e.message||e))}).</div>`; return; }
  _apoioOk=true; _apoioCharts.forEach(c=>{try{if(c.$apIv)clearInterval(c.$apIv);c.destroy()}catch(e){}}); _apoioCharts=[];
  const R=(v,d=0)=>v==null?'—':'R$ '+Number(v).toLocaleString('pt-BR',{minimumFractionDigits:d,maximumFractionDigits:d});
  const N=v=>v==null?'—':Math.round(v).toLocaleString('pt-BR');
  const P=(v,d=1)=>v==null?'—':Number(v).toLocaleString('pt-BR',{minimumFractionDigits:d,maximumFractionDigits:d})+'%';
  const K=D.kpi, M=D.meses;
  const kpi=(rot,val,sub,cor)=>`<div style="min-width:170px;flex:1"><div class="acmp-l">${rot}</div><div class="acmp-v" style="font-size:21px;${cor?`color:${cor}`:''}">${val}</div><div class="acmp-s">${sub}</div></div>`;
  const STC={'saiu':'var(--green)','caiu':'var(--cyan)','caiu pouco':'var(--amber)','estável/subiu':'var(--red)','novo':'var(--purple)'};
  const STR={'saiu':'✅ saiu do apoio','caiu':'⬇ caiu','caiu pouco':'↘ caiu pouco','estável/subiu':'⚠ continua','novo':'🆕 novo'};
  const spark=(arr,cor)=>{const mx=Math.max(...arr,1);return `<span style="display:inline-flex;gap:2px;align-items:flex-end;height:18px">${arr.map(v=>`<span title="${v}" style="width:5px;height:${Math.max(1,v/mx*18)}px;background:${cor};opacity:${v?1:.25};border-radius:1px"></span>`).join('')}</span>`;};

  let h=`<div class="card" style="margin-top:18px">
    <h3>🧪 Laboratório de apoio · Vet Lab <span class="cap">${esc(D.apoio)} · ${esc(D.periodo)} · atualizado ${esc(D.gerado)}</span></h3>
    <div style="display:flex;flex-wrap:wrap;gap:22px;margin-top:10px">
      ${kpi('Boleto de janeiro → '+esc(K.ultimo_rotulo||'ago/26'), R(K.jan)+' → '+R(K.ago), 'queda de <b style="color:var(--green)">'+P(Math.abs(K.queda_jan_ago_pct))+'</b>', 'var(--ink)')}
      ${kpi('Média 1º tri → média jul–ago', R(K.media_q1)+' → '+R(K.media_jul_ago), 'queda de '+P(Math.abs(K.queda_q1_pct))+' por mês')}
      ${kpi('Peso na receita da matriz', P(K.pct_receita_jan)+' → '+P(K.pct_receita_ago), 'boleto ÷ faturamento HF do mês', 'var(--green)')}
      ${kpi('Custo evitado / ano', R(K.economia_anual_ritmo_ago_vs_q1), 'ritmo de agosto × 1º trimestre (antes do reagente interno)', 'var(--green)')}
      ${kpi('Pago em 8 meses', R(K.total_cheio), N(K.total_exames)+' exames · '+K.exames_distintos+' tipos · com desconto '+R(K.total_desc))}
      ${kpi('Margem no que ainda vai', P(K.margem_bruta_pct_geral), 'preço praticado × custo Vet Lab c/ desconto · cobertura '+P(K.cobertura_preco_pct))}
    </div>
    <div style="margin-top:14px;font-size:13.5px;line-height:1.65;background:linear-gradient(90deg,rgba(0,229,160,.08),transparent);border-left:3px solid var(--green);padding:10px 14px;border-radius:6px">
      <b>🧠 Interpretação</b><br>${(D.texto||[]).map(t=>'• '+esc(t)).join('<br>')}</div></div>`;
  if(D.aviso_parcial) h+=`<div class="card" style="margin-top:12px;border-left:3px solid var(--amber);background:rgba(255,176,32,.07)"><b style="color:var(--amber)">${esc(D.aviso_parcial)}</b></div>`;

  // ★ QUEDA EM % PISCANDO (Wal 16/set): tem que chamar atenção
  if(!document.getElementById('apPiscaCSS')){ const st=document.createElement('style'); st.id='apPiscaCSS';
    st.textContent=`@keyframes apPisca{0%,100%{opacity:1;transform:scale(1);text-shadow:0 0 18px rgba(0,229,160,.9)}50%{opacity:.25;transform:scale(.94);text-shadow:none}}
    @keyframes apBorda{0%,100%{box-shadow:0 0 0 0 rgba(0,229,160,.0),0 0 28px rgba(0,229,160,.55)}50%{box-shadow:0 0 0 6px rgba(0,229,160,.25),0 0 6px rgba(0,229,160,.1)}}
    .apPisca{animation:apPisca 1.1s ease-in-out infinite;display:inline-block}
    .apBig{font-size:clamp(38px,6vw,72px);font-weight:900;color:#00E5A0;letter-spacing:-.03em;line-height:1}
    .apBox{border:2px solid #00E5A0;border-radius:14px;padding:12px 18px;animation:apBorda 1.1s ease-in-out infinite;background:rgba(0,229,160,.07);text-align:center;flex:1;min-width:210px}
    .apChip{border-radius:10px;padding:6px 4px;text-align:center;flex:1;min-width:64px;background:rgba(255,255,255,.03);border:1px solid var(--line)}`;
    document.head.appendChild(st); }
  const MF=M.filter(m=>!m.parcial), pv0=MF[0].boleto, pico=Math.max(...MF.map(m=>m.boleto)), ult=MF[MF.length-1];
  const qJan=(ult.boleto/pv0-1)*100, qPico=(ult.boleto/pico-1)*100, qTri=K.queda_q1_pct;
  const seta=v=>v<0?'▼':'▲', corq=v=>v<0?'#00E5A0':'#FF5470';
  const big=(v,rot)=>`<div class="apBox" style="border-color:${corq(v)}"><div class="apBig apPisca" style="color:${corq(v)}">${seta(v)} ${P(Math.abs(v))}</div><div style="margin-top:6px;font-size:13px;font-weight:700">${rot}</div></div>`;
  h+=`<div class="card" style="margin-top:14px"><h3>📉 A queda do apoio, mês a mês <span class="cap">barras = boleto da Vet Lab por área · linha = % do faturamento · % no topo = variação contra JANEIRO</span></h3>
    <div style="display:flex;flex-wrap:wrap;gap:14px;margin:10px 0 14px">
      ${big(qJan,'janeiro → '+ult.rotulo.split('/')[0]+' ('+R(pv0)+' → '+R(ult.boleto)+')')}
      ${big(qTri,'média 1º trimestre → média jul–ago')}
      ${big(qPico,'pico de '+MF.find(m=>m.boleto===pico).rotulo.split('/')[0]+' → '+ult.rotulo.split('/')[0]+' ('+R(pico)+' → '+R(ult.boleto)+')')}
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
      ${M.map((m,i)=>{if(m.parcial) return `<div class="apChip" style="border-color:var(--amber)"><div style="font-size:11px;color:var(--mut)">${m.rotulo.split('/')[0]}</div><div style="font-size:14px;font-weight:800;color:var(--amber);padding:3px 0">em aberto</div><div style="font-size:10.5px;color:var(--mut)">${R(m.boleto)}</div></div>`;
        const ant=M.filter((x,j)=>j<i&&!x.parcial), vj=(m.boleto/pv0-1)*100, va=ant.length?(m.boleto/ant[ant.length-1].boleto-1)*100:null;
        return `<div class="apChip"><div style="font-size:11px;color:var(--mut)">${m.rotulo.split('/')[0]}</div>
          <div class="${i&&vj<0?'apPisca':''}" style="font-size:20px;font-weight:900;color:${i?corq(vj):'var(--mut)'}">${i?seta(vj)+' '+P(Math.abs(vj),0):'base'}</div>
          <div style="font-size:10.5px;color:${va==null?'var(--mut)':corq(va)}">${va==null?'&nbsp;':'mês ant. '+(va<0?'−':'+')+P(Math.abs(va),0)}</div></div>`;}).join('')}
    </div>
    <div class="chartbox" style="height:360px"><canvas id="apQueda"></canvas></div></div>`;
  h+=`<div class="grid g2" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:14px;margin-top:14px">
    <div class="card"><h3>🔢 Exames enviados × custo médio por exame <span class="cap">o volume barato voltou para casa; ficou o exame caro e raro</span></h3><div class="chartbox"><canvas id="apVol"></canvas></div></div>
    <div class="card"><h3>🏠 Produção da Alpha × enviado à Vet Lab <span class="cap">prova de verticalização: a produção segue, o envio zera</span></h3>
      <select id="apSel" style="margin:4px 0 8px;background:var(--navy2);color:var(--ink);border:1px solid var(--line);border-radius:6px;padding:4px 8px;max-width:100%">${(D.producao_vs_apoio||[]).map((x,i)=>`<option value="${i}">${esc(x.exame)} — apoio ${x.pct_apoio_q1??'—'}% → ${x.pct_apoio_jul_ago??'—'}%</option>`).join('')}</select>
      <div class="chartbox" style="height:250px"><canvas id="apProd"></canvas></div></div></div>`;

  // tabela produção x apoio
  h+=`<div class="card" style="margin-top:14px"><h3>🔬 Quanto de cada exame ainda vai para o apoio <span class="cap">% = exames na fatura Vet Lab ÷ exames produzidos no HF · 1º tri × jul–ago</span></h3>
    <div style="overflow-x:auto"><table class="atab"><thead><tr><th>Exame</th><th>Produção HF (jan→ago)</th><th>Vet Lab (jan→ago)</th><th class="num">% apoio 1º tri</th><th class="num">% apoio jul–ago</th></tr></thead><tbody>
    ${(D.producao_vs_apoio||[]).map(x=>{const a=x.pct_apoio_jul_ago; const c=a==null?'var(--mut)':a<=10?'var(--green)':a<=50?'var(--amber)':'var(--red)';
      return `<tr><td>${esc(x.exame)}</td><td>${spark(x.producao,'var(--cyan)')} <span style="color:var(--mut);font-size:11px">${x.producao.reduce((a,b)=>a+b,0)}</span></td><td>${spark(x.vetlab,'var(--amber)')} <span style="color:var(--mut);font-size:11px">${x.vetlab.reduce((a,b)=>a+b,0)}</span></td><td class="num">${x.pct_apoio_q1==null?'—':x.pct_apoio_q1+'%'}</td><td class="num" style="color:${c}"><b>${a==null?'—':a+'%'}</b></td></tr>`;}).join('')}
    </tbody></table></div><div style="font-size:11px;color:var(--mut);margin-top:6px">Acima de 100% = a Vet Lab fatura em itens separados o que o HF registra como um só (ex.: Ácidos Biliares basal + pós-prandial).</div></div>`;

  // ainda envia em agosto
  h+=`<div class="card" style="margin-top:14px"><h3>📋 O que ainda enviamos (fatura de ${esc((K.parcial_rotulo||K.ultimo_rotulo||'ago/26').replace('*',''))}) <span class="cap">ordenado por R$ · custo Vet Lab com desconto × seu preço praticado</span></h3>
    <div style="overflow-x:auto"><table class="atab"><thead><tr><th>Exame</th><th>Área</th><th class="num">Ago (qtd)</th><th class="num">Ago R$ cheio</th><th class="num">Custo Vet Lab</th><th class="num">Seu preço</th><th class="num">Margem</th><th class="num">Custo ÷ preço</th><th>Jan→Ago</th></tr></thead><tbody>
    ${(D.ainda_envia_ago||[]).map(e=>{const cp=e.custo_sobre_preco; const cc=cp==null?'var(--mut)':cp>=75?'var(--red)':cp>=65?'var(--amber)':'var(--green)';
      return `<tr><td>${esc(e.exame)}</td><td style="color:var(--mut);font-size:12px">${esc(e.categoria)}</td><td class="num">${e.ago}</td><td class="num">${R(e.ago_rs)}</td><td class="num">${R(e.custo,2)}</td><td class="num">${e.meu_preco?R(e.meu_preco,2):'<span title="sem preço identificado" style="color:var(--amber)">?</span>'}</td><td class="num">${P(e.margem_pct)}</td><td class="num" style="color:${cc}">${P(cp)}</td><td>${spark(e.por_mes,'var(--amber)')}</td></tr>`;}).join('')}
    </tbody></table></div></div>`;

  // ranking geral
  h+=`<div class="card" style="margin-top:14px"><h3>🏆 Todos os exames do período <span class="cap">Pareto: ${K.exames_para_80pct} exames = 80% do gasto · top 10 = ${P(K.top10_pct)} · status = 1º tri × jul–ago</span></h3>
    <div style="margin:4px 0 8px"><input id="apBusca" placeholder="Buscar exame…" style="background:var(--navy2);color:var(--ink);border:1px solid var(--line);border-radius:6px;padding:5px 9px;width:260px;max-width:100%"></div>
    <div style="overflow-x:auto;max-height:520px;overflow-y:auto"><table class="atab" id="apTab"><thead><tr><th>#</th><th>Exame</th><th>Status</th><th class="num">Qtd</th><th class="num">Total pago</th><th class="num">Custo un.</th><th class="num">Seu preço</th><th class="num">Margem</th><th class="num">% acum.</th><th>Jan→Ago</th></tr></thead><tbody>
    ${D.exames.map((e,i)=>`<tr data-n="${esc(e.exame.toLowerCase())}"><td style="color:var(--mut)">${i+1}</td><td>${esc(e.exame)}<div style="font-size:10.5px;color:var(--mut)">${esc(e.categoria)}${e.hf_nome?' · HF: '+esc(e.hf_nome):''}</div></td><td style="color:${STC[e.status]};white-space:nowrap">${STR[e.status]}</td><td class="num">${N(e.n)}</td><td class="num">${R(e.total)}</td><td class="num">${R(e.custo,2)}</td><td class="num" title="${esc(e.fonte_preco||'sem preço')}">${e.meu_preco?R(e.meu_preco,2):'—'}</td><td class="num">${P(e.margem_pct)}</td><td class="num">${P(e.pareto_pct)}</td><td>${spark(e.por_mes,'var(--cyan)')}</td></tr>`).join('')}
    </tbody></table></div></div>`;

  // benchmark
  h+=`<div class="card" style="margin-top:14px"><h3>🏁 Benchmark de mercado <span class="cap">com fonte · o que cada referência diz sobre a Alpha</span></h3>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;margin-top:8px">
    ${(D.benchmark||[]).map(b=>`<div style="border:1px solid var(--line);border-radius:10px;padding:12px;background:rgba(255,255,255,.02)">
      <div style="font-size:11px;color:var(--mut);text-transform:uppercase;letter-spacing:.05em">${esc(b.t)}</div>
      <div style="font-size:16px;font-weight:800;margin:4px 0;color:var(--cyan)">${esc(b.v)}</div>
      <div style="font-size:12.5px;line-height:1.5">${esc(b.leitura)}</div>
      <div style="font-size:10.5px;color:var(--mut);margin-top:6px">Fonte: ${esc(b.fonte)}</div></div>`).join('')}
    </div></div>`;

  h+=`<div class="card" style="margin-top:14px"><h3>🧾 Boletos <span class="cap">valor cheio = boleto · com desconto = pagando até o vencimento (10%)</span></h3>
    <div style="overflow-x:auto"><table class="atab"><thead><tr><th>Mês</th><th class="num">Exames</th><th class="num">Requisições</th><th class="num">Boleto</th><th class="num">Com desconto</th><th class="num">Desconto</th><th>Vencimento</th><th class="num">% receita</th><th class="num">Custo/exame</th></tr></thead><tbody>
    ${M.map(m=>`<tr><td>${m.rotulo}</td><td class="num">${N(m.exames)}</td><td class="num">${N(m.requisicoes)}</td><td class="num"><b>${R(m.boleto,2)}</b></td><td class="num">${R(m.com_desconto,2)}</td><td class="num">${R(m.desconto,2)}</td><td>${m.vencimento?m.vencimento.split('-').reverse().join('/'):'—'}</td><td class="num">${P(m.pct_receita,2)}</td><td class="num">${R(m.custo_medio_exame,2)}</td></tr>`).join('')}
    </tbody></table></div>
    <div style="font-size:11px;color:var(--mut);margin-top:8px">Seu preço = mediana do valor cobrado no HF em 2026 (>R$0) para o mesmo exame; na falta, Tabela de Preços Alpha mar/26. Sem preço: ${R(K.sem_preco_rs)} (T4 Total/Livre sem RIE, Vitamina D3 Calcitriol, Neosporose…). Receita = itemização HF do mês.</div></div>`;
  wrap.innerHTML=h;

  const busca=document.getElementById('apBusca');
  if(busca) busca.addEventListener('input',()=>{const q=busca.value.toLowerCase(); document.querySelectorAll('#apTab tbody tr').forEach(tr=>{tr.style.display=tr.dataset.n.includes(q)?'':'none';});});
  if(!window.Chart) return;
  const tick={color:'#8aa2bd',font:{size:10}}, grid={color:'rgba(255,255,255,.05)'}, lab=M.map(m=>m.rotulo);
  const cats=Object.keys(M[0].por_categoria), cor={'Sorologia':'#00D4FF','Biologia molecular (PCR)':'#A78BFA','Hormônios':'#FFB020','Bioquímica especial / outros':'#FF6AD5'};
  _apoioCharts.push(new Chart(document.getElementById('apQueda'),{type:'bar',data:{labels:lab,datasets:[
     ...cats.map(c=>({label:c,data:M.map(m=>m.por_categoria[c]),backgroundColor:cor[c]||'#8aa2bd',stack:'s',yAxisID:'y',order:2})),
     {type:'line',label:'% do faturamento',data:M.map(m=>m.pct_receita),borderColor:'#00E5A0',backgroundColor:'#00E5A0',yAxisID:'y2',tension:.3,pointRadius:4,order:1}]},
    options:{responsive:true,maintainAspectRatio:false,animation:false,layout:{padding:{top:34}},plugins:{legend:{labels:{color:'#8aa2bd',font:{size:11}}},tooltip:{callbacks:{label:c=>c.dataset.yAxisID==='y2'?' '+P(c.raw,2)+' da receita':' '+c.dataset.label+': '+R(c.raw)}}},
      scales:{x:{stacked:true,ticks:tick,grid},y:{stacked:true,suggestedMax:pico*1.18,ticks:{...tick,callback:v=>'R$ '+(v/1000)+'k'},grid},y2:{position:'right',ticks:{...tick,callback:v=>v+'%'},grid:{display:false},min:0}}},
    plugins:[{id:'apPct',afterDatasetsDraw(ch){                 // % contra janeiro no topo de cada barra, piscando
      const ctx=ch.ctx, meta=ch.getDatasetMeta(cats.length-1), y=ch.scales.y, on=(Math.floor(Date.now()/550)%2)===0;
      M.forEach((m,i)=>{ if(!i) return; const el=meta.data[i]; if(!el) return; const v=(m.boleto/pv0-1)*100;
        const txt=(v<0?'▼ ':'▲ ')+P(Math.abs(v),0); ctx.save(); ctx.font='900 18px -apple-system,Helvetica,sans-serif'; ctx.textAlign='center';
        ctx.globalAlpha=on?1:.3; ctx.fillStyle=v<0?'#00E5A0':'#FF5470'; ctx.shadowColor=ctx.fillStyle; ctx.shadowBlur=on?14:0;
        ctx.fillText(txt, el.x, y.getPixelForValue(m.boleto)-10); ctx.restore(); });
    }}]}));
  { const chQ=_apoioCharts[_apoioCharts.length-1]; const iv=setInterval(()=>{ if(!document.body.contains(chQ.canvas)){clearInterval(iv);return;} if(chQ.canvas.offsetParent) chQ.draw(); },550);
    chQ.$apIv=iv; }
  _apoioCharts.push(new Chart(document.getElementById('apVol'),{type:'bar',data:{labels:lab,datasets:[
     {label:'Exames enviados',data:M.map(m=>m.exames),backgroundColor:'rgba(0,212,255,.55)',yAxisID:'y'},
     {type:'line',label:'Custo médio por exame',data:M.map(m=>m.custo_medio_exame),borderColor:'#FFB020',backgroundColor:'#FFB020',yAxisID:'y2',tension:.3}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#8aa2bd',font:{size:10}}}},scales:{x:{ticks:tick,grid},y:{ticks:tick,grid},y2:{position:'right',ticks:{...tick,callback:v=>'R$ '+v},grid:{display:false}}}}}));
  const pv=D.producao_vs_apoio||[]; let chProd=null;
  const desenha=i=>{const x=pv[i]; if(!x) return; if(chProd){chProd.destroy();}
    chProd=new Chart(document.getElementById('apProd'),{type:'bar',data:{labels:lab,datasets:[
      {label:'Produzido na Alpha (HF)',data:x.producao,backgroundColor:'rgba(0,229,160,.6)'},
      {label:'Enviado à Vet Lab',data:x.vetlab,backgroundColor:'rgba(255,176,32,.85)'}]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#8aa2bd',font:{size:10}}}},scales:{x:{ticks:tick,grid},y:{ticks:tick,grid,beginAtZero:true}}}});
    _apoioCharts.push(chProd);};
  desenha(0); const sel=document.getElementById('apSel'); if(sel) sel.addEventListener('change',()=>desenha(+sel.value));
}


/* ── 🤖 Custos IA · Atendimento ao Cliente ────────────────────────────────
   O ecossistema do Atendimento (ouvinte do WhatsApp, rotas, agendamento, inclusões)
   NÃO usa IA paga: é regra + banco. Esta aba mostra o que ele custa de verdade,
   quanto trabalho ele faz e quanto custaria fazer o mesmo comprando no mercado. */
const CC_SB = 'https://lrwjcdvporaivxvfuiwt.supabase.co';
const CC_KEY = 'sb_publishable_fcodHc3AxR_HQ-aduMGzlg_CTBALng8';
// valores mensais em R$ — conferir com o Wal; o que for 0 é porque já está pago em outra conta
const CC_CUSTO = [
  { item: 'IA paga (modelo de linguagem)', valor: 0, nota: 'nenhuma chamada paga: reconhecimento é regra + banco' },
  { item: 'Transcrição dos áudios das clínicas', valor: 0, nota: '~39 áudios/dia transcritos LOCAL no Air (modelo próprio) · na nuvem seria ~R$20/mês' },
  { item: 'Banco do quadro (Supabase)', valor: 0, nota: 'mesmo projeto da frota · 114 linhas do Atendimento hoje: cabe folgado' },
  { item: 'Site do quadro (Netlify)', valor: 0, nota: 'mesmo site do BI, sem custo adicional' },
  { item: 'Automação (GitHub Actions)', valor: 0, nota: 'repositório público = minutos gratuitos' },
  { item: 'Energia: Mesa 4 (principal, 24 h)', valor: 11, nota: 'Mac mini ~15 W · R$ 1,00/kWh' },
  { item: 'Energia: Air (reserva + transcrição)', valor: 7, nota: '~10 W, já ficava ligado' },
  { item: 'Linha de WhatsApp do sistema', valor: 0, nota: 'linha comum, sem API paga' },
  { item: 'Conferência humana (pente-fino)', valor: 0, nota: '3 × 10 min/dia em rodízio, dentro do expediente — sem hora extra' },
];
// referências de mercado (mensal, R$) para fazer o mesmo trabalho
const CC_MERCADO = [
  { item: 'Plataforma de atendimento por agente (Zendesk/Intercom)', valor: 1500, nota: '5 pessoas × ~US$55' },
  { item: 'Fornecedor de chatbot/CRM de WhatsApp', valor: 1200, nota: 'faixa de mercado para 1 número + automações' },
  { item: 'API oficial do WhatsApp (mensagens de serviço)', valor: 300, nota: '~R$0,10 por conversa iniciada' },
  { item: 'IA por mensagem, se cada leitura fosse ao modelo', valor: 900, nota: '~2.600 msgs/dia × R$0,01' },
  { item: 'Transcrição de áudio na nuvem', valor: 20, nota: '~39 áudios/dia × ~30 s · hoje fazemos local por R$ 0' },
  { item: 'Rastreamento de entregas (Onfleet e similares)', valor: 700, nota: '~US$130/mês na faixa de 17 rotas' },
];
let _cciaOk = false;
async function renderCustosCC(force){
  const wrap = document.getElementById('cciaWrap'); if(!wrap) return;
  if(_cciaOk && !force) return;
  wrap.innerHTML = '<div class="card" style="margin-top:18px;color:var(--mut)">Carregando o uso do Atendimento…</div>';
  const get = async (tab, q) => {
    try{ const r = await fetch(`${CC_SB}/rest/v1/${tab}?${q}`, { headers:{ apikey: CC_KEY, Authorization:'Bearer '+CC_KEY, Prefer:'count=exact' } });
      const n = Number((r.headers.get('content-range')||'0-0/0').split('/')[1]||0); const d = await r.json().catch(()=>[]); return { n, d };
    }catch(e){ return { n:0, d:[] }; }
  };
  const d30 = new Date(Date.now()-30*864e5).toISOString();
  const [uso, coletas, cartoes, envios, suspeitas] = await Promise.all([
    get('cc_uso','select=dia,msgs,grupos&order=dia.desc&limit=30'),
    get('inc_coletas',`select=id,status,quando&quando=gte.${d30}&limit=2000`),
    get('inc_chamados',`select=id,criado_em&criado_em=gte.${d30}&limit=2000`),
    get('inc_envios','select=id,tipo,status&limit=2000'),
    get('inc_suspeitas',`select=id,tipo,quando&quando=gte.${d30}&limit=2000`),
  ]);
  _cciaOk = true;
  const R = v => 'R$ ' + Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
  const N = v => Number(v||0).toLocaleString('pt-BR');
  const msgsDia = (uso.d[0]||{}).msgs || 0;
  const msgsMes = uso.d.reduce((a,x)=>a+(x.msgs||0),0);
  const grupos = (uso.d[0]||{}).grupos || 0;
  const custoMes = CC_CUSTO.reduce((a,x)=>a+x.valor,0);
  const mercadoMes = CC_MERCADO.reduce((a,x)=>a+x.valor,0);
  const trabalho = coletas.n + cartoes.n + suspeitas.n;      // demandas tratadas em 30 dias
  const porDemanda = trabalho ? custoMes/trabalho : null;
  const cor = custoMes < 100 ? 'var(--green)' : custoMes < 500 ? 'var(--amber)' : 'var(--red)';
  const linha = (x, tot) => `<tr><td>${esc(x.item)}</td><td style="text-align:right;font-variant-numeric:tabular-nums">${x.valor?R(x.valor):'<b style="color:var(--green)">R$ 0,00</b>'}</td><td style="color:var(--mut);font-size:12.5px">${esc(x.nota)}</td></tr>`;
  wrap.innerHTML = `
  <div class="card" style="margin-top:18px;border-color:${cor}">
    <h3>🤖 Custo do Atendimento ao Cliente com IA <span class="cap">ouvinte do WhatsApp · rotas · agendamento · inclusões</span></h3>
    <div style="display:flex;flex-wrap:wrap;gap:22px;margin-top:10px">
      <div style="min-width:180px"><div class="acmp-l">Custo por mês</div><div class="acmp-v" style="color:${cor}">${R(custoMes)}</div><div class="acmp-s">sem nenhuma IA paga</div></div>
      <div style="min-width:180px"><div class="acmp-l">Custo por demanda tratada</div><div class="acmp-v">${porDemanda==null?'—':R(porDemanda)}</div><div class="acmp-s">${N(trabalho)} demandas em 30 dias</div></div>
      <div style="min-width:180px"><div class="acmp-l">Mensagens lidas (ontem/hoje)</div><div class="acmp-v">${N(msgsDia)}</div><div class="acmp-s">${N(grupos)} grupos vigiados · ${N(msgsMes)} no mês</div></div>
      <div style="min-width:180px"><div class="acmp-l">Custaria no mercado</div><div class="acmp-v" style="color:var(--amber)">${R(mercadoMes)}</div><div class="acmp-s">economia de ${R(mercadoMes-custoMes)}/mês</div></div>
    </div>
  </div>

  <div class="card" style="margin-top:14px">
    <h3>O que paga a conta</h3>
    <table class="tbl" style="width:100%;border-collapse:collapse;font-size:14px">
      <thead><tr><th style="text-align:left">Item</th><th style="text-align:right">Por mês</th><th style="text-align:left">Observação</th></tr></thead>
      <tbody>${CC_CUSTO.map(linha).join('')}
      <tr><td><b>Total</b></td><td style="text-align:right"><b>${R(custoMes)}</b></td><td></td></tr></tbody>
    </table>
    <div style="margin-top:10px;font-size:13px;color:var(--mut)">A leitura das mensagens é feita por <b>regra</b> (palavras e padrões), não por modelo de linguagem. Por isso o custo não cresce com o volume: ler 3.000 ou 30.000 mensagens por dia custa o mesmo.</div>
  </div>

  <div class="card" style="margin-top:14px">
    <h3>Quanto custaria comprar pronto</h3>
    <table class="tbl" style="width:100%;border-collapse:collapse;font-size:14px">
      <thead><tr><th style="text-align:left">Alternativa de mercado</th><th style="text-align:right">Por mês</th><th style="text-align:left">Base do cálculo</th></tr></thead>
      <tbody>${CC_MERCADO.map(linha).join('')}
      <tr><td><b>Total</b></td><td style="text-align:right"><b>${R(mercadoMes)}</b></td><td></td></tr></tbody>
    </table>
  </div>

  <div class="card" style="margin-top:14px">
    <h3>O que o sistema fez (últimos 30 dias)</h3>
    <div style="display:flex;flex-wrap:wrap;gap:22px">
      <div style="min-width:160px"><div class="acmp-l">Pedidos de coleta</div><div class="acmp-v">${N(coletas.n)}</div><div class="acmp-s">detectados no WhatsApp</div></div>
      <div style="min-width:160px"><div class="acmp-l">Coletas confirmadas</div><div class="acmp-v">${N((coletas.d||[]).filter(x=>x.status==='coletada').length)}</div><div class="acmp-s">ciclo fechado sozinho</div></div>
      <div style="min-width:160px"><div class="acmp-l">Cartões de inclusão</div><div class="acmp-v">${N(cartoes.n)}</div><div class="acmp-s">esteira das 7 etapas</div></div>
      <div style="min-width:160px"><div class="acmp-l">Pedidos reconhecidos</div><div class="acmp-v">${N(suspeitas.n)}</div><div class="acmp-s">inclusão + perguntas de amostra</div></div>
      <div style="min-width:160px"><div class="acmp-l">Mensagens enviadas</div><div class="acmp-v">${N(envios.n)}</div><div class="acmp-s">${N((envios.d||[]).filter(x=>x.tipo==='auto').length)} automáticas</div></div>
    </div>
    <div style="margin-top:10px;font-size:12.5px;color:var(--mut)">Fonte: banco do quadro (ao vivo) e uso publicado pelo ouvinte a cada 15 min. Valores de custo são fixos, definidos com o Wal — se algum mudar, é só corrigir na aba.</div>
  </div>`;
}

/* ---- aba 🧪 Apoio · TECSA (19/set/2026) — TECSA + consolidado dos dois apoios ---- */
let _apoiotOk=false, _apoiotCharts=[];
async function renderApoioT(force){
  const wrap=document.getElementById('apoiot'); if(!wrap) return;
  if(_apoiotOk && !force) return;
  wrap.innerHTML='<div class="card" style="margin-top:18px;color:var(--mut)">Carregando o apoio (TECSA)…</div>';
  let D;
  try{ const env=await fetchEncF('apoio_tecsa','data/apoio_tecsa.enc'); D=await decryptEncObj(env, window.__PW||''); }
  catch(e){ wrap.innerHTML=`<div class="card" style="margin-top:18px;color:var(--amber)">Painel da TECSA ainda não publicado (${esc(String(e.message||e))}).</div>`; return; }
  _apoiotOk=true; _apoiotCharts.forEach(c=>{try{if(c.$apIv)clearInterval(c.$apIv);c.destroy()}catch(e){}}); _apoiotCharts=[];
  const R=(v,d=0)=>v==null?'—':'R$ '+Number(v).toLocaleString('pt-BR',{minimumFractionDigits:d,maximumFractionDigits:d});
  const N=v=>v==null?'—':Math.round(v).toLocaleString('pt-BR');
  const P=(v,d=1)=>v==null?'—':Number(v).toLocaleString('pt-BR',{minimumFractionDigits:d,maximumFractionDigits:d})+'%';
  const K=D.kpi, M=D.meses, C=D.consolidado, CK=D.consolidado_kpi;
  const kpi=(rot,val,sub,cor)=>`<div style="min-width:170px;flex:1"><div class="acmp-l">${rot}</div><div class="acmp-v" style="font-size:21px;${cor?`color:${cor}`:''}">${val}</div><div class="acmp-s">${sub}</div></div>`;
  const STC={'saiu':'var(--green)','caiu':'var(--cyan)','caiu pouco':'var(--amber)','estável/subiu':'var(--red)','novo':'var(--purple)'};
  const STR={'saiu':'✅ saiu do apoio','caiu':'⬇ caiu','caiu pouco':'↘ caiu pouco','estável/subiu':'⚠ continua','novo':'🆕 novo'};
  const spark=(arr,cor)=>{const mx=Math.max(...arr,1);return `<span style="display:inline-flex;gap:2px;align-items:flex-end;height:18px">${arr.map(v=>`<span title="${v}" style="width:5px;height:${Math.max(1,v/mx*18)}px;background:${cor};opacity:${v?1:.25};border-radius:1px"></span>`).join('')}</span>`;};

  if(!document.getElementById('apPiscaCSS')){ const st=document.createElement('style'); st.id='apPiscaCSS';
    st.textContent=`@keyframes apPisca{0%,100%{opacity:1;transform:scale(1);text-shadow:0 0 18px rgba(0,229,160,.9)}50%{opacity:.25;transform:scale(.94);text-shadow:none}}
    @keyframes apBorda{0%,100%{box-shadow:0 0 0 0 rgba(0,229,160,.0),0 0 28px rgba(0,229,160,.55)}50%{box-shadow:0 0 0 6px rgba(0,229,160,.25),0 0 6px rgba(0,229,160,.1)}}
    .apPisca{animation:apPisca 1.1s ease-in-out infinite;display:inline-block}
    .apBig{font-size:clamp(38px,6vw,72px);font-weight:900;color:#00E5A0;letter-spacing:-.03em;line-height:1}
    .apBox{border:2px solid #00E5A0;border-radius:14px;padding:12px 18px;animation:apBorda 1.1s ease-in-out infinite;background:rgba(0,229,160,.07);text-align:center;flex:1;min-width:210px}
    .apChip{border-radius:10px;padding:6px 4px;text-align:center;flex:1;min-width:64px;background:rgba(255,255,255,.03);border:1px solid var(--line)}
    @keyframes alBorda{0%,100%{box-shadow:0 0 0 0 rgba(255,84,112,0),0 0 30px rgba(255,84,112,.6)}50%{box-shadow:0 0 0 7px rgba(255,84,112,.22),0 0 6px rgba(255,84,112,.1)}}
    @keyframes alPisca{0%,100%{opacity:1}50%{opacity:.3}}
    .alBox{border:2px solid #FF5470;border-radius:14px;background:rgba(255,84,112,.09);animation:alBorda 1.05s ease-in-out infinite;padding:14px 18px}
    .alPisca{animation:alPisca 1.05s ease-in-out infinite;display:inline-block}
    .alVal{font-size:clamp(30px,4.6vw,54px);font-weight:900;color:#FF5470;letter-spacing:-.03em;line-height:1}`;
    document.head.appendChild(st); }

  let h=`<div class="card" style="margin-top:18px">
    <h3>🧪 Laboratório de apoio · TECSA <span class="cap">${esc(D.apoio)} · ${esc(D.periodo)} · atualizado ${esc(D.gerado)}</span></h3>
    <div style="display:flex;flex-wrap:wrap;gap:22px;margin-top:10px">
      ${kpi('Pago à TECSA ('+esc(K.primeiro_rotulo)+'→'+esc(K.ultimo_rotulo)+')', R(K.total_custo), N(K.total_itens)+' exames · '+K.exames_distintos+' tipos · boleto '+R(K.total_boleto)+' + IR retido '+R(K.total_ir))}
      ${kpi('Janeiro → '+esc(K.ultimo_rotulo), R(K.jan)+' → '+R(K.ago), 'variação de <b style="color:var(--green)">'+P(K.queda_jan_ago_pct)+'</b>','var(--ink)')}
      ${kpi('Peso na receita da matriz', P(K.pct_receita_jan,2)+' → '+P(K.pct_receita_ago,2), 'custo ÷ faturamento HF do mês','var(--green)')}
      ${kpi('Os dois apoios juntos', R(CK.total), 'Vet Lab '+R(CK.vetlab)+' + TECSA '+R(CK.tecsa)+' · TECSA = '+P(CK.tecsa_pct)+' do apoio','var(--cyan)')}
      ${kpi('Custo médio por exame', R(K.custo_medio_item,2), 'na Vet Lab o ticket é bem menor — aqui vai o exame caro e raro')}
      ${kpi('Margem no que vai à TECSA', P(K.margem_bruta_pct_geral), 'preço praticado × custo do apoio · cobertura de preço '+P(K.cobertura_preco_pct))}
    </div>
    <div style="margin-top:14px;font-size:13.5px;line-height:1.65;background:linear-gradient(90deg,rgba(0,212,255,.08),transparent);border-left:3px solid var(--cyan);padding:10px 14px;border-radius:6px">
      <b>🧠 Interpretação</b><br>${(D.texto||[]).map(t=>'• '+esc(t)).join('<br>')}</div></div>`;
  if(D.aviso_parcial) h+=`<div class="card" style="margin-top:12px;border-left:3px solid var(--amber);background:rgba(255,176,32,.07)"><b style="color:var(--amber)">${esc(D.aviso_parcial)}</b></div>`;

  // ---- ⚠ ALERTA FORTE: exame indo para o apoio MAIS CARO (pedido do Wal 19/set) ----
  const AK=D.alerta_kpi||{}, AL=(D.alertas_preco||[]);
  const ativos=AL.filter(a=>a.ainda_envia), parados=AL.filter(a=>!a.ainda_envia);
  if(AL.length){
    h+=`<div class="alBox" style="margin-top:14px">
      <div style="display:flex;flex-wrap:wrap;gap:20px;align-items:center">
        <div style="flex:1;min-width:250px">
          <div style="font-size:15px;font-weight:900;color:#FF5470">${ativos.length?'🚨 <span class="alPisca">VOCÊ ESTÁ PAGANDO MAIS CARO</span>':'✅ Nenhum exame indo hoje para o apoio mais caro'}</div>
          <div style="font-size:13px;margin-top:4px;line-height:1.5">${ativos.length
            ? `<b>${N(ativos.length)}</b> exame(s) continuam indo para o apoio errado nos últimos 2 meses. No mesmo ritmo, isso custa <b>${R(AK.ativos_ano)} por ano</b>.`
            : `Os ${N(parados.length)} casos abaixo já pararam de ser enviados — ficam aqui como histórico.`}</div>
        </div>
        ${ativos.length?`<div style="text-align:center;min-width:190px"><div class="alVal alPisca">${R(AK.ativos_ano)}</div><div style="font-size:12px;font-weight:700;margin-top:2px">por ano, pago a mais</div><div style="font-size:11px;color:var(--mut)">${R(AK.ativos_periodo)} nos 8 meses</div></div>`:''}
      </div>
      <div style="overflow-x:auto;margin-top:12px"><table class="atab">
        <thead><tr><th>Exame</th><th>Está indo para</th><th>Deveria ir para</th><th class="num">A mais<br>por exame</th><th class="num">Qtd no<br>período</th><th class="num">Pago a mais<br>no período</th><th class="num">Por ano<br>no ritmo</th><th>Últimos<br>2 meses</th><th>Confere?</th></tr></thead><tbody>
        ${AL.map(a=>`<tr style="${a.ainda_envia?'background:rgba(255,84,112,.07)':'opacity:.55'}">
          <td><b>${esc(a.exame_hf||a.exame_vetlab||a.exame_tecsa)}</b><div style="font-size:10px;color:var(--mut)">${esc(a.exame_vetlab||'')}${a.exame_vetlab&&a.exame_tecsa?' · ':''}${esc(a.exame_tecsa||'')}</div></td>
          <td style="color:var(--red);white-space:nowrap"><b>${esc(a.indo_para)}</b> ${R(a.indo_para==='Vet Lab'?a.custo_vetlab:a.custo_tecsa,2)}</td>
          <td style="color:var(--green);white-space:nowrap"><b>${esc(a.deveria_ir)}</b> ${R(a.deveria_ir==='Vet Lab'?a.custo_vetlab:a.custo_tecsa,2)}</td>
          <td class="num" style="color:var(--red)"><b>${R(a.a_mais_por_exame,2)}</b></td>
          <td class="num">${N(a.qtd_errada)}</td>
          <td class="num">${R(a.pago_a_mais_periodo)}</td>
          <td class="num" style="color:${a.ainda_envia?'var(--red)':'var(--mut)'}">${R(a.pago_a_mais_ano)}</td>
          <td>${a.ainda_envia?`<span style="color:var(--red)">🔴 ainda envia (${N(a.qtd_ult2)})</span>`:'<span style="color:var(--mut)">parou</span>'}</td>
          <td style="font-size:11px;color:${a.confianca==='confira'?'var(--amber)':'var(--mut)'}">${a.confianca==='confira'?'⚠ conferir nome':'ok'}</td></tr>`).join('')}
      </tbody></table></div>
      <div style="font-size:11px;color:var(--mut);margin-top:8px">Comparo o mesmo exame nos dois apoios (Vet Lab com desconto × TECSA na fatura ou, quando nunca foi enviado, na tabela 2026 — que ainda é preço cheio). "Por ano no ritmo" = o que foi pago a mais nos 8 meses, projetado para 12. Antes de mudar a rota do material, confirme com o laboratório que é o mesmo método; as linhas com ⚠ são as que não tenho certeza.</div></div>`;
  }




  // ---- consolidado dos dois apoios (é o número que entra no custo) ----
  const seta=v=>v<0?'▼':'▲', corq=v=>v<0?'#00E5A0':'#FF5470';
  const big=(v,rot)=>`<div class="apBox" style="border-color:${corq(v)}"><div class="apBig apPisca" style="color:${corq(v)}">${seta(v)} ${P(Math.abs(v))}</div><div style="margin-top:6px;font-size:13px;font-weight:700">${rot}</div></div>`;
  h+=`<div class="card" style="margin-top:14px"><h3>🏦 Apoio total da Alpha, mês a mês <span class="cap">Vet Lab + TECSA · linha = % do faturamento do mês · % no topo = variação contra JANEIRO</span></h3>
    <div style="display:flex;flex-wrap:wrap;gap:14px;margin:10px 0 14px">
      ${big(CK.queda_pct,'apoio total: janeiro → '+esc(CK.ultimo_rotulo)+' ('+R(CK.jan)+' → '+R(CK.ago)+')')}
      ${big(K.queda_jan_ago_pct,'só TECSA: janeiro → '+esc(K.ultimo_rotulo)+' ('+R(K.jan)+' → '+R(K.ago)+')')}
      <div class="apBox" style="border-color:#00D4FF"><div class="apBig apPisca" style="color:#00D4FF">${R(CK.economia_anual)}</div><div style="margin-top:6px;font-size:13px;font-weight:700">custo evitado por ano<br><span style="font-weight:400;color:var(--mut)">ritmo de jul–ago × 1º trimestre, somando os dois apoios</span></div></div>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
      ${C.map((m,i)=>{if(m.parcial) return `<div class="apChip" style="border-color:var(--amber)"><div style="font-size:11px;color:var(--mut)">${m.rotulo.split('/')[0]}</div><div style="font-size:14px;font-weight:800;color:var(--amber);padding:3px 0">em aberto</div><div style="font-size:10.5px;color:var(--mut)">${R(m.total)}</div></div>`;
        const ant=C.filter((x,j)=>j<i&&!x.parcial), vj=(m.total/C[0].total-1)*100, va=ant.length?(m.total/ant[ant.length-1].total-1)*100:null;
        return `<div class="apChip"><div style="font-size:11px;color:var(--mut)">${m.rotulo.split('/')[0]}</div>
          <div class="${i&&vj<0?'apPisca':''}" style="font-size:20px;font-weight:900;color:${i?corq(vj):'var(--mut)'}">${i?seta(vj)+' '+P(Math.abs(vj),0):'base'}</div>
          <div style="font-size:10.5px;color:${va==null?'var(--mut)':corq(va)}">${va==null?'&nbsp;':'mês ant. '+(va<0?'−':'+')+P(Math.abs(va),0)}</div></div>`;}).join('')}
    </div>
    <div class="chartbox" style="height:340px"><canvas id="apTCons"></canvas></div>
    <div style="overflow-x:auto;margin-top:10px"><table class="atab"><thead><tr><th>Mês</th><th class="num">Vet Lab</th><th class="num">TECSA</th><th class="num">Apoio total</th><th class="num">TECSA % do apoio</th><th class="num">Faturamento HF</th><th class="num">% da receita</th></tr></thead><tbody>
    ${C.map(m=>`<tr><td>${m.rotulo}</td><td class="num">${R(m.vetlab,2)}</td><td class="num">${R(m.tecsa,2)}</td><td class="num"><b>${R(m.total,2)}</b></td><td class="num">${P(m.tecsa_pct_do_apoio)}</td><td class="num">${R(m.receita_hf)}</td><td class="num">${P(m.pct_receita,2)}</td></tr>`).join('')}
    </tbody></table></div></div>`;

  // ---- TECSA por mês e por área ----
  h+=`<div class="grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:14px;margin-top:14px">
    <div class="card"><h3>📉 TECSA por mês e por área <span class="cap">o gasto aqui é dirigido por poucos exames caros</span></h3><div class="chartbox" style="height:300px"><canvas id="apTMes"></canvas></div></div>
    <div class="card"><h3>💸 TECSA × Vet Lab no mesmo exame <span class="cap">custo unitário dos ${D.nos_dois_apoios.length} exames que os dois fazem</span></h3><div class="chartbox" style="height:300px"><canvas id="apTvsV"></canvas></div></div></div>`;

  // ---- onde dá para economizar trocando de apoio ----
  h+=`<div class="card" style="margin-top:14px"><h3>⚠️ Mesmo exame, dois preços <span class="cap">economia se o volume da Vet Lab fosse para o apoio mais barato: <b style="color:var(--green)">${R(D.economia_troca)}</b> no período (${N(D.economia_troca_qtd)} exames)</span></h3>
    <div style="overflow-x:auto"><table class="atab"><thead><tr><th>Exame (TECSA)</th><th>Exame (Vet Lab)</th><th class="num">TECSA</th><th class="num">Vet Lab</th><th class="num">Diferença</th><th>Mais barato</th><th class="num">Qtd Vet Lab</th><th class="num">Economia no período</th></tr></thead><tbody>
    ${D.nos_dois_apoios.map(d=>`<tr><td>${esc(d.exame_tecsa)}</td><td style="color:var(--mut)">${esc(d.exame_vetlab||'—')}</td><td class="num">${R(d.custo_unit,2)}</td><td class="num">${R(d.custo_vetlab,2)}</td><td class="num" style="color:${d.diferenca<0?'var(--green)':'var(--red)'}">${R(d.diferenca,2)}</td><td><b style="color:${d.quem_mais_barato==='TECSA'?'var(--cyan)':'var(--amber)'}">${esc(d.quem_mais_barato||'—')}</b></td><td class="num">${N(d.qtd_vetlab)}</td><td class="num" style="color:var(--green)">${d.economia_se_trocar?R(d.economia_se_trocar):'—'}</td></tr>`).join('')}
    </tbody></table></div>
    <div style="font-size:11px;color:var(--mut);margin-top:6px">Custo Vet Lab = mediana do valor com desconto (10% pagando até o vencimento). Custo TECSA = valor da fatura. O nome do exame é casado por semelhança — confira antes de mudar a rota do material.</div></div>`;

  // ---- COMPARADOR DOS DOIS APOIOS (pedido do Wal 19/set): ranking do que ele mais pede, preço dos dois ----
  const CP=D.comparador||[], CR=D.comparador_resumo||{};
  h+=`<div class="card" style="margin-top:14px"><h3>🔁 Comparador dos dois apoios <span class="cap">ranking pelos exames que a Alpha MAIS PEDE · preço da Vet Lab e da TECSA lado a lado · quando a TECSA nunca fez, vale a tabela 2026 deles (${N(CR.tabela_tecsa_itens)} exames)</span></h3>
    <div style="display:flex;flex-wrap:wrap;gap:18px;margin:8px 0 12px">
      ${kpi('Exames na lista', N(CR.exames), N(CR.nos_dois)+' com preço dos DOIS lados')}
      ${kpi('Vet Lab mais barata', N(CR.vetlab_mais_barata)+' exames', 'manter nela', 'var(--amber)')}
      ${kpi('TECSA mais barata', N(CR.tecsa_mais_barata)+' exames', 'candidatos a mudar de apoio', 'var(--cyan)')}
      ${kpi('Se cada um fosse ao mais barato', R(CR.economia_periodo), 'no período jan→ago, com o mesmo volume', 'var(--green)')}
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
      <input id="cpBusca" placeholder="Buscar exame…" style="background:var(--navy2);color:var(--ink);border:1px solid var(--line);border-radius:6px;padding:5px 9px;width:240px;max-width:100%">
      <label style="font-size:12px;color:var(--mut)"><input type="checkbox" id="cpDois"> só os que os dois fazem</label>
      <label style="font-size:12px;color:var(--mut)"><input type="checkbox" id="cpApoio"> só o que vai para apoio hoje</label>
      <label style="font-size:12px;color:var(--mut)"><input type="checkbox" id="cpTec"> só onde a TECSA é mais barata</label>
    </div>
    <div style="overflow-x:auto;max-height:620px;overflow-y:auto"><table class="atab" id="cpTab"><thead><tr>
      <th>#</th><th>Exame (nome no HF)</th><th class="num">Pedidos<br>no ano</th><th>Vai hoje para</th>
      <th class="num">Vet Lab</th><th class="num">TECSA</th><th class="num">Diferença</th><th>Mais barato</th>
      <th class="num">Economia<br>no período</th><th class="num">Preço Alpha</th><th class="num">Margem<br>Vet Lab</th><th class="num">Margem<br>TECSA</th><th>Confere?</th></tr></thead><tbody>
    ${CP.map(l=>{
      const nome=l.exame_hf||l.exame_vetlab||l.exame_tecsa||'—';
      const cor=l.mais_barato==='TECSA'?'var(--cyan)':l.mais_barato==='Vet Lab'?'var(--amber)':'var(--mut)';
      const bad=l.confianca==='confira';
      return `<tr data-n="${esc((nome+' '+(l.exame_vetlab||'')+' '+(l.exame_tecsa||'')).toLowerCase())}" data-dois="${l.custo_vetlab&&l.custo_tecsa?1:0}" data-apoio="${l.qtd_apoio?1:0}" data-tec="${l.mais_barato==='TECSA'?1:0}">
        <td style="color:var(--mut)">${l.rank}</td>
        <td>${esc(nome)}<div style="font-size:10px;color:var(--mut)">${l.exame_vetlab?'Vet Lab: '+esc(l.exame_vetlab):''}${l.exame_vetlab&&l.exame_tecsa?' · ':''}${l.exame_tecsa?'TECSA: '+esc(l.exame_tecsa):''}</div></td>
        <td class="num">${N(l.volume_hf)}</td>
        <td style="font-size:11.5px;color:${l.onde==='não foi ao apoio'?'var(--mut)':'var(--ink)'}">${esc(l.onde)}${l.qtd_apoio?` <span style="color:var(--mut)">(${N(l.qtd_apoio)})</span>`:''}</td>
        <td class="num">${l.custo_vetlab?R(l.custo_vetlab,2):'<span style="color:var(--mut)">não faz</span>'}</td>
        <td class="num">${l.custo_tecsa?R(l.custo_tecsa,2)+`<div style="font-size:9.5px;color:var(--mut)">${esc(l.fonte_tecsa||'')}</div>`:'<span style="color:var(--mut)">sem preço</span>'}</td>
        <td class="num">${l.diferenca==null?'—':R(Math.abs(l.diferenca),2)+(l.diferenca_pct!=null?`<div style="font-size:9.5px;color:var(--mut)">${P(Math.abs(l.diferenca_pct),0)}</div>`:'')}</td>
        <td style="color:${cor};white-space:nowrap"><b>${esc(l.mais_barato||'—')}</b></td>
        <td class="num" style="color:${l.economia_periodo?'var(--green)':'var(--mut)'}">${l.economia_periodo?R(l.economia_periodo):'—'}</td>
        <td class="num">${l.preco_alpha?R(l.preco_alpha,2):'—'}</td>
        <td class="num">${P(l.margem_vetlab)}</td><td class="num">${P(l.margem_tecsa)}</td>
        <td style="font-size:11px;color:${bad?'var(--amber)':'var(--mut)'}">${l.confianca?(bad?'⚠ conferir nome':'ok'):''}</td></tr>`;}).join('')}
    </tbody></table></div>
    <div style="font-size:11px;color:var(--mut);margin-top:6px">"Pedidos no ano" = quantas vezes o exame apareceu na conta da Alpha em 2026 (itemização do HF), mesmo quando é feito em casa — serve para ordenar pelo que mais pesa. Vet Lab = mediana cobrada com desconto; TECSA = valor da fatura ou, quando nunca foi enviado, o preço da tabela 2026. Os nomes são casados por semelhança; "⚠ conferir nome" marca os pares em que não tenho certeza.</div></div>`;

  // ---- de-para completo ----
  h+=`<div class="card" style="margin-top:14px"><h3>🔁 De-para de tudo <span class="cap">exame na fatura da TECSA → tabela TECSA 2026 (${N(K.tabela_tecsa_itens)} exames) → nome no HF → preço da Alpha → margem · Pareto: ${K.exames_para_80pct} exames = 80% do gasto, top 10 = ${P(K.top10_pct)}</span></h3>
    <div style="margin:4px 0 8px"><input id="apTBusca" placeholder="Buscar exame…" style="background:var(--navy2);color:var(--ink);border:1px solid var(--line);border-radius:6px;padding:5px 9px;width:260px;max-width:100%"></div>
    <div style="overflow-x:auto;max-height:560px;overflow-y:auto"><table class="atab" id="apTTab"><thead><tr><th>#</th><th>Exame na TECSA</th><th>Status</th><th class="num">Qtd</th><th class="num">Custo un.</th><th class="num">Total</th><th class="num">Tabela TECSA</th><th>Nome no HF</th><th class="num">Preço Alpha</th><th class="num">Margem</th><th class="num">Custo ÷ preço</th><th>${esc(M[0].rotulo.split('/')[0])}→${esc(M[M.length-1].rotulo.split('/')[0].replace('*',''))}</th></tr></thead><tbody>
    ${D.depara.map((d,i)=>{const cp=d.custo_sobre_preco, cc=cp==null?'var(--mut)':cp>=75?'var(--red)':cp>=65?'var(--amber)':'var(--green)';
      return `<tr data-n="${esc((d.exame_tecsa+' '+(d.exame_hf||'')).toLowerCase())}"><td style="color:var(--mut)">${i+1}</td>
      <td>${esc(d.exame_tecsa)}<div style="font-size:10.5px;color:var(--mut)">cód. ${esc(d.codigo)} · ${esc(d.categoria)}</div></td>
      <td style="color:${STC[d.status]};white-space:nowrap">${STR[d.status]}</td>
      <td class="num">${N(d.qtd)}</td><td class="num">${R(d.custo_unit,2)}</td><td class="num">${R(d.custo_total,2)}</td>
      <td class="num" title="tabela de preços TECSA 2026">${d.preco_tabela_tecsa?R(d.preco_tabela_tecsa,2):'—'}</td>
      <td style="font-size:12px">${d.exame_hf?esc(d.exame_hf)+`<div style="font-size:10px;color:var(--mut)">semelhança ${P(d.similaridade*100,0)}</div>`:'<span style="color:var(--amber)">não identifiquei</span>'}</td>
      <td class="num">${d.preco_alpha?R(d.preco_alpha,2):'—'}</td><td class="num">${P(d.margem_pct)}</td>
      <td class="num" style="color:${cc}">${P(cp)}</td><td>${spark(d.por_mes,'var(--cyan)')}</td></tr>`;}).join('')}
    </tbody></table></div>
    <div style="font-size:11px;color:var(--mut);margin-top:6px">Preço da Alpha = mediana do valor cobrado no HF em 2026 (acima de R$ 0) para o exame equivalente. Sem preço identificado: ${R(K.sem_preco_rs)} do gasto — em geral painéis que a Alpha vende separados por agente. ${P(100-K.ligados_hf_pct)} dos itens não achei a requisição no HF (a fatura da TECSA não traz o número).</div></div>`;

  // ---- ainda envia + conferência ----
  h+=`<div class="card" style="margin-top:14px"><h3>📋 O que ainda foi para a TECSA em ${esc(K.parcial_rotulo||K.ultimo_rotulo)} <span class="cap">ordenado por R$ do período${K.parcial_rotulo?' · '+esc(K.parcial_rotulo)+' é mês em andamento':''}</span></h3>
    <div style="overflow-x:auto"><table class="atab"><thead><tr><th>Exame</th><th>Área</th><th class="num">${esc((K.parcial_rotulo||K.ultimo_rotulo).replace('*',''))} (qtd)</th><th class="num">Custo un.</th><th class="num">Preço Alpha</th><th class="num">Margem</th><th>${esc(M[0].rotulo.split('/')[0])}→${esc(M[M.length-1].rotulo.split('/')[0].replace('*',''))}</th></tr></thead><tbody>
    ${D.ainda_envia.map(d=>`<tr><td>${esc(d.exame_tecsa)}</td><td style="color:var(--mut);font-size:12px">${esc(d.categoria)}</td><td class="num">${N(d.por_mes[d.por_mes.length-1])}</td><td class="num">${R(d.custo_unit,2)}</td><td class="num">${d.preco_alpha?R(d.preco_alpha,2):'—'}</td><td class="num">${P(d.margem_pct)}</td><td>${spark(d.por_mes,'var(--amber)')}</td></tr>`).join('')}
    </tbody></table></div></div>`;

  h+=`<div class="card" style="margin-top:14px"><h3>🧾 Faturas conferidas <span class="cap">soma dos itens = total impresso · total − desconto − IR retido = boleto</span></h3>
    <div style="overflow-x:auto"><table class="atab"><thead><tr><th>Mês</th><th class="num">Itens</th><th class="num">Atendimentos</th><th class="num">Bruto</th><th class="num">Desconto</th><th class="num">Custo</th><th class="num">IR retido</th><th class="num">Boleto</th><th>NF</th><th>Confere</th></tr></thead><tbody>
    ${M.map((m,i)=>`<tr><td>${m.rotulo}</td><td class="num">${N(m.itens)}</td><td class="num">${N(m.requisicoes)}</td><td class="num">${R(m.bruto,2)}</td><td class="num">${R(m.desconto,2)}</td><td class="num"><b>${R(m.custo,2)}</b></td><td class="num">${R(m.ir_retido,2)}</td><td class="num">${R(m.boleto,2)}</td><td>${esc(m.nf||'—')}</td><td style="color:${D.conferencia[i].ok?'var(--green)':'var(--red)'}">${D.conferencia[i].ok?'✅ bate':'⚠ conferir'}</td></tr>`).join('')}
    </tbody></table></div>
    <div style="font-size:11px;color:var(--mut);margin-top:6px">O boleto vem líquido do IR retido na fonte (1,5%), que a Alpha recolhe. O custo real do mês é o bruto menos o desconto da nota.</div></div>`;

  h+=`<div class="card" style="margin-top:14px"><h3>🏁 Benchmark de mercado <span class="cap">com fonte · vale para os dois apoios</span></h3>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;margin-top:8px">
    ${(D.benchmark||[]).map(b=>`<div style="border:1px solid var(--line);border-radius:10px;padding:12px;background:rgba(255,255,255,.02)">
      <div style="font-size:11px;color:var(--mut);text-transform:uppercase;letter-spacing:.05em">${esc(b.t)}</div>
      <div style="font-size:16px;font-weight:800;margin:4px 0;color:var(--cyan)">${esc(b.v)}</div>
      <div style="font-size:12.5px;line-height:1.5">${esc(b.leitura)}</div>
      <div style="font-size:10.5px;color:var(--mut);margin-top:6px">Fonte: ${esc(b.fonte)}</div></div>`).join('')}
    </div></div>`;
  wrap.innerHTML=h;

  const cpF=()=>{const q=(document.getElementById('cpBusca')||{}).value||'', d2=document.getElementById('cpDois').checked,
      ap=document.getElementById('cpApoio').checked, tc=document.getElementById('cpTec').checked;
    document.querySelectorAll('#cpTab tbody tr').forEach(tr=>{
      const ok=tr.dataset.n.includes(q.toLowerCase()) && (!d2||tr.dataset.dois==='1') && (!ap||tr.dataset.apoio==='1') && (!tc||tr.dataset.tec==='1');
      tr.style.display=ok?'':'none';});};
  ['cpBusca','cpDois','cpApoio','cpTec'].forEach(id=>{const el=document.getElementById(id); if(el) el.addEventListener(el.type==='checkbox'?'change':'input',cpF);});
  const busca=document.getElementById('apTBusca');
  if(busca) busca.addEventListener('input',()=>{const q=busca.value.toLowerCase(); document.querySelectorAll('#apTTab tbody tr').forEach(tr=>{tr.style.display=tr.dataset.n.includes(q)?'':'none';});});
  if(!window.Chart) return;
  const tick={color:'#8aa2bd',font:{size:10}}, grid={color:'rgba(255,255,255,.05)'};
  const lab=C.map(m=>m.rotulo), maxT=Math.max(...C.map(m=>m.total));
  const chCons=new Chart(document.getElementById('apTCons'),{type:'bar',data:{labels:lab,datasets:[
      {label:'Vet Lab',data:C.map(m=>m.vetlab),backgroundColor:'#FFB020',stack:'s',yAxisID:'y',order:2},
      {label:'TECSA',data:C.map(m=>m.tecsa),backgroundColor:'#00D4FF',stack:'s',yAxisID:'y',order:2},
      {type:'line',label:'% do faturamento',data:C.map(m=>m.pct_receita),borderColor:'#00E5A0',backgroundColor:'#00E5A0',yAxisID:'y2',tension:.3,pointRadius:4,order:1}]},
    options:{responsive:true,maintainAspectRatio:false,animation:false,layout:{padding:{top:34}},
      plugins:{legend:{labels:{color:'#8aa2bd',font:{size:11}}},tooltip:{callbacks:{label:c=>c.dataset.yAxisID==='y2'?' '+P(c.raw,2)+' da receita':' '+c.dataset.label+': '+R(c.raw)}}},
      scales:{x:{stacked:true,ticks:tick,grid},y:{stacked:true,suggestedMax:maxT*1.18,ticks:{...tick,callback:v=>'R$ '+(v/1000)+'k'},grid},
              y2:{position:'right',ticks:{...tick,callback:v=>v+'%'},grid:{display:false},min:0}}},
    plugins:[{id:'apTPct',afterDatasetsDraw(ch){
      const ctx=ch.ctx, meta=ch.getDatasetMeta(1), on=(Math.floor(Date.now()/550)%2)===0;
      ctx.save(); ctx.textAlign='center'; ctx.font='800 13px system-ui';
      C.forEach((m,i)=>{ if(!i||m.parcial) return; const v=(m.total/C[0].total-1)*100, el=meta.data[i]; if(!el) return;
        ctx.globalAlpha=on?1:.35; ctx.fillStyle=v<0?'#00E5A0':'#FF5470';
        ctx.fillText((v<0?'▼ ':'▲ ')+Math.abs(v).toFixed(0)+'%', el.x, el.y-8); });
      ctx.restore(); }}]});
  if(document.getElementById('apTCons').offsetParent) chCons.$apIv=setInterval(()=>{try{chCons.draw()}catch(e){}},550);
  _apoiotCharts.push(chCons);

  const cats=[...new Set(M.flatMap(m=>Object.keys(m.por_categoria)))];
  const cor={'Imuno-histoquímica':'#FF6AD5','Biologia molecular (PCR)':'#A78BFA','Sorologia':'#00D4FF','Microbiologia':'#00E5A0','Bioquímica especial / outros':'#FFB020'};
  _apoiotCharts.push(new Chart(document.getElementById('apTMes'),{type:'bar',data:{labels:M.map(m=>m.rotulo),
      datasets:cats.map(c=>({label:c,data:M.map(m=>m.por_categoria[c]||0),backgroundColor:cor[c]||'#8aa2bd',stack:'s'}))},
    options:{responsive:true,maintainAspectRatio:false,animation:false,plugins:{legend:{labels:{color:'#8aa2bd',font:{size:10}}},
      tooltip:{callbacks:{label:c=>' '+c.dataset.label+': '+R(c.raw,2)}}},
      scales:{x:{stacked:true,ticks:tick,grid},y:{stacked:true,ticks:{...tick,callback:v=>'R$ '+(v/1000)+'k'},grid}}}}));

  const nd=D.nos_dois_apoios.slice(0,12);
  _apoiotCharts.push(new Chart(document.getElementById('apTvsV'),{type:'bar',data:{labels:nd.map(d=>d.exame_tecsa.length>28?d.exame_tecsa.slice(0,27)+'…':d.exame_tecsa),
      datasets:[{label:'TECSA',data:nd.map(d=>d.custo_unit),backgroundColor:'#00D4FF'},
                {label:'Vet Lab',data:nd.map(d=>d.custo_vetlab),backgroundColor:'#FFB020'}]},
    options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,animation:false,
      plugins:{legend:{labels:{color:'#8aa2bd',font:{size:11}}},tooltip:{callbacks:{label:c=>' '+c.dataset.label+': '+R(c.raw,2)}}},
      scales:{x:{ticks:{...tick,callback:v=>'R$ '+v},grid},y:{ticks:{...tick,font:{size:9}},grid:{display:false}}}}}));
}
