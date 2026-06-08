/* ============================================================
   AGENTE CRM — MATRIZ  ·  Agentes de IA Alpha
   Painel de movimentação de clientes (sem R$). Skin BI Alpha.
   Abas com rotação tipo TV + radar de reativação + worklists acionáveis.
   ============================================================ */
let DATA = null, ACTIVE = "reativar", pinned = false, rotTimer = null, search = "", locked = null;

/* deep-link por visão: #reativar / #em_queda / #parados / ... trava a tela numa visão
   (igual ao #setor da Produção). Sem hash = visão completa rotativa da equipe. */
const HASH_ALIAS = {queda:"em_queda", "em-queda":"em_queda", parado:"parados",
  alta:"em_alta", "em-alta":"em_alta", novos:"novos_esfriando", esfriando:"novos_esfriando",
  reativacao:"reativar", "reativação":"reativar"};
function resolveLock(){
  const h = decodeURIComponent((location.hash||"").replace("#","")).trim().toLowerCase();
  if(!h) return null;
  const k = HASH_ALIAS[h] || h;
  return TABS.some(t=>t.k===k) ? k : null;
}

const TABS = [
  {k:"reativar",        ic:"🎯", nm:"Reativar",        cls:"urgtab",   bcls:"urgb"},
  {k:"em_queda",        ic:"▼",  nm:"Em Queda",        cls:"atrastab", bcls:"atrasb"},
  {k:"parados",         ic:"⛔", nm:"Parados",         cls:"atrastab", bcls:"atrasb"},
  {k:"novos_esfriando", ic:"🌱", nm:"Novos Esfriando", cls:"",         bcls:""},
  {k:"em_alta",         ic:"▲",  nm:"Em Alta",         cls:"",         bcls:""},
  {k:"carteira",        ic:"👥", nm:"Carteira",        cls:"",         bcls:""},
  {k:"resultados",      ic:"📋", nm:"Resultados",      cls:"",         bcls:""},
  {k:"historico",       ic:"📅", nm:"Histórico",       cls:"",         bcls:""},
];
const ROT_MS = 15000;

/* ---------- follow-up compartilhado (Netlify Function + Blobs) ---------- */
const FU_API = "/api/followup";
let FOLLOWED = new Map();   // cod(string) -> {cod,nome,por,nota,ts}
function syncFollowups(arr){ FOLLOWED = new Map((arr||[]).map(f=>[String(f.cod), f])); }
async function loadFollowups(){
  try{ const r = await fetch(FU_API); if(r.ok){ const j = await r.json(); syncFollowups(j.followups||[]); } }catch(e){}
}
function quem(){
  let q = localStorage.getItem("crm_quem");
  if(!q){ q = (prompt("Seu nome/iniciais (aparece no follow-up):")||"").trim(); if(!q) return null; localStorage.setItem("crm_quem", q); }
  return q;
}
async function toggleFollowup(cod, nome){
  const codS = String(cod), has = FOLLOWED.has(codS);
  let por = "equipe";
  if(!has){ por = quem(); if(por===null) return; }
  try{
    const r = await fetch(FU_API, {method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({cod:codS, nome, por, acao: has?"remove":"add", senha: window.__pwd})});
    if(r.status===401){ alert("Sessão sem permissão. Saia e entre de novo com a senha do time."); return; }
    const j = await r.json(); syncFollowups(j.followups||[]); renderTab();
  }catch(e){ console.warn(e); alert("Não foi possível salvar o follow-up (função indisponível)."); }
}

/* ---------- registro de contatos (interações) + BI ---------- */
const INTER_API = "/api/interacoes";
let INTER = [], CHARTS = [];
const RESULT = {
  positivo:    {lbl:"Positivo",      ic:"✅", col:"#00E5A0"},
  negociacao:  {lbl:"Em negociação", ic:"🔄", col:"#00D4FF"},
  sem_resposta:{lbl:"Sem resposta",  ic:"⚠️", col:"#FFB020"},
  negativo:    {lbl:"Negativo",      ic:"❌", col:"#FF5470"},
};
const CANAIS = ["Ligação","WhatsApp","E-mail","Visita"];
const MOTIVOS = ["Preço","Concorrente","Qualidade","Fechou","Sem demanda","Outro"];
function syncInter(arr){ INTER = (arr||[]).slice().sort((a,b)=>b.ts-a.ts); }
async function loadInter(){ try{ const r=await fetch(INTER_API); if(r.ok) syncInter((await r.json()).interacoes); }catch(e){} }
function interOf(cod){ const c=String(cod); return INTER.filter(x=>String(x.cod)===c); }
function lastInter(cod){ return interOf(cod)[0]||null; }
function diasAtras(ts){ const d=Math.floor((Date.now()-ts)/864e5); return d<=0?"hoje":d===1?"ontem":`há ${d}d`; }

