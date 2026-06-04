/* Painel de Produção (TV) — operacional: fila, prazos, fluxo. Sem R$, sem totais acumulados. */
const C={navy:'#0A1628',cyan:'#00D4FF',green:'#00E5A0',amber:'#FFB020',red:'#FF5470',purple:'#A78BFA',mut:'#8aa2bd'};
const num=n=>Math.round(n||0).toLocaleString('pt-BR');
const LS='bi_prod_pwd';
const b64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
let ENC=null,TIMER=null;

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

(function gate(){
  const f=document.getElementById('gateForm'),p=document.getElementById('gatePwd'),
        er=document.getElementById('gateErr'),b=document.getElementById('gateBtn');
  tick();setInterval(tick,1000);
  async function unlock(pw,fromLS){
    try{const D=await decrypt(pw);localStorage.setItem(LS,pw);window.__pwd=pw;
      document.getElementById('gate').style.display='none';document.getElementById('tv').style.display='';boot(D);}
    catch(e){if(fromLS){localStorage.removeItem(LS);return;}
      er.textContent=/sem dados/.test(e.message)?'Dados indisponíveis.':'Senha incorreta.';
      b.disabled=false;b.textContent='Entrar';p.select();}
  }
  f.addEventListener('submit',e=>{e.preventDefault();er.textContent='';b.disabled=true;b.textContent='Verificando…';unlock(p.value,false);});
  const s=localStorage.getItem(LS); if(s) unlock(s,true);
})();

function boot(D){
  render(D);
  if(TIMER)clearInterval(TIMER);
  TIMER=setInterval(async()=>{try{render(await decrypt(window.__pwd));}catch(e){console.warn(e);}},10*60*1000);
}

function render(D){
  document.getElementById('upd').textContent='dados '+D.meta.gerado_em.slice(11,16)+' · atualiza a cada 10 min';
  const R=D.resumo;
  const kpis=[
    {l:'Em processo',v:num(R.em_processo),s:'na fila agora',c:''},
    {l:'No prazo',v:num(R.no_prazo),s:'dentro do prazo',c:'gr'},
    {l:'Atrasado',v:num(R.atrasado),s:'passou do prazo',c:'rd'},
    {l:'% no prazo',v:R.pct_no_prazo+'%',s:'da fila atual',c:R.pct_no_prazo>=70?'gr':R.pct_no_prazo>=40?'am':'rd'},
  ];
  document.getElementById('kpis').innerHTML=kpis.map(k=>
    `<div class="kpi ${k.c}"><div class="l">${k.l}</div><div class="v">${k.v}</div><div class="s">${k.s}</div></div>`).join('');

  document.getElementById('cats').innerHTML=D.categorias.filter(x=>x.em_processo>0||x.entrando>0||x.saindo>0).map(x=>{
    const tot=x.em_processo||1, okp=100*x.no_prazo/tot, latep=100*x.atrasado/tot;
    const pc=x.pct_no_prazo>=70?C.green:x.pct_no_prazo>=40?C.amber:C.red;
    return `<div class="catrow">
      <div><div class="catname">${esc(x.categoria)}<span class="slatag">prazo ${x.sla}d</span></div>
        <div class="barwrap" style="margin-top:7px"><div class="ok" style="width:${okp}%"></div><div class="late" style="width:${latep}%"></div></div></div>
      <div class="catopen">${num(x.em_processo)}<small>em proc.</small></div>
      <div style="text-align:right"><span class="pctpill" style="background:${rgba(pc,.14)};color:${pc}">${x.pct_no_prazo}% no prazo</span>
        <div class="catflow" style="margin-top:6px">${x.atrasado>0?`<b style="color:${C.red}">${num(x.atrasado)} atrasados</b> · `:''}TAT real ${x.tat_medio!=null?x.tat_medio+'d':'—'}</div></div>
    </div>`;
  }).join('') || '<div style="color:var(--mut);padding:20px">Sem fila no momento.</div>';

  // worklist: por categoria, exames em processo com nº de registro + paciente
  const grupos=D.categorias.filter(x=>x.exames&&x.exames.length);
  document.getElementById('late').innerHTML = grupos.length ? grupos.map(x=>{
    const rows=x.exames.map(e=>`
      <div class="wl">
        <span class="reg">#${esc(e.registro!=null?e.registro:'—')}</span>
        <div class="info"><div class="pac">${esc(e.paciente)}</div><div class="exm">${esc(e.exame||'—')} · entrou ${fmtD(e.entrada)}${e.dono?' · '+esc(e.dono):''}</div></div>
        <span class="db ${e.atrasado?'late':'ok'}">${e.dias}d</span>
      </div>`).join('');
    const resto = x.em_processo - x.exames.length;
    return `<div class="grp">
      <div class="grphead"><span class="gn">${esc(x.categoria)}</span>
        <span class="gm">prazo ${x.sla}d · ${num(x.em_processo)} em proc.${x.atrasado?` · <b class="late">${num(x.atrasado)} atrasados</b>`:''}</span></div>
      ${rows}
      ${resto>0?`<div style="font-size:11px;color:var(--mut);padding:6px 0 2px 4px">+${num(resto)} exames nesta categoria…</div>`:''}
    </div>`;
  }).join('') : '<div style="color:var(--green);padding:20px">✓ Sem exames em processo.</div>';
}
function fmtD(d){if(!d)return'—';const p=String(d).slice(0,10).split('-');return p.length===3?`${p[2]}/${p[1]}`:d;}
function rgba(h,a){const x=h.replace('#','');return`rgba(${parseInt(x.slice(0,2),16)},${parseInt(x.slice(2,4),16)},${parseInt(x.slice(4,6),16)},${a})`;}
function esc(s){return String(s==null?'':s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
