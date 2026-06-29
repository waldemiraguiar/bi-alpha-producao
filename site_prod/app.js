/* Painel de Produção (TV) — abas por categoria, derivações visuais, rotação automática.
   Trava por categoria via URL (#15 ou #citopatologia) para TVs de setor. Sem R$, sem volumes. */
const C={navy:'#0A1628',cyan:'#00D4FF',green:'#00E5A0',amber:'#FFB020',red:'#FF5470',purple:'#A78BFA',petlove:'#FF6AD5',mut:'#8aa2bd'};
const num=n=>Math.round(n||0).toLocaleString('pt-BR');
const LS='bi_prod_pwd', ROTATE=15000; // 15s por categoria
const b64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
let ENC=null,REFRESH=null,ROT=null,DATA=null,active=0,locked=null,pinned=false;
const URG_API='/api/urgentes';
let manual=new Set(), baixados=new Set(), baixasInfo=[];
// baixa de EXAME na Produção (PIN admin) — chave única por exame = registro|exame
let prodBaixados=new Set(), prodBaixaInfo=[];
const exChave=e=>String(e.registro)+'|'+(e.exame||'');
const exBaixado=e=>prodBaixados.has(exChave(e));
function setOverlays(j){manual=new Set((j.urgentes||[]).map(u=>String(u.registro))); baixados=new Set((j.baixas||[]).map(u=>String(u.registro))); baixasInfo=(j.baixas||[]);}
async function loadManual(){ try{ if(window.SUPA&&window.SUPA.ok){const o=await window.SUPA.loadUrg(); setOverlays({urgentes:o.urgentes,baixas:o.baixas}); try{prodBaixaInfo=await window.SUPA.loadProd(); prodBaixados=new Set(prodBaixaInfo.map(b=>String(b.chave)));}catch(e){} return;} const r=await fetch('/api/overlays?_='+Date.now()); if(r.ok){const o=await r.json(); setOverlays({urgentes:o.urgentes,baixas:o.urg_baixas});}}catch(e){} }
// urgente de verdade = (sistema OU manual) E NÃO baixado
const urgentOf=e=>{const r=String(e.registro);return (e.urgente||manual.has(r))&&!baixados.has(r);};
async function post(payload,errMsg){
  try{
    if(window.SUPA&&window.SUPA.ok){
      const tbl=payload.tipo==='baixa'?'urg_baixas':'urg_lista';
      if(payload.acao==='remove') await window.SUPA.delUrg(tbl,payload.registro);
      else await window.SUPA.upsertUrg(tbl,{registro:String(payload.registro),paciente:payload.paciente||'',exame:payload.exame||'',por:payload.por||'equipe',ts:Date.now()});
      await loadManual(); renderActive(); return;
    }
    const r=await fetch(URG_API,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({...payload,senha:window.__pwd})});
    if(!r.ok){alert(errMsg);return;} setOverlays(await r.json()); renderActive();
  }catch(e){alert('Erro de conexão.');}
}
function toggleUrg(reg,pac,exm,isOn){post({tipo:'urgente',registro:reg,paciente:pac,exame:exm,acao:isOn?'remove':'add'},'Não foi possível marcar.');}
function darBaixa(reg,pac,exm,isManual){
  if(!confirm('Dar baixa neste urgente? Ele sai do alerta de urgência (continua na fila normal até o sistema concluir).'))return;
  if(isManual) post({tipo:'urgente',registro:reg,paciente:pac,exame:exm,acao:'remove'},'Não foi possível dar baixa.');
  else post({tipo:'baixa',registro:reg,paciente:pac,exame:exm,acao:'add'},'Não foi possível dar baixa.');
}
function onContentClick(ev){
  const u=ev.target.closest('.urgbtn'); if(u){toggleUrg(u.dataset.reg,u.dataset.pac,u.dataset.exm,manual.has(String(u.dataset.reg)));return;}
  const b=ev.target.closest('.baixabtn'); if(b){darBaixa(b.dataset.reg,b.dataset.pac,b.dataset.exm,b.dataset.manual==='1');return;}
  const d=ev.target.closest('.desfazbtn'); if(d){post({tipo:'baixa',registro:d.dataset.reg,acao:'remove'},'Não foi possível desfazer.');return;}
  const xb=ev.target.closest('.exbaixabtn'); if(xb){exBaixar(xb.dataset);return;}
  const lb=ev.target.closest('.limpabtn'); if(lb){limparAtrasados();return;}
  const ub=ev.target.closest('.undobtn'); if(ub){undoBaixas();return;}}