/* ---------- histórico semanal do radar (snapshots) ---------- */
const HIST_API = "/api/crm-history";
let HIST = [];
const MOTLAB = {parado:"Parado", queda_forte:"Queda forte", queda:"Em queda", novo_esfriando:"Novo esfriando", alta:"Em alta"};
const MOTCOL = {parado:"#FF5470", queda_forte:"#FF2D55", queda:"#FF8A8A", novo_esfriando:"#FFB020", alta:"#4D9DFF"};
async function loadHist(){ try{ const r=await fetch(HIST_API); if(r.ok){ const j=await r.json(); HIST=(j.snapshots||[]).slice().sort((a,b)=>a.week<b.week?-1:(a.week>b.week?1:0)); } }catch(e){} }
function weekDiff(prev, cur){
  const pm=new Map((prev&&prev.flagged?prev.flagged:[]).map(x=>[String(x.cod),x]));
  const cm=new Map((cur.flagged||[]).map(x=>[String(x.cod),x]));
  return {entraram:[...cm.values()].filter(x=>!pm.has(String(x.cod))),
          sairam:[...pm.values()].filter(x=>!cm.has(String(x.cod)))};
}
function histCliList(arr){
  if(!arr.length) return `<div class="t-mut" style="font-size:12.5px;padding:4px 0">—</div>`;
  return arr.map(x=>{const col=MOTCOL[x.motivo]||"#8aa2bd";
    const dl=(x.delta!=null&&Math.abs(x.delta)>=1)?` ${x.delta>0?'+':''}${Math.round(x.delta)}%`:"";
    return `<div class="histcli"><span class="nm">${esc(x.nome||('#'+x.cod))}</span><span class="t-mut">${esc(x.cidade||'')}</span><span class="pr" style="background:${col}22;color:${col}">${esc(MOTLAB[x.motivo]||x.motivo||'')}${dl}</span></div>`;
  }).join("");
}
function weekCard(wk, d){
  return `<div class="card" style="margin-bottom:12px">
    <h3>Semana ${esc(wk.week)} <span class="tag">início ${esc(wk.label||'')}</span></h3>
    <div class="histgrid">
      <div><div class="histhead" style="color:var(--amber)">⚠ Entraram no radar (${d.entraram.length}) <span class="t-mut" style="font-weight:500">· novos alertas</span></div>${histCliList(d.entraram)}</div>
      <div><div class="histhead" style="color:var(--green)">✓ Saíram do radar (${d.sairam.length}) <span class="t-mut" style="font-weight:500">· recuperaram</span></div>${histCliList(d.sairam)}</div>
    </div></div>`;
}
function findClient(cod){
  const c=String(cod), D=DATA||{};
  for(const k of ["reativar","parados","em_queda","queda_forte","novos_esfriando","em_alta","carteira"]){
    const hit=(D[k]||[]).find(x=>String(x.cod)===c); if(hit) return hit;
  }
  return null;
}
function snapOf(cod){
  const x=findClient(cod)||{};
  const sit = x.motivo || x.situacao || (x.flag==="up"?"alta":x.flag==="down"?"queda":"");
  return {dias_inativo:x.dias_inativo??null, delta:x.delta??null, situacao:sit};
}

