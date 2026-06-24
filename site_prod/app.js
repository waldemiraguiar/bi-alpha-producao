/* Painel de Produção (TV) — abas por categoria, derivações visuais, rotação automática.
   Trava por categoria via URL (#15 ou #citopatologia) para TVs de setor. Sem R$, sem volumes. */
const C={navy:'#0A1628',cyan:'#00D4FF',green:'#00E5A0',amber:'#FFB020',red:'#FF5470',purple:'#A78BFA',petlove:'#FF6AD5',mut:'#8aa2bd'};
const num=n=>Math.round(n||0).toLocaleString('pt-BR');
const LS='bi_prod_pwd', ROTATE=15000; // 15s por categoria
const b64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
let ENC=null,REFRESH=null,ROT=null,DATA=null,active=0,locked=null,pinned=false;
const URG_API='/api/urgentes';
let manual=new Set(), baixados=new Set(), baixasInfo=[];
function setOverlays(j){manual=new Set((j.urgentes||[]).map(u=>String(u.registro))); baixados=new Set((j.baixas||[]).map(u=>String(u.registro))); baixasInfo=(j.baixas||[]);}
async function loadManual(){ try{const r=await fetch('/api/overlays?_='+Date.now()); if(r.ok){const o=await r.json(); setOverlays({urgentes:o.urgentes,baixas:o.urg_baixas});}}catch(e){} }
// urgente de verdade = (sistema OU manual) E NÃO baixado
const urgentOf=e=>{const r=String(e.registro);return (e.urgente||manual.has(r))&&!baixados.has(r);};
async function post(payload,errMsg){
  try{const r=await fetch(URG_API,{method:'POST',headers:{'Content-Type':'application/json'},
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
  const d=ev.target.closest('.desfazbtn'); if(d){post({tipo:'baixa',registro:d.dataset.reg,acao:'remove'},'Não foi possível desfazer.');return;}}
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
    if(pred(e,c)) items.push({...e,categoria:c.categoria,_urg:urgentOf(e),_manual:manual.has(String(e.registro))&&!e.urgente&&!baixados.has(String(e.registro))});
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

async function decrypt(pwd){
  ENC=await fetch('data/producao.enc?_='+Date.now()).then(r=>{if(!r.ok)throw new Error('sem dados');return r.json();});
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
  // urgentes só importam no modo TV → não chama a função quando estiver em outro modo (Triagem/Clientes)
  window.__muref=setInterval(async()=>{if(document.hidden||document.getElementById('content').style.display==='none')return;const k=[...manual].sort().join();await loadManual();if(k!==[...manual].sort().join())renderActive();},90000);
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
  tabsEl.innerHTML=list.map((x,i)=>{const k=x.special?KT[x.kind]:null;return `
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
  const x = locked || list[active] || list[0];
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
        <div class="scroll">${wlItems.map(e=>{const pl=isPetlove(e.paciente);return `
          <div class="wl"><span class="reg">#${esc(e.registro!=null?e.registro:'—')}</span>
            <div><div class="pac${pl?' petlove':''}">${esc(e.paciente)}${pl?'<span class="plove">PET LOVE</span>':''}${e._urg?`<span class="urg">URGENTE${e._manual?' ★':''}</span>`:''}</div><div class="exm">${special?`<b style="color:var(--cyan)">${esc(e.categoria)}</b> · `:''}${esc(e.exame||'—')} · entrou ${fmtD(e.entrada)} · <b style="color:${e.atrasado?C.red:C.amber}">limite ${fmtD(e.limite)}</b>${e.dono?' · '+esc(e.dono):''}</div></div>
            <div class="wlact">${e._urg
              ? `<button class="baixabtn" data-reg="${esc(e.registro)}" data-pac="${escA(e.paciente)}" data-exm="${escA(e.exame||'')}" data-manual="${e._manual?'1':'0'}" title="dar baixa (resolver urgência)">✓ baixa</button>`
              : `<button class="urgbtn" data-reg="${esc(e.registro)}" data-pac="${escA(e.paciente)}" data-exm="${escA(e.exame||'')}" title="marcar como urgente">🚨</button>`}<span class="db ${e.atrasado?'late':'ok'}">${e.dias}d</span></div></div>`;}).join('')||(special?'<div style="color:var(--green);padding:14px">✓ Nenhum urgente no momento.</div>':'<div style="color:var(--green);padding:14px">✓ Nada em processo.</div>')}
        </div>
      </div>
    </div></div>`;
  if(searchTerm) filterWL();
}
function fmtD(d){if(!d)return'—';const p=String(d).slice(0,10).split('-');return p.length===3?`${p[2]}/${p[1]}`:d;}
function esc(s){return String(s==null?'':s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