// --- baixa de EXAME na Produção (PIN admin) ---
let __pin=null;
async function pedePin(){
  if(__pin) return __pin;
  if(!(window.SUPA&&window.SUPA.ok)){alert('Sem conexão com o servidor — baixa de exame indisponível.');return null;}
  const p=prompt('PIN admin para dar baixa no exame:'); if(!p) return null;
  const ok=await window.SUPA.admincheck(p); if(!ok){alert('PIN inválido.');return null;}
  __pin=p; return p;
}
async function exBaixar(d){
  if(!confirm(`Dar baixa no EXAME?\n\n#${d.reg} · ${d.pac}\n${d.exm}\n\nSai da Produção (não depende do HF). Dá pra desfazer.`))return;
  const pin=await pedePin(); if(!pin) return;
  try{ await window.SUPA.prodBaixar([{chave:d.reg+'|'+d.exm,registro:d.reg,exame:d.exm,paciente:d.pac,cat:d.cat,atrasado:d.atr==='1'}],pin);
    await loadManual(); renderActive(); }
  catch(e){ if(/pin/i.test(e.message||''))__pin=null; alert('Não foi possível: '+(e.message||e)); }
}
async function limparAtrasados(){
  const alvo=window.__limparAlvo||[]; if(!alvo.length){alert('Nenhum atrasado nesta aba.');return;}
  if(!confirm(`Limpar ${alvo.length} atrasado(s) desta aba?\n\nTodos saem da Produção (dá pra desfazer).`))return;
  const pin=await pedePin(); if(!pin) return;
  try{ await window.SUPA.prodBaixar(alvo,pin); await loadManual(); renderActive(); }
  catch(e){ if(/pin/i.test(e.message||''))__pin=null; alert('Não foi possível: '+(e.message||e)); }
}
async function undoBaixas(){
  const cat=window.__curCat||''; const info=(prodBaixaInfo||[]).filter(b=>!cat||b.cat===cat);
  if(!info.length){alert('Nada baixado nesta aba.');return;}
  const lista=info.slice(-25).map(b=>`#${b.registro} · ${b.exame}`).join('\n');
  if(!confirm(`Desfazer ${info.length} baixa(s)${cat?' de '+cat:''}? Os exames VOLTAM pra fila.\n\n${lista}`))return;
  const pin=await pedePin(); if(!pin) return;
  try{ await window.SUPA.prodUnbaixar(info.map(b=>b.chave),pin); await loadManual(); renderActive(); }
  catch(e){ if(/pin/i.test(e.message||''))__pin=null; alert('Não foi possível: '+(e.message||e)); }
}
const escA=s=>esc(s).replace(/"/g,'&quot;');
const isPetlove=s=>/pet\s*love/i.test(String(s||''));
let searchTerm='';
function filterWL(){const t=searchTerm.trim().toLowerCase();
  document.querySelectorAll('#content .wl').forEach(row=>{
    const reg=(row.querySelector('.reg')?.textContent||'').toLowerCase();
    const pac=(row.querySelector('.pac')?.textContent||'').toLowerCase();
    row.style.display=(!t||reg.includes(t)||pac.includes(t))?'':'none';});}
function onSearch(ev){if(ev.target.id!=='wlsearch')return;
  searchTerm=ev.target.value; pinned=true; if(ROT)clearInterval(ROT);
  const rc=document.getElementById('rotctl'); if(rc){rc.classList.add('pinned');rc.textContent='⏸ fixado · clique p/ girar';}
  filterWL();}
// ORDEM das abas (nomes/trechos na ordem desejada; vazio = ordem padrão por gravidade).
// EXAMES URGENTES é sempre a 1ª. Preencher conforme o usuário definir.
const ORDER=['hematologia','bioquimica','uroanalise','parasito','citopatologia','especializados','molecular','imunologia','bacteriologia','necropsia'];
function catOrderIdx(name){const i=ORDER.findIndex(o=>slug(name).includes(slug(o)));return i<0?99:i;}
function buildSpecial(list,pred,opts){
  const items=[];
  list.forEach(c=>(c.exames||[]).forEach(e=>{
    if(pred(e,c)&&!exBaixado(e)) items.push({...e,categoria:c.categoria,_urg:urgentOf(e),_manual:manual.has(String(e.registro))&&!e.urgente&&!baixados.has(String(e.registro))});
  }));
  items.sort((a,b)=>(b._urg?1:0)-(a._urg?1:0)||b.dias-a.dias);
  const byCat={}; items.forEach(e=>{const k=e.categoria;(byCat[k]=byCat[k]||{exame:k,em_processo:0,atrasado:0});byCat[k].em_processo++;if(e.atrasado)byCat[k].atrasado++;});
  const atras=items.filter(e=>e.atrasado).length;
  return {cod:opts.cod,categoria:opts.nome,special:true,kind:opts.kind,sla:null,
    em_processo:items.length,atrasado:atras,no_prazo:items.length-atras,
    pct_no_prazo:items.length?Math.round(100*(items.length-atras)/items.length):100,
    tat_medio:null,urgentes:items.filter(e=>e._urg).length,urgentes_list:items.filter(e=>e._urg).slice(0,10),exames:items,
    derivacoes:Object.values(byCat).map(d=>({...d,pct:d.em_processo?Math.round(100*(d.em_processo-d.atrasado)/d.em_processo):100})).sort((a,b)=>catOrderIdx(a.exame)-catOrderIdx(b.exame))};
}
function buildUrgentCat(list){return buildSpecial(list,e=>urgentOf(e),{cod:'__URG__',nome:'EXAMES URGENTES',kind:'urg'});}
function buildPetCat(list){return buildSpecial(list,e=>isPetlove(e.paciente),{cod:'__PET__',nome:'PET LOVE',kind:'pet'});}
function buildAtrasCat(list){return buildSpecial(list,e=>e.atrasado,{cod:'__ATR__',nome:'ATRASADOS',kind:'atras'});}
// Desconta os exames baixados (PIN) de uma categoria NORMAL — contadores, derivações e lista batem.
function adjustCat(x){
  if(!x||x.special||!prodBaixados.size) return x;
  const ex=x.exames||[], baix=ex.filter(exBaixado);
  if(!baix.length) return x;
  const byT={},byTA={}; baix.forEach(e=>{const t=e.exame||'';byT[t]=(byT[t]||0)+1;if(e.atrasado)byTA[t]=(byTA[t]||0)+1;});
  const nB=baix.length, nBA=baix.filter(e=>e.atrasado).length;
  const emp=Math.max(0,(x.em_processo||0)-nB), atr=Math.max(0,(x.atrasado||0)-nBA);
  const ders=(x.derivacoes||[]).map(d=>{const ep=Math.max(0,d.em_processo-(byT[d.exame]||0)),at=Math.max(0,d.atrasado-(byTA[d.exame]||0));return {...d,em_processo:ep,atrasado:at,pct:ep?Math.round(100*(ep-at)/ep):100};}).filter(d=>d.em_processo>0);
  return {...x,exames:ex.filter(e=>!exBaixado(e)),em_processo:emp,atrasado:atr,no_prazo:emp-atr,pct_no_prazo:emp?Math.round(100*(emp-atr)/emp):100,derivacoes:ders};
}

// Busca o .enc da FUNÇÃO (/api/enc, baratíssimo — atualizado sem deploy) e CAI no arquivo
// estático data/producao.enc se a função falhar/estiver vazia. Nunca quebra o painel.
async function fetchEnc(){
  try{
    const r=await fetch('/api/enc?_='+Date.now());
    if(r.ok){const j=await r.json(); if(j&&j.ct&&j.salt&&j.iv) return j;}
  }catch(e){}
  return await fetch('data/producao.enc?_='+Date.now()).then(r=>{if(!r.ok)throw new Error('sem dados');return r.json();});
}
async function decrypt(pwd){
  ENC=await fetchEnc();
  const bk=await crypto.subtle.importKey('raw',new TextEncoder().encode(pwd),'PBKDF2',false,['deriveKey']);
  const key=await crypto.subtle.deriveKey({name:'PBKDF2',salt:b64(ENC.salt),iterations:ENC.iter,hash:'SHA-256'},bk,{name:'AES-GCM',length:256},false,['decrypt']);
  const pt=await crypto.subtle.decrypt({name:'AES-GCM',iv:b64(ENC.iv)},key,b64(ENC.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}
function tick(){const d=new Date();
  document.getElementById('clk').textContent=d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  document.getElementById('dat').textContent=d.toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long'});}
const slug=s=>String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]/gi,'').toLowerCase();

(function gate(){
  const f=document.getElementById('gateForm'),p=document.getElementById('gatePwd'),er=document.getElementById('gateErr'),b=document.getElementById('gateBtn');
  const _BIO='bi_prod_bio';
  const _be=x=>btoa(String.fromCharCode(...new Uint8Array(x))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const _bd=x=>{x=x.replace(/-/g,'+').replace(/_/g,'/');return Uint8Array.from(atob(x),c=>c.charCodeAt(0));};
  const gbio=document.getElementById('gateBio'), bset=document.getElementById('bioSetup');
  tick();setInterval(tick,1000);
  async function unlock(pw,fromLS){
    try{const D=await decrypt(pw);localStorage.setItem(LS,pw);window.__pwd=pw;
      document.getElementById('gate').style.display='none';document.getElementById('tv').style.display='';boot(D);
      if(window.PublicKeyCredential && bset && !localStorage.getItem(_BIO)) bset.style.display='';}
    catch(e){if(fromLS){localStorage.removeItem(LS);return;}
      er.textContent=/sem dados/.test(e.message)?'Dados indisponíveis.':'Senha incorreta.';b.disabled=false;b.textContent='Entrar';p.select();}
  }
  f.addEventListener('submit',e=>{e.preventDefault();er.textContent='';b.disabled=true;b.textContent='Verificando…';unlock(p.value,false);});
  /* ---- digital / Touch ID (por aparelho; NÃO afeta a TV) ---- */
  if(gbio) gbio.onclick=async()=>{ const id=localStorage.getItem(_BIO); if(!id)return;
    try{gbio.textContent='👆 Toque o leitor…';
      await navigator.credentials.get({publicKey:{challenge:crypto.getRandomValues(new Uint8Array(32)),allowCredentials:[{type:'public-key',id:_bd(id)}],userVerification:'required',timeout:60000,rpId:location.hostname}});
      unlock(localStorage.getItem(LS),true);
    }catch(e){console.warn(e);gbio.textContent='👆 Entrar com digital';} };
  if(bset) bset.onclick=async()=>{ const pw=localStorage.getItem(LS); if(!pw)return;
    try{bset.textContent='👆 Toque p/ ativar…';
      const c=await navigator.credentials.create({publicKey:{challenge:crypto.getRandomValues(new Uint8Array(32)),rp:{name:'BI Produção Alpha — Atlas Digital',id:location.hostname},user:{id:crypto.getRandomValues(new Uint8Array(16)),name:'prod',displayName:'BI Produção'},pubKeyCredParams:[{type:'public-key',alg:-7},{type:'public-key',alg:-257}],authenticatorSelection:{authenticatorAttachment:'platform',userVerification:'required'},timeout:60000,attestation:'none'}});
      localStorage.setItem(_BIO,_be(c.rawId)); bset.textContent='✅ Digital ativa neste PC'; setTimeout(()=>{bset.style.display='none';},1800);
    }catch(e){console.warn(e);bset.textContent='👆 Proteger com digital';} };
  /* auto-entrar SÓ se NÃO houver digital neste aparelho → a TV continua sozinha; seu PC pede o dedo */
  const s=localStorage.getItem(LS);
  if(s && localStorage.getItem(_BIO) && gbio){ gbio.style.display=''; p.placeholder='ou use a senha'; }
  else if(s){ unlock(s,true); }
})();

function cats(){
  let list=(DATA.categorias||[]).filter(x=>x.em_processo>0 || (x.derivacoes&&x.derivacoes.length));
  if(ORDER.length){ const idx=c=>{const i=ORDER.findIndex(o=>slug(c.categoria).includes(slug(o)));return i<0?99:i;};
    list=[...list].sort((a,b)=>idx(a)-idx(b)); }
  return [buildUrgentCat(list), buildPetCat(list), buildAtrasCat(list), ...list];   // 3 abas especiais primeiro
}
function resolveLock(list){
  const h=decodeURIComponent((location.hash||'').replace('#','')).trim();
  if(!h) return null;
  let c=list.find(x=>String(x.cod)===h);
  if(!c){const sh=slug(h); c=list.find(x=>slug(x.categoria)===sh)||list.find(x=>slug(x.categoria).includes(sh));}
  return c||null;
}

async function boot(D){
  DATA=D;
  await loadManual();
  locked=resolveLock(cats());
  buildTabs(); active=0; renderActive(); startRotation();
  if(!window.__wired){window.__wired=true;
    document.getElementById('content').addEventListener('click',onContentClick);
    document.getElementById('content').addEventListener('input',onSearch);
    window.addEventListener('hashchange',()=>{locked=resolveLock(cats());active=0;buildTabs();renderActive();startRotation();});
  }
  if(REFRESH)clearInterval(REFRESH);
  REFRESH=setInterval(async()=>{if(document.hidden)return;try{DATA=await decrypt(window.__pwd);await loadManual();buildTabs();renderActive();}catch(e){console.warn(e);}},10*60*1000);
  // urgentes manuais propagam entre TVs em ~90s (só com a aba visível — poupa créditos)
  if(window.__muref)clearInterval(window.__muref);
  // urgentes só importam no modo TV. Com Supabase: Realtime (push, zero polling); senão: polling 90s
  if(window.SUPA&&window.SUPA.ok){
    if(!window.__urgsub) window.__urgsub=window.SUPA.subscribe(['urg_lista','urg_baixas'],async()=>{if(document.getElementById('content').style.display!=='none'){await loadManual();renderActive();}});
  }else{
    window.__muref=setInterval(async()=>{if(document.hidden||document.getElementById('content').style.display==='none')return;const k=[...manual].sort().join();await loadManual();if(k!==[...manual].sort().join())renderActive();},90000);
  }
  if(!window.__visref){window.__visref=true;document.addEventListener('visibilitychange',()=>{if(!document.hidden&&document.getElementById('content').style.display!=='none'){loadManual().then(renderActive).catch(()=>{});}});}
}

function buildTabs(){
  const upd=DATA.meta.gerado_em.slice(11,16);
  document.getElementById('upd').textContent='dados '+upd+' · 10 min';
  const list=cats(); const tabsEl=document.getElementById('tabs'); const contentEl=document.getElementById('content');
  if(locked){
    tabsEl.style.display='none'; contentEl.classList.add('locked');
    document.getElementById('subtitle').textContent='Setor: '+locked.categoria;
    return;
  }
  tabsEl.style.display=''; contentEl.classList.remove('locked');
  document.getElementById('subtitle').textContent='Fila operacional · prazos de liberação';
  const KT={urg:{t:'urgtab',i:'🚨',b:'urgb'},pet:{t:'pettab',i:'💗',b:'petb'},atras:{t:'atrastab',i:'⏰',b:'atrasb'}};
  tabsEl.innerHTML=list.map((x,i)=>{x=adjustCat(x);const k=x.special?KT[x.kind]:null;return `
    <div class="tab ${i===active?'on':''} ${k?k.t:''}" data-i="${i}">
      <span class="tn">${k?k.i+' '+esc(x.categoria):esc(x.categoria)}</span>
      <span class="tb ${k?k.b:(x.atrasado>0?'late':'')}">${x.special?num(x.em_processo):(x.atrasado>0?num(x.atrasado)+' atras':num(x.em_processo))}</span>
      <span class="prog"></span>
    </div>`;}).join('')
    + `<div class="rotctl ${pinned?'pinned':''}" id="rotctl">${pinned?'⏸ fixado · clique p/ girar':'🔄 girando 15s'}</div>`;
  [...tabsEl.querySelectorAll('.tab')].forEach(t=>t.addEventListener('click',()=>{
    active=+t.dataset.i; pinned=true; if(ROT)clearInterval(ROT); buildTabs(); renderActive();}));
  document.getElementById('rotctl').addEventListener('click',()=>{
    pinned=!pinned; if(pinned){if(ROT)clearInterval(ROT);} else {active=(active+1)%cats().length; startRotation();} buildTabs(); renderActive();});
}

function startRotation(){
  if(ROT)clearInterval(ROT);
  if(locked||pinned) return;
  const list=cats(); if(list.length<=1) return;
  ROT=setInterval(()=>{active=(active+1)%list.length;renderActive();},ROTATE);
  animateProg();
}
function animateProg(){
  const on=document.querySelector('.tab.on .prog'); if(!on)return;
  on.style.transition='none';on.style.width='0';
  requestAnimationFrame(()=>{on.style.transition=`width ${ROTATE}ms linear`;on.style.width='100%';});
}

function ringColor(p){return p>=70?C.green:p>=40?C.amber:C.red;}

function renderActive(){
  const list=cats(); if(!list.length){document.getElementById('content').innerHTML='<div style="padding:40px;color:var(--mut)">Sem fila no momento.</div>';return;}
  const x = adjustCat(locked || list[active] || list[0]);
  if(!locked){ [...document.querySelectorAll('.tab')].forEach((t,i)=>t.classList.toggle('on',i===active)); animateProg(); }
  const special=!!x.special;
  const KIND={
    urg:{c:C.amber,ic:'🚨',sub:'urgentes de todas as categorias',ring:'urgentes',m1l:'Urgentes na fila',work:'Amostras urgentes',m3l:'Marcados pela equipe (★)'},
    pet:{c:C.petlove,ic:'💗',sub:'pacientes Pet Love — todas as categorias',ring:'pacientes',m1l:'Pacientes Pet Love',work:'Pacientes Pet Love',m3l:'Urgentes entre os Pet Love'},
    atras:{c:C.red,ic:'⏰',sub:'atrasados de todas as categorias',ring:'atrasados',m1l:'Atrasados na fila',work:'Amostras atrasadas',m3l:'Atraso máximo (dias)'}};
  const K=special?KIND[x.kind]:null;
  const col=special?K.c:ringColor(x.pct_no_prazo);
  const ders=(x.derivacoes||[]).slice(0,18);
  const wlItems=(x.exames||[]).map(e=>({...e,_urg:urgentOf(e),_manual:manual.has(String(e.registro))&&!e.urgente&&!baixados.has(String(e.registro))}))
    .sort((a,b)=>(b._urg?1:0)-(a._urg?1:0)||b.dias-a.dias);
  const urgItems=wlItems.filter(e=>e._urg);
  const urgCount=urgItems.length;
  const manualCount=wlItems.filter(e=>e._manual).length;
  // alvo do "Limpar atrasados" = os atrasados visíveis nesta aba
  const atrasAlvo=wlItems.filter(e=>e.atrasado);
  window.__limparAlvo=atrasAlvo.map(e=>({chave:exChave(e),registro:String(e.registro),exame:e.exame||'',paciente:e.paciente||'',cat:e.categoria||x.categoria||'',atrasado:true}));
  window.__curCat=special?'':x.categoria;
  const banner = (!special && urgCount>0) ? `<div class="urgbanner"><span class="ico">🚨</span>
      <span class="ttl">${num(urgCount)} URGENTE${urgCount>1?'S':''}</span>
      <div class="ul">${urgItems.slice(0,10).map(u=>`<span class="u"><span class="r">#${esc(u.registro)}</span> ${esc(u.paciente)} · ${esc(u.exame||'')} · ${u.dias}d</span>`).join('')}</div>
    </div>` : '';
  document.getElementById('content').innerHTML=banner+`
    <div class="cgrid">
    <div class="hero">
      <div class="hcat ${special?x.kind+'cat':''}"><div class="nm">${special?K.ic+' ':''}${esc(x.categoria)}</div><span class="sla">${special?K.sub:'prazo de liberação: '+x.sla+(x.sla>1?' dias':' dia')}</span></div>
      <div class="ringwrap">
        <div class="ring" style="background:conic-gradient(${col} ${special?100:x.pct_no_prazo}%, rgba(255,255,255,.07) 0)">
          <div class="rv"><div class="big" style="color:${col}">${special?num(x.em_processo):x.pct_no_prazo+'%'}</div><div class="lb">${special?K.ring:'no prazo'}</div></div>
        </div>
      </div>
      <div class="minis">
        <div class="mini proc"><div class="v">${num(x.em_processo)}</div><div class="l">${special?K.m1l:'Em processo'}</div></div>
        <div class="mini late"><div class="v" style="color:${x.atrasado>0?C.red:C.ink}">${num(x.atrasado)}</div><div class="l">Atrasados</div></div>
        ${special
          ? `<div class="mini" style="grid-column:1/3"><div class="v">${x.kind==='urg'?num(manualCount):x.kind==='pet'?num((x.exames||[]).filter(e=>e._urg).length):num(Math.max(0,...(x.exames||[]).map(e=>e.dias||0)))}</div><div class="l">${K.m3l}</div></div>`
          : `<div class="mini tat" style="grid-column:1/3"><div class="v">${x.tat_medio!=null?x.tat_medio+'<span style="font-size:16px"> dias</span>':'—'}</div><div class="l">Tempo real médio de liberação</div></div>`}
      </div>
      ${(special&&x.kind==='urg'&&baixasInfo.length)?`<div class="card" style="flex:1;min-height:0;display:flex;flex-direction:column"><h3>↩ Baixados <span class="tag">${baixasInfo.length} · desfazer</span></h3><div class="scroll">${baixasInfo.map(b=>`<div class="wl"><span class="reg">#${esc(b.registro)}</span><div class="cli-x"><div class="pac" style="font-size:13px">${esc(b.paciente||'—')}</div><div class="exm">baixa dada pela equipe</div></div><button class="desfazbtn" data-reg="${esc(b.registro)}">↩ desfazer</button></div>`).join('')}</div></div>`:''}
    </div>
    <div class="right">
      <div class="card"><h3>${special?'Por categoria':'Derivações'} <span class="tag">${ders.length} ${special?'categorias':'tipos'} · em processo / atrasado</span></h3>
        <div class="ders">${ders.map(d=>{
          const okp=100*(d.em_processo-d.atrasado)/(d.em_processo||1), lp=100-okp;
          return `<div class="der"><div class="de">${esc(d.exame)}</div>
            <div class="row"><div><span class="pv">${num(d.em_processo)}</span> <span class="pl">em proc.</span></div>
              <div class="lb" style="color:${d.atrasado>0?C.red:C.green}">${d.atrasado>0?num(d.atrasado)+' atras':'ok'}</div></div>
            <div class="bar"><div class="ok" style="width:${okp}%"></div><div class="bad" style="width:${lp}%"></div></div>
          </div>`;}).join('')||'<div style="color:var(--mut)">—</div>'}</div>
      </div>
      <div class="card"><h3><span>${special?K.work:'Amostras em processo'} <span class="tag">${special?'categoria · ':''}nº registro · paciente</span></span><input id="wlsearch" class="wlsearch" placeholder="🔍 buscar nº registro / paciente" value="${escA(searchTerm)}"></h3>
        <div class="exleg">
          <span class="lg"><b style="color:var(--amber,#f0a020)">baixa na urgência</b> = tira só do alerta 🔴 (o exame continua)</span>
          <span class="lg"><b style="color:var(--cyan,#22d3ee)">✓ no exame</b> = tira o exame da Produção · não depende do HF · pede PIN</span>
          ${atrasAlvo.length?`<button class="limpabtn">🧹 Limpar atrasados (${atrasAlvo.length})</button>`:''}
          ${prodBaixados.size?`<button class="undobtn">↩ baixados (${prodBaixados.size})</button>`:''}
        </div>
        <div class="scroll">${wlItems.map(e=>{const pl=isPetlove(e.paciente);return `
          <div class="wl"><span class="reg">#${esc(e.registro!=null?e.registro:'—')}</span>
            <div><div class="pac${pl?' petlove':''}">${esc(e.paciente)}${pl?'<span class="plove">PET LOVE</span>':''}${e._urg?`<span class="urg">URGENTE${e._manual?' ★':''}</span>`:''}</div><div class="exm">${special?`<b style="color:var(--cyan)">${esc(e.categoria)}</b> · `:''}${esc(e.exame||'—')} · entrou ${fmtD(e.entrada)} · <b style="color:${e.atrasado?C.red:C.amber}">limite ${fmtD(e.limite)}</b>${e.dono?' · '+esc(e.dono):''}</div></div>
            <div class="wlact">${e._urg
              ? `<button class="baixabtn" data-reg="${esc(e.registro)}" data-pac="${escA(e.paciente)}" data-exm="${escA(e.exame||'')}" data-manual="${e._manual?'1':'0'}" title="tira do alerta de urgência (o exame continua na fila)">baixa na urgência</button>`
              : `<button class="urgbtn" data-reg="${esc(e.registro)}" data-pac="${escA(e.paciente)}" data-exm="${escA(e.exame||'')}" title="marcar como urgente">🚨</button>`}<button class="exbaixabtn" data-reg="${esc(e.registro)}" data-exm="${escA(e.exame||'')}" data-pac="${escA(e.paciente)}" data-cat="${escA(e.categoria||x.categoria||'')}" data-atr="${e.atrasado?'1':'0'}" title="baixa no EXAME — tira da Produção (não depende do HF)">✓ no exame</button><span class="db ${e.atrasado?'late':'ok'}">${e.dias}d</span></div></div>`;}).join('')||(special?'<div style="color:var(--green);padding:14px">✓ Nenhum urgente no momento.</div>':'<div style="color:var(--green);padding:14px">✓ Nada em processo.</div>')}
        </div>
      </div>
    </div></div>`;
  if(searchTerm) filterWL();
}
function fmtD(d){if(!d)return'—';const p=String(d).slice(0,10).split('-');return p.length===3?`${p[2]}/${p[1]}`:d;}
function esc(s){return String(s==null?'':s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}

/* Auto-reload na virada do dia (meia-noite BRT): a TV/PC fica ligada a noite toda;
   isso garante que ela pegue o codigo novo + o reset diario da Triagem sem F5 manual. */
(function(){
  function msAteMeiaNoiteBRT(){
    const now=Date.now();
    const brt=new Date(now-3*3600e3);                                            // relogio em BRT (UTC-3)
    const alvo=Date.UTC(brt.getUTCFullYear(),brt.getUTCMonth(),brt.getUTCDate()+1)+3*3600e3; // proxima 00:00 BRT em UTC
    return alvo-now;
  }
  setTimeout(function(){ location.reload(); }, msAteMeiaNoiteBRT()+8000);         // +8s de folga p/ a data ja ter virado
})();