/* ---- modal de registro ---- */
let M_COD=null, M_RES="positivo", M_CANAL="Ligação", M_MOTIVO="";
function rbadge(h){ const r=RESULT[h.resultado]||RESULT.sem_resposta; return r; }
function openReg(cod){
  M_COD=String(cod); M_RES="positivo"; M_CANAL="Ligação"; M_MOTIVO="";
  const cli=findClient(cod)||{}, nome=cli.nome||("#"+cod), hist=interOf(cod);
  const histHtml = hist.length ? hist.map(h=>{ const r=rbadge(h);
    return `<div class="hist-row"><span class="hi-ic">${r.ic}</span>
      <div class="hi-body"><div class="hi-top"><b>${esc(r.lbl)}</b> <span class="t-mut">· ${esc(h.canal||"—")} · ${esc(diasAtras(h.ts))} · ${esc(h.por)}</span>${h.motivo?` · <span class="t-red">${esc(h.motivo)}</span>`:""}</div>
      ${h.nota?`<div class="hi-nota">"${esc(h.nota)}"</div>`:""}${h.proximo_passo?`<div class="hi-next">↻ retorno: ${esc(h.proximo_passo)}</div>`:""}</div>
      <button class="hi-del" data-del="${esc(h.id)}" title="remover">✕</button></div>`;
  }).join("") : `<div class="t-mut" style="font-size:13px;padding:6px 0">Sem contatos registrados ainda.</div>`;
  document.getElementById("modalBody").innerHTML = `
    <div class="m-head"><div><div class="m-cli">${esc(nome)}</div>
      <div class="t-mut" style="font-size:13px;margin-top:2px">${esc(cli.cidade||"")}${cli.dias_inativo!=null?` · ${cli.dias_inativo}d sem enviar`:""}</div></div>
      <button class="m-x" id="mClose">✕</button></div>
    <div class="m-sec">Histórico de contatos</div><div class="m-hist">${histHtml}</div>
    <div class="m-sec">Registrar novo contato</div>
    <div class="m-lbl">Canal</div><div class="m-opts" id="mCanal">${CANAIS.map(c=>`<button class="opt${c===M_CANAL?" on":""}" data-canal="${c}">${c}</button>`).join("")}</div>
    <div class="m-lbl">Resultado</div><div class="m-opts" id="mRes">${Object.entries(RESULT).map(([k,v])=>`<button class="opt res-${k}${k===M_RES?" on":""}" data-res="${k}">${v.ic} ${v.lbl}</button>`).join("")}</div>
    <div id="mMotivoWrap" style="display:none"><div class="m-lbl">Motivo da perda</div><div class="m-opts" id="mMotivo">${MOTIVOS.map(m=>`<button class="opt" data-motivo="${m}">${m}</button>`).join("")}</div></div>
    <div class="m-lbl">Nota / relatório</div><textarea id="mNota" class="m-ta" placeholder="O que foi conversado, combinado, objeções…"></textarea>
    <div class="m-lbl">Próximo passo (retorno)</div><input id="mNext" type="date" class="m-date">
    <button class="m-save" id="mSave">Salvar contato</button>`;
  document.getElementById("modal").style.display="flex";
  document.getElementById("mClose").onclick=closeModal;
  document.getElementById("mCanal").onclick=e=>{const b=e.target.closest("[data-canal]");if(b){M_CANAL=b.dataset.canal;[...e.currentTarget.children].forEach(c=>c.classList.toggle("on",c===b));}};
  document.getElementById("mRes").onclick=e=>{const b=e.target.closest("[data-res]");if(b){M_RES=b.dataset.res;[...e.currentTarget.children].forEach(c=>c.classList.toggle("on",c===b));document.getElementById("mMotivoWrap").style.display=M_RES==="negativo"?"block":"none";}};
  const mm=document.getElementById("mMotivo"); if(mm) mm.onclick=e=>{const b=e.target.closest("[data-motivo]");if(b){M_MOTIVO=b.dataset.motivo;[...e.currentTarget.children].forEach(c=>c.classList.toggle("on",c===b));}};
  document.getElementById("mSave").onclick=submitReg;
  document.querySelectorAll(".hi-del").forEach(b=>b.onclick=()=>removeInter(b.dataset.del));
}
function closeModal(){ document.getElementById("modal").style.display="none"; }
async function submitReg(){
  const por=quem(); if(por===null) return;
  const nota=document.getElementById("mNota").value.trim(), next=document.getElementById("mNext").value;
  const cli=findClient(M_COD)||{}, btn=document.getElementById("mSave");
  btn.disabled=true; btn.textContent="Salvando…";
  try{
    const r=await fetch(INTER_API,{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({acao:"add",cod:M_COD,cliente:cli.nome||"",por,canal:M_CANAL,resultado:M_RES,
        motivo:M_RES==="negativo"?M_MOTIVO:"",nota,proximo_passo:next,snapshot:snapOf(M_COD),senha:window.__pwd})});
    if(r.status===401){ alert("Sessão sem permissão. Saia e entre de novo com a senha do time."); btn.disabled=false; btn.textContent="Salvar contato"; return; }
    syncInter((await r.json()).interacoes); closeModal(); renderAll();
  }catch(e){ console.warn(e); alert("Não foi possível salvar (função indisponível)."); btn.disabled=false; btn.textContent="Salvar contato"; }
}
async function removeInter(id){
  try{ const r=await fetch(INTER_API,{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({acao:"remove",id,senha:window.__pwd})});
    if(r.ok){ syncInter((await r.json()).interacoes); openReg(M_COD); renderAll(); } }catch(e){}
}
function regbtn(x){ return `<button class="regbtn" data-reg="${esc(x.cod)}">📞 Registrar</button>`; }

/* retorno agendado (próximo_passo do contato mais recente do cliente) */
function retorno(cod){
  const ints=interOf(cod).filter(x=>x.proximo_passo);
  if(!ints.length) return null;
  const dt=new Date(ints[0].proximo_passo+"T00:00:00"); if(isNaN(dt)) return null;
  const today=new Date(); today.setHours(0,0,0,0);
  const dias=Math.round((dt-today)/864e5);
  return {date:ints[0].proximo_passo, dias, status: dias<0?"atrasado":dias===0?"hoje":"futuro"};
}
function dueRank(cod){ const r=retorno(cod); if(!r) return 3; return r.status==="atrasado"?0:r.status==="hoje"?1:(r.dias<=3?2:3); }
function bumpDue(arr){ return arr.map((x,i)=>[x,i]).sort((a,b)=>(dueRank(a[0].cod)-dueRank(b[0].cod))||(a[1]-b[1])).map(p=>p[0]); }
function dueCount(){ return [...new Set(INTER.map(x=>String(x.cod)))].filter(cod=>{const r=retorno(cod);return r&&(r.status==="hoje"||r.status==="atrasado");}).length; }

