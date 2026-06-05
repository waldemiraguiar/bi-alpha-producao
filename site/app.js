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
  form.addEventListener('submit', async e=>{
    e.preventDefault(); err.textContent=''; btn.disabled=true; btn.textContent='Verificando…';
    try{
      const D = await decryptDashboard(pwd.value);
      document.getElementById('gate').style.display='none';
      document.getElementById('dash').style.display='';
      render(D);
    }catch(ex){
      err.textContent = /não encontrado/.test(ex.message) ? 'Dados indisponíveis. Tente recarregar.' : 'Senha incorreta.';
      btn.disabled=false; btn.textContent='Entrar'; pwd.select();
    }
  });
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
    const order=['geral','projecao','clientes','novos','perdidos'];
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
  const map={geral:'app',projecao:'projecao',clientes:'clientes',novos:'novos',perdidos:'perdidos'};
  tabs.forEach(t=>{t.__w=1; t.addEventListener('click',()=>{
    tabs.forEach(o=>o.classList.toggle('on',o===t));
    const v=t.dataset.v;
    Object.entries(map).forEach(([k,id])=>{const el=document.getElementById(id); if(el)el.style.display=(k===v)?'':'none';});
    if(v==='projecao') drawProjCharts();
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
