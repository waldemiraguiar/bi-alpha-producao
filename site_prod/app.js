/* Painel de Produção (TV) — volume only, auto-refresh 10 min, login persistente */
const C={navy:'#0A1628',cyan:'#00D4FF',green:'#00E5A0',amber:'#FFB020',red:'#FF5470',purple:'#A78BFA',mut:'#8aa2bd'};
const PAL=[C.cyan,C.green,C.amber,C.purple,C.red,'#5B8DEF','#4ECDC4','#F472B6','#FBBF24','#34D399','#818CF8','#FB7185'];
const num=n=>Math.round(n).toLocaleString('pt-BR');
const MES=['','Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const DOW=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
const fmtYM=ym=>{const[y,m]=ym.split('-');return MES[+m]+'/'+y.slice(2);};
const fmtD=d=>{const[y,m,dd]=d.split('-');return dd+'/'+m;};
Chart.defaults.color=C.mut;Chart.defaults.font.family='Inter';Chart.defaults.font.size=12;
const GRID={color:'rgba(255,255,255,.05)'},noGrid={grid:{display:false}};
const hex2rgb=h=>{const x=h.replace('#','');return`rgb(${parseInt(x.slice(0,2),16)},${parseInt(x.slice(2,4),16)},${parseInt(x.slice(4,6),16)})`;};
const rgba=(h,a)=>hex2rgb(h).replace('rgb(',`rgba(`).replace(')',`,${a})`);
function grad(ctx,area,color,a1=.45,a2=0){if(!area)return rgba(color,a1);const g=ctx.createLinearGradient(0,area.top,0,area.bottom);g.addColorStop(0,rgba(color,a1));g.addColorStop(1,rgba(color,a2));return g;}

const LS_KEY='bi_prod_pwd';
const b64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
let ENC=null, CHARTS=[], TIMER=null;

async function decrypt(pwd){
  ENC=await fetch('data/producao.enc?_='+Date.now()).then(r=>{if(!r.ok)throw new Error('sem dados');return r.json();});
  const bk=await crypto.subtle.importKey('raw',new TextEncoder().encode(pwd),'PBKDF2',false,['deriveKey']);
  const key=await crypto.subtle.deriveKey({name:'PBKDF2',salt:b64(ENC.salt),iterations:ENC.iter,hash:'SHA-256'},bk,{name:'AES-GCM',length:256},false,['decrypt']);
  const pt=await crypto.subtle.decrypt({name:'AES-GCM',iv:b64(ENC.iv)},key,b64(ENC.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}

/* ---------- relógio ---------- */
function tickClock(){
  const d=new Date();
  document.getElementById('clk').textContent=d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  document.getElementById('dat').textContent=d.toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long'});
}

/* ---------- gate ---------- */
(function gate(){
  const form=document.getElementById('gateForm'),pwd=document.getElementById('gatePwd'),
        err=document.getElementById('gateErr'),btn=document.getElementById('gateBtn');
  tickClock(); setInterval(tickClock,1000);
  async function unlock(p,fromLS){
    try{
      const D=await decrypt(p);
      localStorage.setItem(LS_KEY,p);
      window.__pwd=p;
      document.getElementById('gate').style.display='none';
      document.getElementById('tv').style.display='';
      boot(D);
    }catch(e){
      if(fromLS){localStorage.removeItem(LS_KEY);return;}
      err.textContent=/sem dados/.test(e.message)?'Dados indisponíveis.':'Senha incorreta.';
      btn.disabled=false;btn.textContent='Entrar';pwd.select();
    }
  }
  form.addEventListener('submit',e=>{e.preventDefault();err.textContent='';btn.disabled=true;btn.textContent='Verificando…';unlock(pwd.value,false);});
  const saved=localStorage.getItem(LS_KEY);
  if(saved) unlock(saved,true);
})();

/* ---------- boot + auto-refresh ---------- */
function boot(D){
  render(D);
  if(TIMER) clearInterval(TIMER);
  TIMER=setInterval(async()=>{
    try{ const D2=await decrypt(window.__pwd); render(D2); }catch(e){ console.warn('refresh falhou',e); }
  }, 10*60*1000); // 10 min
}

function setUpd(meta){
  document.getElementById('upd').textContent='dados de '+meta.gerado_em.slice(11,16)+' · atualiza a cada 10 min';
}

/* ---------- render ---------- */
function render(D){
  setUpd(D.meta);
  CHARTS.forEach(c=>c.destroy()); CHARTS=[];
  const L=D.live, s=document.getElementById('stage'); s.innerHTML='';

  // HERO KPIs (linha 1)
  const heroes=[
    {cls:'',lbl:'Exames hoje',big:num(L.exames_hoje),meta:`${num(L.requisicoes_hoje)} requisições · ${D.meta.hoje.split('-').reverse().slice(0,2).join('/')}`,
     badge:L.vs_media_pct>=0?{c:'up',t:`▲ ${L.vs_media_pct}% vs média diária`}:{c:'down',t:`▼ ${Math.abs(L.vs_media_pct)}% vs média`}},
    {cls:'g',lbl:'Exames no mês',big:num(L.exames_mes),meta:`projeção ${num(L.projecao_mes)} · mês anterior ${num(L.exames_mes_passado)}`,
     badge:{c:L.projecao_mes>=L.exames_mes_passado?'up':'down',t:`dia ${L.dia_do_mes}/${L.dias_no_mes}`}},
    {cls:'a',lbl:'Ritmo diário',big:num(L.media_dia),metaTxt:'média de exames/dia (90 dias)',
     badge2:`${L.exames_por_req} exames por requisição`},
    {cls:'p',lbl:'Clientes ativos',big:num(L.clientes_ativos),metaTxt:`${num(L.exames_l12)} exames em 12 meses`,
     badge2:`${num(L.exames_total)} no histórico`},
  ];
  heroes.forEach(h=>{
    const e=document.createElement('div');e.className='hero '+h.cls;
    e.innerHTML=`<div class="lbl">${h.lbl}</div><div class="big">${h.big}</div>`+
      (h.meta?`<div class="meta">${h.meta}</div>`:'')+
      (h.metaTxt?`<div class="meta">${h.metaTxt}</div>`:'')+
      (h.badge?`<div class="badge ${h.badge.c}">${h.badge.t}</div>`:'')+
      (h.badge2?`<div class="meta" style="margin-top:6px">${h.badge2}</div>`:'');
    s.appendChild(e);
  });

  // LINHA 2: diário (span2) + mensal (span2)
  s.appendChild(cardChart('Produção diária','últimos 45 dias','cv_dia','span2'));
  s.appendChild(cardChart('Tendência mensal','volume de exames','cv_mes','span2'));
  // LINHA 3: setores donut + espécies donut + dia semana + top exames
  s.appendChild(cardChart('Por setor','12 meses','cv_set',''));
  s.appendChild(cardChart('Por espécie','12 meses','cv_esp',''));
  s.appendChild(cardChart('Ritmo semanal','exames por dia da semana','cv_dow',''));
  s.appendChild(cardList('Top exames','volume 12m', D.top_exames.slice(0,8).map((x,i)=>({rk:i+1,nm:x.Exame,q:num(x.q)}))));

  // diário
  const dia=D.diario;
  CHARTS.push(new Chart(byid('cv_dia'),{type:'bar',data:{labels:dia.map(x=>fmtD(x.d)),datasets:[
    {data:dia.map(x=>x.q),backgroundColor:c=>grad(c.chart.ctx,c.chart.chartArea,C.cyan,.95,.35),borderRadius:3}
  ]},options:{...base(),plugins:{legend:{display:false},tooltip:tt()},scales:{x:{...noGrid,ticks:{maxTicksLimit:15,font:{size:11}}},y:{grid:GRID,ticks:{callback:num}}}}}));
  // mensal
  const mm=D.mensal;
  CHARTS.push(new Chart(byid('cv_mes'),{type:'line',data:{labels:mm.map(x=>fmtYM(x.ym)),datasets:[
    {data:mm.map(x=>x.q),borderColor:C.green,backgroundColor:c=>grad(c.chart.ctx,c.chart.chartArea,C.green),fill:true,tension:.35,borderWidth:2.5,pointRadius:0}
  ]},options:{...base(),plugins:{legend:{display:false},tooltip:tt()},scales:{x:{...noGrid,ticks:{maxTicksLimit:12}},y:{grid:GRID,ticks:{callback:num}}}}}));
  // setores
  const st=mergeBy(D.setores,'setor').slice(0,5);
  CHARTS.push(donut('cv_set',st.map(x=>x.setor),st.map(x=>x.q)));
  // espécies
  const es=mergeBy(D.especies,'especie').slice(0,6);
  CHARTS.push(donut('cv_esp',es.map(x=>x.especie),es.map(x=>x.q)));
  // dia semana
  const dw=D.dia_semana;
  CHARTS.push(new Chart(byid('cv_dow'),{type:'bar',data:{labels:dw.map(x=>DOW[+x.dow]),datasets:[
    {data:dw.map(x=>x.q),backgroundColor:dw.map((x,i)=>rgba(PAL[i%PAL.length],.85)),borderRadius:5}
  ]},options:{...base(),plugins:{legend:{display:false},tooltip:tt()},scales:{x:noGrid,y:{grid:GRID,ticks:{callback:num}}}}}));
}

/* helpers */
function byid(id){return document.getElementById(id);}
function cardChart(title,tag,cvid,span){
  const c=document.createElement('div');c.className='card '+span;
  c.innerHTML=`<h3>${title}<span class="tag">${tag}</span></h3><div class="body"><canvas id="${cvid}"></canvas></div>`;
  return c;
}
function cardList(title,tag,items){
  const c=document.createElement('div');c.className='card';
  c.innerHTML=`<h3>${title}<span class="tag">${tag}</span></h3>`;
  const b=document.createElement('div');b.className='body lst';
  items.forEach(it=>{const r=document.createElement('div');r.className='it';
    r.innerHTML=`<span class="rk">${it.rk}</span><span class="nm">${esc(it.nm)}</span>`+
      (it.ci?`<span class="ci">${esc(it.ci)}</span>`:'')+`<span class="q">${it.q}</span>`;
    b.appendChild(r);});
  c.appendChild(b);return c;
}
function donut(id,labels,data){
  return new Chart(byid(id),{type:'doughnut',data:{labels,datasets:[
    {data,backgroundColor:PAL.map(hex2rgb),borderColor:C.navy,borderWidth:2,hoverOffset:5}
  ]},options:{responsive:true,maintainAspectRatio:false,cutout:'60%',
    plugins:{legend:{position:'right',labels:{boxWidth:11,boxHeight:11,padding:7,font:{size:12}}},
      tooltip:{...tt(),callbacks:{label:c=>{const t=c.dataset.data.reduce((a,b)=>a+b,0);return ' '+num(c.raw)+' ('+(100*c.raw/t).toFixed(1)+'%)';}}}}}});
}
function base(){return{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:tt()},scales:{x:noGrid,y:{grid:GRID}}};}
function tt(){return{backgroundColor:'rgba(10,22,40,.95)',borderColor:'rgba(0,212,255,.3)',borderWidth:1,padding:9,titleColor:'#fff',bodyColor:'#cfe',cornerRadius:6,callbacks:{label:c=>' '+num(c.raw)+' exames'}};}
function mergeBy(rows,f){const m={};rows.forEach(r=>{const k=String(r[f]||'').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^A-Z0-9]/gi,'').toUpperCase();if(!m[k])m[k]={[f]:String(r[f]||'').trim().toUpperCase(),q:0};m[k].q+=r.q;});return Object.values(m).sort((a,b)=>b.q-a.q);}
function esc(s){return String(s==null?'':s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