/* ---- BI: estatísticas + gráficos ---- */
function biStats(){
  const D=DATA||{};
  const paradosSet=new Set((D.parados||[]).map(x=>String(x.cod)));
  const quedaSet=new Set([...(D.em_queda||[]),...(D.queda_forte||[])].map(x=>String(x.cod)));
  const wk=Date.now()-7*864e5, mo=Date.now()-30*864e5;
  const byRes={positivo:0,negociacao:0,sem_resposta:0,negativo:0};
  INTER.forEach(x=>{ if(byRes[x.resultado]!=null) byRes[x.resultado]++; });
  const porPessoa={}; INTER.forEach(x=>{const p=x.por||"equipe"; (porPessoa[p]=porPessoa[p]||{n:0,pos:0}); porPessoa[p].n++; if(x.resultado==="positivo")porPessoa[p].pos++;});
  const contatados=new Set(INTER.map(x=>String(x.cod)));
  let reativados=0;
  contatados.forEach(cod=>{ const ruim=interOf(cod).some(h=>{const s=h.snapshot||{}; return (s.dias_inativo!=null&&s.dias_inativo>=21)||(s.delta!=null&&s.delta<=-10)||["parado","queda","queda_forte"].includes(s.situacao);});
    if(ruim && !paradosSet.has(cod) && !quedaSet.has(cod)) reativados++; });
  const motivos={}; INTER.filter(x=>x.resultado==="negativo"&&x.motivo).forEach(x=>{motivos[x.motivo]=(motivos[x.motivo]||0)+1;});
  const weeks=[]; for(let i=7;i>=0;i--){const end=Date.now()-i*7*864e5,start=end-7*864e5; weeks.push({lbl:i===0?"agora":`-${i}s`,c:INTER.filter(x=>x.ts>=start&&x.ts<end).length});}
  const total=INTER.length, topP=Object.entries(porPessoa).sort((a,b)=>b[1].n-a[1].n)[0];
  return {total,sem:INTER.filter(x=>x.ts>=wk).length,mes:INTER.filter(x=>x.ts>=mo).length,byRes,porPessoa,
    reativados,motivos,weeks,contatados:contatados.size,pctPos:total?Math.round(100*byRes.positivo/total):0,
    topPessoa:topP?topP[0]:"—",alvos:(D.parados||[]).length+(D.em_queda||[]).length};
}
function funil(s){
  const steps=[["Alvos (parados + em queda)",s.alvos,"#FF5470"],["Contatados",s.contatados,"#FFB020"],
    ["Responderam",s.byRes.positivo+s.byRes.negociacao+s.byRes.negativo,"#00D4FF"],["Reativados ✅",s.reativados,"#00E5A0"]];
  const max=Math.max(1,...steps.map(x=>x[1]));
  return `<div class="funil">${steps.map(([l,v,c])=>`<div class="fstep"><div class="fl">${l}</div><div class="fbar"><div style="width:${Math.max(3,Math.round(100*v/max))}%;background:${c}"></div></div><div class="fv">${v}</div></div>`).join("")}</div>`;
}
function feed(){
  if(!INTER.length) return `<div class="empty">Nenhum contato registrado ainda. Use <b>📞 Registrar</b> nas abas Reativar / Parados.</div>`;
  return INTER.slice(0,14).map(h=>{const r=rbadge(h);
    return `<div class="feedrow"><span class="fi">${r.ic}</span>
      <div class="hi-body"><div><b>${esc(h.cliente||("#"+h.cod))}</b> <span class="t-mut">· ${esc(h.canal||"")} · ${esc(diasAtras(h.ts))} · ${esc(h.por)}</span></div>
      ${h.nota?`<div class="hi-nota">"${esc(h.nota)}"</div>`:""}</div>
      <span class="pr" style="background:${r.col}22;color:${r.col}">${esc(r.lbl)}</span></div>`;}).join("");
}
function drawCharts(s){
  if(typeof Chart==="undefined") return;
  CHARTS.forEach(c=>{try{c.destroy();}catch(e){}}); CHARTS=[];
  Chart.defaults.color="#8aa2bd"; Chart.defaults.font.family="Inter";
  const res=Object.keys(RESULT), g=id=>document.getElementById(id);
  if(g("cRes")) CHARTS.push(new Chart(g("cRes"),{type:"doughnut",data:{labels:res.map(k=>RESULT[k].lbl),
    datasets:[{data:res.map(k=>s.byRes[k]),backgroundColor:res.map(k=>RESULT[k].col),borderColor:"#0A1628",borderWidth:3}]},
    options:{plugins:{legend:{position:"right",labels:{boxWidth:12}}},animation:false,cutout:"60%"}}));
  const pess=Object.entries(s.porPessoa).sort((a,b)=>b[1].n-a[1].n).slice(0,8);
  if(g("cPess")) CHARTS.push(new Chart(g("cPess"),{type:"bar",data:{labels:pess.map(p=>p[0]),
    datasets:[{label:"contatos",data:pess.map(p=>p[1].n),backgroundColor:"#00D4FF"},{label:"positivos",data:pess.map(p=>p[1].pos),backgroundColor:"#00E5A0"}]},
    options:{animation:false,scales:{x:{grid:{display:false}},y:{grid:{color:"rgba(255,255,255,.06)"},ticks:{precision:0}}},plugins:{legend:{labels:{boxWidth:12}}}}}));
  if(g("cSem")) CHARTS.push(new Chart(g("cSem"),{type:"line",data:{labels:s.weeks.map(w=>w.lbl),
    datasets:[{data:s.weeks.map(w=>w.c),borderColor:"#00D4FF",backgroundColor:"rgba(0,212,255,.15)",fill:true,tension:.35,pointRadius:3}]},
    options:{animation:false,scales:{x:{grid:{display:false}},y:{grid:{color:"rgba(255,255,255,.06)"},ticks:{precision:0}}},plugins:{legend:{display:false}}}}));
  const mot=Object.entries(s.motivos).sort((a,b)=>b[1]-a[1]);
  if(g("cMot")) CHARTS.push(new Chart(g("cMot"),{type:"bar",data:{labels:mot.length?mot.map(m=>m[0]):["sem perdas"],
    datasets:[{data:mot.length?mot.map(m=>m[1]):[0],backgroundColor:"#FF5470"}]},
    options:{indexAxis:"y",animation:false,scales:{x:{grid:{color:"rgba(255,255,255,.06)"},ticks:{precision:0}},y:{grid:{display:false}}},plugins:{legend:{display:false}}}}));
}

