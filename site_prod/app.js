/* Painel de Produção (TV) — abas por categoria, derivações visuais, rotação automática.
   Trava por categoria via URL (#15 ou #citopatologia) para TVs de setor. Sem R$, sem volumes. */
const C={navy:'#0A1628',cyan:'#00D4FF',green:'#00E5A0',amber:'#FFB020',red:'#FF5470',purple:'#A78BFA',mut:'#8aa2bd'};
const num=n=>Math.round(n||0).toLocaleString('pt-BR');
const LS='bi_prod_pwd', ROTATE=15000; // 15s por categoria
const b64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
let ENC=null,REFRESH=null,ROT=null,DATA=null,active=0,locked=null,pinned=false;
const URG_API='/api/urgentes';
let manual=new Set();
async function loadManual(){
  try{const r=await fetch(URG_API+'?_='+Date.now());
    if(r.ok){const j=await r.json(); manual=new Set((j.urgentes||[]).map(u=>String(u.registro)));}}catch(e){}
}
async function toggleUrg(reg,pac,exm,isOn){
  try{const r=await fetch(URG_API,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({registro:reg,paciente:pac,exame:exm,acao:isOn?'remove':'add',senha:window.__pwd})});
    if(!r.ok){alert('Não foi possível marcar (autorização/conexão).');return;}
    const j=await r.json(); manual=new Set((j.urgentes||[]).map(u=>String(u.registro))); renderActive();
  }catch(e){alert('Erro de conexão ao marcar urgência.');}
}
function onContentClick(ev){const b=ev.target.closest('.urgbtn'); if(!b)return;
  toggleUrg(b.dataset.reg,b.dataset.pac,b.dataset.exm, manual.has(String(b.dataset.reg)));}
const escA=s=>esc(s).replace(/"/g,'&quot;');

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
  tick();setInterval(tick,1000);
  async function unlock(pw,fromLS){
    try{const D=await decrypt(pw);localStorage.setItem(LS,pw);window.__pwd=pw;
      document.getElementById('gate').style.display='none';document.getElementById('tv').style.display='';boot(D);}
    catch(e){if(fromLS){localStorage.removeItem(LS);return;}
      er.textContent=/sem dados/.test(e.message)?'Dados indisponíveis.':'Senha incorreta.';b.disabled=false;b.textContent='Entrar';p.select();}
  }
  f.addEventListener('submit',e=>{e.preventDefault();er.textContent='';b.disabled=true;b.textContent='Verificando…';unlock(p.value,false);});
  const s=localStorage.getItem(LS); if(s) unlock(s,true);
})();

