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
  if(opts.fu) parts.push(fubtn(x));
  const right = parts.length ? `<div class="rcell">${parts.join("")}</div>` : "<div></div>";
  const rank = opts.rank ? `<div class="rk">${i+1}</div>` : `<div class="rk" style="color:var(--line)">•</div>`;
  const done = opts.fu && FOLLOWED.has(String(x.cod)) ? " done" : "";
  return `<div class="crow${done}">
    ${rank}
    <div><div class="nm">${esc(x.nome)}</div><div class="ci">${meta}</div></div>
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
    const arr = D.reativar||[];
    const calm = arr.length===0;
    const riscoPct = ativos ? 100*arr.length/ativos : 0;
    c.innerHTML = `
      <div class="radar ${calm?"calm":""}">
        <div class="ico">${calm?"✅":"🎯"}</div>
        <div><div class="big">${arr.length}</div></div>
        <div style="flex:1">
          <div class="lbl">${calm?"Carteira saudável — nada para reativar agora":"CLIENTES PARA REATIVAR — ação comercial"}</div>
          <div class="sub">${r.parados||0} parados · ${r.queda_forte||0} em queda forte · ${r.em_queda||0} em queda · ${r.novos_esfriando||0} novos esfriando · ${Math.round(riscoPct)}% da carteira ativa</div>
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
    const arr = D.parados||[];
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
    const n = r[tb.k] || 0;
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
      const b = e.target.closest(".fubtn"); if(b) toggleFollowup(b.dataset.cod, b.dataset.nome);
    });
    loadFollowups().then(()=>renderTab());
    setInterval(async()=>{ const a=[...FOLLOWED.keys()].sort().join(); await loadFollowups();
      if(a!==[...FOLLOWED.keys()].sort().join()) renderTab(); }, 45000);
  }
}
window.addEventListener("hashchange", ()=>{ if(DATA){ applyLock(); search=""; renderAll(); } });

document.getElementById("rotctl").addEventListener("click", ()=>{ if(locked) return; pinned=!pinned; setPin(); if(!pinned){search="";} renderAll(); });
setInterval(clock, 1000); clock();
setInterval(()=>{ if(DATA) rotate(); }, ROT_MS);

initGate({ encUrl:"data/crm.enc", lsKey:"agente_crm_matriz", onData:render, refreshMs:600000 });