/* ---------- helpers ---------- */
const esc = s => String(s==null?"":s).replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

function spark(arr, color){
  if(!arr || !arr.length) return "";
  const w=70, h=24, n=arr.length, step = n>1 ? w/(n-1) : 0;
  const pts = arr.map((v,i)=> `${(i*step).toFixed(1)},${(h-3 - (Math.max(0,Math.min(100,v))/100)*(h-6)).toFixed(1)}`).join(" ");
  const last = arr[arr.length-1], lx=(w).toFixed(1), ly=(h-3 - (Math.max(0,Math.min(100,last))/100)*(h-6)).toFixed(1);
  return `<svg width="${w}" height="${h}" class="spk" viewBox="0 0 ${w} ${h}">
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${lx}" cy="${ly}" r="2.6" fill="${color}"/></svg>`;
}
function deltaHtml(d){
  if(d==null) return `<div class="delta flat">—</div>`;
  if(d>=10)  return `<div class="delta up">▲ ${Math.abs(Math.round(d))}%</div>`;
  if(d<=-10) return `<div class="delta down">▼ ${Math.abs(Math.round(d))}%</div>`;
  return `<div class="delta flat">${d>0?"+":""}${Math.round(d)}%</div>`;
}
function sparkColor(x){
  const f = x.flag, d = x.delta, m = x.motivo, s = x.situacao;
  if(m==="parado" || s==="parado") return "#FF5470";
  if(f==="up" || s==="alta" || (d!=null && d>=10)) return "#4D9DFF";
  if(f==="down" || s==="queda" || (d!=null && d<=-10)) return "#FF5470";
  return "#8aa2bd";
}
function kpi(cls, val, label, sub){
  return `<div class="kpi ${cls}"><div class="l">${label}</div><div class="v">${val}</div>${sub?`<div class="s">${sub}</div>`:""}</div>`;
}
function ring(pct, color, label){
  pct = Math.max(0, Math.min(100, Math.round(pct||0)));
  return `<div class="ring" style="background:conic-gradient(${color} ${pct}%, rgba(255,255,255,.07) 0)">
    <div class="rv"><div class="big">${pct}%</div><div class="lb">${label}</div></div></div>`;
}

/* botão de follow-up (toggle compartilhado) */
function fubtn(x){
  const f = FOLLOWED.get(String(x.cod));
  if(f) return `<button class="fubtn on" data-cod="${esc(x.cod)}" data-nome="${esc(x.nome)}" title="em follow-up por ${esc(f.por)}">✓ ${esc(f.por)}</button>`;
  return `<button class="fubtn" data-cod="${esc(x.cod)}" data-nome="${esc(x.nome)}">＋ Follow-up</button>`;
}