function cats(){ return (DATA.categorias||[]).filter(x=>x.em_processo>0 || (x.derivacoes&&x.derivacoes.length)); }
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
    window.addEventListener('hashchange',()=>{locked=resolveLock(cats());active=0;buildTabs();renderActive();startRotation();});
  }
  if(REFRESH)clearInterval(REFRESH);
  REFRESH=setInterval(async()=>{try{DATA=await decrypt(window.__pwd);await loadManual();buildTabs();renderActive();}catch(e){console.warn(e);}},10*60*1000);
  // urgentes manuais propagam entre TVs em ~45s
  if(window.__muref)clearInterval(window.__muref);
  window.__muref=setInterval(async()=>{const k=[...manual].sort().join();await loadManual();if(k!==[...manual].sort().join())renderActive();},45000);
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
  tabsEl.innerHTML=list.map((x,i)=>`
    <div class="tab ${i===active?'on':''}" data-i="${i}">
      <span class="tn">${esc(x.categoria)}</span>
      <span class="tb ${x.atrasado>0?'late':''}">${x.atrasado>0?num(x.atrasado)+' atras':num(x.em_processo)}</span>
      <span class="prog"></span>
    </div>`).join('')
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
  const col=ringColor(x.pct_no_prazo);
  const ders=(x.derivacoes||[]).slice(0,18);
  // mescla urgentes do SISTEMA (e.urgente) com os MANUAIS (marcados no app)
  const manualHere=(x.exames||[]).filter(e=>manual.has(String(e.registro))&&!e.urgente);
  const urgCount=x.urgentes+manualHere.length;
  const urgList=[...manualHere.map(e=>({registro:e.registro,paciente:e.paciente,exame:e.exame,dias:e.dias})),...(x.urgentes_list||[])];
  const wlItems=(x.exames||[]).map(e=>({...e,_urg:e.urgente||manual.has(String(e.registro)),_manual:manual.has(String(e.registro))&&!e.urgente}))
    .sort((a,b)=>(b._urg?1:0)-(a._urg?1:0)||b.dias-a.dias);
  const banner = (urgCount>0) ? `<div class="urgbanner"><span class="ico">🚨</span>
      <span class="ttl">${num(urgCount)} URGENTE${urgCount>1?'S':''}</span>
      <div class="ul">${urgList.slice(0,10).map(u=>`<span class="u"><span class="r">#${esc(u.registro)}</span> ${esc(u.paciente)} · ${esc(u.exame||'')} · ${u.dias}d</span>`).join('')}</div>
    </div>` : '';
  document.getElementById('content').innerHTML=banner+`
    <div class="cgrid">
    <div class="hero">
      <div class="hcat"><div class="nm">${esc(x.categoria)}</div><span class="sla">prazo de liberação: ${x.sla} ${x.sla>1?'dias':'dia'}</span></div>
      <div class="ringwrap">
        <div class="ring" style="background:conic-gradient(${col} ${x.pct_no_prazo}%, rgba(255,255,255,.07) 0)">
          <div class="rv"><div class="big" style="color:${col}">${x.pct_no_prazo}%</div><div class="lb">no prazo</div></div>
        </div>
      </div>
      <div class="minis">
        <div class="mini proc"><div class="v">${num(x.em_processo)}</div><div class="l">Em processo</div></div>
        <div class="mini late"><div class="v" style="color:${x.atrasado>0?C.red:C.ink}">${num(x.atrasado)}</div><div class="l">Atrasados</div></div>
        <div class="mini tat" style="grid-column:1/3"><div class="v">${x.tat_medio!=null?x.tat_medio+'<span style="font-size:16px"> dias</span>':'—'}</div><div class="l">Tempo real médio de liberação</div></div>
      </div>
    </div>
    <div class="right">
      <div class="card"><h3>Derivações <span class="tag">${ders.length} tipos · em processo / atrasado</span></h3>
        <div class="ders">${ders.map(d=>{
          const okp=100*(d.em_processo-d.atrasado)/(d.em_processo||1), lp=100-okp;
          return `<div class="der"><div class="de">${esc(d.exame)}</div>
            <div class="row"><div><span class="pv">${num(d.em_processo)}</span> <span class="pl">em proc.</span></div>
              <div class="lb" style="color:${d.atrasado>0?C.red:C.green}">${d.atrasado>0?num(d.atrasado)+' atras':'ok'}</div></div>
            <div class="bar"><div class="ok" style="width:${okp}%"></div><div class="bad" style="width:${lp}%"></div></div>
          </div>`;}).join('')||'<div style="color:var(--mut)">—</div>'}</div>
      </div>
      <div class="card"><h3>Amostras em processo <span class="tag">nº registro · paciente · entrada</span></h3>
        <div class="scroll">${wlItems.map(e=>`
          <div class="wl"><span class="reg">#${esc(e.registro!=null?e.registro:'—')}</span>
            <div><div class="pac">${esc(e.paciente)}${e._urg?`<span class="urg">URGENTE${e._manual?' ★':''}</span>`:''}</div><div class="exm">${esc(e.exame||'—')} · entrou ${fmtD(e.entrada)} · <b style="color:${e.atrasado?C.red:C.amber}">limite ${fmtD(e.limite)}</b>${e.dono?' · '+esc(e.dono):''}</div></div>
            <div class="wlact">${e.urgente?'':`<button class="urgbtn ${e._manual?'on':''}" data-reg="${esc(e.registro)}" data-pac="${escA(e.paciente)}" data-exm="${escA(e.exame||'')}" title="${e._manual?'remover urgência':'marcar como urgente'}">${e._manual?'★':'🚨'}</button>`}<span class="db ${e.atrasado?'late':'ok'}">${e.dias}d</span></div></div>`).join('')||'<div style="color:var(--green);padding:14px">✓ Nada em processo.</div>'}
        </div>
      </div>
    </div></div>`;
}
function fmtD(d){if(!d)return'—';const p=String(d).slice(0,10).split('-');return p.length===3?`${p[2]}/${p[1]}`:d;}
function esc(s){return String(s==null?'':s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
