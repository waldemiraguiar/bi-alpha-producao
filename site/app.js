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

async function decryptDashboard(pwd){
  if(!ENC){ ENC = await fetch('data/dashboard.enc?_='+Date.now()).then(r=>{
    if(!r.ok) throw new Error('arquivo de dados não encontrado'); return r.json(); }); }
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
  const _BIO='bi_fin_bio', _PW='bi_fin_pw';
  const _be=x=>btoa(String.fromCharCode(...new Uint8Array(x))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const _bd=x=>{x=x.replace(/-/g,'+').replace(/_/g,'/');return Uint8Array.from(atob(x),c=>c.charCodeAt(0));};
  const gbio=document.getElementById('gateBio'), bset=document.getElementById('bioSetup');
  form.addEventListener('submit', async e=>{
    e.preventDefault(); err.textContent=''; btn.disabled=true; btn.textContent='Verificando…';
    try{
      const D = await decryptDashboard(pwd.value);
      window.__PW = pwd.value; try{localStorage.setItem(_PW,pwd.value);}catch(_){}
      document.getElementById('gate').style.display='none';
      document.getElementById('dash').style.display='';
      render(D);
      if(window.PublicKeyCredential && bset && !localStorage.getItem(_BIO)) bset.style.display='';
    }catch(ex){
      err.textContent = /não encontrado/.test(ex.message) ? 'Dados indisponíveis. Tente recarregar.' : 'Senha incorreta.';
      btn.disabled=false; btn.textContent='Entrar'; pwd.select();
    }
  });
  /* ---- digital / Touch ID (por aparelho) ---- */
  if(gbio) gbio.onclick=async()=>{ const id=localStorage.getItem(_BIO), pw=localStorage.getItem(_PW); if(!id||!pw)return;
    try{gbio.textContent='👆 Toque o leitor…';
      await navigator.credentials.get({publicKey:{challenge:crypto.getRandomValues(new Uint8Array(32)),allowCredentials:[{type:'public-key',id:_bd(id)}],userVerification:'required',timeout:60000,rpId:location.hostname}});
      pwd.value=pw; (form.requestSubmit?form.requestSubmit():btn.click());
    }catch(e){console.warn(e);gbio.textContent='👆 Entrar com digital';} };
  if(bset) bset.onclick=async()=>{ const pw=localStorage.getItem(_PW)||window.__PW; if(!pw)return;
    try{bset.textContent='👆 Toque p/ ativar…';
      const c=await navigator.credentials.create({publicKey:{challenge:crypto.getRandomValues(new Uint8Array(32)),rp:{name:'BI Financeiro Alpha — Atlas Digital',id:location.hostname},user:{id:crypto.getRandomValues(new Uint8Array(16)),name:'fin',displayName:'BI Financeiro'},pubKeyCredParams:[{type:'public-key',alg:-7},{type:'public-key',alg:-257}],authenticatorSelection:{authenticatorAttachment:'platform',userVerification:'required'},timeout:60000,attestation:'none'}});
      localStorage.setItem(_BIO,_be(c.rawId)); bset.textContent='✅ Digital ativa neste PC'; setTimeout(()=>{bset.style.display='none';},1800);
    }catch(e){console.warn(e);bset.textContent='👆 Proteger com digital';} };
  if(localStorage.getItem(_BIO) && localStorage.getItem(_PW) && gbio){ gbio.style.display=''; pwd.placeholder='ou use a senha'; }
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
  const kpis = el('div','kpis');
  const kdata = [
    {l:'Faturamento · últ. 12m', v:brlk(k.faturamento_l12), d:`${num(k.exames_l12)} exames · vs 12m anterior`, c:'',  yoy:f12.yoy, spark:f12.spark, col:C.cyan},
    {l:'Exames · últ. 12m',      v:num(k.exames_l12),       d:`${k.exames_por_req_l12} por requisição · vs 12m anterior`, c:'g', yoy:e12.yoy, spark:e12.spark, col:C.green},
    {l:'Faturamento 2025',       v:brlk(k.faturamento_2025),d:`${num(k.exames_2025)} exames · vs 2024`, c:'',  yoy:an2025.yoy_fat, spark:spark2025, col:C.cyan},
    {l:'Ticket médio / exame',   v:brl(tick12),             d:`requisição: ${brl(k.ticket_medio_req_l12)} · vs 12m anterior`, c:'a', yoy:tickYoY},
    {l:'Clientes ativos · 12m',  v:num(k.clientes_ativos_l12), d:`de ${num(k.clientes_total)} cadastrados`, c:'p', spark:novosTrend, col:C.purple},
    {l:'Faturamento histórico',  v:brlk(k.total_faturamento), d:`desde 2014 · ${num(k.total_exames)} exames`, c:'a'},
  ];
  kdata.forEach(d=>{ const e=el('div','kpi'+(d.c?' '+d.c:''));
    e.innerHTML=`<div class="lbl">${d.l}</div><div class="krow"><div class="val">${d.v}</div>${chip(d.yoy)}</div><div class="delta">${d.d}</div>${d.spark?kspark(d.spark,d.col):''}`;
    kpis.appendChild(e); });
  app.appendChild(kpis);

  /* ---------- Destaques executivos ---------- */
  const conc=D.concentracao||{}, pe=D.perdidos||{}, nvres=D.novos||{};
  const yoyTxt = f12.yoy!=null ? `<b>${f12.yoy>=0?'▲ ':'▼ '}${Math.abs(f12.yoy).toFixed(1)}%</b> vs 12m anterior` : 'janela em produção';
  const plL12 = _mmS.slice(-12).reduce((a,x)=>a+(x.petlove||0),0);
  const totRev12 = k.faturamento_l12 + plL12;
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
function wireTools(){
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
  const map={geral:'app',alertas:'alertas',projecao:'projecao',clientes:'clientes',novos:'novos',perdidos:'perdidos',analises:'analises',petlove:'petlove',margem:'margem',estudo:'estudo',custos:'custos'};
  tabs.forEach(t=>{t.__w=1; t.addEventListener('click',()=>{
    tabs.forEach(o=>o.classList.toggle('on',o===t));
    const v=t.dataset.v;
    Object.entries(map).forEach(([k,id])=>{const el=document.getElementById(id); if(el)el.style.display=(k===v)?'':'none';});
    if(v==='projecao') drawProjCharts();
    if(v==='analises'){ drawAnalisesChart(); drawDailyChart(); }
    if(v==='petlove'){ drawPetloveChart(); drawPetloveYearChart(); }
    if(v==='estudo') drawEstudoChart();
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
  const rec=yms.slice(-18).reverse();
  html+=`<div class="card"><h3>Detalhe mensal <span class="cap">produção interna (sistema HF) + Pet Love · % = participação Pet Love no total do mês</span></h3>
    <table class="atab"><thead><tr><th>Mês</th><th class="num">Produção interna (R$)</th><th class="num">Exames (sistema)</th><th class="num">Pet Love (R$)</th><th class="num">Atend. PL</th><th class="num">Total mês</th><th class="num">% Pet Love</th></tr></thead><tbody>`+
    rec.map(ym=>{const v=men[ym]||0;const lab=(mensalLab[ym]||{}).fat||0;const q=(mensalLab[ym]||{}).qtd||0;const p=lab+v>0?100*v/(lab+v):0;const n=(at[ym]||{}).n_atend;
      return `<tr><td>${ymLabel(ym)}</td><td class="num">${lab?brl(lab):'—'}</td><td class="num">${q?num(q):'—'}</td><td class="num" style="color:var(--cyan)">${brl(v)}</td><td class="num">${n?num(n):'—'}</td><td class="num">${brl(lab+v)}</td><td class="num" style="font-weight:700">${p.toFixed(1)}%</td></tr>`;}).join('')+
    `</tbody></table><div style="color:var(--mut);font-size:11px;margin-top:8px">Produção interna e exames vêm do sistema (inclui 2026). "Atend. PL" só consta dos meses cujos relatórios Pet Love foram importados.</div></div>`;
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
  const wrap=document.getElementById('custos'); if(!wrap) return;
  const C=D.custos||{};
  if(C.erro){ wrap.innerHTML=`<div class="card" style="margin-top:18px;color:var(--red)">Falha ao carregar custos: ${esc(C.erro)}</div>`; return; }
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
    <div class="card" style="margin-bottom:16px"><h3>Faturamento e produção mensal desde 2014 <span class="cap">${(D.serie_mensal_full||[]).length} meses · área = faturamento · linha = exames (eixo dir.)</span></h3>
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
  el.innerHTML=head+`<div class="card"><h3>${selWin==='mes'?'Mês a mês':'Blocos de '+selWin+' dias'} <span class="cap">azul = crescimento · vermelho = queda · vs mesma janela</span></h3>
    <table class="atab"><thead><tr><th>Período</th><th class="num">Exames</th><th class="num">Faturamento</th><th class="num">vs mês ant.</th><th class="num">vs ano ant.</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
function drawAnalisesChart(){
  const D=_AD; if(!D) return; const cv=document.getElementById('anHist'); if(!cv||typeof Chart==='undefined') return;
  if(_achart) _achart.destroy();
  const s=D.serie_mensal_full||[];
  _achart=new Chart(cv,{data:{labels:s.map(x=>x.ym),datasets:[
    {type:'line',label:'Faturamento',data:s.map(x=>x.fat),borderColor:'#00D4FF',backgroundColor:'rgba(0,212,255,.10)',fill:true,tension:.3,pointRadius:0,borderWidth:2,yAxisID:'f'},
    {type:'line',label:'Exames',data:s.map(x=>x.qtd),borderColor:'#00E5A0',backgroundColor:'#00E5A0',fill:false,tension:.3,pointRadius:0,borderWidth:1.5,yAxisID:'q'}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#9fb0c8'}},tooltip:{callbacks:{label:c=>c.dataset.yAxisID==='q'?' Exames: '+num(c.raw):' Faturamento: '+brl(c.raw)}}},
      scales:{x:{ticks:{maxTicksLimit:14,color:'#8aa2bd'},grid:{display:false}},
        f:{position:'left',ticks:{callback:v=>brlk(v),color:'#00D4FF'},grid:{color:'rgba(255,255,255,.05)'}},
        q:{position:'right',ticks:{callback:v=>num(v),color:'#00E5A0'},grid:{display:false}}}}});
}