/* linha de cliente (worklist) */
function crow(x, i, opts){
  opts = opts || {};
  const col = sparkColor(x);
  const di = x.dias_inativo!=null ? `${x.dias_inativo}d sem enviar` : "";
  const dc = x.dias_cad!=null ? `novo há ${x.dias_cad}d` : "";
  const meta = [esc(x.cidade)+(x.uf?"/"+esc(x.uf):""), di, dc].filter(Boolean).join(" · ");
  const parts = [];
  if(opts.acao){
    const hot = (x.motivo==="parado"||x.motivo==="queda_forte");
    parts.push(`<div class="acao ${hot?"hot":""}">${esc(x.acao)}</div>`);
  } else if(opts.badge){
    const cls = opts.badge==="sit" ? (x.situacao||"estável") : x.motivo;
    const txt = opts.badge==="sit" ? (x.situacao||"estável") : (x.prioridade||x.motivo||"");
    parts.push(`<span class="pr ${cls==="parado"&&opts.badge==="sit"?"parado-sit":cls}">${esc(txt)}</span>`);
  }
  if(opts.fu){ parts.push(fubtn(x)); parts.push(regbtn(x)); }
  const right = parts.length ? `<div class="rcell">${parts.join("")}</div>` : "<div></div>";
  const rank = opts.rank ? `<div class="rk">${i+1}</div>` : `<div class="rk" style="color:var(--line)">•</div>`;
  const done = opts.fu && FOLLOWED.has(String(x.cod)) ? " done" : "";
  const li = opts.fu ? lastInter(x.cod) : null;
  const liHtml = li ? `<div class="lastint" data-reg="${esc(x.cod)}">${rbadge(li).ic} <b>${esc(rbadge(li).lbl)}</b> <span class="t-mut">· ${esc(diasAtras(li.ts))} · ${esc(li.por)}</span></div>` : "";
  const rt = opts.fu ? retorno(x.cod) : null;
  const rtHtml = !rt ? "" :
    rt.status==="atrasado" ? `<div class="rtbadge atrasado" data-reg="${esc(x.cod)}">↻ Retorno atrasado ${Math.abs(rt.dias)}d</div>` :
    rt.status==="hoje"     ? `<div class="rtbadge hoje" data-reg="${esc(x.cod)}">↻ Retornar hoje</div>` :
    rt.dias<=3             ? `<div class="rtbadge fut" data-reg="${esc(x.cod)}">↻ retorno em ${rt.dias}d</div>` : "";
  const due = rt && (rt.status==="atrasado"||rt.status==="hoje") ? " due" : "";
  return `<div class="crow${done}${due}">
    ${rank}
    <div><div class="nm">${esc(x.nome)}</div><div class="ci">${meta}</div>${liHtml}${rtHtml}</div>
    <div class="mid">${spark(x.spark, col)}${deltaHtml(x.delta)}</div>
    ${right}
  </div>`;
}

function list(arr, opts){
  if(!arr || !arr.length) return `<div class="empty">Nada por aqui agora. 👌</div>`;
  return arr.map((x,i)=>crow(x,i,opts)).join("");
}

