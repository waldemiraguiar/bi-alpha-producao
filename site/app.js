/* BI Alpha — dashboard de produção e faturamento */
const C = {navy:'#0A1628',cyan:'#00D4FF',green:'#00E5A0',amber:'#FFB020',red:'#FF5470',purple:'#A78BFA',mut:'#8aa2bd'};
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

  /* ---------- KPIs ---------- */
  const kpis = el('div','kpis');
  const kdata = [
    ['Faturamento · últ. 12m', brlk(k.faturamento_l12), `${num(k.exames_l12)} exames`, ''],
    ['Faturamento 2025', brlk(k.faturamento_2025), `${num(k.exames_2025)} exames`, 'g'],
    ['Ticket médio / exame', brl(k.ticket_medio_exame), `${k.exames_por_req_l12} exames por requisição`, ''],
    ['Ticket médio / requisição', brl(k.ticket_medio_req_l12), `${num(k.requisicoes_l12)} requisições · 12m`, 'g'],
    ['Clientes ativos · 12m', num(k.clientes_ativos_l12), `de ${num(k.clientes_total)} cadastrados`, 'p'],
    ['Faturamento histórico', brlk(k.total_faturamento), `desde 2014 · ${num(k.total_exames)} exames`, 'a'],
  ];
  kdata.forEach(([l,v,d,c])=>{ const e=el('div','kpi'+(c?' '+c:'')); e.innerHTML=`<div class="lbl">${l}</div><div class="val">${v}</div><div class="delta">${d}</div>`; kpis.appendChild(e); });
  app.appendChild(kpis);

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
  new Chart(cv1,{data:{labels:mm.map(x=>fmtYM(x.ym)),datasets:[
    {type:'bar',label:'Faturamento',data:mm.map(x=>x.fat),yAxisID:'y',
      backgroundColor:(c)=>gradient(c.chart.ctx,c.chart.chartArea,hex2rgb(C.cyan),.85,.25),borderRadius:3,order:2},
    {type:'line',label:'Exames',data:mm.map(x=>x.qtd),yAxisID:'y1',borderColor:C.green,
      backgroundColor:C.green,tension:.35,borderWidth:2,pointRadius:0,order:1}
  ]},options:dualOpts()});

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