/* ---------- render por aba ---------- */
function renderTab(){
  const D = DATA, r = D.resumo || {}, c = document.getElementById("content");
  const ativos = r.ativos || r.carteira || 0;

  if(ACTIVE==="reativar"){
    const arr = bumpDue(D.reativar||[]);
    const calm = arr.length===0; const dc = dueCount();
    const riscoPct = ativos ? 100*arr.length/ativos : 0;
    c.innerHTML = `
      <div class="radar ${calm?"calm":""}">
        <div class="ico">${calm?"✅":"🎯"}</div>
        <div><div class="big">${arr.length}</div></div>
        <div style="flex:1">
          <div class="lbl">${calm?"Carteira saudável — nada para reativar agora":"CLIENTES PARA REATIVAR — ação comercial"}</div>
          <div class="sub">${r.parados||0} parados · ${r.queda_forte||0} em queda forte · ${r.em_queda||0} em queda · ${r.novos_esfriando||0} novos esfriando · ${Math.round(riscoPct)}% da carteira ativa${dc?` · <b style="color:#fff">↻ ${dc} retorno(s) p/ hoje</b>`:""}</div>
        </div>
        ${ring(riscoPct, "#FF8A00", "em risco")}
      </div>
      <div class="kgrid">
        ${kpi("r", r.parados||0, "Parados", "21+ dias sem enviar")}
        ${kpi("r", r.queda_forte||0, "Queda forte", "40%+ abaixo do normal")}
        ${kpi("a", r.em_queda||0, "Em queda", "10%+ abaixo do normal")}
        ${kpi("a", r.novos_esfriando||0, "Novos esfriando", "pararam após início")}
      </div>
      <div class="seclabel">🔴 Fila de reativação — priorizada</div>
      ${list(arr, {acao:true, rank:true, fu:true})}`;
    return;
  }

  if(ACTIVE==="em_queda"){
    const arr = D.em_queda||[];
    c.innerHTML = `
      <div class="hero">${ring(ativos? 100*arr.length/ativos:0, "#FF5470", "em queda")}
        <div class="kgrid" style="margin:0">
          ${kpi("r", arr.length, "Clientes em queda", "10%+ abaixo do normal")}
          ${kpi("a", D.queda_forte? (D.queda_forte.length):0, "Quedas fortes", "40%+ abaixo do normal")}
          ${kpi("", ativos, "Carteira ativa", "clientes com envio recente")}
        </div></div>
      <div class="seclabel">▼ Em queda — acompanhar de perto</div>
      ${list(arr, {badge:"motivo", rank:true})}`;
    return;
  }

  if(ACTIVE==="parados"){
    const arr = bumpDue(D.parados||[]);
    c.innerHTML = `
      <div class="hero">${ring(ativos? 100*arr.length/ativos:0, "#FF5470", "parados")}
        <div class="kgrid" style="margin:0">
          ${kpi("r", arr.length, "Clientes parados", "21+ dias sem enviar")}
          ${kpi("a", (arr[0]&&arr[0].dias_inativo)||0, "Mais antigo", "dias sem enviar")}
          ${kpi("", ativos, "Carteira ativa", "")}
        </div></div>
      <div class="seclabel">⛔ Parados — priorizar contato (recência primeiro)</div>
      ${list(arr, {badge:"motivo", rank:true, fu:true})}`;
    return;
  }

  if(ACTIVE==="novos_esfriando"){
    const esf = D.novos_esfriando||[], ok = D.novos||[];
    c.innerHTML = `
      <div class="kgrid">
        ${kpi("a", esf.length, "Novos esfriando", "pararam após início")}
        ${kpi("g", ok.length, "Novos aquecendo", "engajando bem")}
      </div>
      <div class="seclabel">🌱 Novos esfriando — recuperar antes de perder</div>
      ${list(esf, {acao:false, badge:"motivo", rank:true})}
      <div class="seclabel">✅ Novos aquecendo — manter o ritmo</div>
      ${list(ok, {rank:false})}`;
    return;
  }

  if(ACTIVE==="em_alta"){
    const arr = D.em_alta||[];
    c.innerHTML = `
      <div class="hero">${ring(ativos? 100*arr.length/ativos:0, "#4D9DFF", "em alta")}
        <div class="kgrid" style="margin:0">
          ${kpi("", arr.length, "Clientes em alta", "10%+ acima do normal")}
          ${kpi("g", ativos, "Carteira ativa", "")}
        </div></div>
      <div class="seclabel">▲ Em alta — fortalecer relacionamento</div>
      ${list(arr, {badge:"motivo", rank:true})}`;
    return;
  }

  if(ACTIVE==="resultados"){
    const s=biStats();
    c.innerHTML = `
      <div class="kgrid">
        ${kpi("", s.sem, "Contatos na semana", `${s.mes} no mês · ${s.total} no total`)}
        ${kpi("g", s.pctPos+"%", "Taxa de sucesso", "contatos com resultado positivo")}
        ${kpi("g", s.reativados, "Clientes reativados", "estavam ruins e voltaram a enviar")}
        ${kpi("a", s.topPessoa, "Mais ativo", "colaborador com mais contatos")}
      </div>
      <div class="bigrid">
        <div class="card"><h3>Resultados dos contatos</h3><div class="cwrap"><canvas id="cRes"></canvas></div></div>
        <div class="card"><h3>Contatos por colaborador</h3><div class="cwrap"><canvas id="cPess"></canvas></div></div>
      </div>
      <div class="bigrid">
        <div class="card"><h3>Evolução semanal <span class="tag">últimas 8 semanas</span></h3><div class="cwrap"><canvas id="cSem"></canvas></div></div>
        <div class="card"><h3>Motivos de perda</h3><div class="cwrap"><canvas id="cMot"></canvas></div></div>
      </div>
      <div class="card" style="margin-top:14px"><h3>Funil de reativação</h3>${funil(s)}</div>
      <div class="seclabel">🕑 Últimos contatos registrados</div>${feed()}`;
    drawCharts(s);
    return;
  }

  if(ACTIVE==="historico"){
    if(!HIST.length){ c.innerHTML=`<div class="empty" style="margin-top:18px">📅 O histórico está começando a acumular. O robô grava uma <b>foto por semana</b> do radar — volte após o próximo ciclo e, ao longo das semanas, para comparar quem entrou e saiu.</div>`; return; }
    const w=HIST, last=w[w.length-1];
    const lastD = w.length>=2 ? weekDiff(w[w.length-2], last) : {entraram:[],sairam:[]};
    let feed="";
    if(w.length>=2){ for(let i=w.length-1;i>=1;i--){ feed += weekCard(w[i], weekDiff(w[i-1], w[i])); } }
    else { feed=`<div class="empty">Só <b>1 semana</b> registrada — preciso de pelo menos 2 para comparar entradas/saídas. A 1ª foto (${(last.flagged||[]).length} clientes no radar) já está guardada; volte na próxima semana. 👍</div>`; }
    c.innerHTML = `
      <div class="kgrid">
        ${kpi("", w.length, "Semanas registradas", "fotos semanais do radar")}
        ${kpi("r", (last.flagged||[]).length, "No radar agora", `semana ${esc(last.week)}`)}
        ${kpi("a", lastD.entraram.length, "Entraram (últ. semana)", "novos alertas")}
        ${kpi("g", lastD.sairam.length, "Saíram (últ. semana)", "recuperaram")}
      </div>
      <div class="seclabel">📅 Entradas e saídas do radar · semana a semana</div>
      ${feed}`;
    return;
  }

  if(ACTIVE==="carteira"){
    const all = D.carteira||[];
    const q = search.trim().toLowerCase();
    const arr = q ? all.filter(x => (x.nome||"").toLowerCase().includes(q) || (x.cidade||"").toLowerCase().includes(q)) : all;
    c.innerHTML = `
      <div class="tabsbar" style="margin:16px 0 6px">
        <div class="seclabel" style="margin:0">👥 Carteira ativa — ${all.length} clientes</div>
        <input class="wlsearch" id="lupa" placeholder="🔍 buscar cliente ou cidade…" value="${esc(search)}">
      </div>
      ${list(arr, {badge:"sit", rank:false})}`;
    const lupa = document.getElementById("lupa");
    if(lupa){
      lupa.addEventListener("input", e=>{ search=e.target.value; pinned=true; setPin(); const p=lupa.selectionStart; renderTab(); const l2=document.getElementById("lupa"); if(l2){l2.focus(); try{l2.setSelectionRange(p,p);}catch(_){}}});
    }
    return;
  }
}

/* ---------- abas ---------- */
function renderTabs(){
  const D = DATA, r = D.resumo||{}, t = document.getElementById("tabs");
  const shown = locked ? TABS.filter(tb=>tb.k===locked) : TABS;
  t.innerHTML = shown.map(tb=>{
    const n = tb.k==="resultados" ? INTER.filter(x=>x.ts>=Date.now()-7*864e5).length
            : tb.k==="historico" ? HIST.length
            : (r[tb.k] || 0);
    const on = tb.k===ACTIVE;
    const bcls = (tb.k==="reativar"||tb.k==="em_queda"||tb.k==="parados") && n>0 ? "late" : "";
    return `<div class="tab ${tb.cls} ${on?"on":""}" data-k="${tb.k}">
      <span class="tn">${tb.ic} ${tb.nm}</span>
      <span class="tb ${tb.bcls||bcls}">${n}</span>
      ${on && !pinned && !locked ? '<span class="prog" id="prog"></span>' : ''}
    </div>`;
  }).join("") + (locked ? '<span class="rotctl pinned" style="cursor:default">🔒 Tela fixa</span>' : '');
  if(!locked) t.querySelectorAll(".tab").forEach(el=>el.addEventListener("click", ()=>{
    ACTIVE = el.dataset.k; pinned = true; setPin(); search=""; renderAll();
  }));
  animProg();
}
function animProg(){
  const p = document.getElementById("prog"); if(!p || pinned) return;
  p.style.transition="none"; p.style.width="0";
  requestAnimationFrame(()=>{ p.style.transition=`width ${ROT_MS}ms linear`; p.style.width="100%"; });
}
function setPin(){
  const b = document.getElementById("rotctl");
  if(pinned){ b.classList.add("pinned"); b.textContent="▶ Girar abas"; }
  else { b.classList.remove("pinned"); b.textContent="⏸ Fixar aba"; }
}
function rotate(){
  if(pinned) return;
  const m=document.getElementById("modal"); if(m && m.style.display==="flex") return;
  const i = TABS.findIndex(t=>t.k===ACTIVE);
  ACTIVE = TABS[(i+1)%TABS.length].k;
  renderAll();
}

/* ---------- topo / relógio / footer ---------- */
function clock(){
  const d=new Date(); const p=n=>String(n).padStart(2,"0");
  const el=document.getElementById("clock"); if(el) el.textContent=`${p(d.getHours())}:${p(d.getMinutes())}`;
}
function footer(){
  const m = DATA.meta||{};
  document.getElementById("foot").innerHTML =
    `Fonte: ${esc(m.fonte||"—")} · ${esc(m.periodo||"")} · dados até ${esc(m.max_data||"—")} · gerado ${esc(m.gerado_em||"—")}.<br>
     Sem valores financeiros. Atualização automática. — Agente CRM, frota Agentes de IA Alpha.`;
  const demo = /DEMO/i.test(m.fonte||"") || /DEMO/i.test(m.gerado_em||"");
  document.getElementById("demoFlag").classList.toggle("on", demo);
}

/* ---------- ciclo ---------- */
function renderAll(){ renderTabs(); renderTab(); }
function applyLock(){
  locked = resolveLock();
  const rc = document.getElementById("rotctl");
  if(locked){ ACTIVE = locked; pinned = true; rc.style.display="none"; }
  else { rc.style.display=""; }
}
function render(D){
  DATA = D;
  document.getElementById("app").style.display="block";
  applyLock();
  footer(); renderAll();
  if(!window.__fuwired){
    window.__fuwired = true;
    document.getElementById("content").addEventListener("click", e=>{
      const fb = e.target.closest(".fubtn"); if(fb){ toggleFollowup(fb.dataset.cod, fb.dataset.nome); return; }
      const rb = e.target.closest("[data-reg]"); if(rb){ openReg(rb.dataset.reg); return; }
    });
    const modal=document.getElementById("modal");
    if(modal) modal.addEventListener("click", e=>{ if(e.target===modal) closeModal(); });
    Promise.all([loadFollowups(), loadInter(), loadHist()]).then(()=>renderAll());
    setInterval(async()=>{ const a=[...FOLLOWED.keys()].sort().join()+"|"+INTER.length+"|"+HIST.length;
      await Promise.all([loadFollowups(), loadInter(), loadHist()]);
      if(a!==[...FOLLOWED.keys()].sort().join()+"|"+INTER.length+"|"+HIST.length) renderTab(); }, 45000);
  }
}
window.addEventListener("hashchange", ()=>{ if(DATA){ applyLock(); search=""; renderAll(); } });

document.getElementById("rotctl").addEventListener("click", ()=>{ if(locked) return; pinned=!pinned; setPin(); if(!pinned){search="";} renderAll(); });
setInterval(clock, 1000); clock();
setInterval(()=>{ if(DATA) rotate(); }, ROT_MS);

initGate({ encUrl:"data/crm.enc", lsKey:"agente_crm_matriz", onData:render, refreshMs:600000 });
