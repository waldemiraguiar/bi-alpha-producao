/* ============================================================
   AGENTE CRM — MATRIZ  ·  Agentes de IA Alpha
   Painel de movimentação de clientes (sem R$). Skin BI Alpha.
   Abas com rotação tipo TV + radar de reativação + worklists acionáveis.
   ============================================================ */
let DATA = null, ACTIVE = "reativar", pinned = false, rotTimer = null, search = "", locked = null;

/* deep-link por visão: #reativar / #em_queda / #parados / ... trava a tela numa visão
   (igual ao #setor da Produção). Sem hash = visão completa rotativa da equipe. */
const HASH_ALIAS = {queda:"em_queda", "em-queda":"em_queda", parado:"parados", resgate:"parados",
  alta:"em_alta", "em-alta":"em_alta", novos:"novos_esfriando", esfriando:"novos_esfriando", onboarding:"novos_esfriando",
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
  {k:"inativos",        ic:"🚫", nm:"Inativos",        cls:"",         bcls:""},
  {k:"novos_esfriando", ic:"🌱", nm:"Onboarding",      cls:"",         bcls:""},
  {k:"em_alta",         ic:"▲",  nm:"Em Alta",         cls:"",         bcls:""},
  {k:"carteira",        ic:"👥", nm:"Carteira",        cls:"",         bcls:""},
  {k:"pista",           ic:"🏍️", nm:"Pista",           cls:"",         bcls:""},
  {k:"clinicas",        ic:"🌂", nm:"Guarda-Chuva",    cls:"",         bcls:""},
  {k:"prospeccao",      ic:"🧲", nm:"Prospecção",      cls:"",         bcls:""},
  {k:"resultados",      ic:"📋", nm:"Resultados",      cls:"",         bcls:""},
  {k:"reativados",      ic:"♻️", nm:"Reativados",      cls:"",         bcls:""},
  {k:"sensiveis",       ic:"🚨", nm:"Sensíveis",       cls:"urgtab",   bcls:"urgb"},
  {k:"historico",       ic:"📅", nm:"Histórico",       cls:"",         bcls:""},
  {k:"encerrados",      ic:"🔒", nm:"Encerrados",      cls:"",         bcls:""},
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
  positivo:    {lbl:"Positivo",            ic:"✅", col:"#00E5A0"},
  negociacao:  {lbl:"Em negociação",       ic:"🔄", col:"#00D4FF"},
  sem_resposta:{lbl:"Sem resposta",        ic:"⚠️", col:"#FFB020"},
  em_andamento:{lbl:"Contato em andamento", ic:"⏳", col:"#A78BFA"},
  negativo:    {lbl:"Negativo",            ic:"❌", col:"#FF5470"},
};
const CANAIS = ["Ligação","WhatsApp","E-mail","Visita"];
const MOTIVOS = ["Preço","Concorrente","Qualidade","Fechou","Sem demanda","Outro"];
function syncInter(arr){ INTER = (arr||[]).slice().sort((a,b)=>b.ts-a.ts); }
async function loadInter(){ try{ const r=await fetch(INTER_API, {cache:"no-store"}); if(r.ok) syncInter((await r.json()).interacoes); }catch(e){} }
function interOf(cod){ const c=String(cod); return INTER.filter(x=>String(x.cod)===c); }
function lastInter(cod){ return interOf(cod)[0]||null; }
function diasAtras(ts){ const d=Math.floor((Date.now()-ts)/864e5); return d<=0?"hoje":d===1?"ontem":`há ${d}d`; }

/* ---------- clientes encerrados (Netlify Function + Blobs, permanente) ---------- */
const ENCERR_API="/api/crm-encerrados";
let ENCERR=new Map();   // cod(string) -> {cod,cliente,cidade,motivo,por,nota,ts}
const MOTIVOS_ENC=["Em débito","Sem interesse","Judicial"];
function syncEncerr(arr){ ENCERR=new Map((arr||[]).map(e=>[String(e.cod),e])); }
async function loadEncerr(){ try{ const r=await fetch(ENCERR_API, {cache:"no-store"}); if(r.ok) syncEncerr((await r.json()).encerrados); }catch(e){} }
function motivosEnc(){ return [...new Set([...MOTIVOS_ENC, ...[...ENCERR.values()].map(e=>e.motivo).filter(Boolean)])]; }
function act(arr){ return (arr||[]).filter(x=>!ENCERR.has(String(x.cod)) && !INAT.has(String(x.cod))); }   // tira encerrados E inativos do fluxo/% geral
async function encerrar(cod, cliente, cidade, motivo, nota){
  const por=quem(); if(por===null) return false;
  try{ const r=await fetch(ENCERR_API,{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({acao:"add",cod:String(cod),cliente,cidade,motivo,nota,por,senha:window.__pwd})});
    if(r.status===401){ alert("Sessão sem permissão. Saia e entre de novo."); return false; }
    syncEncerr((await r.json()).encerrados); return true;
  }catch(e){ console.warn(e); alert("Não foi possível encerrar (função indisponível)."); return false; }
}
async function reabrir(cod){
  try{ const r=await fetch(ENCERR_API,{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({acao:"remove",cod:String(cod),senha:window.__pwd})});
    if(r.ok){ syncEncerr((await r.json()).encerrados); closeModal(); renderAll(); } }catch(e){}
}

/* ---------- clientes INATIVOS (parados travados: calote, falta de pgto) ----------
   Categoria SEPARADA de encerrados. Saem do % GERAL macro (act() abaixo) e ganham
   aba própria com % de inativação por motivo. Permanente (Blobs). */
const INAT_API="/api/crm-inativos";
let INAT=new Map();   // cod(string) -> {cod,cliente,cidade,motivo,por,nota,ts}
const MOTIVOS_INAT=["Calote","Falta de pagamento","Judicial","Sem contato"];
function syncInat(arr){ INAT=new Map((arr||[]).map(e=>[String(e.cod),e])); }
async function loadInat(){ try{ const r=await fetch(INAT_API, {cache:"no-store"}); if(r.ok) syncInat((await r.json()).inativos); }catch(e){} }
function motivosInat(){ return [...new Set([...MOTIVOS_INAT, ...[...INAT.values()].map(e=>e.motivo).filter(Boolean)])]; }
async function inativar(cod, cliente, cidade, motivo, nota){
  const por=quem(); if(por===null) return false;
  try{ const r=await fetch(INAT_API,{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({acao:"add",cod:String(cod),cliente,cidade,motivo,nota,por,senha:window.__pwd})});
    if(r.status===401){ alert("Sessão sem permissão. Saia e entre de novo."); return false; }
    syncInat((await r.json()).inativos); return true;
  }catch(e){ console.warn(e); alert("Não foi possível marcar inativo (função indisponível)."); return false; }
}
async function reativarInat(cod){
  try{ const r=await fetch(INAT_API,{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({acao:"remove",cod:String(cod),senha:window.__pwd})});
    if(r.ok){ syncInat((await r.json()).inativos); closeModal(); renderAll(); } }catch(e){}
}

/* ---------- clientes SENSÍVEIS (atenção máxima, editável, pra telão) ---------- */
const SENS_API="/api/crm-sensiveis";
let SENS=[];
function syncSens(arr){ SENS=(arr||[]).slice().sort((a,b)=>b.ts-a.ts); }
async function loadSens(){ try{ const r=await fetch(SENS_API, {cache:"no-store"}); if(r.ok) syncSens((await r.json()).sensiveis); }catch(e){} }
async function addSens(nome,obs){ if(!(nome||"").trim()) return; const por=quem(); if(por===null) return;
  try{ const r=await fetch(SENS_API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({acao:"add",nome,obs,por,senha:window.__pwd})});
    if(r.status===401){ alert("Sessão sem permissão."); return; } if(r.ok){ syncSens((await r.json()).sensiveis); renderTab(); } }catch(e){ alert("Falha ao adicionar."); } }
async function removeSens(id){ try{ const r=await fetch(SENS_API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({acao:"remove",id,senha:window.__pwd})}); if(r.ok){ syncSens((await r.json()).sensiveis); renderTab(); } }catch(e){} }

/* ---------- 🌂 GUARDA-CHUVA HISTOPATOLOGIA — ponte com a produção da histotécnica ---------- */
const GC_API="/api/crm-guardachuva";
let GC_CLIN=null, GC_EST=null, GC_LOADING=false, GC_ESTADO_ADD="reconquista";
const GC_STAGES=[{n:1,nome:"Recepção/Triagem"},{n:3,nome:"Clivagem"},{n:4,nome:"Processamento"},{n:5,nome:"Microtomia"},{n:6,nome:"Prep. Lâminas"},{n:7,nome:"Prof. Luís (laudo)",prof:true},{n:8,nome:"Finalização"}];
const GC_PROF_IDX=GC_STAGES.findIndex(s=>s.prof);   // 5 (0-based) — etapa do Professor
const GC_SLA_PROF=3;                                 // golden SLA: dias úteis com o Prof p/ virar alerta
const GC_ESTADOS={reconquista:{ic:"🎯",nm:"Reconquista",cor:"#FF2D55"},novo:{ic:"🆕",nm:"Novo",cor:"#00E5A0"},risco:{ic:"⚠️",nm:"Em risco",cor:"#FF8A00"},chave:{ic:"⭐",nm:"Chave",cor:"#00D4FF"}};
function gcNorm(et){ et=(et||[]).slice(); if(et.length===8) et.splice(1,1); return et; }  // HF nasce com 8 etapas → migra p/ 7
function gcSod(d){ const x=new Date(d); x.setHours(0,0,0,0); return x; }
function gcDiasUteis(from,to){ if(!from) return 0; let a=gcSod(from),b=gcSod(to); if(b<a) return 0; let c=0; const d=new Date(a); while(d<=b){ if(d.getDay()!==0)c++; d.setDate(d.getDate()+1);} return c; }
function gcEtapaAtual(et){ et=gcNorm(et); for(let i=0;i<et.length;i++){ if(!et[i]||!et[i].concluida_em) return i+1; } return et.length+1; }
function gcFinalizado(et){ return gcEtapaAtual(et) > gcNorm(et).length; }
function gcComProf(et){ return gcEtapaAtual(et)===GC_PROF_IDX+1; }
function gcEntrouProf(et){ et=gcNorm(et); return (et[GC_PROF_IDX]&&et[GC_PROF_IDX].coletado_em)||(et[GC_PROF_IDX-1]&&et[GC_PROF_IDX-1].concluida_em)||null; }
function gcDiasProf(et){ return gcComProf(et)? Math.max(0, gcDiasUteis(gcEntrouProf(et), new Date())-1) : 0; }
async function loadGC(){ if(GC_LOADING) return; GC_LOADING=true;
  try{ const [a,b]=await Promise.all([
      fetch(GC_API+"?acao=list",{cache:"no-store"}).then(r=>r.json()),
      fetch(GC_API+"?acao=esteira",{cache:"no-store"}).then(r=>r.json()) ]);
    GC_CLIN=(a&&a.clinicas)||[]; GC_EST=(b&&b.esteira)||[];
  }catch(e){ GC_CLIN=GC_CLIN||[]; GC_EST=GC_EST||[]; }
  GC_LOADING=false; if(ACTIVE==="clinicas"&&clinView==="guardachuva") renderTab();
}
async function gcSave(o){
  try{ const r=await fetch(GC_API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...o,senha:window.__pwd})});
    if(r.status===401){ alert("Sessão sem permissão — entre com a senha do time."); return; }
    const j=await r.json().catch(()=>({})); if(j.erro){ alert("Erro: "+j.erro); return; }
    if(j.clinicas) GC_CLIN=j.clinicas; loadGC();
  }catch(e){ alert("Falha ao salvar."); }
}
async function gcAdd(){ const nm=document.getElementById("gcNome"); if(!nm||!nm.value.trim()){ alert("Digite/escolha a clínica"); return; }
  const resp=(typeof quem==="function"?quem():"")||""; await gcSave({acao:"upsert",nome:nm.value.trim(),estado:GC_ESTADO_ADD,responsavel:resp}); }
async function gcRemove(id){ if(!confirm("Tirar esta clínica de baixo do guarda-chuva?")) return; await gcSave({acao:"remove",id}); }
async function gcSetEstado(id,estado){ await gcSave({acao:"upsert",id,estado}); }
async function gcToggle(id,ativo){ await gcSave({acao:"upsert",id,ativo:!ativo}); }

/* ---------- PROSPECÇÃO (novos leads — crescimento) ---------- */
const PROSP_API="/api/crm-prospeccao";
let PROSP=[];
const PSTATUS={novo:{lbl:"Novo",col:"#8aa2bd"},em_contato:{lbl:"Em contato",col:"#00D4FF"},
  visita_agendada:{lbl:"Visita agendada",col:"#FFB020"},grupo_aberto:{lbl:"Grupo aberto",col:"#A78BFA"},
  venda_ganha:{lbl:"Venda ganha",col:"#00E5A0"},venda_perdida:{lbl:"Venda perdida",col:"#FF5470"}};
const PORDER=["novo","em_contato","visita_agendada","grupo_aberto","venda_ganha","venda_perdida"];
function syncProsp(arr){ PROSP=(arr||[]).slice().sort((a,b)=>(b.ts_upd||b.ts||0)-(a.ts_upd||a.ts||0)); }
async function loadProsp(){ try{ const r=await fetch(PROSP_API, {cache:"no-store"}); if(r.ok) syncProsp((await r.json()).prospects); }catch(e){} }
function prospOf(id){ return PROSP.find(p=>p.id===id); }
async function saveProsp(p){ const por=quem(); if(por===null) return false; if(!p.por) p.por=por;
  try{ const r=await fetch(PROSP_API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({acao:"save",prospect:p,senha:window.__pwd})});
    if(r.status===401){ alert("Sessão sem permissão."); return false; } if(r.ok){ syncProsp((await r.json()).prospects); return true; } }catch(e){ alert("Falha ao salvar."); } return false; }
async function removeProsp(id){ try{ const r=await fetch(PROSP_API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({acao:"remove",id,senha:window.__pwd})}); if(r.ok){ syncProsp((await r.json()).prospects); closeModal(); renderTab(); } }catch(e){} }
async function addProspInline(){
  const nome=document.getElementById("npNome"), contato=document.getElementById("npContato"), cidade=document.getElementById("npCidade"), origem=document.getElementById("npOrigem");
  if(!nome.value.trim()){ nome.focus(); return; }
  const ok=await saveProsp({nome:nome.value,contato:contato.value,cidade:cidade.value,origem:origem.value,status:"novo",feedbacks:[],incrementos:[]});
  if(ok) renderTab();
}
let P_ID=null, P_STATUS="novo", P_INC=[];
function openProsp(id){
  const p=prospOf(id); if(!p) return; P_ID=id; P_STATUS=p.status; P_INC=(p.incrementos||[]).slice();
  const fb=(p.feedbacks||[]).slice().sort((a,b)=>b.ts-a.ts);
  const fbHtml=fb.length?fb.map(f=>`<div class="hist-row"><span class="hi-ic">💬</span><div class="hi-body"><div class="hi-top t-mut">${esc(diasAtras(f.ts))} · ${esc(f.por)}</div><div class="hi-nota">"${esc(f.texto)}"</div></div></div>`).join(""):`<div class="t-mut" style="font-size:13px;padding:6px 0">Sem feedbacks ainda.</div>`;
  document.getElementById("modalBody").innerHTML=`
    <div class="m-head"><div><div class="m-cli">${esc(p.nome)}</div><div class="t-mut" style="font-size:13px;margin-top:2px">${esc(p.contato||"")}${p.cidade?" · "+esc(p.cidade):""}${p.origem?" · origem: "+esc(p.origem):""}</div></div><button class="m-x" id="mClose">✕</button></div>
    <div class="m-sec">Status (pipeline)</div>
    <div class="m-opts" id="pStatus">${PORDER.map(k=>`<button class="opt pst-${k}${k===P_STATUS?" on":""}" data-st="${k}">${PSTATUS[k].lbl}</button>`).join("")}</div>
    <div class="m-lbl">Visita agendada</div><input id="pVisita" type="date" class="m-date" value="${esc(p.visita||"")}">
    <div class="m-sec">Feedback do contato</div><div class="m-hist">${fbHtml}</div>
    <textarea id="pFb" class="m-ta" style="min-height:54px;margin-top:8px" placeholder="Novo feedback / o que rolou no contato…"></textarea>
    <div class="m-sec">Incrementos <span class="t-mut" style="font-weight:500">— campos extras (futuro)</span></div>
    <div id="pIncList"></div>
    <div class="m-opts" style="margin-top:6px"><input id="pIncL" class="m-date" style="flex:1;min-width:120px" placeholder="Campo (ex.: Indicado por)"><input id="pIncV" class="m-date" style="flex:1;min-width:120px" placeholder="Valor"><button class="opt" id="pIncAdd">+ campo</button></div>
    <button class="m-save" id="pSave">Salvar prospect</button>
    <button class="m-enc" id="pDel" style="border-color:var(--mut);color:var(--mut)">Remover prospect</button>`;
  document.getElementById("modal").style.display="flex";
  document.getElementById("mClose").onclick=closeModal;
  document.getElementById("pStatus").onclick=e=>{const b=e.target.closest("[data-st]");if(b){P_STATUS=b.dataset.st;[...e.currentTarget.children].forEach(c=>c.classList.toggle("on",c===b));}};
  const drawInc=()=>{ document.getElementById("pIncList").innerHTML=P_INC.map((i,idx)=>`<div class="histcli"><span class="nm">${esc(i.label)}</span><span class="t-mut">${esc(i.valor)}</span><button class="hi-del" data-incdel="${idx}">✕</button></div>`).join("");
    document.querySelectorAll("[data-incdel]").forEach(b=>b.onclick=()=>{ P_INC.splice(+b.dataset.incdel,1); drawInc(); }); };
  drawInc();
  document.getElementById("pIncAdd").onclick=()=>{ const l=document.getElementById("pIncL"),v=document.getElementById("pIncV"); if(!l.value.trim())return; P_INC.push({label:l.value.trim(),valor:v.value.trim()}); l.value="";v.value=""; drawInc(); };
  document.getElementById("pSave").onclick=async()=>{
    const fbTxt=document.getElementById("pFb").value.trim(), por=localStorage.getItem("crm_quem")||"equipe";
    const np={...p, status:P_STATUS, visita:document.getElementById("pVisita").value, incrementos:P_INC,
      feedbacks:[...(p.feedbacks||[]), ...(fbTxt?[{ts:Date.now(),por,texto:fbTxt}]:[])]};
    const btn=document.getElementById("pSave"); btn.disabled=true; btn.textContent="Salvando…";
    const ok=await saveProsp(np); if(ok){ closeModal(); renderTab(); } else { btn.disabled=false; btn.textContent="Salvar prospect"; } };
  document.getElementById("pDel").onclick=()=>{ if(confirm("Remover este prospect?")) removeProsp(P_ID); };
}

/* ---------- PISTA (feedback do comercial de rua — voz→texto, editável) ---------- */
const PISTA_API="/api/crm-pista";
let PISTA=[];
const PRES={interesse:{lbl:"Interesse",ic:"😍",col:"#00E5A0"},orcamento:{lbl:"Pediu orçamento",ic:"📄",col:"#00D4FF"},
  fechou:{lbl:"Fechou",ic:"✅",col:"#00E5A0"},objecao:{lbl:"Objeção",ic:"🛑",col:"#FFB020"},
  sem_interesse:{lbl:"Sem interesse",ic:"❌",col:"#FF5470"},visita:{lbl:"Visita registrada",ic:"📍",col:"#8aa2bd"}};
const PRORDER=["interesse","orcamento","fechou","objecao","sem_interesse","visita"];
function syncPista(arr){ PISTA=(arr||[]).slice().sort((a,b)=>(b.ts||0)-(a.ts||0)); }
async function loadPista(){ try{ const r=await fetch(PISTA_API, {cache:"no-store"}); if(r.ok) syncPista((await r.json()).pista); }catch(e){} }
/* ---- fila OFFLINE (grava sem sinal → sincroniza quando volta a internet) ---- */
const PQ_KEY="crm_pista_queue";
function pqLoad(){ try{ return JSON.parse(localStorage.getItem(PQ_KEY)||"[]"); }catch(e){ return []; } }
function pqSave(q){ try{ localStorage.setItem(PQ_KEY, JSON.stringify(q)); }catch(e){} }
function pqCount(){ return pqLoad().length; }
async function pqFlush(){
  let q=pqLoad(); if(!q.length || !navigator.onLine || !window.__pwd) return;
  const rest=[];
  for(const it of q){
    try{ const r=await fetch(PISTA_API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({acao:"save",item:it,senha:window.__pwd})});
      if(r.ok){ syncPista((await r.json()).pista); } else rest.push(it); }
    catch(e){ rest.push(it); break; }   // ainda sem sinal — para e mantém o resto
  }
  pqSave(rest);
  if(rest.length!==q.length && ACTIVE==="pista") renderTab();
}
async function savePista(it){ if(!it.por) it.por=meuRep()||"equipe";
  it.edit_by=operadorAtual()||it.por; it.edit_ts=Date.now();   // QUEM mudou/ajustou (auditoria)
  try{ const r=await fetch(PISTA_API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({acao:"save",item:it,senha:window.__pwd})});
    if(r.status===401){ alert("Sessão sem permissão. Saia e entre de novo com a senha do time."); return false; }
    if(r.ok){ syncPista((await r.json()).pista); return true; }
    return false;
  }catch(e){
    // SEM SINAL: enfileira no aparelho + mostra local (otimista)
    const item={...it, id:it.id||("f"+Date.now()), ts:it.ts||Date.now(), ts_upd:Date.now(), _offline:true};
    const q=pqLoad(); q.push(item); pqSave(q);
    PISTA=PISTA.filter(x=>x.id!==item.id); PISTA.unshift(item); PISTA.sort((a,b)=>(b.ts||0)-(a.ts||0));
    alert("📴 Sem sinal — salvo no aparelho. Sincroniza sozinho quando a internet voltar.");
    return true;
  }
}
async function removePista(id){ try{ const r=await fetch(PISTA_API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({acao:"remove",id,senha:window.__pwd})}); if(r.ok){ syncPista((await r.json()).pista); } }catch(e){} }

/* ---- 📣 RELATOS da pista (voz da rua — inteligência de campo, gravado por ÁUDIO) ---- */
const RELATOS_API="/api/crm-relatos";
let RELATOS=[];
const RORIG={ligacao:{lbl:"Ligação",ic:"📞"}, reuniao:{lbl:"Reunião",ic:"🤝"}, visita:{lbl:"Visita",ic:"🏍️"}, whatsapp:{lbl:"WhatsApp",ic:"💬"}, outro:{lbl:"Outro",ic:"•"}};
/* dicionário de DORES (inteligência de mercado) — casa no texto normalizado (sem acento) */
function _norm(s){ return (s||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,""); }
const PAINS=[
  {key:"atraso_result", lbl:"Atraso em resultados", ic:"⏱", rx:/atras|demor|nao (saiu|ficou pronto|libera)|prazo|result.*(atras|demor)/},
  {key:"motoboy_cc",    lbl:"Motoboy/Call-center cobrando", ic:"📞", rx:/motoboy|call.?center|fica(m)? ligando|ligando (todo|toda|as |9|nove)|liga.*saber se tem/},
  {key:"whatsapp",      lbl:"Demora no WhatsApp", ic:"💬", rx:/whats|zap|nao responde|resposta.*(demor|lenta)|demora.*resposta/},
  {key:"urgencia",      lbl:"Exame de urgência", ic:"🚨", rx:/urgenc|urgente|emergenc/},
  {key:"coleta",        lbl:"Horário de coleta", ic:"🕒", rx:/coleta|coletar/},
  {key:"laudo_erro",    lbl:"Erro no laudo/digitação", ic:"⚠️", rx:/erro|errad|digitac|repetitiv|troc.*laudo|laudo.*erra/},
  {key:"comunic_pato",  lbl:"Comunicação com patologista", ic:"🔬", rx:/patolog|sem confianc|nao (tem|sentem?) confianc|passando um|passa.*(um|para o) outro/},
  {key:"clinica_fechou",lbl:"Clínica fechou/mudou", ic:"🚪", rx:/fechou|encerrou|nova clinica|construindo|mudou de endereco|vai fechar/},
  {key:"preco",         lbl:"Preço / tabela", ic:"💰", rx:/preco|caro|tabela|valor|reajust/},
  {key:"concorrente",   lbl:"Concorrente / lab próprio", ic:"⚔️", rx:/concorr|outro lab|lab proprio|lab interno|abriu.*lab/},
];
function detectPains(txt){ const t=_norm(txt); return PAINS.filter(p=>p.rx.test(t)); }
function relCritico(txt){ return /\bput[oa]\b|revoltad|indignad|cansad|\bchat[oa]\b|nao aguent|ameac|(vai|vou) (sair|cortar)|parar de mandar|insatisfeit|nao aguenta mais/.test(_norm(txt)); }
function relTitulo(r){ if(r.titulo&&r.titulo.trim()) return r.titulo.trim();
  const ps=detectPains((r.titulo||"")+" "+r.texto); const dor=ps.length?ps[0].lbl:"";
  if(r.clinica) return r.clinica + (dor?(" — "+dor):"");
  return (r.texto||"").trim().split(/[.\n]/)[0].slice(0,60)||"Relato"; }
function syncRelatos(arr){ const base=(arr||[]).slice(), ids=new Set(base.map(x=>x.id));
  try{ (rqLoad()||[]).forEach(it=>{ if(it&&!ids.has(it.id)) base.push(it); }); }catch(e){}   // mantém os que ainda estão na fila offline (não somem num reload)
  RELATOS=base.sort((a,b)=>(b.ts||0)-(a.ts||0)); }
async function loadRelatos(){ try{ const r=await fetch(RELATOS_API, {cache:"no-store"}); if(r.ok) syncRelatos((await r.json()).relatos); }catch(e){} }
function relatosFiltrados(){ return repFilter ? RELATOS.filter(r=>(r.por||"")===repFilter) : RELATOS; }
/* fila offline dos relatos (mesmo padrão da pista) */
function rqLoad(){ try{ return JSON.parse(localStorage.getItem("crm_relato_queue")||"[]"); }catch(e){ return []; } }
function rqSave(a){ try{ localStorage.setItem("crm_relato_queue", JSON.stringify(a)); }catch(e){} }
function rqCount(){ return rqLoad().length; }
async function rqFlush(){ let q=rqLoad(); if(!q.length) return; const rest=[];
  for(const it of q){ try{ const r=await fetch(RELATOS_API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({acao:"save",item:it,senha:window.__pwd})}); if(r.ok){ syncRelatos((await r.json()).relatos); } else rest.push(it); }catch(e){ rest.push(it); } }
  rqSave(rest); }
async function saveRelato(item){
  if(!item.id) item.id="r"+Date.now(); item.ts=item.ts||Date.now();
  try{ const r=await fetch(RELATOS_API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({acao:"save",item,senha:window.__pwd})});
    if(r.status===401){ alert("Sessão sem permissão."); return false; }
    if(r.ok){ syncRelatos((await r.json()).relatos); return true; }
  }catch(e){}
  const q=rqLoad(); q.push(item); rqSave(q);   // offline → enfileira + otimista
  RELATOS=RELATOS.filter(x=>x.id!==item.id); RELATOS.unshift(item); RELATOS.sort((a,b)=>(b.ts||0)-(a.ts||0));
  return true;
}
async function removeRelato(id){ try{ const r=await fetch(RELATOS_API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({acao:"remove",id,senha:window.__pwd})}); if(r.ok){ syncRelatos((await r.json()).relatos); } }catch(e){} }

/* ---- histórico de EXCLUSÕES (auditoria — nada some sem rastro) ---- */
const EXCL_API="/api/crm-exclusoes";
let EXCL=[];
function syncExcl(arr){ EXCL=(arr||[]).slice().sort((a,b)=>(b.ts||0)-(a.ts||0)); }
async function loadExcl(){ try{ const r=await fetch(EXCL_API, {cache:"no-store"}); if(r.ok) syncExcl((await r.json()).exclusoes); }catch(e){} }
function quemExcluiu(){ return meuRep() || (localStorage.getItem("crm_quem")||"").trim() || (prompt("Quem está excluindo? (seu nome)")||"").trim(); }
async function excluirFeedback(id){
  const f=PISTA.find(x=>x.id===id); if(!f) return;
  if(!confirm(`Excluir o feedback de "${f.cliente||"(sem nome)"}"? Vai para o 🗑️ Histórico de exclusão (permanente, com seu nome).`)) return;
  const por=quemExcluiu(); if(!por){ alert("Preciso saber quem está excluindo."); return; }
  const motivo=(prompt("Motivo da exclusão (opcional):")||"").trim();
  try{ await fetch(EXCL_API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({acao:"add",senha:window.__pwd,
    item:{tipo:"Feedback pista",cliente:f.cliente,bairro:f.bairro,resumo:(f.texto||"").slice(0,200),por_registro:f.por,por_exclusao:por,motivo,ts_original:f.ts}})}); }catch(e){}
  await removePista(id); await loadExcl(); closeModal(); renderTab();
}

/* ---- ditado por voz (grátis, no aparelho — Web Speech API) ---- */
let PREC=null, precOn=false, precStop=false;
function speechOK(){ return !!(window.SpeechRecognition||window.webkitSpeechRecognition); }
/* Captura em BLOCOS CURTOS (continuous=false) + reinício automático — mata a repetição "bom dia bom dia"
   que alguns Android faziam no modo contínuo (o navegador re-emitia os mesmos resultados). Cada bloco é
   uma frase; o texto finalizado vai pro acumulador e a próxima frase começa limpa. */
function pistaMic(btn, ta, onDone){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){ alert("Este celular não transcreve voz (comum no iPhone). Pode DIGITAR normalmente, ou usar o 🎤 do teclado."); return; }
  if(precOn){ precStop=true; try{precStop=true;PREC&&PREC.stop();}catch(e){} return; }   // 2º toque = parar
  const startBase = ta.value ? ta.value.replace(/\s+$/,"")+" " : "";
  let acc="", sess="";
  const paint=intr=>{ ta.value=startBase+acc+sess+intr; if(onDone) try{onDone();}catch(_){} };
  const stopUI=()=>{ precOn=false; btn.classList.remove("rec"); btn.innerHTML="🎤 Falar"; if(onDone) try{onDone();}catch(e){} };
  function startSession(){
    PREC=new SR(); PREC.lang="pt-BR"; PREC.continuous=false; PREC.interimResults=true; sess="";
    PREC.onresult=e=>{ let fin="",intr=""; for(let i=0;i<e.results.length;i++){ const t=e.results[i][0].transcript; if(e.results[i].isFinal) fin+=t+" "; else intr+=t; } sess=fin; paint(intr); };
    PREC.onend=()=>{ acc+=sess; sess=""; paint(""); if(!precStop){ try{ startSession(); }catch(e){ stopUI(); } } else stopUI(); };
    PREC.onerror=()=>{};   // deixa o onend decidir (reinicia ou para)
    try{ PREC.start(); }catch(e){ stopUI(); }
  }
  precStop=false; precOn=true; btn.classList.add("rec"); btn.innerHTML="⏹ Parar — gravando…";
  startSession();
}
/* ---- comerciais (reps) da Pista — setorizar por pessoa ---- */
const REPS_API="/api/crm-reps";
let REPS=[], repFilter="";   // repFilter="" = todos
function syncReps(arr){ REPS=(arr||[]).slice().sort((a,b)=>a.localeCompare(b)); }
async function loadReps(){ try{ const r=await fetch(REPS_API, {cache:"no-store"}); if(r.ok) syncReps((await r.json()).reps); }catch(e){} }
async function addRep(nome){ nome=(nome||"").trim(); if(!nome) return; const por=quem(); if(por===null) return;
  try{ const r=await fetch(REPS_API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({acao:"add",nome,senha:window.__pwd})});
    if(r.status===401){ alert("Sessão sem permissão."); return; } if(r.ok){ syncReps((await r.json()).reps); renderTab(); } }catch(e){ alert("Falha ao cadastrar."); } }
async function removeRep(nome){ try{ const r=await fetch(REPS_API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({acao:"remove",nome,senha:window.__pwd})}); if(r.ok){ syncReps((await r.json()).reps); renderTab(); } }catch(e){} }
function repList(){ return [...new Set([...REPS, ...OPERADORES.map(o=>o.nome), ...PISTA.map(f=>f.por).filter(Boolean)])].sort((a,b)=>a.localeCompare(b)); }  // cadastrados + operadores + já usados
function meuRep(){ return operadorAtual() || (localStorage.getItem("crm_rep")||""); }
/* ---- 👤 OPERADOR (identidade + PIN — pra saber QUEM mudou/ajustou; mantém a senha do time p/ entrar) ---- */
const OPS_API="/api/crm-operadores";
let OPERADORES=[];
function syncOps(a){ OPERADORES=(a||[]).slice(); }
async function loadOps(){ try{ const r=await fetch(OPS_API, {cache:"no-store"}); if(r.ok) syncOps((await r.json()).operadores); }catch(e){} }
function operadorAtual(){ return (localStorage.getItem("crm_operador")||"").trim(); }
function operadorPapel(){ return (localStorage.getItem("crm_operador_papel")||"comercial"); }
function ehDiretoria(){ return operadorPapel()==="diretoria"; }   // só diretoria vê R$
function setOperador(nome, papel){ nome=(nome||"").trim(); if(nome){ localStorage.setItem("crm_operador",nome); localStorage.setItem("crm_rep",nome); } if(papel){ localStorage.setItem("crm_operador_papel", papel==="diretoria"?"diretoria":"comercial"); if(papel!=="diretoria"){ CLIN_RS=null; CLIN_FATMES=null; CLIN_RS_DESDE=null; CLIN_CONQFAT=null; CLIN_CONQMES=null; try{sessionStorage.removeItem("crm_dir_code");localStorage.removeItem("crm_fin_code");}catch(e){} } } renderOpBtn(); }
function renderOpBtn(){ const b=document.getElementById("opBtn"); if(b){ const o=operadorAtual(); b.innerHTML=o?("👤 "+esc(o)+(ehDiretoria()?" 🔓R$":"")+" · trocar"):"👤 identificar-se"; } }
/* 💰 R$ BLINDADO: só a diretoria vê o valor; comercial vê 🔒 (Fase 2 — pronto p/ o R$ da Fase 3) */
function fmtBRL(v){ const n=+v||0; return "R$ "+n.toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2}); }
function rs(v){ return ehDiretoria()?fmtBRL(v):`<span class="t-mut" title="valor visível só para a diretoria">🔒</span>`; }
async function trocarMeuPin(){
  const nome=operadorAtual(); if(!nome){ alert("Identifique-se primeiro (seu nome + PIN)."); return; }
  const atual=(prompt(`Seu PIN ATUAL (${esc(nome)}):`)||"").trim(); if(!atual) return;
  const novo=(prompt("Novo PIN (mínimo 6 dígitos):")||"").trim();
  if(novo.length<6){ alert("O PIN precisa de pelo menos 6 dígitos."); return; }
  if(!/^\d+$/.test(novo)){ alert("Use só números no PIN."); return; }
  if((prompt("Repita o novo PIN pra confirmar:")||"").trim()!==novo){ alert("Os PINs não bateram. Nada foi trocado."); return; }
  try{
    const r=await fetch(OPS_API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({acao:"setpin",nome,pin:novo,pin_atual:atual,senha:window.__pwd})});
    const j=await r.json().catch(()=>({}));
    if(r.ok && j.ok!==false){ alert("🔑 PIN trocado com sucesso! Use o novo da próxima vez que entrar."); closeModal(); }
    else if(j.erro==="pin_atual_invalido"){ alert("PIN atual incorreto — não troquei."); }
    else alert("Não consegui trocar agora: "+(j.erro||"erro"));
  }catch(e){ alert("Sem internet pra trocar o PIN agora."); }
}
async function verificaPin(nome, pin){
  try{ const r=await fetch(OPS_API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({acao:"verify",nome,pin,senha:window.__pwd})});
    if(r.ok){ const j=await r.json(); return j.ok?{ok:true, papel:j.papel||"comercial", finkey:j.finkey}:{ok:false}; } }catch(e){ return null; }   // null = offline/erro
  return {ok:false}; }
async function criarOperador(nome, pin, papel, dir_code){
  try{ const r=await fetch(OPS_API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({acao:"add",nome,pin,papel,dir_code,senha:window.__pwd})});
    if(r.status===409){ alert("Já existe um operador com esse nome — escolha ele na lista."); return false; }
    if(r.status===403){ alert("❌ Código da diretoria inválido — criado como comercial não foi feito."); return false; }
    if(r.status===400){ alert("O PIN precisa de pelo menos 6 dígitos."); return false; }
    if(r.status===401){ alert("Sessão sem permissão."); return false; }
    if(r.ok){ syncOps((await r.json()).operadores); return true; } }catch(e){ alert("Sem internet — precisa de conexão pra criar operador."); }
  return false; }
async function tornarDiretoria(){
  const nome=operadorAtual(); if(!nome){ alert("Identifique-se primeiro."); return; }
  const code=(prompt(`Para VER R$, digite a SENHA FINANCEIRA da diretoria (só você e o Fúlvio têm — NÃO é o código do desmarcou):`)||"").trim(); if(!code) return;
  try{ const r=await fetch(OPS_API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({acao:"setpapel",nome,papel:"diretoria",dir_code:code,senha:window.__pwd})});
    if(r.status===403){ alert("❌ Código da diretoria inválido."); return; }
    if(r.ok){ localStorage.setItem("crm_operador_papel","diretoria"); sessionStorage.setItem("crm_dir_code",code); syncOps((await r.json()).operadores); if(!CLIN_RS_ENV) await loadClinRS(); await decDirRS(code); alert("🔓 Pronto — você agora é DIRETORIA e vê os valores em R$."); renderOpBtn(); renderAll(); } }catch(e){ alert("Sem internet."); }
}
async function openIdentidade(force){
  await loadOps();
  document.getElementById("modalBody").innerHTML=`
    <div class="m-head"><div><div class="m-cli">👤 Quem está usando?</div>
      <div class="t-mut" style="font-size:13px;margin-top:2px">identifique-se com seu PIN — tudo que você fizer/ajustar fica no seu nome</div></div>
      ${force?"":'<button class="m-x" id="mClose">✕</button>'}</div>
    <div id="opList" style="display:flex;flex-direction:column;gap:8px;margin:10px 0">
      ${OPERADORES.length?OPERADORES.map(o=>`<button class="checkinbtn" data-op="${esc(o.nome)}" style="text-align:left">👤 ${esc(o.nome)}${(o.papel==="diretoria"&&ehDiretoria())?' <span class="t-mut">🔓 diretoria</span>':''}</button>`).join(""):`<div class="t-mut" style="text-align:center;padding:10px">Nenhum operador ainda. Crie o primeiro 👇</div>`}
    </div>
    <button class="m-save" id="opNovo">＋ Novo operador</button>
    ${operadorAtual()?`<button class="checkinbtn" id="opPin" type="button" style="margin-top:8px;border-color:rgba(0,212,255,.4);color:#9fe6ff">🔑 Trocar meu PIN (${esc(operadorAtual())})</button>`:""}
    `;   /* removido o botão público "Sou da diretoria": reps não devem saber que existe R$. Diretoria vem pelo login (papel do operador) ou é promovida via API. */
  document.getElementById("modal").style.display="flex";
  const mc=document.getElementById("mClose"); if(mc) mc.onclick=closeModal;
  document.querySelectorAll("#opList [data-op]").forEach(el=>el.onclick=async()=>{
    const nome=el.dataset.op, pin=(prompt(`PIN de ${nome}:`)||"").trim(); if(!pin) return;
    const res=await verificaPin(nome, pin);
    if(res===null){ if(confirm("Sem internet pra validar o PIN agora. Entrar como "+nome+" mesmo assim?")){ setOperador(nome, "comercial"); closeModal(); renderAll(); } }   // offline não libera R$ (segurança)
    else if(res.ok){ setOperador(nome, res.papel); if(res.papel==="diretoria" && res.finkey) await autoRSdir(res.finkey); closeModal(); renderAll(); }
    else alert("PIN incorreto."); });
  document.getElementById("opNovo").onclick=async()=>{
    const nome=(prompt("Nome do novo operador (ex.: Heitor, Luciane, Wal):")||"").trim(); if(!nome) return;
    const pin=(prompt(`Crie um PIN (mínimo 6 dígitos) para ${nome}:`)||"").trim(); if(pin.length<6){ alert("O PIN precisa de pelo menos 6 dígitos."); return; }
    let papel="comercial", dir_code="";
    if(confirm(`${nome} é da DIRETORIA (vê valores em R$)?\n\nOK = sim (vai pedir a senha financeira) · Cancelar = comercial`)){ dir_code=(prompt("Senha financeira da diretoria (só R$ — não é o código do desmarcou):")||"").trim(); if(dir_code) papel="diretoria"; }
    const ok=await criarOperador(nome, pin, papel, dir_code); if(ok){ setOperador(nome, papel); closeModal(); renderAll(); } };
  const od=document.getElementById("opDir"); if(od) od.onclick=()=>tornarDiretoria();
  const op=document.getElementById("opPin"); if(op) op.onclick=()=>trocarMeuPin();
}
function pistaFiltrada(){ return repFilter ? PISTA.filter(f=>(f.por||"")===repFilter) : PISTA; }
/* ---- 🏥 CLÍNICAS: master do HF (autocomplete) + carteira Novas/Reconquistadas ---- */
const CLIN_API="/api/crm-clinicas", CART_API="/api/crm-carteira";
let CLINICAS=[], CLIN_TS=0, CARTEIRA=[], clinView="reconquistada";
const PORTE_PROD_BAIXA=40;   // porte Grande com produção L12 abaixo disso = 🚩 pode estar dividindo exame (heurística até ter categoria)
function syncClin(o){ CLINICAS=(o&&o.clinicas)||[]; CLIN_TS=(o&&o.ts)||0; }
async function loadClin(){ try{ const r=await fetch(CLIN_API, {cache:"no-store"}); if(r.ok) syncClin(await r.json()); }catch(e){} }
function syncCart(a){ CARTEIRA=(a||[]).slice().sort((x,y)=>(y.ts||0)-(x.ts||0)); }
async function loadCart(){ try{ const r=await fetch(CART_API, {cache:"no-store"}); if(r.ok) syncCart((await r.json()).carteira); }catch(e){} }
const REL_API="/api/crm-relatorios"; let RELATORIOS=[];
async function loadRel(){ try{ const r=await fetch(REL_API, {cache:"no-store"}); if(r.ok) RELATORIOS=((await r.json()).relatorios||[]).slice().sort((a,b)=>(a.id<b.id?1:-1)); }catch(e){} }
let CLIN_DET={}, CLIN_SETORES=[], CLIN_CATVAL={};   // share-of-wallet por clínica + share de R$ por categoria (simulação da mesa) — SEM R$ por clínica
async function loadDet(){ try{ const r=await fetch("/api/crm-clinicas-det", {cache:"no-store"}); if(r.ok){ const j=await r.json(); CLIN_DET=(j&&j.det)||{}; CLIN_SETORES=(j&&j.setores)||[]; CLIN_CATVAL=(j&&j.catval)||{}; } }catch(e){} }
let AAA=[], AAA_TS=0, AAA_SETORES=[], AAA_PCT=80;   // clínicas Triplo A (top faturamento 12m, curva A) + share-of-wallet 12m (ordem = ranking; SEM R$ no payload)
async function loadAAA(){ try{ const r=await fetch("/api/crm-aaa", {cache:"no-store"}); if(r.ok){ const j=await r.json(); AAA=(j&&j.aaa)||[]; AAA_TS=(j&&j.ts)||0; AAA_SETORES=(j&&j.setores)||[]; AAA_PCT=(j&&j.pct)||80; } }catch(e){} }
async function saveCart(item){ try{ const r=await fetch(CART_API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({acao:"save",item,senha:window.__pwd})}); if(r.status===401){ alert("Sessão sem permissão."); return false; } if(r.ok){ syncCart((await r.json()).carteira); return true; } }catch(e){ alert("Sem internet."); } return false; }
async function removeCart(id){ try{ const r=await fetch(CART_API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({acao:"remove",id,senha:window.__pwd})}); if(r.ok){ syncCart((await r.json()).carteira); } }catch(e){} }
function clinByCod(cod){ return cod?CLINICAS.find(c=>String(c.cod)===String(cod)):null; }
const AUTO_REL_NOTE='<span class="t-mut" style="font-size:11px">· 🔄 automático</span>';
/* 🧠² CÉREBRO 2 — aprende o RITMO de envio de cada clínica (média/semana + cadência típica) e detecta
   PAROU / CAIU. O alerta é ADAPTATIVO: cada clínica tem seu próprio limiar (~2× a cadência dela) —
   quem manda a cada 2 dias dispara em ~4-5 dias; quem manda semanal, em ~14. Aprende do histórico real. */
function cerebro2(det){
  const r=(det&&det.recent)||[];
  if(r.length<4) return null;   // pouco histórico p/ aprender o ritmo
  const DAY=864e5, hoje=Date.now();
  const days=[...new Set(r.map(e=>e.d))].sort();   // dias com exame, ISO asc
  const diasSil=Math.max(0,Math.floor((hoje-Date.parse(days[days.length-1]+"T00:00:00"))/DAY));
  const wk={}; r.forEach(e=>{ const b=Math.floor(Date.parse(e.d+"T00:00:00")/(7*DAY)); wk[b]=(wk[b]||0)+1; });
  const wv=Object.values(wk).sort((a,b)=>a-b); const semMed=wv.length?wv[Math.floor(wv.length/2)]:0;   // exames/semana (mediana)
  const gaps=[]; for(let i=1;i<days.length;i++) gaps.push(Math.round((Date.parse(days[i]+"T00:00:00")-Date.parse(days[i-1]+"T00:00:00"))/DAY));
  gaps.sort((a,b)=>a-b); const cad=gaps.length?gaps[Math.floor(gaps.length/2)]:null;   // cadência típica (dias entre envios)
  const alerta=cad?Math.max(cad*2, cad+3):14;   // limiar adaptativo por clínica
  const cut=hoje-14*DAY, rec14=r.filter(e=>Date.parse(e.d+"T00:00:00")>=cut).length, esp14=semMed*2;
  let status,cor,msg;
  if(diasSil>=alerta){ status="parou"; cor="#ff6b81"; msg=`🔴 PAROU — <b>${diasSil} dias</b> sem enviar (costuma a cada ~${cad}d · ~${semMed}/sem). <b>Liga hoje.</b>`; }
  else if(esp14>0 && rec14<esp14*0.5){ status="caiu"; cor="#ffc266"; const q=Math.round((1-rec14/esp14)*100); msg=`🟡 CAIU — ${rec14} em 14d vs ~${esp14} do normal (−${q}%). Atenção antes de perder.`; }
  else { status="ok"; cor="#7effcf"; msg=`🟢 no ritmo — ~${semMed}/semana · última há ${diasSil}d (normal ~${cad}d)`; }
  return {status,cor,msg,semMed,diasSil,cad,alerta};
}
function c2mini(cod){ const c2=cerebro2(CLIN_DET[String(cod)]); if(!c2) return "";
  if(c2.status==="parou") return `<span style="color:#ff6b81;font-weight:700">🔴 parou ${c2.diasSil}d</span>`;
  if(c2.status==="caiu") return `<span style="color:#ffc266;font-weight:700">🟡 caiu</span>`;
  return `<span style="color:#7effcf">🟢 ~${c2.semMed}/sem</span>`; }
/* 💰 R$ POR CLÍNICA — CIFRADO só p/ DIRETORIA (decifra no navegador com o código da diretoria) */
const CLIN_RS_API="/api/crm-clinicas-rs";
let CLIN_RS_ENV=null, CLIN_RS=null, CLIN_RS_DESDE=null, CLIN_FATMES=null, CLIN_CONQFAT=null, CLIN_CONQMES=null, LAB_FAT_DESDE=null, LAB_MARCO=null, LAB_MES=null;   // env cifrado (público) + {cod:fat 12m} + {cod:fat desde marco} + {cod:[{ym,n,fat}]} + {cod:{setor:fat}} conquistas + faturamento do lab TOTAL(lab_desde) e MÊS A MÊS(lab_mes={ym:fat}) desde o marco (denominador do BI) — só diretoria
async function loadClinRS(){ try{ const r=await fetch(CLIN_RS_API, {cache:"no-store"}); if(r.ok){ const j=await r.json(); CLIN_RS_ENV=(j&&j.ct)?j:null; } }catch(e){} }
function _b64b(s){ const bin=atob(s||""); const a=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++)a[i]=bin.charCodeAt(i); return a; }
async function decDirRS(code){
  if(!CLIN_RS_ENV||!CLIN_RS_ENV.ct||!code) return false;
  try{ const bk=await crypto.subtle.importKey("raw", new TextEncoder().encode(code), "PBKDF2", false, ["deriveKey"]);
    const key=await crypto.subtle.deriveKey({name:"PBKDF2", salt:_b64b(CLIN_RS_ENV.salt), iterations:CLIN_RS_ENV.iter||250000, hash:"SHA-256"}, bk, {name:"AES-GCM", length:256}, false, ["decrypt"]);
    const plain=await crypto.subtle.decrypt({name:"AES-GCM", iv:_b64b(CLIN_RS_ENV.iv)}, key, _b64b(CLIN_RS_ENV.ct));
    const obj=JSON.parse(new TextDecoder().decode(plain));
    if(obj && obj.fat){ CLIN_RS=obj.fat; CLIN_RS_DESDE=obj.desde||{}; CLIN_FATMES=obj.fatmes||{}; CLIN_CONQFAT=obj.conqfat||{}; CLIN_CONQMES=obj.conqmes||{}; LAB_FAT_DESDE=obj.lab_desde||null; LAB_MARCO=obj.marco||null; LAB_MES=obj.lab_mes||null; }   // {fat, desde, fatmes, conqfat, lab_desde, marco, lab_mes}
    else { CLIN_RS=obj; CLIN_RS_DESDE={}; CLIN_FATMES={}; CLIN_CONQFAT={}; }   // compat formato antigo (mapa plano)
    return true;
  }catch(e){ return false; } }
/* R$ da clínica: se ela tem marco zero e há R$ desde o marco, usa esse (reconquista conta da volta); senão 12m */
function rsVal(cod, marco){ if(!CLIN_RS||cod==null) return null; const k=String(cod);
  if(marco && CLIN_RS_DESDE && CLIN_RS_DESDE[k]!=null) return CLIN_RS_DESDE[k];
  return CLIN_RS[k]!=null?CLIN_RS[k]:null; }
function dirCodeCache(){ return localStorage.getItem("crm_fin_code")||sessionStorage.getItem("crm_dir_code")||""; }   // localStorage = gruda no aparelho da diretoria
/* 🔓 AUTO-R$ p/ DIRETORIA: quando o operador diretoria (Wal/Fábio) loga, o servidor manda a finkey → abre o R$ SOZINHO (inclusive por biometria). Reps não recebem finkey → nada muda pra eles. */
async function autoRSdir(finkey){
  if(!finkey) return false;
  try{ if(!CLIN_RS_ENV) await loadClinRS();
    if(await decDirRS(finkey)){ try{ localStorage.setItem("crm_fin_code",finkey); sessionStorage.setItem("crm_dir_code",finkey); }catch(e){} return true; }
  }catch(e){}
  return false;
}
async function verRS(){
  if(!ehDiretoria()){ alert("Só a diretoria vê R$. Identifique-se como diretoria primeiro (🔓)."); return; }
  if(!CLIN_RS_ENV) await loadClinRS();
  const code=dirCodeCache()||(prompt("Senha financeira da diretoria (pra abrir os valores em R$):")||"").trim(); if(!code) return;
  const ok=await decDirRS(code);
  if(ok){ sessionStorage.setItem("crm_dir_code", code); if(ACTIVE==="clinicas") renderTab(); }
  else alert("Não consegui abrir o R$ — código incorreto, ou os valores ainda não chegaram do robô.");
}
/* 🔓 UNLOCK financeiro em UMA tocada: pede a senha financeira, e se a decifragem funcionar (prova
   criptográfica de que o código está certo) já promove a diretoria + abre o R$. Serve mesmo que o
   operador ainda não esteja marcado como diretoria neste aparelho. */
/* 👆 DIGITAL / FACE ID (WebAuthn): depois de destravar 1x com a senha, o Wal ativa a biometria e nas
   próximas abre com o dedo/rosto. A senha financeira fica salva no aparelho; a biometria é o atalho rápido. */
async function bioSuportado(){ try{ return !!(window.PublicKeyCredential) && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); }catch(e){ return false; } }
async function bioRegistrar(){
  try{
    const cred=await navigator.credentials.create({publicKey:{
      challenge:crypto.getRandomValues(new Uint8Array(32)),
      rp:{name:"Agente CRM Alpha", id:location.hostname},
      user:{id:crypto.getRandomValues(new Uint8Array(16)), name:"diretoria", displayName:"Diretoria"},
      pubKeyCredParams:[{type:"public-key",alg:-7},{type:"public-key",alg:-257}],
      authenticatorSelection:{authenticatorAttachment:"platform", userVerification:"required"},
      timeout:60000, attestation:"none"}});
    const raw=new Uint8Array(cred.rawId); let s=""; raw.forEach(b=>s+=String.fromCharCode(b));
    localStorage.setItem("crm_bio_id", btoa(s)); return true;
  }catch(e){ return false; }
}
async function bioUnlock(){
  const id=localStorage.getItem("crm_bio_id"); if(!id) return false;
  try{ await navigator.credentials.get({publicKey:{
      challenge:crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials:[{type:"public-key", id:_b64b(id)}],
      userVerification:"required", timeout:60000}});
    return true;   // biometria passou
  }catch(e){ return false; }
}
async function abrirFinanceiro(){
  if(!CLIN_RS_ENV) await loadClinRS();
  if(!CLIN_RS_ENV || !CLIN_RS_ENV.ct){ alert("Os valores em R$ ainda não chegaram do robô — tenta de novo em alguns minutos."); return; }
  // 1) já tem digital + senha salva no aparelho → abre com o dedo/rosto
  if(localStorage.getItem("crm_bio_id") && localStorage.getItem("crm_fin_code")){
    if(await bioUnlock()){ const ok=await decDirRS(localStorage.getItem("crm_fin_code"));
      if(ok){ localStorage.setItem("crm_operador_papel","diretoria"); sessionStorage.setItem("crm_dir_code",localStorage.getItem("crm_fin_code")); renderOpBtn(); renderAll(); return; } }
    // biometria falhou/cancelou → cai pro código
  }
  const code=dirCodeCache()||(prompt("🔒 Senha FINANCEIRA da diretoria (abre o faturamento em R$):")||"").trim();
  if(!code) return;
  const ok=await decDirRS(code);
  if(ok){ localStorage.setItem("crm_operador_papel","diretoria"); localStorage.setItem("crm_fin_code",code); sessionStorage.setItem("crm_dir_code",code); renderOpBtn(); renderAll();   // grava no aparelho → abre sozinho nas próximas
    if(!localStorage.getItem("crm_bio_id") && await bioSuportado() && confirm("Ativar 👆 Face ID / digital pra abrir o financeiro rápido neste aparelho?")){
      if(await bioRegistrar()) alert("👆 Pronto! Da próxima é só o dedo/rosto."); } }
  else alert("Código incorreto — não abri o R$. (É a senha financeira, diferente do código do desmarcou.)");
}
/* 👆 Controle explícito da trava biométrica (pedido do Wal: só EU vejo o R$ da Triplo A/carteira).
   Uma vez ativada NESTE aparelho, o R$ só abre com o dedo/rosto e NÃO abre sozinho no boot. */
function bioAtivo(){ return !!localStorage.getItem("crm_bio_id"); }
async function ativarBioManual(){
  if(!ehDiretoria()){ alert("Abra o financeiro primeiro (você precisa ser diretoria)."); return; }
  if(!localStorage.getItem("crm_fin_code")){ alert("Primeiro abra o R$ uma vez com a senha financeira; aí eu travo com sua digital/Face ID."); return; }
  if(!(await bioSuportado())){ alert("Este navegador/aparelho não tem Face ID/digital disponível. Tente no Safari do seu iPhone/Mac."); return; }
  if(await bioRegistrar()){ alert("👆 Pronto! Agora o R$ (inclusive da Triplo A) só abre com o SEU Face ID/digital NESTE aparelho. Nenhum outro aparelho abre sem a senha financeira — e ela é só sua."); renderAll(); }
  else alert("Não consegui ativar (cancelado ou não suportado). Tente de novo.");
}
function removerBioManual(){ if(confirm("Remover a trava de Face ID/digital DESTE aparelho? O R$ volta a abrir com a senha financeira.")){ localStorage.removeItem("crm_bio_id"); renderAll(); } }
function bioLinha(){ if(!ehDiretoria()) return "";
  return bioAtivo()
    ? `<div style="font-size:11px;margin-top:5px;color:#7effcf">👆 <b>Face ID / digital ATIVO</b> neste aparelho — o R$ só abre com você · <a onclick="removerBioManual()" style="color:#ffc266;cursor:pointer">remover</a></div>`
    : `<div style="font-size:11px;margin-top:5px"><a onclick="ativarBioManual()" style="color:#00D4FF;cursor:pointer;font-weight:700">👆 Travar o R$ com meu Face ID / digital</a> <span class="t-mut">(só você abre, só neste aparelho)</span></div>`;
}
function rsClin(cod, marco){
  if(!ehDiretoria()) return "";   // reps não veem NADA de R$ (nem que existe)
  const v=rsVal(cod, marco);
  if(v!=null) return `<b style="color:#7effcf">${fmtBRL(v)}</b>${marco&&CLIN_RS_DESDE&&CLIN_RS_DESDE[String(cod)]!=null?' <span class="t-mut" style="font-size:10px">desde a reconq.</span>':''}`;
  return `<a onclick="abrirFinanceiro()" style="color:var(--cyan);cursor:pointer;font-weight:700">🔓 ver R$</a>`;
}
/* fuzzy match: normaliza, tira palavras genéricas (vet/clínica/pet…), casa por token distintivo — "Guaratiba" acha "Vet Guaratiba" */
const _CLIN_STOP=new Set(["vet","veterinaria","veterinario","clinica","hospital","pet","petshop","shop","centro","dr","dra","drs","de","da","do","dos","das","e","o","a"]);
function _clinNorm(s){ return (s||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim(); }
function _clinToks(s){ return _clinNorm(s).split(" ").filter(t=>t && !_CLIN_STOP.has(t)); }
function matchClinicas(q, lim){ lim=lim||8; const qt=_clinToks(q), qn=_clinNorm(q); if(!qt.length) return [];
  const scored=CLINICAS.map(c=>{ const cn=_clinNorm(c.nome), ct=_clinToks(c.nome); let sc=0;
    qt.forEach(t=>{ if(ct.includes(t)) sc+=10; else if(ct.some(x=>x.startsWith(t)||t.startsWith(x))) sc+=6; else if(cn.includes(t)) sc+=4; });
    if(cn.startsWith(qn)) sc+=5; if(cn===qn) sc+=25;
    return {c, sc}; }).filter(x=>x.sc>0).sort((a,b)=>b.sc-a.sc||((b.c.prod||0)-(a.c.prod||0)));
  return scored.slice(0,lim).map(x=>x.c); }
function openCarteira(tipo, id){
  const c=id?CARTEIRA.find(x=>x.id===id):null; let T=c?c.tipo:(tipo||"reconquistada"), P=c?c.porte:"";
  document.getElementById("modalBody").innerHTML=`
    <div class="m-head"><div><div class="m-cli">${c?"✏️ Editar clínica":"➕ Adicionar clínica"}</div>
      <div class="t-mut" style="font-size:13px;margin-top:2px">digite o nome; eu acho no HF e vinculo (correlaciona a produção)</div></div>
      <button class="m-x" id="mClose">✕</button></div>
    <div class="m-lbl">Clínica <span style="color:var(--red)">*</span> <span class="t-mut" style="font-weight:500">— digite e escolha a do HF</span></div>
    <input id="caNome" class="m-date" style="width:100%" autocomplete="off" placeholder="Ex.: Guaratiba…" value="${c?esc(c.nome):""}">
    <div id="caSug" style="display:flex;flex-direction:column;gap:4px;margin-top:6px"></div>
    <input type="hidden" id="caCod" value="${c?esc(c.cod||""):""}"><input type="hidden" id="caCidade" value="${c?esc(c.cidade||""):""}">
    <div id="caVinc" class="proxhint" style="display:${(c&&c.cod)?"block":"none"}">${(c&&c.cod)?("🔗 vinculada ao HF"+(c.cidade?" · "+esc(c.cidade):"")):""}</div>
    <div class="m-lbl">Tipo</div>
    <div class="m-opts" id="caTipo"><button class="opt${T==="reconquistada"?" on":""}" data-t="reconquistada">♻️ Reconquistada</button><button class="opt${T==="nova"?" on":""}" data-t="nova">🆕 Nova</button><button class="opt${T==="divide"?" on":""}" data-t="divide">🔀 Divide material</button><button class="opt${T==="particular"?" on":""}" data-t="particular">🐾 Particular</button></div>
    <div class="m-lbl">Porte <span class="t-mut" style="font-weight:500">— ajuda a saber se manda muito ou pouco</span></div>
    <div class="m-opts" id="caPorte">${[["G","🐘 Grande"],["M","🐎 Médio"],["P","🐇 Pequeno"]].map(([v,l])=>`<button class="opt${P===v?" on":""}" data-p="${v}">${l}</button>`).join("")}</div>
    <div class="m-lbl">📅 Marco zero — data da reconquista/entrada <span style="color:var(--red)">*</span> <span class="t-mut" style="font-weight:500">— a produção conta a partir daqui</span></div>
    <input id="caRecData" type="date" class="m-date" style="width:100%" value="${c?esc(c.reconq_data||""):hojeISO()}">
    <div class="m-lbl">Motivo da perda anterior <span class="t-mut" style="font-weight:500">— por que tinha deixado de mandar (opcional)</span></div>
    <textarea id="caMotivo" class="m-ta" style="min-height:44px" placeholder="Ex.: vazamento de urina na cistocentese — reembolsamos e recuperamos">${c?esc(c.motivo_perda||""):""}</textarea>
    <div class="m-lbl">Códigos adicionais do HF <span class="t-mut" style="font-weight:500">— se a clínica tem cadastro duplicado/órfão (ex.: exames caíram noutro código). Separe por vírgula.</span></div>
    <input id="caCodsExtra" class="m-date" style="width:100%" inputmode="numeric" placeholder="Ex.: 5724" value="${c?esc((c.cods_extra||[]).join(", ")):""}">
    <div class="m-lbl">Observação</div>
    <textarea id="caObs" class="m-ta" style="min-height:48px">${c?esc(c.obs||""):""}</textarea>
    <button class="m-save" id="caSave">${c?"Salvar alterações":"Salvar"}</button>
    ${c?`<button class="m-enc" id="caDel" style="border-color:var(--mut);color:var(--mut)">Remover</button>`:""}`;
  document.getElementById("modal").style.display="flex";
  document.getElementById("mClose").onclick=closeModal;
  const nomeEl=document.getElementById("caNome"), sug=document.getElementById("caSug"), vinc=document.getElementById("caVinc");
  const pickClin=m=>{ nomeEl.value=m.nome; document.getElementById("caCod").value=m.cod; document.getElementById("caCidade").value=m.cidade||""; sug.innerHTML=""; vinc.style.display="block"; vinc.style.borderColor="rgba(0,229,160,.4)"; vinc.style.color="#7effcf"; vinc.innerHTML=`🔗 vinculada ao HF: <b>${esc(m.nome)}</b>${m.cidade?" · "+esc(m.cidade):""} · produção ${m.prod||0}`; };
  const doSug=()=>{ document.getElementById("caCod").value=""; const ms=matchClinicas(nomeEl.value);
    if(!nomeEl.value.trim()||!ms.length){ sug.innerHTML=""; if(nomeEl.value.trim()&&CLINICAS.length){ vinc.style.display="block"; vinc.style.borderColor="rgba(255,138,0,.4)"; vinc.style.color="#ffc266"; vinc.innerHTML="⚠️ não achei no HF — pode salvar como <b>pendente de vínculo</b> e conciliar depois"; } else vinc.style.display="none"; return; }
    vinc.style.display="none";
    sug.innerHTML=ms.map((m,i)=>`<button class="checkinbtn" data-sug="${i}" style="text-align:left;font-size:13px">🏥 ${esc(m.nome)}${m.cidade?` <span class="t-mut">· ${esc(m.cidade)}</span>`:""} <span class="t-mut">· prod ${m.prod||0}</span></button>`).join("");
    sug.querySelectorAll("[data-sug]").forEach(b=>b.onclick=()=>pickClin(ms[+b.dataset.sug])); };
  nomeEl.addEventListener("input", doSug);
  document.getElementById("caTipo").onclick=e=>{const b=e.target.closest("[data-t]");if(b){T=b.dataset.t;[...e.currentTarget.children].forEach(x=>x.classList.toggle("on",x===b));}};
  document.getElementById("caPorte").onclick=e=>{const b=e.target.closest("[data-p]");if(b){P=b.dataset.p;[...e.currentTarget.children].forEach(x=>x.classList.toggle("on",x===b));}};
  document.getElementById("caSave").onclick=async()=>{
    const nome=nomeEl.value.trim(); if(!nome){ alert("Informe a clínica."); return; }
    const codsExtra=((document.getElementById("caCodsExtra")||{}).value||"").split(/[,\s]+/).map(s=>s.replace(/\D/g,"")).filter(Boolean);
    const item={id:c?c.id:null, cod:document.getElementById("caCod").value, cods_extra:codsExtra, cidade:document.getElementById("caCidade").value, nome, tipo:T, porte:P, reconq_data:(document.getElementById("caRecData")||{}).value||"", motivo_perda:(document.getElementById("caMotivo")||{}).value.trim(), obs:document.getElementById("caObs").value.trim(), por:meuRep()||"equipe", ts:c?c.ts:Date.now()};
    const btn=document.getElementById("caSave"); btn.disabled=true; btn.textContent="Salvando…";
    const ok=await saveCart(item); if(ok){ clinView=T; closeModal(); renderTab(); } else { btn.disabled=false; btn.textContent=c?"Salvar alterações":"Salvar"; } };
  const del=document.getElementById("caDel"); if(del) del.onclick=async()=>{ if(confirm(`Remover "${c.nome}" da carteira?`)){ await removeCart(c.id); closeModal(); renderTab(); } };
}
/* VISITA EM ANDAMENTO: check-in na CHEGADA (separado); feedback+check-out na SAÍDA */
function visitaLoad(){ try{ return JSON.parse(localStorage.getItem("crm_visita")||"null"); }catch(e){ return null; } }
function visitaSave(v){ try{ localStorage.setItem("crm_visita", JSON.stringify(v)); }catch(e){} }
function visitaClear(){ try{ localStorage.removeItem("crm_visita"); }catch(e){} }
function iniciarVisita(ret){   // ret = retorno da agenda {id,cliente,bairro} → amarra a visita ao agendamento
  if(!navigator.geolocation){ alert("Este aparelho não tem GPS/localização."); return; }
  let cli, bairro, returnId=null;
  if(ret){ cli=ret.cliente||""; bairro=ret.bairro||""; returnId=ret.id||null; }
  else { cli=(prompt("📍 CHECK-IN DE CHEGADA — qual cliente/clínica você está visitando agora?")||"").trim(); if(!cli) return; bairro=(prompt("Bairro (pra montar a rota):")||"").trim(); }
  navigator.geolocation.getCurrentPosition(pos=>{ const c=pos.coords;
    visitaSave({cliente:cli, bairro, por:meuRep()||"", returnId, checkin:{lat:+c.latitude.toFixed(6),lng:+c.longitude.toFixed(6),acc:Math.round(c.accuracy||0),ts:Date.now()}});
    alert("✅ Check-in de chegada registrado! Faça a visita. Ao SAIR, toque em '📝 Feedback + check-out'.");
    if(ACTIVE==="pista"){ pistaView="feed"; renderTab(); }
  }, ()=>alert("Não consegui pegar sua localização. Ative o GPS e permita o acesso."), {enableHighAccuracy:true,timeout:15000,maximumAge:0});
}
/* "Cliquei em Cheguei sem querer" — cancela a chegada. Seguro contra golpe: a chegada mora só no aparelho
   (localStorage), NADA foi gravado no servidor ainda; e o horário NÃO é editável — ao chegar de verdade
   bate um novo Cheguei (timestamp novo só pode ser MAIS TARDE, nunca infla o tempo de permanência). */
function cancelVisita(){
  const v=visitaLoad(); if(!v) return;
  if(!confirm(`Cancelar a chegada em "${v.cliente||""}"?\n\nUse se tocou "📍 Cheguei" sem querer / ainda não chegou. O cliente continua na sua agenda de retornos.\n\n⚠️ O horário de chegada NÃO é editável: quando chegar de verdade, toque "Cheguei" de novo.`)) return;
  const rid=v.returnId; visitaClear();
  alert("↩ Chegada cancelada. Quando chegar na clínica, toque 📍 Cheguei de novo.");
  if(ACTIVE==="pista"){ pistaView=rid?"retornos":"feed"; }
  renderTab();
}

let pistaView="feed";   // "feed" | "retornos"
let retHoje=false;   // Retornos/rotas: ver "atividade de hoje" (o que o rep fez hoje) em vez da agenda futura
/* ---- ☑️ SELEÇÃO EM LOTE (marcar isolado/todos + mover entre abas) ---- */
let selMode=false; const SEL=new Set();
function selReset(){ selMode=false; SEL.clear(); }
function selBox(id){ return selMode?`<input type="checkbox" class="selbox" data-sel="${esc(id)}" ${SEL.has(id)?"checked":""} onclick="event.stopPropagation()" style="width:20px;height:20px;flex:0 0 auto;accent-color:#00E5A0;margin:2px 6px 0 0;cursor:pointer">`:""; }
function selBar(ids){
  ids=ids||[]; const n=SEL.size, isRel=(pistaView==="relatos");
  const acts=(selMode&&n)?`<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
      ${isRel?"":`<button class="baixabtn ok" id="selRetorno" style="margin:0">📅 Jogar pra Retorno</button><button class="baixabtn ok" id="selRelato" style="margin:0">📣 Copiar p/ Relato</button>`}
      <button class="baixabtn no" id="selDel" style="margin:0">🗑️ Excluir (${n})</button>
      <button class="subtab" id="selClear" style="margin:0">limpar</button></div>`:"";
  return `<div class="card" style="margin-bottom:12px;padding:10px 12px;border-color:${selMode?'rgba(0,229,160,.4)':'rgba(255,255,255,.08)'}">
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <button class="subtab ${selMode?'on':''}" id="selToggle" style="margin:0">${selMode?"✖ Sair da seleção":"☑️ Selecionar em lote"}</button>
        ${selMode?`<button class="subtab" id="selAll" data-ids="${esc(ids.join(","))}" style="margin:0">${(ids.length&&ids.every(i=>SEL.has(i)))?"Desmarcar todos":"Selecionar todos"} (${ids.length})</button><span class="t-mut" style="font-size:12.5px">${n} selecionado(s)</span>`:""}
      </div>${acts}</div>`;
}
async function bulkRetorno(){
  const ids=[...SEL].filter(id=>PISTA.find(x=>x.id===id)); if(!ids.length){ alert("Nada selecionado."); return; }
  const txt=(prompt(`Jogar ${ids.length} cliente(s) pra Retorno. Qual data? (ex.: 20/07, "dia 20 do 7")`)||"").trim(); if(!txt) return;
  const nova=parseDataBR(txt)||(/^\d{4}-\d{2}-\d{2}$/.test(txt)?txt:""); if(!nova){ alert("Não entendi a data. Tente 20/07 ou 2026-07-20."); return; }
  for(const id of ids){ const f=PISTA.find(x=>x.id===id); if(f) await savePista({...f, proximo:nova, sem_retorno:false, clear_baixa:true}); }
  selReset(); alert("✅ "+ids.length+" jogado(s) pra Retorno em "+fmtDataBR(nova)); pistaView="retornos"; renderTab();
}
async function bulkRelato(){
  const ids=[...SEL].filter(id=>PISTA.find(x=>x.id===id)); if(!ids.length){ alert("Nada selecionado."); return; }
  if(!confirm(`Copiar ${ids.length} p/ Relatos (voz da rua)?`)) return;
  for(const id of ids){ const f=PISTA.find(x=>x.id===id); if(f) await saveRelato({clinica:f.cliente, texto:f.texto||("Visita "+(f.cliente||"")), data:hojeISO(), origem:"visita", por:f.por||meuRep()}); }
  selReset(); alert("✅ "+ids.length+" copiado(s) p/ Relatos"); pistaView="relatos"; renderTab();
}
async function bulkExcluir(){
  const ids=[...SEL]; if(!ids.length){ alert("Nada selecionado."); return; }
  if(!confirm(`Excluir ${ids.length} item(ns)? Vai pro 🗑️ Histórico de exclusão (permanente).`)) return;
  const por=operadorAtual()||quemExcluiu()||"escritório", motivo=(prompt("Motivo da exclusão em lote (opcional):")||"").trim();
  for(const id of ids){
    if(pistaView==="relatos"){ const r=RELATOS.find(x=>x.id===id); if(r){ try{ await fetch(EXCL_API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({acao:"add",senha:window.__pwd,item:{tipo:"Relato pista",cliente:r.clinica,resumo:(r.texto||"").slice(0,200),por_registro:r.por,por_exclusao:por,motivo,ts_original:r.ts}})}); }catch(e){} await removeRelato(id); } }
    else { const f=PISTA.find(x=>x.id===id); if(f){ try{ await fetch(EXCL_API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({acao:"add",senha:window.__pwd,item:{tipo:"Feedback pista",cliente:f.cliente,bairro:f.bairro,resumo:(f.texto||"").slice(0,200),por_registro:f.por,por_exclusao:por,motivo,ts_original:f.ts}})}); }catch(e){} await removePista(id); } }
  }
  await loadExcl(); selReset(); renderTab();
}
/* Presença comprovada (check-in de chegada) — vale como visita REALIZADA mesmo sem a baixa formal do retorno */
function temPresenca(f){ return !!((f.checkin&&f.checkin.ts)||(f.baixa&&f.baixa.checkin&&f.baixa.checkin.ts)); }
function ehVisitaReal(f){ return (f.origem||"visita")!=="telefone"; }   // visita presencial ≠ contato por telefone
function ehRealizada(f){ return (f.baixa&&f.baixa.tipo==="compareceu") || (temPresenca(f) && !(f.baixa&&f.baixa.tipo==="desmarcado")); }
function realizadaTs(f){ return (f.baixa&&f.baixa.ts)||(f.checkin&&f.checkin.ts)||f.ts||0; }
function pistaRetornos(list){ // retornos PENDENTES (com data e SEM baixa) — o que ainda falta visitar
  const src=list||PISTA, byCli={};
  // clientes que JÁ têm visita realizada (check-in/baixa) → não ficam piscando como pendentes (resolve o "São Miguel")
  const visitados={}; src.filter(ehRealizada).forEach(f=>{ const k=(f.cliente||"").trim().toLowerCase(); if(k) visitados[k]=Math.max(visitados[k]||0, realizadaTs(f)); });
  src.filter(f=>f.proximo && !f.baixa).forEach(f=>{ const k=(f.cliente||f.id).trim().toLowerCase();
    if(visitados[k] && visitados[k]>=(f.ts||0)) return;   // já foi visitado depois de agendado → sai da pendência
    if(!byCli[k]||(f.ts||0)>(byCli[k].ts||0)) byCli[k]=f; });
  return Object.values(byCli).sort((a,b)=>a.proximo<b.proximo?-1:(a.proximo>b.proximo?1:0));
}
/* BAIXA da visita (blindagem): compareceu=check-in GPS | desmarcado=código da diretoria */
async function saveBaixaItem(f, baixa, dir_code){
  try{ const r=await fetch(PISTA_API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({acao:"save",item:{...f,baixa},senha:window.__pwd,dir_code})});
    if(r.status===403){ alert("❌ Código da diretoria INVÁLIDO — baixa não autorizada."); return false; }
    if(r.status===401){ alert("Sessão sem permissão."); return false; }
    if(r.ok){ syncPista((await r.json()).pista); return true; } }catch(e){ alert("Falha ao dar baixa."); } return false; }
function darBaixaCheckin(id){
  const f=PISTA.find(x=>x.id===id); if(!f) return;
  if(!navigator.geolocation){ alert("Sem GPS neste aparelho. Se o cliente desmarcou, use '🚫 desmarcou' com código da diretoria."); return; }
  if(!confirm(`Dar baixa em "${f.cliente||""}" com CHECK-IN? (você precisa estar NA clínica)`)) return;
  navigator.geolocation.getCurrentPosition(async pos=>{ const c=pos.coords;
    const baixa={tipo:"compareceu",ts:Date.now(),por:meuRep()||quemExcluiu(),checkin:{lat:+c.latitude.toFixed(6),lng:+c.longitude.toFixed(6),acc:Math.round(c.accuracy||0),ts:Date.now()}};
    const ok=await saveBaixaItem(f,baixa); if(ok){ alert("✅ Baixa registrada com check-in!"); renderTab(); }
  }, ()=>alert("Não consegui pegar sua localização. Ative o GPS e permita o acesso."), {enableHighAccuracy:true,timeout:15000,maximumAge:0});
}
/* BAIXA DO ESCRITÓRIO (Luciane, sem GPS): o rep já foi mas o retorno ficou pendente. Marca como visitado
   SEM check-in de GPS — fica registrado quem marcou e que foi manual (auditoria), pra não fingir presença. */
async function baixaEscritorio(id){
  const f=PISTA.find(x=>x.id===id); if(!f) return;
  const quem=meuRep()||quemExcluiu(); if(!quem) return;
  if(!confirm(`Marcar "${f.cliente||""}" como JÁ VISITADO? (baixa do escritório, sem GPS — use só quando o rep já foi e você tem certeza)`)) return;
  const baixa={tipo:"compareceu", ts:Date.now(), por:f.por||quem, manual:true, marcou:quem};   // sem checkin = baixa manual do escritório
  const ok=await saveBaixaItem(f,baixa); if(ok){ alert("✅ Marcado como visitado (baixa do escritório)."); renderTab(); }
}
/* salva uma operação de DESMARCAÇÃO com o código da diretoria (server valida DIR_CODE; 403 se inválido) */
async function saveDesmarc(item, dir_code){
  try{ const r=await fetch(PISTA_API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({acao:"save",item,senha:window.__pwd,dir_code})});
    if(r.status===403){ alert("❌ Código da diretoria INVÁLIDO — não autorizado."); return false; }
    if(r.status===401){ alert("Sessão sem permissão."); return false; }
    if(r.ok){ syncPista((await r.json()).pista); return true; } }catch(e){ alert("Sem internet — a desmarcação precisa de conexão pra validar o código da diretoria."); } return false; }
async function darBaixaDesmarcou(id){
  const f=PISTA.find(x=>x.id===id); if(!f) return;
  const motivo=(prompt(`Cliente "${f.cliente||""}" DESMARCOU (a visita não aconteceu). Qual o motivo?`)||"").trim(); if(!motivo) return;
  // o REP decide o destino; a diretoria só LIBERA o código (anti-golpe). Nunca vira "realizado", nunca some sem rastro.
  const dst=(prompt(`Destino de "${f.cliente||""}":\n\n1 = 🔁 REMARCAR (cliente quer nova data → volta pra sua rota)\n2 = 🚫 PERDIDO (cliente não quer mais → sai da agenda, fica no histórico/BI)\n\nDigite 1 ou 2:`)||"").trim();
  if(dst!=="1"&&dst!=="2") return;
  const rem=dst==="1"; let nova="";
  if(rem){
    const txt=(prompt('Nova data do retorno (ex.: 12/07, "dia 12 do 7", "segunda que vem"):')||"").trim(); if(!txt) return;
    nova=parseDataBR(txt)||(/^\d{4}-\d{2}-\d{2}$/.test(txt)?txt:"");
    if(!nova){ alert("Não entendi a data. Tente 12/07, 'dia 12 do 7' ou 2026-07-12."); return; }
  }
  const code=(prompt("A DIRETORIA precisa LIBERAR (anti-golpe). Digite o código da diretoria:")||"").trim(); if(!code) return;
  const por=meuRep()||quemExcluiu();
  const desmarc_add={motivo,por,destino:rem?"remarcado":"perdido",remarcado_para:nova,ts:Date.now()};   // log permanente (auditoria), exige DIR_CODE
  const item = rem
    ? {...f, desmarc_add, proximo:nova, sem_retorno:false, clear_baixa:true}                              // remarcar → volta pra agenda de rota
    : {...f, desmarc_add, sem_retorno:true, baixa:{tipo:"desmarcado",ts:Date.now(),por,motivo,destino:"perdido"}};   // perdido → sai da agenda
  const ok=await saveDesmarc(item, code);
  if(ok){ alert(rem
      ? "✅ Liberado pela diretoria. Remarcado p/ "+fmtDataBR(nova)+" — voltou pra sua rota (fica o registro da desmarcação)."
      : "✅ Liberado pela diretoria. Marcado como PERDIDO — saiu da agenda, ficou no histórico e no BI (objeção)."); renderTab(); }
}
async function reagendarRetorno(id){
  const f=PISTA.find(x=>x.id===id); if(!f) return;
  const txt=(prompt(`Reagendar "${f.cliente||""}". Nova data (ex.: 12/07, "dia 12 do 7", "segunda que vem"):`)||"").trim(); if(!txt) return;
  const nova=parseDataBR(txt)||(/^\d{4}-\d{2}-\d{2}$/.test(txt)?txt:"");
  if(!nova){ alert("Não entendi a data. Tente 12/07, 'dia 12 do 7' ou 2026-07-12."); return; }
  const motivo=(prompt(`Por que não foi / motivo do reagendamento? (ex.: doutora mal-humorada, achamos melhor não ir)`)||"").trim();
  const reag_add={motivo, de:f.proximo||"", para:nova, por:meuRep()||quemExcluiu(), ts:Date.now()};   // histórico do porquê
  const ok=await savePista({...f, proximo:nova, sem_retorno:false, clear_baixa:true, reag_add});   // limpa baixa → volta pra agenda
  if(ok){ alert("✅ Reagendado para "+fmtDataBR(nova)+(motivo?` — motivo: "${motivo}"`:"")+". Voltou pra agenda de rota."); renderTab(); }
}
async function desfazerBaixa(id){   // ↩ voltar etapa: desfaz a baixa (confirmei errado) → volta pra agenda de retornos
  const f=PISTA.find(x=>x.id===id); if(!f) return;
  if(!confirm(`Desfazer a baixa de "${f.cliente||""}"? Volta pra agenda de retornos (dá pra dar baixa de novo).`)) return;
  const ok=await savePista({...f, clear_baixa:true});
  if(ok){ alert("↩ Baixa desfeita — voltou pra agenda de retornos."); renderTab(); }
}
/* 📞 Agendar visita por TELEFONE (prospecção ativa) → cai na agenda de retornos, sem check-in */
function openAgendar(){
  const bairrosUsados=[...new Set(PISTA.map(x=>x.bairro).filter(Boolean))].sort();
  document.getElementById("modalBody").innerHTML=`
    <div class="m-head"><div><div class="m-cli">📞 Agendar visita (por telefone)</div>
      <div class="t-mut" style="font-size:13px;margin-top:2px">prospecção ativa — cai na agenda de rota; o check-in é só quando você for lá</div></div>
      <button class="m-x" id="mClose">✕</button></div>
    <div class="m-lbl">Comercial <span style="color:var(--red)">*</span></div>
    <input id="aRep" class="m-date" style="width:100%" list="repsDL" value="${esc(meuRep())}">
    <datalist id="repsDL">${repList().map(n=>`<option value="${esc(n)}">`).join("")}</datalist>
    <div class="m-lbl">Cliente / clínica <span style="color:var(--red)">*</span></div>
    <input id="aCli" class="m-date" style="width:100%" placeholder="Nome do cliente">
    <div class="m-lbl">Bairro <span style="color:var(--red)">*</span> <span class="t-mut" style="font-weight:500">— monta a rota</span></div>
    <input id="aBairro" class="m-date" style="width:100%" placeholder="Ex.: Tijuca" list="bairrosDL">
    <datalist id="bairrosDL">${bairrosUsados.map(b=>`<option value="${esc(b)}">`).join("")}</datalist>
    <div class="m-lbl">Data da visita agendada <span style="color:var(--red)">*</span></div>
    <input id="aData" type="date" class="m-date" value="${hojeISO()}">
    <div class="m-lbl">O que combinou no telefone <span class="t-mut" style="font-weight:500">— ${speechOK()?"toque 🎤 e fale, ou digite":"digite (voz indisponível neste aparelho)"}</span></div>
    <div style="display:flex;gap:8px;align-items:stretch">
      <button class="micbtn" id="aMic" type="button">🎤 Falar</button>
      <textarea id="aObs" class="m-ta" style="flex:1;min-height:70px;margin:0" placeholder="Ex.: Liguei pra clínica Provet no bairro Tijuca, a Dra. topou receber orçamento dia 15, levar tabela de histopato"></textarea>
    </div>
    <div id="aHint" class="proxhint" style="display:none"></div>
    <button class="m-save" id="aSave">📞 Agendar na rota</button>`;
  document.getElementById("modal").style.display="flex";
  document.getElementById("mClose").onclick=()=>{ try{precStop=true;PREC&&PREC.stop();}catch(e){} closeModal(); };
  const ata=document.getElementById("aObs");
  const aDetect=()=>{ const val=ata.value, got=[];
    const setIf=(id,v,fmt)=>{ const el=document.getElementById(id); if(el && !el.value && v){ el.value=v; got.push(fmt(v)); } };
    setIf("aRep", detectRep(val), v=>"👤 "+v);
    setIf("aCli", detectCliente(val), v=>"🏥 "+v);
    setIf("aBairro", detectBairro(val, bairrosUsados), v=>"📍 "+v);
    const dt=parseDataBR(val); if(dt){ const el=document.getElementById("aData"); if(el && el.value===hojeISO()){ el.value=dt; got.push("📅 "+fmtDataBR(dt)); } }
    const h=document.getElementById("aHint"); if(h){ if(got.length){ h.style.display="block"; h.innerHTML="🧠 detectei da fala (confira/corrija): <b>"+got.join(" · ")+"</b>"; } } };
  ata.addEventListener("input", aDetect);
  document.getElementById("aMic").onclick=function(){ pistaMic(this, ata, aDetect); };
  document.getElementById("aSave").onclick=async()=>{
    try{precStop=true;PREC&&PREC.stop();}catch(e){}
    const rep=document.getElementById("aRep").value.trim(), cli=document.getElementById("aCli").value.trim(), bairro=document.getElementById("aBairro").value.trim(), data=document.getElementById("aData").value, obs=document.getElementById("aObs").value.trim();
    if(!rep){ alert("Informe o COMERCIAL."); return; }
    if(!cli){ alert("Informe o CLIENTE / clínica."); document.getElementById("aCli").focus(); return; }
    if(!bairro){ alert("Informe o BAIRRO (monta a rota)."); document.getElementById("aBairro").focus(); return; }
    if(!data){ alert("Informe a DATA da visita agendada."); return; }
    localStorage.setItem("crm_rep", rep);
    const btn=document.getElementById("aSave"); btn.disabled=true; btn.textContent="Agendando…";
    const ok=await savePista({cliente:cli, bairro, por:rep, proximo:data, resultado:"visita", origem:"telefone", texto:obs?("📞 Agendado por telefone: "+obs):"📞 Agendado por telefone"});
    if(ok){ closeModal(); pistaView="retornos"; renderTab(); } else { btn.disabled=false; btn.textContent="📞 Agendar na rota"; } };
}
/* ➕ OBSERVAÇÃO do escritório num feedback (a Luciane acompanha e comenta, sem refazer a visita) */
async function addObs(id){
  const f=PISTA.find(x=>x.id===id); if(!f) return;
  const t=(prompt(`Observação sobre "${f.cliente||""}" (ex.: voltou a pedir coleta depois da visita):`)||"").trim(); if(!t) return;
  const obs_add={texto:t, por:meuRep()||quemExcluiu()||"escritório", ts:Date.now()};
  const ok=await savePista({...f, obs_add});
  if(ok){ alert("✅ Observação adicionada ao histórico do cliente."); renderTab(); }
}
/* 🎯 LANÇAR CLIENTE PRA VISITAR — SEM DATA (o escritório põe o cliente; o vendedor escolhe QUANDO ir) */
function openAddCliente(){
  const bairrosUsados=[...new Set(PISTA.map(x=>x.bairro).filter(Boolean))].sort();
  document.getElementById("modalBody").innerHTML=`
    <div class="m-head"><div><div class="m-cli">🎯 Cliente pra visitar (sem data)</div>
      <div class="t-mut" style="font-size:13px;margin-top:2px">você lança o cliente; o vendedor escolhe QUANDO ir e dá o feedback lá</div></div>
      <button class="m-x" id="mClose">✕</button></div>
    <div class="m-lbl">Comercial (quem vai visitar) <span style="color:var(--red)">*</span></div>
    <input id="cRep" class="m-date" style="width:100%" list="repsDL" value="${esc(meuRep())}">
    <datalist id="repsDL">${repList().map(n=>`<option value="${esc(n)}">`).join("")}</datalist>
    <div class="m-lbl">Cliente / clínica <span style="color:var(--red)">*</span></div>
    <input id="cCli" class="m-date" style="width:100%" placeholder="Nome do cliente">
    <div class="m-lbl">Bairro <span style="color:var(--red)">*</span> <span class="t-mut" style="font-weight:500">— monta a rota</span></div>
    <input id="cBairro" class="m-date" style="width:100%" placeholder="Ex.: Tijuca" list="bairrosDL">
    <datalist id="bairrosDL">${bairrosUsados.map(b=>`<option value="${esc(b)}">`).join("")}</datalist>
    <div class="m-lbl">Observação <span class="t-mut" style="font-weight:500">— ${speechOK()?"toque 🎤 e fale, ou digite (opcional)":"opcional"}</span></div>
    <div style="display:flex;gap:8px;align-items:stretch">
      <button class="micbtn" id="cMic" type="button">🎤 Falar</button>
      <textarea id="cObs" class="m-ta" style="flex:1;min-height:70px;margin:0" placeholder="Ex.: cliente do PDF do Heitor, clínica Provet na Tijuca, oferecer histopato"></textarea>
    </div>
    <div id="cHint" class="proxhint" style="display:none"></div>
    <button class="m-save" id="cSave">🎯 Lançar na lista do vendedor</button>`;
  document.getElementById("modal").style.display="flex";
  document.getElementById("mClose").onclick=()=>{ try{precStop=true;PREC&&PREC.stop();}catch(e){} closeModal(); };
  const cta=document.getElementById("cObs");
  const cDetect=()=>{ const val=cta.value, got=[];
    const setIf=(id,v,fmt)=>{ const el=document.getElementById(id); if(el && !el.value && v){ el.value=v; got.push(fmt(v)); } };
    setIf("cRep", detectRep(val), v=>"👤 "+v);
    setIf("cCli", detectCliente(val), v=>"🏥 "+v);
    setIf("cBairro", detectBairro(val, bairrosUsados), v=>"📍 "+v);
    const h=document.getElementById("cHint"); if(h && got.length){ h.style.display="block"; h.innerHTML="🧠 detectei da fala (confira/corrija): <b>"+got.join(" · ")+"</b>"; } };
  cta.addEventListener("input", cDetect);
  document.getElementById("cMic").onclick=function(){ pistaMic(this, cta, cDetect); };
  document.getElementById("cSave").onclick=async()=>{
    try{precStop=true;PREC&&PREC.stop();}catch(e){}
    const rep=document.getElementById("cRep").value.trim(), cli=document.getElementById("cCli").value.trim(), bairro=document.getElementById("cBairro").value.trim(), obs=document.getElementById("cObs").value.trim();
    if(!rep){ alert("Informe o COMERCIAL (quem vai visitar)."); return; }
    if(!cli){ alert("Informe o CLIENTE / clínica."); document.getElementById("cCli").focus(); return; }
    if(!bairro){ alert("Informe o BAIRRO (monta a rota)."); document.getElementById("cBairro").focus(); return; }
    localStorage.setItem("crm_rep", rep);
    const btn=document.getElementById("cSave"); btn.disabled=true; btn.textContent="Lançando…";
    const ok=await savePista({cliente:cli, bairro, por:rep, proximo:"", a_visitar:true, resultado:"visita", origem:"telefone", texto:obs?("🎯 Cliente pra visitar: "+obs):"🎯 Cliente pra visitar (sem data)"});
    if(ok){ closeModal(); pistaView="retornos"; renderTab(); } else { btn.disabled=false; btn.textContent="🎯 Lançar na lista do vendedor"; } };
}
/* BI da Pista (Chart.js — mesmo CDN da aba Resultados) */
function drawPistaBI(base){
  if(typeof Chart==="undefined") return;
  CHARTS.forEach(c=>{try{c.destroy();}catch(e){}}); CHARTS=[];
  Chart.defaults.color="#8aa2bd"; Chart.defaults.font.family="Inter";
  const g=id=>document.getElementById(id), p=n=>String(n).padStart(2,"0");
  const porRep=Object.entries(base.reduce((a,f)=>{const k=f.por||"—";a[k]=(a[k]||0)+1;return a;},{})).sort((a,b)=>b[1]-a[1]);
  if(g("pbRep")) CHARTS.push(new Chart(g("pbRep"),{type:"bar",data:{labels:porRep.map(r=>r[0]),datasets:[{data:porRep.map(r=>r[1]),backgroundColor:"#00D4FF"}]},options:{animation:false,plugins:{legend:{display:false}},scales:{x:{grid:{display:false}},y:{grid:{color:"rgba(255,255,255,.06)"},ticks:{precision:0}}}}}));
  const porRes=PRORDER.map(k=>base.filter(f=>f.resultado===k).length);
  if(g("pbRes")) CHARTS.push(new Chart(g("pbRes"),{type:"doughnut",data:{labels:PRORDER.map(k=>PRES[k].lbl),datasets:[{data:porRes,backgroundColor:PRORDER.map(k=>PRES[k].col),borderColor:"#0A1628",borderWidth:3}]},options:{animation:false,cutout:"60%",plugins:{legend:{position:"right",labels:{boxWidth:12}}}}}));
  const dias=[]; for(let i=13;i>=0;i--){const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()-i);dias.push({lbl:`${p(d.getDate())}/${p(d.getMonth()+1)}`,key:`${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`,v:0,t:0});}
  base.forEach(f=>{const dv=f.data_visita||new Date(f.ts).toISOString().slice(0,10);const d=dias.find(x=>x.key===dv);if(d){ if(ehVisitaReal(f)) d.v++; else d.t++; }});   // separa VISITA presencial de CONTATO por telefone
  if(g("pbDia")) CHARTS.push(new Chart(g("pbDia"),{type:"line",data:{labels:dias.map(d=>d.lbl),datasets:[
      {label:"🚶 Visitas",data:dias.map(d=>d.v),borderColor:"#00E5A0",backgroundColor:"rgba(0,229,160,.15)",fill:true,tension:.35,pointRadius:2},
      {label:"📞 Telefone",data:dias.map(d=>d.t),borderColor:"#00D4FF",backgroundColor:"rgba(0,212,255,.10)",fill:true,tension:.35,pointRadius:2}]},
    options:{animation:false,plugins:{legend:{display:true,labels:{boxWidth:12,font:{size:11}}}},scales:{x:{grid:{display:false}},y:{grid:{color:"rgba(255,255,255,.06)"},ticks:{precision:0}}}}}));
  const obj=[["🛑 Objeção",base.filter(f=>f.resultado==="objecao").length],["❌ Sem interesse",base.filter(f=>f.resultado==="sem_interesse").length],["🚫 Desmarcado",base.filter(f=>f.baixa&&f.baixa.tipo==="desmarcado").length]];
  if(g("pbObj")) CHARTS.push(new Chart(g("pbObj"),{type:"bar",data:{labels:obj.map(o=>o[0]),datasets:[{data:obj.map(o=>o[1]),backgroundColor:"#FF8A00"}]},options:{indexAxis:"y",animation:false,plugins:{legend:{display:false}},scales:{x:{grid:{color:"rgba(255,255,255,.06)"},ticks:{precision:0}},y:{grid:{display:false}}}}}));
}
function fmtDataBR(iso){ try{ const d=new Date(iso+"T00:00:00"); const dd=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'][d.getDay()]; const p=n=>String(n).padStart(2,'0'); return `${dd} ${p(d.getDate())}/${p(d.getMonth()+1)}`; }catch(e){ return iso; } }
/* Coordenada de cada cliente p/ a rota: usa o CHECK-IN (preciso, se já visitou) OU o centro do BAIRRO.
   Assim um cliente agendado por telefone (sem check-in) TAMBÉM entra na conta da rota. */
const BAIRRO_COORD={ // bairro normalizado (sem acento) → [lat, lng] · centro aproximado (bom p/ agrupar rota)
  "barra da tijuca":[-23.0040,-43.3650],"recreio dos bandeirantes":[-23.0250,-43.4650],"recreio":[-23.0250,-43.4650],
  "jacarepagua":[-22.9640,-43.3690],"freguesia":[-22.9430,-43.3380],"anil":[-22.9500,-43.3350],"taquara":[-22.9200,-43.3650],
  "pechincha":[-22.9330,-43.3620],"curicica":[-22.9540,-43.4030],"gardenia azul":[-22.9530,-43.3480],"cidade de deus":[-22.9490,-43.3620],
  "praca seca":[-22.8930,-43.3500],"vila valqueire":[-22.8830,-43.3660],"tanque":[-22.9130,-43.3560],"itanhanga":[-22.9970,-43.3020],
  "tijuca":[-22.9240,-43.2320],"vila isabel":[-22.9160,-43.2470],"maracana":[-22.9121,-43.2302],"grajau":[-22.9210,-43.2610],
  "andarai":[-22.9270,-43.2540],"praca da bandeira":[-22.9110,-43.2160],
  "copacabana":[-22.9710,-43.1830],"ipanema":[-22.9840,-43.2040],"leblon":[-22.9840,-43.2240],"botafogo":[-22.9510,-43.1840],
  "flamengo":[-22.9330,-43.1750],"laranjeiras":[-22.9330,-43.1880],"gavea":[-22.9760,-43.2320],"jardim botanico":[-22.9680,-43.2240],
  "humaita":[-22.9560,-43.1970],"catete":[-22.9250,-43.1770],"gloria":[-22.9200,-43.1740],
  "meier":[-22.9020,-43.2780],"cachambi":[-22.8900,-43.2790],"engenho de dentro":[-22.8880,-43.2870],"engenho novo":[-22.9030,-43.2660],
  "sao cristovao":[-22.8970,-43.2220],"madureira":[-22.8730,-43.3390],"cascadura":[-22.8850,-43.3230],"campinho":[-22.8830,-43.3110],
  "oswaldo cruz":[-22.8680,-43.3510],"marechal hermes":[-22.8570,-43.3760],"iraja":[-22.8300,-43.3260],"vila da penha":[-22.8380,-43.3120],
  "penha":[-22.8420,-43.2770],"ramos":[-22.8500,-43.2540],"olaria":[-22.8440,-43.2650],"bonsucesso":[-22.8600,-43.2540],
  "ilha do governador":[-22.8100,-43.2100],"campo grande":[-22.9030,-43.5610],"bangu":[-22.8790,-43.4650],"realengo":[-22.8790,-43.4300],
  "padre miguel":[-22.8770,-43.4470],"santa cruz":[-22.9190,-43.6840],"guaratiba":[-23.0530,-43.5940],"sepetiba":[-22.9700,-43.7100],
  "centro":[-22.9070,-43.1760],"lapa":[-22.9130,-43.1810],"santa teresa":[-22.9190,-43.1900],
  "duque de caxias":[-22.7850,-43.3110],"nova iguacu":[-22.7590,-43.4510],"sao joao de meriti":[-22.8040,-43.3720],
  "belford roxo":[-22.7640,-43.3990],"nilopolis":[-22.8080,-43.4140],"mesquita":[-22.7820,-43.4290],
  "niteroi":[-22.8830,-43.1030],"icarai":[-22.9060,-43.1080],"sao goncalo":[-22.8270,-43.0540],"alcantara":[-22.8250,-43.0180],
};
function bairroKey(s){ return (s||"").replace(/\([^)]*\)/g," ").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-z ]/g," ").replace(/\s+/g," ").trim(); }  // ignora o "(cerâmica)" — pega só a região (Nova Iguaçu)
function geoCacheLoad(){ try{ return JSON.parse(localStorage.getItem("crm_bairro_geo")||"{}"); }catch(e){ return {}; } }
function geoCacheSave(o){ try{ localStorage.setItem("crm_bairro_geo", JSON.stringify(o)); }catch(e){} }
function ptBairro(f){ const k=bairroKey(f.bairro); if(!k) return null;
  if(BAIRRO_COORD[k]) return {lat:BAIRRO_COORD[k][0],lng:BAIRRO_COORD[k][1],src:"bairro"};
  const g=geoCacheLoad(); if(g[k]) return {lat:g[k][0],lng:g[k][1],src:"bairro"};
  // fallback: acha a região conhecida contida no texto (ex.: "cerâmica nova iguacu" → nova iguacu)
  const kw=" "+k+" "; let best=null;
  for(const bk in BAIRRO_COORD){ if(kw.includes(" "+bk+" ") && (!best||bk.length>best.length)) best=bk; }
  if(best) return {lat:BAIRRO_COORD[best][0],lng:BAIRRO_COORD[best][1],src:"bairro"};
  return null; }
function ptOf(f){ if(f&&f.checkin&&f.checkin.ts&&f.checkin.lat!=null&&f.checkin.lng!=null) return {lat:f.checkin.lat,lng:f.checkin.lng,src:"checkin"}; return ptBairro(f); }
/* geocoda (1x, cacheado) os bairros que não estão na tabela nem têm check-in — via Nominatim grátis */
async function geocodeBairros(items){
  const g=geoCacheLoad(); const origByKey={};
  (items||[]).forEach(f=>{ if(f.checkin&&f.checkin.ts) return; const k=bairroKey(f.bairro); if(k&&!BAIRRO_COORD[k]&&!g[k]&&!origByKey[k]) origByKey[k]=f.bairro; });
  const need=Object.keys(origByKey); if(!need.length) return; let changed=false;
  for(const k of need){ try{
      const u=`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(origByKey[k]+", Rio de Janeiro, Brasil")}`;
      const r=await fetch(u); if(!r.ok) continue; const j=await r.json();
      if(j&&j[0]&&j[0].lat){ g[k]=[+(+j[0].lat).toFixed(5),+(+j[0].lon).toFixed(5)]; changed=true; }
    }catch(e){} }
  if(changed) geoCacheSave(g);
}
/* roteiro otimizado: ordena por proximidade (vizinho mais próximo) usando a coord de cada cliente (check-in ou bairro) */
function ordenarRota(items){
  const pts=(items||[]).map(f=>({f,p:ptOf(f)})).filter(x=>x.p);
  if(pts.length<=2) return pts.map(x=>x.f);
  const d2=(a,b)=>{const dx=a.p.lat-b.p.lat,dy=a.p.lng-b.p.lng;return dx*dx+dy*dy;};
  const rem=pts.slice(), ord=[rem.shift()];
  while(rem.length){ const last=ord[ord.length-1]; let bi=0,bd=Infinity; rem.forEach((x,i)=>{const dd=d2(last,x);if(dd<bd){bd=dd;bi=i;}}); ord.push(rem.splice(bi,1)[0]); }
  return ord.map(x=>x.f);
}
function mapsRotaURL(items){ const ord=ordenarRota(items).map(f=>({f,p:ptOf(f)})).filter(x=>x.p);
  return ord.length>=2 ? "https://www.google.com/maps/dir/"+ord.map(x=>`${x.p.lat},${x.p.lng}`).join("/") : ""; }
/* rota compatível por DISTÂNCIA REAL — mede a MAIOR distância entre as paradas do dia.
   Preferência: distância de RUA de verdade (OSRM grátis, sem API key), já que o comercial vai de MOTO
   (mesmas vias do carro). Fallback = linha reta (Haversine) quando estiver OFFLINE. */
const RAIO_CARRO_KM=15;   // de moto/carro pela RUA: paradas até X km entre si = rota compatível (Anil↔Maracanã=19km→incompatível)
const RAIO_KM=8;          // fallback OFFLINE por linha reta (mais apertado — a reta subestima; ex.: Anil↔Maracanã reta=11,5km mas de rua=19km)
function haversineKm(a,b){ const R=6371, toR=x=>x*Math.PI/180, dLat=toR(b.lat-a.lat), dLng=toR(b.lng-a.lng);
  const s=Math.sin(dLat/2)**2 + Math.cos(toR(a.lat))*Math.cos(toR(b.lat))*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.min(1,Math.sqrt(s))); }
function geoPts(items){ return (items||[]).map(f=>({f,p:ptOf(f)})).filter(x=>x.p); }   // [{f,p}] — cada cliente com sua coord (check-in ou bairro)
function rotaAvaliar(items){   // {ok, km, a, b, geoN, semLoc} — LINHA RETA (fallback offline / render instantâneo)
  const geo=geoPts(items), semLoc=(items||[]).length-geo.length;
  if(geo.length<2) return {geoN:geo.length, semLoc};
  let maxd=0, pa=geo[0], pb=geo[1];
  for(let i=0;i<geo.length;i++) for(let j=i+1;j<geo.length;j++){ const d=haversineKm(geo[i].p,geo[j].p); if(d>maxd){maxd=d;pa=geo[i];pb=geo[j];} }
  return {ok:maxd<=RAIO_KM, km:Math.round(maxd), a:pa.f, b:pb.f, geoN:geo.length, semLoc};
}
/* upgrade assíncrono: troca a estimativa por reta pela DISTÂNCIA DE RUA real (OSRM table). Offline → mantém a reta. */
let PENDING_ROTAS=[];
async function upgradeRotas(){
  const jobs=PENDING_ROTAS.slice(); PENDING_ROTAS=[];
  for(const job of jobs){
    const el=document.getElementById(job.id); if(!el) continue;
    await geocodeBairros(job.items);   // garante coord de bairros fora da tabela antes de medir
    const geo=geoPts(job.items); if(geo.length<2){ continue; }
    const semLoc=(job.items||[]).length-geo.length;
    const nota=semLoc?` <span class="t-mut" style="font-weight:500">· ${semLoc} sem bairro/GPS (fora da conta)</span>`:"";
    const reta=()=>{ const a=rotaAvaliar(job.items); el.removeAttribute("style"); el.className=a.ok?"rota-ok":"rota-inc";
      el.innerHTML=a.ok?`✅ Rota compatível <span class="t-mut" style="font-weight:500">(estimativa reta, offline)</span> — até <b>${a.km} km</b>${nota}`
        :`🚨 ROTA INCOMPATÍVEL <span style="font-weight:500">(estimativa reta, offline)</span> — <b>${esc(a.a.cliente||a.a.bairro||"?")} ↔ ${esc(a.b.cliente||a.b.bairro||"?")}: ${a.km} km</b>${nota}`; };
    try{
      const coords=geo.map(x=>`${x.p.lng},${x.p.lat}`).join(";");
      const url=`https://router.project-osrm.org/table/v1/driving/${coords}?annotations=distance,duration`;
      const ctrl=new AbortController(); const to=setTimeout(()=>ctrl.abort(),9000);
      const r=await fetch(url,{signal:ctrl.signal}); clearTimeout(to);
      if(!r.ok) throw 0; const j=await r.json(); const D=j.distances, T=j.durations; if(!D) throw 0;
      let maxm=-1, ai=0, bi=1;
      for(let i=0;i<geo.length;i++) for(let k=i+1;k<geo.length;k++){ const m=D[i][k]; if(m!=null&&m>maxm){maxm=m;ai=i;bi=k;} }
      if(maxm<0) throw 0;
      const km=Math.round(maxm/1000), min=(T&&T[ai]&&T[ai][bi]!=null)?Math.round(T[ai][bi]/60):null, ok=km<=RAIO_CARRO_KM;
      const a=geo[ai].f, b=geo[bi].f; el.removeAttribute("style"); el.className=ok?"rota-ok":"rota-inc";
      el.innerHTML=ok
        ? `✅ Rota compatível de 🏍️ moto — no máx <b>${km} km${min!=null?` / ${min} min`:""}</b> de rua entre as paradas <span class="t-mut" style="font-weight:500">(limite ${RAIO_CARRO_KM} km)</span>${nota}`
        : `🚨 ROTA INCOMPATÍVEL de 🏍️ moto — <b>${esc(a.cliente||a.bairro||"?")} ↔ ${esc(b.cliente||b.bairro||"?")}: ${km} km${min!=null?` / ${min} min`:""}</b> de rua (limite ${RAIO_CARRO_KM} km). Separe em dias diferentes!${nota}`;
    }catch(e){ reta(); }
  }
}
/* detecta a data de retorno no texto falado/digitado (pt-BR) → "YYYY-MM-DD" */
const _NUMW={um:1,uma:1,dois:2,duas:2,tres:3,"três":3,quatro:4,cinco:5,seis:6,sete:7,oito:8,nove:9,dez:10,onze:11,doze:12,treze:13,quatorze:14,catorze:14,quinze:15,dezesseis:16,dezasseis:16,dezessete:17,dezoito:18,dezenove:19,vinte:20,trinta:30};
function _palNum(s){ s=(s||"").trim(); if(/^\d+$/.test(s)) return +s; let n=0; for(const p of s.split(/\s+e\s+/)){ if(_NUMW[p]!=null) n+=_NUMW[p]; else return null; } return n||null; }
function parseDataBR(texto){
  if(!texto) return ""; const t=(" "+texto.toLowerCase()+" ").replace(/[.,;!?]/g," ");
  const hoje=new Date(); hoje.setHours(0,0,0,0); const y=hoje.getFullYear(); const p=n=>String(n).padStart(2,"0");
  const mk=(dd,mm,yy)=>{ if(mm<1||mm>12||dd<1||dd>31) return ""; return `${yy}-${p(mm)}-${p(dd)}`; };
  const MES={janeiro:1,fevereiro:2,"março":3,marco:3,abril:4,maio:5,junho:6,julho:7,agosto:8,setembro:9,outubro:10,novembro:11,dezembro:12};
  let m;
  // dd/mm  ou dd/mm/aa(aa)
  m=t.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
  if(m){ let yy=m[3]?+m[3]:y; if(yy<100)yy+=2000; const r=mk(+m[1],+m[2],yy); if(r) return r; }
  // "dia X do/de Y" (Y = número, número por extenso, ou nome do mês) — varre todas as ocorrências
  { const re=/dia\s+([a-zç]+(?:\s+e\s+[a-zç]+)?|\d{1,2})\s+(?:do|de)\s+([a-zç]+(?:\s+e\s+[a-zç]+)?|\d{1,2})/g; let mm2;
    while((mm2=re.exec(t))){ const dd=_palNum(mm2[1]); let mm=/^\d+$/.test(mm2[2])?+mm2[2]:(MES[mm2[2]]||_palNum(mm2[2])); if(dd&&mm){ const r=mk(dd,mm,y); if(r) return r; } } }
  // "amanhã"
  if(/amanh[ãa]/.test(t)){ const d=new Date(hoje.getTime()+864e5); return mk(d.getDate(),d.getMonth()+1,d.getFullYear()); }
  // dia da semana ("segunda", "próxima terça"…) → próxima ocorrência
  const DIA={domingo:0,segunda:1,"terça":2,terca:2,quarta:3,quinta:4,sexta:5,"sábado":6,sabado:6};
  for(const nome in DIA){ if(t.includes(nome)){ let diff=(DIA[nome]-hoje.getDay()+7)%7; if(diff===0)diff=7; const d=new Date(hoje.getTime()+diff*864e5); return mk(d.getDate(),d.getMonth()+1,d.getFullYear()); } }
  // "dia X" (só o dia) → próxima ocorrência desse dia — varre todas (ignora "bom dia meu…")
  { const re=/dia\s+([a-zç]+(?:\s+e\s+[a-zç]+)?|\d{1,2})\b/g; let mm3;
    while((mm3=re.exec(t))){ const dd=_palNum(mm3[1]); if(dd){ let d=new Date(y,hoje.getMonth(),dd); if(d<hoje) d=new Date(y,hoje.getMonth()+1,dd); return mk(d.getDate(),d.getMonth()+1,d.getFullYear()); } } }
  return "";
}
/* detectores dos outros campos na fala (best-effort — o que não vier, é obrigatório digitar) */
const BAIRROS_RJ=["Barra da Tijuca","Recreio dos Bandeirantes","Recreio","Jacarepaguá","Freguesia","Tijuca","Vila Isabel","Maracanã","Copacabana","Ipanema","Leblon","Botafogo","Flamengo","Laranjeiras","Méier","Madureira","Campo Grande","Bangu","Santa Cruz","Ilha do Governador","Centro","Duque de Caxias","Nova Iguaçu","São João de Meriti","Belford Roxo","Niterói","Icaraí","São Gonçalo","Alcântara"];
function detectBairro(texto, conhecidos){ const t=" "+(texto||"").toLowerCase()+" ";
  const cands=[...new Set([...(conhecidos||[]), ...BAIRROS_RJ])].sort((a,b)=>b.length-a.length);
  for(const b of cands){ if(b && t.includes(" "+b.toLowerCase())) return b; } return ""; }
function detectRep(texto){ const m=(" "+(texto||"").toLowerCase()).match(/\b(?:meu nome (?:é|e)|aqui (?:é|e|quem fala(?: é| e)?)|quem fala (?:é|e))\s+([a-zà-ú]+(?:\s+[a-zà-ú]+)?)/);
  if(!m) return ""; const s=m[1].replace(/\s+(visitei|visitou|fui|estou|passei|liguei|cheguei|aqui|bom|boa|hoje|falando|e|da|de|do)\b.*$/i,"").trim();
  return s.split(/\s+/).map(w=>w.charAt(0).toUpperCase()+w.slice(1)).join(" "); }
function detectCliente(texto){ const m=(" "+(texto||"")).match(/\b(cl[ií]nica|hospital|pet\s?shop|petshop|veterin[áa]ria|consult[óo]rio|pet)\s+([A-Za-zÀ-ú0-9]+(?:\s+[A-Za-zÀ-ú0-9]+){0,2})/i);
  if(!m) return ""; return m[0].trim().replace(/\s+/g," ").replace(/\s+(na|no|em|de|da|do|para|pra|e|que|com|pediram|pediu|gostou|gostaram)$/i,""); }
let F_ID=null, F_RES="visita", F_CHECKIN=null, F_CHECKOUT=null, F_SEMRET=false, F_COMPLETING=false;
function hojeISO(){ const d=new Date(), p=n=>String(n).padStart(2,"0"); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`; }
function dwellMin(ci,co){ return (ci&&co&&co.ts&&ci.ts)?Math.max(0,Math.round((co.ts-ci.ts)/60000)):null; }
function mapPin(pt, label){ return (pt&&pt.ts&&pt.lat!=null&&pt.lng!=null)?`<a href="https://maps.google.com/?q=${pt.lat},${pt.lng}" target="_blank" onclick="event.stopPropagation()" style="color:#7effcf;font-weight:700">${label}</a>`:""; }
/* distância entre entrada e saída — se grande, o check-out foi longe da clínica (bateu a saída em outro lugar) */
const CHECKOUT_LONGE_M=200;   // > 200 m entre entrada e saída = suspeito (anti-golpe)
function checkinDistM(ci, co){ return (ci&&co&&ci.ts&&co.ts&&ci.lat!=null&&co.lat!=null)?Math.round(haversineKm(ci,co)*1000):null; }
function fmtDist(m){ return m>=1000?(m/1000).toFixed(1).replace(".",",")+" km":m+" m"; }
/* resumo padronizado do check-in: 🟢 ENTRADA (mapa) · 🔴 SAÍDA (mapa) · ⏱ tempo · 🚩 alerta de distância — identifica cada processo */
function checkinResumo(ci, co){
  const p=n=>String(n).padStart(2,"0"), hm=x=>{const d=new Date(x.ts); return p(d.getHours())+":"+p(d.getMinutes());}, parts=[];
  if(ci&&ci.ts) parts.push(`🟢 <b>Entrada</b> ${hm(ci)} ${mapPin(ci,"📍 mapa")}`); else parts.push(`<span style="color:#ffc266">⚠️ sem check-in de entrada</span>`);
  if(co&&co.ts) parts.push(`🔴 <b>Saída</b> ${hm(co)} ${mapPin(co,"📍 mapa")}`); else if(ci&&ci.ts) parts.push(`<span style="color:#ffc266">⏳ sem saída (não bateu o check-out)</span>`);
  const dw=dwellMin(ci,co); if(dw!=null) parts.push(`⏱ <b>${dw} min</b> na clínica`);
  const dist=checkinDistM(ci,co);
  if(dist!=null && dist>CHECKOUT_LONGE_M) parts.push(`<span style="color:#ff5470;font-weight:700">🚩 saída a ${fmtDist(dist)} da entrada — conferir</span>`);
  return parts.join(" · ");
}
/* check-in (entrada) / check-out (saída) por georreferência (Geolocation API — anti-golpe + tempo na clínica) */
function fazerCheckin(btn, kind){
  if(!navigator.geolocation){ alert("Este aparelho não tem localização/GPS."); return; }
  btn.disabled=true; btn.textContent="📍 Localizando…";
  navigator.geolocation.getCurrentPosition(pos=>{
    const c=pos.coords, obj={lat:+c.latitude.toFixed(6), lng:+c.longitude.toFixed(6), acc:Math.round(c.accuracy||0), ts:Date.now()};
    if(kind==="out") F_CHECKOUT=obj; else F_CHECKIN=obj;
    btn.disabled=false; btn.classList.add("done"); btn.textContent=kind==="out"?"✅ Saída (refazer)":"✅ Entrada (refazer)";
    renderCheckinStatus();
  }, ()=>{ btn.disabled=false; btn.textContent=kind==="out"?"📍 Check-out (saída)":"📍 Check-in (entrada)"; alert("Não consegui pegar sua localização. Ative o GPS e PERMITA o acesso."); },
  {enableHighAccuracy:true, timeout:15000, maximumAge:0});
}
function renderCheckinStatus(){
  const el=document.getElementById("fCheckinStatus"); if(!el) return;
  el.style.display=(F_CHECKIN||F_CHECKOUT)?"block":"none"; el.innerHTML=checkinResumo(F_CHECKIN,F_CHECKOUT);
}
function openPistaRec(id){
  const f=id?PISTA.find(x=>x.id===id):null;
  const _v=visitaLoad();
  const vand=(!id) ? _v : ((_v&&_v.returnId&&_v.returnId===id)?_v:null);   // visita em andamento: nova (sem id) OU amarrada a ESTE retorno
  F_COMPLETING = !!(f && vand && vand.returnId===id);   // finalizando um retorno agendado (dá baixa ao salvar)
  F_ID=id||null; F_RES=f?f.resultado:"visita"; F_CHECKIN=(vand&&vand.checkin)?vand.checkin:((f&&f.checkin&&f.checkin.ts)?f.checkin:null); F_CHECKOUT=(f&&f.checkout&&f.checkout.ts)?f.checkout:null; F_SEMRET=f?!!f.sem_retorno:false;
  const bairrosUsados=[...new Set(PISTA.map(x=>x.bairro).filter(Boolean))].sort();
  document.getElementById("modalBody").innerHTML=`
    <div class="m-head"><div><div class="m-cli">${f?"✏️ Editar feedback":"🎤 Novo feedback da pista"}</div>
      <div class="t-mut" style="font-size:13px;margin-top:2px">${f?("registrado "+esc(diasAtras(f.ts))+" · "+esc(f.por)):"fale ou digite — salva com data e hora"}</div></div>
      <button class="m-x" id="mClose">✕</button></div>
    <div class="m-lbl">Comercial (quem visitou) <span style="color:var(--red)">*</span></div>
    <input id="fRep" class="m-date" style="width:100%" placeholder="Seu nome" list="repsDL" value="${f?esc(f.por||""):esc((vand&&vand.por)||meuRep())}">
    <datalist id="repsDL">${repList().map(n=>`<option value="${esc(n)}">`).join("")}</datalist>
    <div class="m-lbl">Cliente / clínica visitada <span style="color:var(--red)">*</span></div>
    <input id="fCli" class="m-date" style="width:100%" placeholder="Nome do cliente" value="${f?esc(f.cliente):esc((vand&&vand.cliente)||"")}">
    <div class="m-lbl">Bairro <span style="color:var(--red)">*</span> <span class="t-mut" style="font-weight:500">— monta a rota das revisitas</span></div>
    <input id="fBairro" class="m-date" style="width:100%" placeholder="Ex.: Tijuca, Copacabana…" list="bairrosDL" value="${f?esc(f.bairro||""):esc((vand&&vand.bairro)||"")}">
    <datalist id="bairrosDL">${bairrosUsados.map(b=>`<option value="${esc(b)}">`).join("")}</datalist>
    <div class="m-lbl">Data da visita <span style="color:var(--red)">*</span></div>
    <input id="fVisita" type="date" class="m-date" value="${f?esc(f.data_visita||hojeISO()):hojeISO()}">
    <div class="m-lbl">Feedback quente <span class="t-mut" style="font-weight:500">— ${speechOK()?"toque 🎤 e fale, ou digite":"digite (voz indisponível neste aparelho)"}</span></div>
    <div style="display:flex;gap:8px;align-items:stretch">
      <button class="micbtn" id="fMic" type="button">🎤 Falar</button>
      <textarea id="fTexto" class="m-ta" style="flex:1;min-height:90px;margin:0" placeholder="O que rolou na visita? Interesse, objeção, próximo passo…">${f?esc(f.texto):""}</textarea>
    </div>
    <div class="m-sec">Resultado</div>
    <div class="m-opts" id="fRes">${PRORDER.map(k=>`<button class="opt pst-${k}${k===F_RES?" on":""}" data-r="${k}">${PRES[k].ic} ${PRES[k].lbl}</button>`).join("")}</div>
    <div class="m-lbl">Próximo passo (retorno) <span style="color:var(--red)">*</span> <span class="t-mut" style="font-weight:500">— detecto da fala; se não falar, digite</span></div>
    <input id="fProx" type="date" class="m-date" value="${f?esc(f.proximo||""):""}">
    <div id="fProxHint" class="proxhint" style="display:none"></div>
    <label class="semret"><input type="checkbox" id="fSemRet" ${F_SEMRET?"checked":""}> 🚫 <b>Sem retorno</b> — cliente fechou/recusou (aí escreva o motivo no feedback)</label>
    <div class="m-sec">Check-in da visita <span style="color:var(--red)">*</span> <span class="t-mut" style="font-weight:500">— GPS: entrada obrigatória; saída mede o tempo na clínica</span></div>
    <div style="display:flex;gap:8px">
      ${(vand&&vand.checkin)?`<div class="checkinbtn done" style="flex:1;text-align:center;cursor:default">🔒 Entrada ${(()=>{const t=new Date(vand.checkin.ts),p=n=>String(n).padStart(2,'0');return p(t.getHours())+':'+p(t.getMinutes());})()} (chegada)</div>`:`<button class="checkinbtn${F_CHECKIN?" done":""}" id="fCheckin" type="button" style="flex:1">${F_CHECKIN?"✅ Entrada (refazer)":"📍 Check-in (entrada)"}</button>`}
      <button class="checkinbtn${F_CHECKOUT?" done":""}" id="fCheckout" type="button" style="flex:1">${F_CHECKOUT?"✅ Saída (refazer)":"📍 Check-out (saída)"}</button>
    </div>
    <div id="fCheckinStatus" class="proxhint" style="display:none"></div>
    <div class="m-sec">🗣️ Cliente reclamou de algo? <span class="t-mut" style="font-weight:500">— opcional; vira um Relato (voz da rua), tudo aqui mesmo</span></div>
    <div style="display:flex;gap:8px;align-items:stretch">
      <button class="micbtn" id="fRecMic" type="button">🎤 Falar</button>
      <textarea id="fReclama" class="m-ta" style="flex:1;min-height:60px;margin:0" placeholder="Ex.: reclamou de atraso no laudo, motoboy ligando toda hora… (deixe vazio se não teve reclamação)"></textarea>
    </div>
    <button class="m-save" id="fSave">${f?"Salvar alterações":"Salvar feedback"}</button>
    ${f?`<button class="m-enc" id="fDel" style="border-color:var(--mut);color:var(--mut)">Remover feedback</button>`:""}`;
  document.getElementById("modal").style.display="flex";
  document.getElementById("mClose").onclick=()=>{ try{precStop=true;PREC&&PREC.stop();}catch(e){} closeModal(); };
  const ta=document.getElementById("fTexto");
  const detectarCampos=()=>{ const val=ta.value, got=[];
    const setIf=(id,v,fmt)=>{ const el=document.getElementById(id); if(el && !el.value && v){ el.value=v; got.push(fmt(v)); } };
    setIf("fRep", detectRep(val), v=>"👤 "+v);
    setIf("fCli", detectCliente(val), v=>"🏥 "+v);
    setIf("fBairro", detectBairro(val, bairrosUsados), v=>"📍 "+v);
    setIf("fProx", parseDataBR(val), v=>"📅 retorno "+fmtDataBR(v));
    if(/\bsem retorno\b|n[ãa]o (?:tem|vai ter|ter[áa]|haver[áa]) retorno|fechou (?:a porta|as portas)|n[ãa]o quis|recusou|n[ãa]o (?:tem|h[áa]) interesse/i.test(val)){ const cb=document.getElementById("fSemRet"); if(cb && !cb.checked){ cb.checked=true; got.push("🚫 sem retorno"); } }
    if(got.length){ const h=document.getElementById("fProxHint"); if(h){ h.style.display="block"; h.innerHTML="🧠 detectei da fala (confira/corrija): <b>"+got.join(" · ")+"</b>"; } } };
  ta.addEventListener("input", detectarCampos);
  document.getElementById("fMic").onclick=function(){ pistaMic(this, ta, detectarCampos); };
  const frm=document.getElementById("fRecMic"), rec=document.getElementById("fReclama"); if(frm&&rec) frm.onclick=function(){ pistaMic(this, rec); };
  const fci=document.getElementById("fCheckin"); if(fci) fci.onclick=function(){ fazerCheckin(this, "in"); };
  document.getElementById("fCheckout").onclick=function(){ fazerCheckin(this, "out"); };
  renderCheckinStatus();
  document.getElementById("fRes").onclick=e=>{const b=e.target.closest("[data-r]");if(b){F_RES=b.dataset.r;[...e.currentTarget.children].forEach(c=>c.classList.toggle("on",c===b));
    const h=document.getElementById("fProxHint"); if(h && F_RES==="fechou"){ h.style.display="block"; h.style.borderColor="rgba(0,229,160,.4)"; h.style.color="#7effcf"; h.style.background="rgba(0,229,160,.1)"; h.innerHTML="🏆 <b>Fechou!</b> — retorno dispensado. Pode salvar direto (check-in + saída)."; } }};
  document.getElementById("fSave").onclick=async()=>{
    try{precStop=true;PREC&&PREC.stop();}catch(e){}
    const cli=document.getElementById("fCli").value.trim(), texto=ta.value.trim(), bairro=document.getElementById("fBairro").value.trim(), rep=document.getElementById("fRep").value.trim(), dataVisita=document.getElementById("fVisita").value;
    if(!rep){ alert("Informe o COMERCIAL (quem visitou) — obrigatório."); document.getElementById("fRep").focus(); return; }
    if(!cli){ alert("Informe o CLIENTE / clínica visitada — obrigatório."); document.getElementById("fCli").focus(); return; }
    if(!bairro){ alert("Informe o BAIRRO — obrigatório (monta a rota das revisitas)."); document.getElementById("fBairro").focus(); return; }
    if(!dataVisita){ alert("Informe a DATA DA VISITA."); document.getElementById("fVisita").focus(); return; }
    const semRet=document.getElementById("fSemRet").checked, fechou=(F_RES==="fechou");
    let prox=document.getElementById("fProx").value; if(!prox && !semRet && !fechou) prox=parseDataBR(texto);   // detecta do texto se não preencheu
    if(fechou){ /* ✅ Fechou não precisa de retorno — libera automático (mantém a data se ele quis marcar) */ }
    else if(semRet){ prox=""; if(!texto){ alert("Marcou '🚫 Sem retorno' — então escreva o MOTIVO no feedback (ex.: cliente fechou a porta, recusou)."); ta.focus(); return; } }
    else if(!prox){ alert("Informe a DATA DE RETORNO — obrigatória. Fale/escolha a data, OU marque '🚫 Sem retorno' e explique o motivo."); document.getElementById("fProx").focus(); return; }
    // check-in obrigatório só p/ VISITA de verdade (nova ou finalizando). Editar um agendado/pendente (sem visita ainda) NÃO exige check-in — é só ajuste (pedido do Heitor).
    const editandoPendente = !!F_ID && !F_COMPLETING && !F_CHECKIN;
    if(!editandoPendente && !F_CHECKIN){ alert("Faça o CHECK-IN (📍 GPS) — obrigatório: confirma que você está no cliente."); return; }
    localStorage.setItem("crm_rep", rep);   // memoriza quem é neste aparelho
    const btn=document.getElementById("fSave"); btn.disabled=true; btn.textContent="Salvando…";
    const item={id:F_ID, cliente:cli, bairro, data_visita:dataVisita, texto, resultado:F_RES, por:rep, proximo:prox, sem_retorno:semRet, checkin:F_CHECKIN, checkout:F_CHECKOUT};
    if(F_COMPLETING){ item.baixa={tipo:"compareceu", ts:Date.now(), por:rep, checkin:F_CHECKIN, checkout:F_CHECKOUT}; }   // finalizou o retorno agendado → baixa automática
    const ok=await savePista(item);
    if(ok){
      const recl=(document.getElementById("fReclama")||{}).value; const rt=(recl||"").trim();
      if(rt){ try{ await saveRelato({clinica:cli, texto:rt, data:dataVisita||hojeISO(), origem:"visita", por:rep}); }catch(e){} }   // reclamação → vira Relato, tudo aqui
      visitaClear(); closeModal(); if(rt) alert("✅ Feedback salvo + 🗣️ reclamação virou Relato."); renderTab();
    } else { btn.disabled=false; btn.textContent="Salvar feedback"; } };
  const del=document.getElementById("fDel"); if(del) del.onclick=()=>excluirFeedback(F_ID);
}

/* 📣 NOVO/EDITAR RELATO — o rep GRAVA o áudio contando o cenário; vira card estruturado + dores detectadas */
function detectMedico(txt){ const m=(" "+(txt||"")).match(/\bdr(?:a|ª|\.)?\s+([A-Za-zÀ-ú]+(?:\s+[A-Za-zÀ-ú]+){0,2})/i); return m?("Dr"+(/\bdra|drª/i.test(m[0])?"ª":".")+" "+m[1].trim().replace(/\b\w/g,c=>c.toUpperCase())):""; }
/* RASCUNHO automático do relato (anti-perda) — salva no aparelho enquanto escreve/fala; recupera se a aba fechar/recarregar */
function relDraftSave(o){ try{ localStorage.setItem("crm_relato_draft", JSON.stringify(o)); }catch(e){} }
function relDraftLoad(){ try{ return JSON.parse(localStorage.getItem("crm_relato_draft")||"null"); }catch(e){ return null; } }
function relDraftClear(){ try{ localStorage.removeItem("crm_relato_draft"); }catch(e){} }
function relDraftVazio(o){ return !o || !((o.texto||"").trim() || (o.clinica||"").trim() || (o.medico||"").trim() || (o.titulo||"").trim()); }
function openRelato(id){
  const r=id?RELATOS.find(x=>x.id===id):null;
  const now=new Date(), pp=n=>String(n).padStart(2,"0");
  let ORIG=r?r.origem:"visita";
  const clis=[...new Set([...RELATOS.map(x=>x.clinica), ...PISTA.map(x=>x.cliente)].filter(Boolean))].sort();
  document.getElementById("modalBody").innerHTML=`
    <div class="m-head"><div><div class="m-cli">${r?"✏️ Editar relato":"📣 Novo relato da rua"}</div>
      <div class="t-mut" style="font-size:13px;margin-top:2px">${r?("registrado "+esc(diasAtras(r.ts))+" · "+esc(r.por)):(speechOK()?"toque 🎤 e CONTE o que rolou (ligação/reunião) — organizo em título, clínica, dores":"digite o relato — organizo em título, clínica, dores")}</div></div>
      <button class="m-x" id="mClose">✕</button></div>
    <div class="m-lbl">Comercial <span style="color:var(--red)">*</span></div>
    <input id="rRep" class="m-date" style="width:100%" placeholder="Seu nome" list="repsDL" value="${r?esc(r.por||""):esc(meuRep())}">
    <datalist id="repsDL">${repList().map(n=>`<option value="${esc(n)}">`).join("")}</datalist>
    <div class="m-lbl">De onde veio esse relato?</div>
    <div class="m-opts" id="rOrig">${Object.keys(RORIG).map(k=>`<button class="opt${k===ORIG?" on":""}" data-o="${k}">${RORIG[k].ic} ${RORIG[k].lbl}</button>`).join("")}</div>
    <div class="m-lbl">Relato <span style="color:var(--red)">*</span> <span class="t-mut" style="font-weight:500">— ${speechOK()?"toque 🎤 e fale à vontade":"digite (voz indisponível neste aparelho)"}</span></div>
    <div style="display:flex;gap:8px;align-items:stretch">
      <button class="micbtn" id="rMic" type="button">🎤 Falar</button>
      <textarea id="rTexto" class="m-ta" style="flex:1;min-height:110px;margin:0" placeholder="Ex.: Liguei pra Veterinária Aguiar, falei com a Drª Erila. Ela está puta com o atraso na liberação de urgência e o motoboy ligando todo dia…">${r?esc(r.texto):""}</textarea>
    </div>
    <div id="rHint" class="proxhint" style="display:none"></div>
    <div class="m-lbl">Clínica <span style="color:var(--red)">*</span></div>
    <input id="rCli" class="m-date" style="width:100%" placeholder="Nome da clínica" list="clisDL" value="${r?esc(r.clinica||""):""}">
    <datalist id="clisDL">${clis.map(c=>`<option value="${esc(c)}">`).join("")}</datalist>
    <div class="m-lbl">Médico(a) responsável <span class="t-mut" style="font-weight:500">— opcional</span></div>
    <input id="rMed" class="m-date" style="width:100%" placeholder="Ex.: Drª Erila Aguiar" value="${r?esc(r.medico||""):""}">
    <div style="display:flex;gap:8px">
      <div style="flex:1"><div class="m-lbl">Data <span style="color:var(--red)">*</span></div><input id="rData" type="date" class="m-date" style="width:100%" value="${r?esc(r.data||hojeISO()):hojeISO()}"></div>
      <div style="flex:1"><div class="m-lbl">Hora</div><input id="rHora" type="time" class="m-date" style="width:100%" value="${r?esc(r.hora||''):pp(now.getHours())+':'+pp(now.getMinutes())}"></div>
    </div>
    <div class="m-lbl">Título <span class="t-mut" style="font-weight:500">— opcional, eu gero sozinho se deixar vazio</span></div>
    <input id="rTit" class="m-date" style="width:100%" placeholder="(automático)" value="${r?esc(r.titulo||""):""}">
    <button class="m-save" id="rSave">${r?"Salvar alterações":"Salvar relato"}</button>
    ${r?`<button class="m-enc" id="rDel" style="border-color:var(--mut);color:var(--mut)">Remover relato</button>`:""}`;
  document.getElementById("modal").style.display="flex";
  document.getElementById("mClose").onclick=()=>{ try{precStop=true;PREC&&PREC.stop();}catch(e){} closeModal(); };
  const ta=document.getElementById("rTexto");
  const previa=()=>{ const val=(document.getElementById("rTit").value+" "+ta.value);
    const cli=document.getElementById("rCli"); if(cli && !cli.value){ const c=detectCliente(ta.value); if(c) cli.value=c; }
    const med=document.getElementById("rMed"); if(med && !med.value){ const m=detectMedico(ta.value); if(m) med.value=m; }
    const ps=detectPains(val), crit=relCritico(val), h=document.getElementById("rHint");
    if(h){ if(ps.length||crit){ h.style.display="block"; h.innerHTML="🧠 detectei: "+ps.map(p=>`<span class="comp-pill">${p.ic} ${p.lbl}</span>`).join(" ")+(crit?` <span class="comp-pill" style="background:rgba(255,45,85,.2);color:#ff8fa3;border-color:rgba(255,45,85,.5)">🔴 CLIENTE IRRITADO</span>`:""); } else h.style.display="none"; } };
  // 💾 RASCUNHO automático (só p/ relato NOVO) — nunca mais perde o que escreveu se a aba fechar/recarregar
  const _v=id2=>{const el=document.getElementById(id2);return el?el.value:"";};
  const lerCampos=()=>({rep:_v("rRep"),texto:_v("rTexto"),clinica:_v("rCli"),medico:_v("rMed"),data:_v("rData"),hora:_v("rHora"),titulo:_v("rTit"),origem:ORIG});
  const salvaRascunho=()=>{ if(r) return; const d=lerCampos(); if(relDraftVazio(d)) relDraftClear(); else relDraftSave(d); };
  if(!r){ const d=relDraftLoad(); if(d && !relDraftVazio(d)){
      const setV=(id2,val)=>{const el=document.getElementById(id2); if(el&&val) el.value=val;};
      setV("rRep",d.rep); setV("rTexto",d.texto); setV("rCli",d.clinica); setV("rMed",d.medico); setV("rData",d.data); setV("rHora",d.hora); setV("rTit",d.titulo);
      if(d.origem){ ORIG=d.origem; [...document.getElementById("rOrig").children].forEach(c=>c.classList.toggle("on",c.dataset.o===ORIG)); }
      const h=document.getElementById("rHint"); if(h){ h.style.display="block"; h.style.borderColor="rgba(0,229,160,.4)"; h.style.color="#7effcf"; h.style.background="rgba(0,229,160,.1)"; h.innerHTML='🔄 <b>Recuperei seu rascunho</b> não salvo — continue de onde parou. <a id="rDescartar" style="color:#ff8fa3;cursor:pointer;text-decoration:underline">🗑️ descartar</a>'; const dd=document.getElementById("rDescartar"); if(dd) dd.onclick=()=>{ relDraftClear(); closeModal(); openRelato(null); }; }
  } }
  ta.addEventListener("input", ()=>{ previa(); salvaRascunho(); });
  ["rRep","rCli","rMed","rData","rHora","rTit"].forEach(id2=>{ const el=document.getElementById(id2); if(el) el.addEventListener("input", salvaRascunho); });
  document.getElementById("rMic").onclick=function(){ pistaMic(this, ta, ()=>{ previa(); salvaRascunho(); }); };
  document.getElementById("rOrig").onclick=e=>{ const b=e.target.closest("[data-o]"); if(b){ ORIG=b.dataset.o; [...e.currentTarget.children].forEach(c=>c.classList.toggle("on",c===b)); salvaRascunho(); } };
  previa();
  document.getElementById("rSave").onclick=async()=>{
    try{precStop=true;PREC&&PREC.stop();}catch(e){}
    const rep=document.getElementById("rRep").value.trim(), texto=ta.value.trim(), clinica=document.getElementById("rCli").value.trim();
    if(!rep){ alert("Informe o COMERCIAL — obrigatório."); document.getElementById("rRep").focus(); return; }
    if(!texto){ alert("Grave ou digite o RELATO — obrigatório."); ta.focus(); return; }
    if(!clinica){ alert("Informe a CLÍNICA — obrigatório."); document.getElementById("rCli").focus(); return; }
    localStorage.setItem("crm_rep", rep);
    const btn=document.getElementById("rSave"); btn.disabled=true; btn.textContent="Salvando…";
    const item={id:r?r.id:null, clinica, medico:document.getElementById("rMed").value.trim(), titulo:document.getElementById("rTit").value.trim(), texto, data:document.getElementById("rData").value||hojeISO(), hora:document.getElementById("rHora").value||"", origem:ORIG, por:rep, ts:r?r.ts:Date.now()};
    const ok=await saveRelato(item);
    if(ok){ if(!r) relDraftClear(); closeModal(); pistaView="relatos"; renderTab(); } else { btn.disabled=false; btn.textContent=r?"Salvar alterações":"Salvar relato"; } };
  const del=document.getElementById("rDel"); if(del) del.onclick=async()=>{ if(confirm(`Remover o relato de "${r.clinica||""}"?`)){ await removeRelato(r.id); closeModal(); renderTab(); } };
}

/* ---------- histórico semanal do radar (snapshots) ---------- */
const HIST_API = "/api/crm-history";
let HIST = [];
const MOTLAB = {parado:"Parado", queda_forte:"Queda forte", queda:"Em queda", novo_esfriando:"Novo esfriando", alta:"Em alta"};
const MOTCOL = {parado:"#FF5470", queda_forte:"#FF2D55", queda:"#FF8A8A", novo_esfriando:"#FFB020", alta:"#4D9DFF"};
async function loadHist(){ try{ const r=await fetch(HIST_API, {cache:"no-store"}); if(r.ok){ const j=await r.json(); HIST=(j.snapshots||[]).slice().sort((a,b)=>a.week<b.week?-1:(a.week>b.week?1:0)); } }catch(e){} }
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
const MESF=['','Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
function isoWeekKey(date){
  const d=new Date(Date.UTC(date.getFullYear(),date.getMonth(),date.getDate()));
  const dow=d.getUTCDay()||7; d.setUTCDate(d.getUTCDate()+4-dow);
  const ys=new Date(Date.UTC(d.getUTCFullYear(),0,1));
  const wk=Math.ceil((((d-ys)/864e5)+1)/7);
  return d.getUTCFullYear()+'-W'+String(wk).padStart(2,'0');
}
function isoMonday(wk){ const [y,w]=wk.split('-W').map(Number);
  const jan4=new Date(Date.UTC(y,0,4)), dow=jan4.getUTCDay()||7;
  const w1=new Date(jan4); w1.setUTCDate(jan4.getUTCDate()-dow+1);
  const mon=new Date(w1); mon.setUTCDate(w1.getUTCDate()+(w-1)*7); return mon;
}
function contatosWeek(lst){
  if(!lst.length) return '';
  const rows=lst.slice().sort((a,b)=>a.ts-b.ts).map(h=>{const r=rbadge(h);
    return `<div class="histcli"><span class="nm">${esc(h.cliente||('#'+h.cod))}</span><span class="t-mut">${esc(h.canal||'')} · ${esc(h.por||'')}</span><span class="pr" style="background:${r.col}22;color:${r.col}">${r.ic} ${esc(r.lbl)}</span></div>`;
  }).join('');
  return `<div style="margin-top:12px"><div class="histhead" style="color:var(--cyan)">📞 Contatos da equipe (${lst.length})</div>${rows}</div>`;
}
function histByWeek(){
  const byWeek={};
  const ensure=wk=>{ if(!byWeek[wk]) byWeek[wk]={week:wk,label:isoMonday(wk).toISOString().slice(0,10),snap:null,contatos:[],encerrados:[],inativos:[]}; return byWeek[wk]; };
  HIST.forEach(s=>{ const w=ensure(s.week); w.snap=s; if(s.label) w.label=s.label; });
  INTER.forEach(x=>{ ensure(isoWeekKey(new Date(x.ts))).contatos.push(x); });
  [...ENCERR.values()].forEach(e=>{ ensure(isoWeekKey(new Date(e.ts))).encerrados.push(e); });
  [...INAT.values()].forEach(e=>{ ensure(isoWeekKey(new Date(e.ts))).inativos.push(e); });
  const weeks=Object.values(byWeek).sort((a,b)=>a.week<b.week?-1:(a.week>b.week?1:0));
  const diff={}; for(let i=1;i<HIST.length;i++) diff[HIST[i].week]=weekDiff(HIST[i-1],HIST[i]);
  return {weeks, diff};
}
function exportHistCSV(){
  const {weeks, diff}=histByWeek();
  const mn=wk=>{const md=isoMonday(wk);return MESF[md.getUTCMonth()+1]+' '+md.getUTCFullYear();};
  const rows=[["Mes","Semana","Inicio","Tipo","Cliente","Cidade","Canal/Motivo","Resultado/Variacao","Por","Nota"]];
  weeks.forEach(wo=>{ const d=diff[wo.week];
    if(d){ d.entraram.forEach(x=>rows.push([mn(wo.week),wo.week,wo.label,"Entrou no radar",x.nome||('#'+x.cod),x.cidade||'',MOTLAB[x.motivo]||x.motivo||'',(x.delta!=null?Math.round(x.delta)+'%':''),'','']));
      d.sairam.forEach(x=>rows.push([mn(wo.week),wo.week,wo.label,"Saiu do radar",x.nome||('#'+x.cod),x.cidade||'',MOTLAB[x.motivo]||x.motivo||'','','',''])); }
    wo.contatos.slice().sort((a,b)=>a.ts-b.ts).forEach(h=>{const r=RESULT[h.resultado]||RESULT.sem_resposta;
      rows.push([mn(wo.week),wo.week,wo.label,"Contato",h.cliente||('#'+h.cod),'',h.canal||'',r.lbl+(h.motivo?(' / '+h.motivo):''),h.por||'',(h.nota||'').replace(/[\r\n]+/g,' ')]); });
    (wo.encerrados||[]).forEach(e=>rows.push([mn(wo.week),wo.week,wo.label,"Encerrado",e.cliente||('#'+e.cod),e.cidade||'',e.motivo||'','',e.por||'',(e.nota||'').replace(/[\r\n]+/g,' ')]));
    (wo.inativos||[]).forEach(e=>rows.push([mn(wo.week),wo.week,wo.label,"Inativo",e.cliente||('#'+e.cod),e.cidade||'',e.motivo||'','',e.por||'',(e.nota||'').replace(/[\r\n]+/g,' ')])); });
  const csv="﻿"+rows.map(r=>r.map(c=>'"'+String(c==null?'':c).replace(/"/g,'""')+'"').join(";")).join("\r\n");
  const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
  a.download="catalogo-crm-"+new Date().toISOString().slice(0,10)+".csv"; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
}
function weekBlock(wo, d){
  const radar = d ? `<div class="histgrid">
      <div><div class="histhead" style="color:var(--amber)">⚠ Entraram no radar (${d.entraram.length}) <span class="t-mut" style="font-weight:500">· novos alertas</span></div>${histCliList(d.entraram)}</div>
      <div><div class="histhead" style="color:var(--green)">✓ Saíram do radar (${d.sairam.length}) <span class="t-mut" style="font-weight:500">· recuperaram</span></div>${histCliList(d.sairam)}</div>
    </div>`
    : (wo.snap ? `<div class="t-mut" style="font-size:12.5px">📅 Início do histórico · ${(wo.snap.flagged||[]).length} clientes no radar</div>` : `<div class="t-mut" style="font-size:12.5px">Sem foto do radar nesta semana.</div>`);
  const encHtml=(wo.encerrados&&wo.encerrados.length)?`<div style="margin-top:12px"><div class="histhead" style="color:var(--red)">🔒 Encerrados (${wo.encerrados.length})</div>${wo.encerrados.map(e=>`<div class="histcli"><span class="nm">${esc(e.cliente||('#'+e.cod))}</span><span class="t-mut">${esc(e.por||'')}${e.nota?' · "'+esc(e.nota)+'"':''}</span><span class="pr" style="background:rgba(255,84,112,.16);color:#ffb3c0">${esc(e.motivo)}</span></div>`).join('')}</div>`:'';
  const inatHtml=(wo.inativos&&wo.inativos.length)?`<div style="margin-top:12px"><div class="histhead" style="color:#FF8A00">🚫 Inativos (${wo.inativos.length})</div>${wo.inativos.map(e=>`<div class="histcli"><span class="nm">${esc(e.cliente||('#'+e.cod))}</span><span class="t-mut">${esc(e.por||'')}${e.nota?' · "'+esc(e.nota)+'"':''}</span><span class="pr" style="background:rgba(255,138,0,.16);color:#ffc266">${esc(e.motivo)}</span></div>`).join('')}</div>`:'';
  return `<div class="card" style="margin-bottom:12px">
    <h3>Semana ${esc(wo.week)} <span class="tag">início ${esc(wo.label||'')}</span></h3>
    ${radar}${contatosWeek(wo.contatos)}${encHtml}${inatHtml}</div>`;
}
function findClient(cod){
  const c=String(cod), D=DATA||{};
  for(const k of ["reativar","parados","em_queda","queda_forte","novos_esfriando","em_alta","carteira"]){
    const hit=(D[k]||[]).find(x=>String(x.cod)===c); if(hit) return hit;
  }
  return null;
}
/* eventos de REATIVAÇÃO (visão ampla): estava ruim (parado/queda/queda forte/esfriando) e saiu do radar.
   Fonte 1 = histórico semanal (saiu do radar, datado por semana). Fonte 2 = detecção atual (contato com
   snapshot ruim + hoje fora dos alertas). Dedupe por cliente. */
function reativadosEvents(){
  const D=DATA||{};
  const ainda=new Set([...(D.parados||[]),...(D.em_queda||[]),...(D.queda_forte||[]),...(D.novos_esfriando||[])].map(x=>String(x.cod)));
  // CHURNED = saiu do radar porque PAROU/foi encerrado/inativado — NÃO é reativação (Luciane: "tá misturado quem não voltou")
  const churn=new Set([...ENCERR.keys(),...INAT.keys()].map(String));
  const reativou=cod=>!churn.has(cod) && !ainda.has(cod);   // só conta se hoje NÃO está ruim e NÃO churnou = voltou a mandar
  const evts=[], visto=new Set();
  for(let i=1;i<HIST.length;i++){ const d=weekDiff(HIST[i-1],HIST[i]), ts=isoMonday(HIST[i].week).getTime();
    d.sairam.forEach(x=>{ const cod=String(x.cod); if(!reativou(cod)) return; evts.push({cod,cliente:x.nome,cidade:x.cidade,motivo:x.motivo,ts,week:HIST[i].week,fonte:"semana"}); visto.add(cod); }); }
  [...new Set(INTER.map(x=>String(x.cod)))].forEach(cod=>{
    if(visto.has(cod) || !reativou(cod)) return;
    const bad=interOf(cod).find(h=>["parado","queda","queda_forte","novo_esfriando"].includes((h.snapshot||{}).situacao));
    if(bad){ const nm=interOf(cod).map(i=>i.cliente).find(Boolean)||("#"+cod);
      evts.push({cod,cliente:nm,cidade:(findClient(cod)||{}).cidade||"",motivo:(bad.snapshot||{}).situacao,ts:Date.now(),week:isoWeekKey(new Date()),fonte:"atual"}); } });
  return evts.sort((a,b)=>b.ts-a.ts);
}
function snapOf(cod){
  const x=findClient(cod)||{};
  const sit = x.motivo || x.situacao || (x.flag==="up"?"alta":x.flag==="down"?"queda":"");
  return {dias_inativo:x.dias_inativo??null, delta:x.delta??null, situacao:sit};
}

/* ---- modal de registro ---- */
let M_COD=null, M_RES="positivo", M_CANAL="Ligação", M_MOTIVO="", M_SAT=null, M_ENCMOT="", M_INATMOT="";
function rbadge(h){ const r=RESULT[h.resultado]||RESULT.sem_resposta; return r; }
function openReg(cod){
  M_COD=String(cod); M_RES="positivo"; M_CANAL="Ligação"; M_MOTIVO=""; M_SAT=null; M_ENCMOT=""; M_INATMOT="";
  const cli=findClient(cod)||ENCERR.get(String(cod))||INAT.get(String(cod))||{}, nome=cli.nome||cli.cliente||("#"+cod), hist=interOf(cod);
  const enc=ENCERR.get(String(cod));
  const inat=INAT.get(String(cod));
  const histHtml = hist.length ? hist.map(h=>{ const r=rbadge(h);
    const sat=(h.nota_satisfacao!=null)?` · <span class="t-cyan">satisf. ${h.nota_satisfacao}/10${h.nota_motivo?(" ("+esc(h.nota_motivo)+")"):""}</span>`:"";
    return `<div class="hist-row"><span class="hi-ic">${r.ic}</span>
      <div class="hi-body"><div class="hi-top"><b>${esc(r.lbl)}</b> <span class="t-mut">· ${esc(h.canal||"—")} · ${esc(diasAtras(h.ts))} · ${esc(h.por)}</span>${h.motivo?` · <span class="t-red">${esc(h.motivo)}</span>`:""}${sat}</div>
      ${h.nota?`<div class="hi-nota">"${esc(h.nota)}"</div>`:""}${h.proximo_passo?`<div class="hi-next">↻ retorno: ${esc(h.proximo_passo)}</div>`:""}</div>
      <button class="hi-del" data-del="${esc(h.id)}" title="remover">✕</button></div>`;
  }).join("") : `<div class="t-mut" style="font-size:13px;padding:6px 0">Sem contatos registrados ainda.</div>`;
  const encBlock = enc
    ? `<div class="m-sec" style="color:var(--red)">Cliente encerrado</div>
       <div class="encbanner"><div><b>${esc(enc.motivo)}</b> <span class="t-mut">· ${esc(diasAtras(enc.ts))} · ${esc(enc.por)}</span>${enc.nota?`<div class="hi-nota">"${esc(enc.nota)}"</div>`:""}</div><button class="opt" id="mReabrir">↩ Reabrir</button></div>`
    : `<div class="m-sec" style="color:var(--red)">Encerrar cliente</div>
       <div class="t-mut" style="font-size:12px;margin-bottom:8px">Tira do fluxo ativo e arquiva em <b>Encerrados</b> (rastreado, permanente).</div>
       <div class="m-opts" id="mEnc">${motivosEnc().map(m=>`<button class="opt enc" data-enc="${esc(m)}">${esc(m)}</button>`).join("")}<button class="opt" data-enc="__novo">+ novo motivo</button></div>
       <input id="mEncNovo" class="m-date" style="width:100%;display:none;margin-top:8px" placeholder="Novo motivo de encerramento">
       <textarea id="mEncNota" class="m-ta" style="min-height:48px;margin-top:8px" placeholder="Observação do encerramento (opcional)"></textarea>
       <button class="m-enc" id="mEncBtn">🔒 Encerrar contato</button>`;
  const inatBlock = inat
    ? `<div class="m-sec" style="color:#FF8A00">Cliente inativo</div>
       <div class="inatbanner"><div><b>${esc(inat.motivo)}</b> <span class="t-mut">· ${esc(diasAtras(inat.ts))} · ${esc(inat.por)}</span>${inat.nota?`<div class="hi-nota">"${esc(inat.nota)}"</div>`:""}</div><button class="opt" id="mInatReabrir">↩ Reativar</button></div>`
    : `<div class="m-sec" style="color:#FF8A00">Marcar como inativo</div>
       <div class="t-mut" style="font-size:12px;margin-bottom:8px">Cliente travado (calote, falta de pagamento…). Sai do <b>% geral</b> do estudo e vai p/ <b>🚫 Inativos</b> (com % de inativação por motivo). Diferente de Encerrado.</div>
       <div class="m-opts" id="mInat">${motivosInat().map(m=>`<button class="opt inat" data-inat="${esc(m)}">${esc(m)}</button>`).join("")}<button class="opt" data-inat="__novo">+ novo motivo</button></div>
       <input id="mInatNovo" class="m-date" style="width:100%;display:none;margin-top:8px" placeholder="Novo motivo de inativação">
       <textarea id="mInatNota" class="m-ta" style="min-height:48px;margin-top:8px" placeholder="Observação (opcional)"></textarea>
       <button class="m-enc" id="mInatBtn" style="border-color:#FF8A00;color:#FF8A00">🚫 Marcar inativo</button>`;
  document.getElementById("modalBody").innerHTML = `
    <div class="m-head"><div><div class="m-cli">${esc(nome)}</div>
      <div class="t-mut" style="font-size:13px;margin-top:2px">${esc(cli.cidade||"")}${cli.dias_inativo!=null?` · ${cli.dias_inativo}d sem enviar`:""}${enc?' · <span class="t-red" style="font-weight:800">ENCERRADO</span>':""}${inat?' · <span style="color:#FF8A00;font-weight:800">INATIVO</span>':""}</div></div>
      <button class="m-x" id="mClose">✕</button></div>
    <div class="m-sec">Histórico de contatos</div><div class="m-hist">${histHtml}</div>
    <div class="m-sec">Registrar novo contato</div>
    <div class="m-lbl">Canal</div><div class="m-opts" id="mCanal">${CANAIS.map(c=>`<button class="opt${c===M_CANAL?" on":""}" data-canal="${c}">${c}</button>`).join("")}</div>
    <div class="m-lbl">Resultado</div><div class="m-opts" id="mRes">${Object.entries(RESULT).map(([k,v])=>`<button class="opt res-${k}${k===M_RES?" on":""}" data-res="${k}">${v.ic} ${v.lbl}</button>`).join("")}</div>
    <div id="mMotivoWrap" style="display:none"><div class="m-lbl">Motivo da perda</div><div class="m-opts" id="mMotivo">${MOTIVOS.map(m=>`<button class="opt" data-motivo="${m}">${m}</button>`).join("")}</div></div>
    <div class="m-lbl">Satisfação (0–10) · opcional <span class="t-mut" style="font-weight:500">— pesquisa (use em Em Alta)</span></div>
    <div class="m-opts" id="mSat">${[0,1,2,3,4,5,6,7,8,9,10].map(n=>`<button class="opt sat" data-sat="${n}">${n}</button>`).join("")}</div>
    <div id="mSatMotivoWrap" style="display:none"><div class="m-lbl">Motivo da nota (abaixo de 8)</div><input id="mSatMotivo" class="m-date" style="width:100%" placeholder="Por que essa nota?"></div>
    <div class="m-lbl">Nota / relatório</div><textarea id="mNota" class="m-ta" placeholder="O que foi conversado, combinado, objeções…"></textarea>
    <div class="m-lbl">Próximo passo (retorno)</div><input id="mNext" type="date" class="m-date">
    <button class="m-save" id="mSave">Salvar contato</button>
    ${encBlock}${inatBlock}`;
  document.getElementById("modal").style.display="flex";
  document.getElementById("mClose").onclick=closeModal;
  document.getElementById("mCanal").onclick=e=>{const b=e.target.closest("[data-canal]");if(b){M_CANAL=b.dataset.canal;[...e.currentTarget.children].forEach(c=>c.classList.toggle("on",c===b));}};
  document.getElementById("mRes").onclick=e=>{const b=e.target.closest("[data-res]");if(b){M_RES=b.dataset.res;[...e.currentTarget.children].forEach(c=>c.classList.toggle("on",c===b));document.getElementById("mMotivoWrap").style.display=M_RES==="negativo"?"block":"none";}};
  const mm=document.getElementById("mMotivo"); if(mm) mm.onclick=e=>{const b=e.target.closest("[data-motivo]");if(b){M_MOTIVO=b.dataset.motivo;[...e.currentTarget.children].forEach(c=>c.classList.toggle("on",c===b));}};
  document.getElementById("mSat").onclick=e=>{const b=e.target.closest("[data-sat]");if(b){M_SAT=+b.dataset.sat;[...e.currentTarget.children].forEach(c=>c.classList.toggle("on",c===b));document.getElementById("mSatMotivoWrap").style.display=M_SAT<8?"block":"none";}};
  document.getElementById("mSave").onclick=submitReg;
  document.querySelectorAll(".hi-del").forEach(b=>b.onclick=()=>removeInter(b.dataset.del));
  const me=document.getElementById("mEnc"); if(me) me.onclick=e=>{const b=e.target.closest("[data-enc]");if(!b)return; const v=b.dataset.enc;
    if(v==="__novo"){ const inp=document.getElementById("mEncNovo"); inp.style.display="block"; inp.focus(); M_ENCMOT=""; [...me.children].forEach(c=>c.classList.remove("on")); }
    else { M_ENCMOT=v; document.getElementById("mEncNovo").style.display="none"; [...me.children].forEach(c=>c.classList.toggle("on",c===b)); } };
  const meb=document.getElementById("mEncBtn"); if(meb) meb.onclick=async()=>{
    const novo=(document.getElementById("mEncNovo").value||"").trim(), motivo=novo||M_ENCMOT;
    if(!motivo){ alert("Escolha ou digite um motivo de encerramento."); return; }
    meb.disabled=true; meb.textContent="Encerrando…";
    const ok=await encerrar(M_COD, cli.nome||"", cli.cidade||"", motivo, (document.getElementById("mEncNota").value||"").trim());
    if(ok){ closeModal(); renderAll(); } else { meb.disabled=false; meb.textContent="🔒 Encerrar contato"; } };
  const mr=document.getElementById("mReabrir"); if(mr) mr.onclick=()=>reabrir(M_COD);
  const mi=document.getElementById("mInat"); if(mi) mi.onclick=e=>{const b=e.target.closest("[data-inat]");if(!b)return; const v=b.dataset.inat;
    if(v==="__novo"){ const inp=document.getElementById("mInatNovo"); inp.style.display="block"; inp.focus(); M_INATMOT=""; [...mi.children].forEach(c=>c.classList.remove("on")); }
    else { M_INATMOT=v; document.getElementById("mInatNovo").style.display="none"; [...mi.children].forEach(c=>c.classList.toggle("on",c===b)); } };
  const mib=document.getElementById("mInatBtn"); if(mib) mib.onclick=async()=>{
    const novo=(document.getElementById("mInatNovo").value||"").trim(), motivo=novo||M_INATMOT;
    if(!motivo){ alert("Escolha ou digite um motivo de inativação."); return; }
    mib.disabled=true; mib.textContent="Marcando…";
    const ok=await inativar(M_COD, cli.nome||cli.cliente||"", cli.cidade||"", motivo, (document.getElementById("mInatNota").value||"").trim());
    if(ok){ closeModal(); renderAll(); } else { mib.disabled=false; mib.textContent="🚫 Marcar inativo"; } };
  const mir=document.getElementById("mInatReabrir"); if(mir) mir.onclick=()=>reativarInat(M_COD);
}
let EX_VIEW="dia";
function openExames(cod, nome){
  cod=String(cod||""); const d=CLIN_DET[cod]||{}; const rec=(d.recent||[]).slice();
  const desde=d.recent_desde||d.marco||"", mais=!!d.recent_mais;
  const MES=["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
  const mesLabel=k=>{ const [y,m]=k.split("-"); return (MES[(+m||1)-1]||"?")+"/"+y; };
  const weekKey=iso=>{ const dt=new Date(iso+"T00:00:00"); const off=(dt.getDay()+6)%7; const mon=new Date(dt); mon.setDate(dt.getDate()-off); const sun=new Date(mon); sun.setDate(mon.getDate()+6); const p=n=>String(n).padStart(2,"0"); return { key:mon.getFullYear()+"-"+p(mon.getMonth()+1)+"-"+p(mon.getDate()), lab:`Semana ${p(mon.getDate())}/${p(mon.getMonth()+1)}–${p(sun.getDate())}/${p(sun.getMonth()+1)}` }; };
  const catCount={}; rec.forEach(e=>{ const k=e.cat||"(sem categoria)"; catCount[k]=(catCount[k]||0)+1; });
  const catsResumo=Object.entries(catCount).sort((a,b)=>b[1]-a[1]);
  const petsTot=new Set(rec.map(e=>e.pet).filter(Boolean)).size;
  const dir=ehDiretoria(), fmes=(dir&&CLIN_FATMES&&CLIN_FATMES[cod])?CLIN_FATMES[cod]:null;
  // 💰 dinheiro entrando mês a mês desde o marco zero (SÓ diretoria) — pra estimular a equipe sem mostrar R$ a eles
  let moneyHTML="";
  if(dir&&fmes&&fmes.length){ let acc=0; const rows=fmes.map(m=>{ acc+=m.fat; return `<tr><td style="padding:4px 8px">${mesLabel(m.ym)}</td><td style="padding:4px 8px;text-align:right">${m.n}</td><td style="padding:4px 8px;text-align:right;color:#7effcf;font-weight:700">${fmtBRL(m.fat)}</td><td style="padding:4px 8px;text-align:right;color:#9fe6ff">${fmtBRL(acc)}</td></tr>`; }).join("");
    moneyHTML=`<div style="background:rgba(0,229,160,.07);border:1px solid rgba(0,229,160,.3);border-radius:8px;padding:10px;margin:10px 0">
      <div style="font-weight:700;color:#7effcf;font-size:13px;margin-bottom:6px">💰 Dinheiro entrando por mês <span class="t-mut" style="font-weight:500">— desde o marco zero${desde?" ("+esc(fmtDataBR(desde))+")":""}</span></div>
      <table style="width:100%;border-collapse:collapse;font-size:12.5px"><thead><tr style="color:var(--mut);font-size:11px"><th style="text-align:left;padding:2px 8px">Mês</th><th style="text-align:right;padding:2px 8px">Exames</th><th style="text-align:right;padding:2px 8px">R$ no mês</th><th style="text-align:right;padding:2px 8px">Acumulado</th></tr></thead><tbody>${rows}</tbody></table>
      <div style="text-align:right;font-weight:800;color:#00E5A0;margin-top:6px">Total recuperado: ${fmtBRL(acc)}</div>
      <div class="t-mut" style="font-size:10.5px;margin-top:3px">🔒 Só a diretoria vê R$. A equipe vê exames/PET — não o dinheiro. É essa informação que você usa pra estimular o time (“olha o que a gente estava perdendo”).</div></div>`;
  }
  const render=()=>{
    let groups=[];
    if(EX_VIEW==="dia"){ const by={}; rec.forEach(e=>{ (by[e.d]=by[e.d]||[]).push(e); }); groups=Object.keys(by).sort().reverse().map(k=>({label:fmtDataBR(k), items:by[k]})); }
    else if(EX_VIEW==="sem"){ const by={}; rec.forEach(e=>{ const w=weekKey(e.d); (by[w.key]=by[w.key]||{lab:w.lab,items:[]}); by[w.key].items.push(e); }); groups=Object.keys(by).sort().reverse().map(k=>({label:by[k].lab, items:by[k].items})); }
    else { const by={}; rec.forEach(e=>{ const mk=(e.d||"").slice(0,7); (by[mk]=by[mk]||[]).push(e); }); groups=Object.keys(by).sort().reverse().map(k=>({label:mesLabel(k), items:by[k]})); }
    const corpo=groups.map(g=>{
      const gc={}; g.items.forEach(e=>{ const k=e.cat||"?"; gc[k]=(gc[k]||0)+1; });
      const catline=Object.entries(gc).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${esc(k)} <b>${v}</b>`).join(" · ");
      let linhas;
      if(EX_VIEW==="dia"){
        linhas=g.items.map(e=>`<div style="display:flex;gap:8px;padding:6px 8px;border-top:1px solid rgba(255,255,255,.05);font-size:12.5px;align-items:baseline">
          <span style="flex:1;min-width:0"><b>${esc(e.ex||"—")}</b> <span class="t-mut" style="font-size:11px">${esc(e.cat||"")}</span></span>
          <span style="color:#9fe6ff;white-space:nowrap">🐾 ${esc(e.pet||"—")}</span>
          ${e.tut?`<span class="t-mut" style="font-size:11px;white-space:nowrap">tutor ${esc(e.tut)}</span>`:""}
          ${e.req?`<span class="t-mut" style="font-size:11px;white-space:nowrap">reg ${esc(e.req)}</span>`:""}
        </div>`).join("");
      } else {
        const gp=[...new Set(g.items.map(e=>e.pet).filter(Boolean))];
        linhas=`<div style="padding:6px 8px;border-top:1px solid rgba(255,255,255,.05);font-size:12px">${catline}<div class="t-mut" style="margin-top:3px">🐾 ${gp.length} pets: ${gp.slice(0,14).map(esc).join(", ")}${gp.length>14?"…":""}</div></div>`;
      }
      return `<div style="background:rgba(0,212,255,.05);border:1px solid rgba(0,212,255,.15);border-radius:8px;margin-bottom:8px;overflow:hidden">
        <div style="padding:7px 9px;background:rgba(0,212,255,.1);font-weight:700;font-size:12.5px;display:flex;justify-content:space-between">
          <span>${esc(g.label)}</span><span style="color:#00D4FF">${g.items.length} exames</span></div>${linhas}</div>`;
    }).join("");
    const seg=(k,l)=>`<button class="opt${EX_VIEW===k?" on":""}" data-exv="${k}" type="button">${l}</button>`;
    const zero = !rec.length;
    document.getElementById("modalBody").innerHTML=`
      <div class="m-head"><div><div class="m-cli">🔬 ${esc(nome||"Clínica")}</div>
        <div class="t-mut" style="font-size:12.5px;margin-top:2px">exames lançados no HF · cod <b>${esc(cod)}</b>${desde?` · desde ${esc(fmtDataBR(desde))}`:""}</div></div>
        <button class="m-x" id="mClose">✕</button></div>
      ${moneyHTML}
      ${zero?`<div class="proxhint" style="border-color:rgba(255,45,85,.5);color:#ff8fa3;line-height:1.5">
          ⚠️ <b>0 exames</b> neste código (${esc(cod)})${desde?` desde ${esc(fmtDataBR(desde))}`:""}.<br>
          Conferi no HF por todos os ângulos (requisição por data de entrada + exames com data futura/nula): <b>nada foi lançado neste cadastro</b>.<br>
          Se a comissão já saiu, provavelmente é: (1) comissão de <b>reconquista</b> (paga na volta, antes do volume) — normal; ou (2) os exames entram em <b>outro cadastro/código</b> no HF; ou (3) ainda não digitaram.
          ${(function(){ const sim=(typeof matchClinicas==="function"?matchClinicas(nome||""):[]).filter(m=>String(m.cod)!==cod&&(m.prod||0)>0).slice(0,6); return sim.length?`<div style="margin-top:8px;color:#9fe6ff;font-size:12px">🔎 Cadastros parecidos <b>com produção</b> (possível código certo):</div>${sim.map(m=>`<div style="font-size:12px;margin-top:2px">• <b>${esc(m.nome)}</b>${m.cidade?" · "+esc(m.cidade):""} · cod <b>${esc(m.cod)}</b> · 📊 ${m.prod||0}</div>`).join("")}<div class="t-mut" style="font-size:11px;margin-top:6px">Se for a mesma clínica, edite e vincule a esse código — ou me avise que eu somo os dois como código-extra.</div>`:`<br><span class="t-mut">👉 confira no HF pelo nome e me passa o código certo que eu revinculo.</span>`; })()}</div>`:`
        <div class="proxhint" style="border-color:rgba(0,229,160,.4);color:#7effcf;line-height:1.5">
          📊 <b>${rec.length}</b> exames · 🐾 <b>${petsTot}</b> pets${desde?` · desde ${esc(fmtDataBR(desde))}`:""}${mais?` <span class="t-mut">(mostrando os ${rec.length} mais recentes)</span>`:""}<br>
          <span style="font-size:11.5px">${catsResumo.map(([k,v])=>`${esc(k)} <b>${v}</b>`).join(" · ")}</span></div>
        <div class="m-opts" style="margin:10px 0 6px">${seg("dia","📅 Dia")}${seg("sem","🗓️ Semana")}${seg("mes","📆 Mês")}</div>
        <div class="t-mut" style="font-size:11px;margin-bottom:8px">Use o <b>reg</b> pra achar a requisição no HF.</div>
        <div style="max-height:56vh;overflow:auto">${corpo}</div>`}`;
    document.getElementById("mClose").onclick=closeModal;
    document.querySelectorAll("#modalBody [data-exv]").forEach(b=>b.onclick=()=>{ EX_VIEW=b.dataset.exv; render(); });
  };
  EX_VIEW="dia"; render();
  document.getElementById("modal").style.display="flex";
}
function closeModal(){ document.getElementById("modal").style.display="none"; }
async function submitReg(){
  const por=quem(); if(por===null) return;
  const nota=document.getElementById("mNota").value.trim(), next=document.getElementById("mNext").value;
  const satMot=(M_SAT!=null&&M_SAT<8)?(document.getElementById("mSatMotivo").value||"").trim():"";
  const cli=findClient(M_COD)||{}, btn=document.getElementById("mSave");
  btn.disabled=true; btn.textContent="Salvando…";
  try{
    const r=await fetch(INTER_API,{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({acao:"add",cod:M_COD,cliente:cli.nome||"",por,canal:M_CANAL,resultado:M_RES,
        motivo:M_RES==="negativo"?M_MOTIVO:"",nota,proximo_passo:next,nota_satisfacao:M_SAT,nota_motivo:satMot,snapshot:snapOf(M_COD),senha:window.__pwd})});
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
function dueCount(){ return [...new Set(INTER.map(x=>String(x.cod)))].filter(cod=>!ENCERR.has(cod)&&(()=>{const r=retorno(cod);return r&&(r.status==="hoje"||r.status==="atrasado");})()).length; }

/* ---- BI: estatísticas + gráficos ---- */
function biStats(){
  const D=DATA||{};
  const paradosSet=new Set(act(D.parados||[]).map(x=>String(x.cod)));
  const quedaSet=new Set(act([...(D.em_queda||[]),...(D.queda_forte||[])]).map(x=>String(x.cod)));
  const wk=Date.now()-7*864e5, mo=Date.now()-30*864e5;
  const byRes={}; Object.keys(RESULT).forEach(k=>byRes[k]=0);
  INTER.forEach(x=>{ if(byRes[x.resultado]!=null) byRes[x.resultado]++; });
  const porPessoa={}; INTER.forEach(x=>{const p=x.por||"equipe"; (porPessoa[p]=porPessoa[p]||{n:0,pos:0}); porPessoa[p].n++; if(x.resultado==="positivo")porPessoa[p].pos++;});
  const contatados=new Set(INTER.map(x=>String(x.cod)));
  // REATIVADO = estava PARADO (sem enviar) em algum contato e HOJE não está mais parado nem em queda = voltou a enviar
  const reativadosList=[];
  contatados.forEach(cod=>{ const eraParado=interOf(cod).some(h=>(h.snapshot||{}).situacao==="parado");
    if(eraParado && !paradosSet.has(cod) && !quedaSet.has(cod)){ reativadosList.push(interOf(cod).map(i=>i.cliente).find(Boolean)||("#"+cod)); } });
  const motivos={}; INTER.filter(x=>x.resultado==="negativo"&&x.motivo).forEach(x=>{motivos[x.motivo]=(motivos[x.motivo]||0)+1;});
  const weeks=[]; for(let i=7;i>=0;i--){const end=Date.now()-i*7*864e5,start=end-7*864e5; weeks.push({lbl:i===0?"agora":`-${i}s`,c:INTER.filter(x=>x.ts>=start&&x.ts<end).length});}
  const total=INTER.length, topP=Object.entries(porPessoa).sort((a,b)=>b[1].n-a[1].n)[0];
  const notas=INTER.filter(x=>x.nota_satisfacao!=null).map(x=>x.nota_satisfacao);
  const satMedia=notas.length?notas.reduce((a,b)=>a+b,0)/notas.length:null;
  return {total,sem:INTER.filter(x=>x.ts>=wk).length,mes:INTER.filter(x=>x.ts>=mo).length,byRes,porPessoa,
    reativados:reativadosList.length, reativadosList, motivos,weeks,contatados:contatados.size,pctPos:total?Math.round(100*byRes.positivo/total):0,
    topPessoa:topP?topP[0]:"—",alvos:act(D.parados||[]).length+act(D.em_queda||[]).length, satMedia, satN:notas.length};
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
/* % por classificação (motivo) — reutilizado em Inativos, Encerrados e Histórico */
function motCount(items){ const m={}; (items||[]).forEach(e=>{const k=e.motivo||"Outro"; m[k]=(m[k]||0)+1;}); return Object.entries(m).sort((a,b)=>b[1]-a[1]); }
function motBars(motArr, total, color){
  if(!total) return `<div class="t-mut" style="font-size:13px;padding:6px 0">Sem registros ainda.</div>`;
  return motArr.map(([m,n])=>{const p=Math.round(100*n/total);
    return `<div class="inatrow"><div class="inatlbl">${esc(m)}</div><div class="inatbar"><div style="width:${Math.max(4,p)}%;background:${color}"></div></div><div class="inatpct" style="color:${color}">${p}% <span class="t-mut">(${n})</span></div></div>`;}).join("");
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
let diaFilter = false;   // #2: filtro "contatos do dia" (retorno hoje/atrasado)
function dueOnly(arr){ return (arr||[]).filter(x=>{const rt=retorno(x.cod); return rt&&(rt.status==="hoje"||rt.status==="atrasado");}); }
function renderTab(){
  const D = DATA, r = D.resumo || {}, c = document.getElementById("content");
  const cnt = k => act(D[k]||[]).length;                 // contagem JÁ sem encerrados (#1)
  const flt = a => diaFilter ? dueOnly(a) : a;            // filtro contatos do dia (#2)
  const ativos = (D.carteira ? act(D.carteira).length : (r.ativos || r.carteira || 0));

  if(ACTIVE==="reativar"){
    const FOCO=new Set(["queda_forte","queda"]);                         // foco DIÁRIO = ativos caindo
    const foco = act(D.reativar||[]).filter(x=>FOCO.has(x.motivo||""));
    const arr = bumpDue(flt(foco));
    const calm = arr.length===0; const dc = dueCount();
    const riscoPct = ativos ? 100*foco.length/ativos : 0;
    const nPar = cnt('parados'), nNovos = cnt('novos_esfriando');
    const rc={}; foco.forEach(x=>{const m=x.motivo; if(m)rc[m]=(rc[m]||0)+1;});
    const RLBL=[["queda_forte","🔻","Queda forte","caiu 40%+ — ainda compra, janela aberta"],["queda","▼","Em queda","caiu 10%+ — pegar cedo, esforço baixo"]];
    const comp=RLBL.map(([k,ic,lb,desc])=>`<div class="leg-row"><span class="leg-dot" style="background:${MOTCOL[k]||'#888'}"></span><b>${ic} ${esc(lb)}</b><span class="leg-n" style="color:${MOTCOL[k]||'#fff'}">${rc[k]||0}</span><span class="t-mut">— ${esc(desc)}</span></div>`).join("");
    c.innerHTML = `
      <div class="radar ${calm?"calm":""}">
        <div class="ico">${calm?"✅":"🎯"}</div>
        <div><div class="big">${arr.length}</div></div>
        <div style="flex:1">
          <div class="lbl">${calm?(diaFilter?"Nenhum contato agendado para hoje":"Tudo sob controle — nada caindo agora"):(diaFilter?"CONTATOS DO DIA — ligar hoje":"REATIVAR (foco diário) — clientes ATIVOS caindo")}</div>
          <div class="sub">${rc.queda_forte||0} queda forte · ${rc.queda||0} em queda · ${Math.round(riscoPct)}% em risco${dc?` · <b style="color:#fff">↻ ${dc} retorno(s) p/ hoje</b>`:""}</div>
          <div class="sub" style="margin-top:5px;font-weight:700;color:#ffd9a0">📊 ${foco.length} em risco (queda forte + em queda) · ⛔ ${nPar} parados (à parte) · 🌱 ${nNovos} novos (Onboarding) · 🔒 ${ENCERR.size+INAT.size} já fora · base ${brData((D.meta||{}).max_data)}</div>
        </div>
        ${ring(riscoPct, "#FF8A00", "em risco")}
      </div>
      <div class="card" style="margin-bottom:14px">
        <h3>📋 Legenda — foco diário <span class="tag">${foco.length} clientes · queda forte + em queda</span></h3>
        <div class="legenda">${comp}</div>
        <div class="t-mut" style="font-size:12px;margin-top:10px;line-height:1.5">A fila diária é só de quem <b>ainda compra e está caindo</b> (maior retorno). <b>🆘 Parados</b> e <b>🌱 Novos esfriando</b> têm abas próprias (resgate em campanha / onboarding) pra não dispersar a energia. Encerrados/inativos fora.</div>
      </div>
      <div class="kgrid">
        ${kpi("r", rc.queda_forte||0, "Queda forte", "40%+ abaixo — urgente")}
        ${kpi("a", rc.queda||0, "Em queda", "10%+ abaixo — preventivo")}
        ${kpi("", nPar, "⛔ Parados", "aba própria — fora do somatório")}
        ${kpi("", nNovos, "🌱 Novos esfriando", "aba Onboarding — nutrir")}
      </div>
      <div class="seclabel">${diaFilter?"📞 Contatos do dia — retorno agendado p/ hoje":"🎯 Fila diária — queda forte + em queda (priorizada)"}</div>
      ${list(arr, {acao:true, rank:true, fu:true})}`;
    return;
  }

  if(ACTIVE==="em_queda"){
    const arr = flt(act(D.em_queda||[]));
    c.innerHTML = `
      <div class="hero">${ring(ativos? 100*cnt('em_queda')/ativos:0, "#FF5470", "em queda")}
        <div class="kgrid" style="margin:0">
          ${kpi("r", arr.length, "Clientes em queda", "10%+ abaixo do normal")}
          ${kpi("a", cnt('queda_forte'), "Quedas fortes", "40%+ abaixo do normal")}
          ${kpi("", ativos, "Carteira ativa", "clientes com envio recente")}
        </div></div>
      <div class="seclabel">▼ Em queda — acompanhar de perto</div>
      ${list(arr, {badge:"motivo", rank:true, fu:true})}`;
    return;
  }

  if(ACTIVE==="parados"){
    const arr = bumpDue(flt(act(D.parados||[])));
    c.innerHTML = `
      <div class="hero">${ring(ativos? 100*arr.length/ativos:0, "#FF5470", "parados")}
        <div class="kgrid" style="margin:0">
          ${kpi("r", arr.length, "Clientes parados", "21+ dias sem enviar")}
          ${kpi("a", (arr[0]&&arr[0].dias_inativo)||0, "Mais antigo", "dias sem enviar")}
          ${kpi("", ativos, "Carteira ativa", "")}
        </div></div>
      <div class="seclabel">⛔ Parados — priorizar contato (recência primeiro) <span class="t-mut" style="font-weight:500">· fora dos somatórios gerais (lista à parte)</span>${INAT.size?` <span class="t-mut" style="font-weight:500">· 🚫 ${INAT.size} inativo(s) fora da conta</span>`:""}</div>
      ${list(arr, {badge:"motivo", rank:true, fu:true})}`;
    return;
  }

  if(ACTIVE==="novos_esfriando"){
    const esf = flt(act(D.novos_esfriando||[])), ok = flt(act(D.novos||[]));
    c.innerHTML = `
      <div class="kgrid">
        ${kpi("a", esf.length, "Novos esfriando", "pararam após início")}
        ${kpi("g", ok.length, "Novos aquecendo", "engajando bem")}
      </div>
      <div class="seclabel">🌱 Onboarding — novos que esfriaram. <b>Nutrir/engajar</b> (não é resgate — cliente recém-chegado, vale o esforço)</div>
      ${list(esf, {badge:"motivo", rank:true, fu:true})}
      <div class="seclabel">✅ Novos aquecendo — manter o ritmo</div>
      ${list(ok, {rank:false, fu:true})}`;
    return;
  }

  if(ACTIVE==="em_alta"){
    const arr = flt(act(D.em_alta||[]));
    c.innerHTML = `
      <div class="hero">${ring(ativos? 100*cnt('em_alta')/ativos:0, "#4D9DFF", "em alta")}
        <div class="kgrid" style="margin:0">
          ${kpi("", arr.length, "Clientes em alta", "10%+ acima do normal")}
          ${kpi("g", ativos, "Carteira ativa", "")}
        </div></div>
      <div class="seclabel">▲ Em alta — fortalecer + <b style="color:var(--cyan)">pesquisa de satisfação</b> (no 📞 Registrar)</div>
      ${list(arr, {badge:"motivo", rank:true, fu:true})}`;
    return;
  }

  if(ACTIVE==="resultados"){
    const s=biStats();
    c.innerHTML = `
      <div class="kgrid">
        ${kpi("", s.sem, "Contatos na semana", `${s.mes} no mês · ${s.total} no total`)}
        ${kpi("g", s.pctPos+"%", "Taxa de sucesso", "contatos com resultado positivo")}
        ${kpi("g", s.reativados, "Clientes reativados", "estavam parados e voltaram a enviar")}
        ${kpi("a", s.topPessoa, "Mais ativo", "colaborador com mais contatos")}
        ${s.satN?kpi("", s.satMedia.toFixed(1)+"/10", "Satisfação média", `${s.satN} resposta(s) · Em Alta`):""}
      </div>
      <div class="card" style="margin-bottom:14px;border-color:rgba(0,229,160,.3)">
        <h3>✅ Clientes reativados <span class="tag">parados que voltaram a enviar</span></h3>
        ${s.reativadosList.length
          ? `<div style="font-size:14px;color:var(--green);font-weight:700">${s.reativadosList.map(esc).join(" · ")}</div>`
          : `<div class="t-mut" style="font-size:13px;line-height:1.5">Nenhum ainda. Conta <b>só quem estava PARADO</b> (sem enviar) e voltou — não conta quedas que se recuperaram sozinhas. O rastreio semana a semana fica na aba <b>📅 Histórico</b> (“Saíram do radar”).</div>`}
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
    const {weeks, diff}=histByWeek();
    if(!weeks.length){ c.innerHTML=`<div class="empty" style="margin-top:18px">📅 O catálogo está começando. O robô grava uma <b>foto por semana</b> do radar e cada <b>contato registrado</b> entra aqui — permanente, em ordem crescente por mês e semana.</div>`; return; }
    const lastSnap=HIST.length?HIST[HIST.length-1]:null;
    const lastD=HIST.length>=2?diff[lastSnap.week]:{entraram:[],sairam:[]};
    let body="", curM=null;
    weeks.forEach(wo=>{ const md=isoMonday(wo.week), mk=md.getUTCFullYear()*100+(md.getUTCMonth()+1);
      if(mk!==curM){ curM=mk; const cnt=weeks.filter(w2=>{const m2=isoMonday(w2.week);return m2.getUTCFullYear()*100+(m2.getUTCMonth()+1)===mk;}).reduce((a,w2)=>a+w2.contatos.length,0);
        body+=`<div class="monthhead">${MESF[md.getUTCMonth()+1]} ${md.getUTCFullYear()}${cnt?` <span>· ${cnt} contato${cnt>1?'s':''}</span>`:''}</div>`; }
      body+=weekBlock(wo, diff[wo.week]);
    });
    c.innerHTML=`
      <div class="kgrid">
        ${kpi("", weeks.length, "Semanas no catálogo", "radar + contatos")}
        ${kpi("g", INTER.length, "Contatos registrados", "permanente, não expira")}
        ${kpi("r", lastSnap?(lastSnap.flagged||[]).length:0, "No radar agora", lastSnap?`semana ${esc(lastSnap.week)}`:"—")}
        ${kpi("a", (lastD.entraram||[]).length, "Entraram (últ. semana)", "novos alertas")}
      </div>
      <div class="bigrid">
        <div class="card" style="border-color:rgba(255,84,112,.3)"><h3>🔒 % de encerramento por classificação <span class="tag">espelho da aba Encerrados</span></h3>${motBars(motCount([...ENCERR.values()]), ENCERR.size, "#FF5470")}</div>
        <div class="card" style="border-color:rgba(255,138,0,.3)"><h3>🚫 % de inativação por classificação <span class="tag">espelho da aba Inativos</span></h3>${motBars(motCount([...INAT.values()]), INAT.size, "#FF8A00")}</div>
      </div>
      <div class="tabsbar" style="margin:16px 0 8px">
        <div class="seclabel" style="margin:0">📅 Catálogo completo · ordem crescente · por mês e semana</div>
        <div style="display:flex;gap:8px"><button class="regbtn" id="histCSV">⬇ CSV</button><button class="regbtn" id="histPDF">🖨 PDF</button></div>
      </div>
      ${body}`;
    const ec=document.getElementById("histCSV"); if(ec) ec.onclick=exportHistCSV;
    const ep=document.getElementById("histPDF"); if(ep) ep.onclick=()=>window.print();
    return;
  }

  if(ACTIVE==="clinicas"){
    // diretoria com o código na sessão: decifra o R$ sozinho e re-renderiza
    if(ehDiretoria() && !CLIN_RS && CLIN_RS_ENV && dirCodeCache()){ decDirRS(dirCodeCache()).then(ok=>{ if(ok&&ACTIVE==="clinicas") renderTab(); }); }
    const nov=CARTEIRA.filter(x=>x.tipo==="nova"), rec=CARTEIRA.filter(x=>x.tipo==="reconquistada"), divm=CARTEIRA.filter(x=>x.tipo==="divide"), part=CARTEIRA.filter(x=>x.tipo==="particular");
    const aaaA=AAA.filter(a=>a.curva==="A"||!a.curva), aaaB=AAA.filter(a=>a.curva==="B"), aaaC=AAA.filter(a=>a.curva==="C"), aaaD=AAA.filter(a=>a.curva==="D");   // curvas por faturamento 12m
    const lista=(clinView==="nova"?nov:clinView==="divide"?divm:clinView==="particular"?part:rec);
    const q=search.trim().toLowerCase();
    const arr=q?lista.filter(x=>((x.nome||"")+" "+(x.cidade||"")).toLowerCase().includes(q)):lista;
    const semVinc=CARTEIRA.filter(x=>!x.cod).length;
    const porteLbl={G:"🐘 Grande",M:"🐎 Médio",P:"🐇 Pequeno"};
    // R$ total da carteira (só diretoria com R$ aberto)
    const rsTotal=(ehDiretoria()&&CLIN_RS)?lista.reduce((s,x)=>{ const v=rsVal(x.cod, x.reconq_data); return s+(v!=null?v:0); },0):null;   // desde a data de corte de cada clínica
    const card=x=>{ const m=clinByCod(x.cod), det=x.cod?CLIN_DET[String(x.cod)]:null;
      const prod=(det&&det.prod12!=null)?det.prod12:(m?m.prod:null), vinc=!!x.cod&&(!!m||(det&&det.prod12!=null));   // prod12 = soma dos códigos-extra
      const prodDesde=(det&&det.prod_desde!=null)?det.prod_desde:null, temMarco=!!x.reconq_data;
      const concentrada=!!(det && CLIN_SETORES.length>=3 && det.cats.length<=1 && (det.falta||[]).length>=2);
      const flag=(x.porte==="G"&&prod!=null&&prod<PORTE_PROD_BAIXA)||concentrada;
      const falta=det?(det.falta||[]):[];
      const nClasses=det?((det.cats||[]).length+falta.length):0;
      const rsvDir=ehDiretoria()?rsVal(x.cod, x.reconq_data):null;
      // 🎯 DEIXANDO NA MESA — bloco de alerta que grita o que ela NÃO te manda (share-of-wallet)
      const mesaBox = (vinc && falta.length && (det.cats||[]).length) ? `
        <div style="margin-top:7px;background:linear-gradient(90deg,rgba(255,45,85,.17),rgba(255,45,85,.05));border:1px solid rgba(255,45,85,.5);border-radius:9px;padding:9px 11px">
          <div style="font-size:12px;font-weight:800;color:#ff6b81;letter-spacing:.4px;text-transform:uppercase">🎯 Deixando na mesa · ${falta.length} classe${falta.length>1?"s":""} que ela NÃO te manda</div>
          <div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:5px">
            ${falta.slice(0,8).map(f=>`<span style="background:rgba(255,45,85,.22);color:#ffc9d2;border:1px solid rgba(255,45,85,.45);border-radius:20px;padding:2px 10px;font-size:11.5px;font-weight:700">${esc(f)}</span>`).join("")}
            ${falta.length>8?`<span style="color:#ff8fa3;font-size:11.5px;align-self:center;font-weight:700">+${falta.length-8}</span>`:""}
          </div>
          <div style="font-size:11.5px;color:#ffb3c0;margin-top:7px;font-weight:600">⚠️ Isso vai pro concorrente. ${rsvDir!=null?`Ela já te rende <b style="color:#7effcf">${fmtBRL(rsvDir)}</b> mandando só <b>${(det.cats||[]).length} de ${nClasses}</b> classes — imagina com o resto. <b style="color:#ff6b81">Puxa.</b>`:`<b style="color:#ff6b81">Puxa essas classes.</b>`}</div>
        </div>` : "";
      // ✅ SHARE-OF-WALLET CHEIO — bloco verde pulsante (igual às A/B), quando ela manda TODAS as classes
      const cheioBox = (vinc && det && !falta.length && (det.cats||[]).length && !(x.porte==="G"&&prod!=null&&prod<PORTE_PROD_BAIXA)) ? `
        <div class="swcheio" style="margin-top:7px;border:1px solid rgba(0,229,160,.5);border-left:3px solid #00E5A0;border-radius:9px;padding:9px 11px">
          <div style="font-size:12px;font-weight:800;color:#00E5A0;letter-spacing:.4px;text-transform:uppercase">✅ Share-of-wallet CHEIO · manda TODAS as classes 👏</div>
          <div style="font-size:11.5px;color:#7effcf;margin-top:6px;font-weight:600">🛡️ cliente redondo — nada indo pro concorrente. Proteja essa: é o modelo do que as outras deveriam mandar.</div>
        </div>` : "";
      // 🎉 CONQUISTA DE CATEGORIA — o que ela NÃO mandava e começou a mandar depois do marco (prova do trabalho)
      const conq = (det && det.conq) ? det.conq : [];
      const conqBox = conq.length ? `
        <div style="margin-top:7px;background:linear-gradient(90deg,rgba(0,229,160,.18),rgba(0,212,255,.07));border:1px solid rgba(0,229,160,.55);border-left:3px solid #00E5A0;border-radius:9px;padding:9px 11px">
          <div style="font-size:12px;font-weight:800;color:#00E5A0;letter-spacing:.4px;text-transform:uppercase">🎉 Conquistou ${conq.length} categoria${conq.length>1?"s":""} desde o marco</div>
          ${conq.slice(0,6).map(z=>{ const rs=(ehDiretoria()&&CLIN_CONQFAT&&CLIN_CONQFAT[String(x.cod)])?CLIN_CONQFAT[String(x.cod)][z.setor]:null;
            return `<div style="font-size:11.5px;color:#7effcf;margin-top:5px">✅ <b>${esc(z.setor)}</b> — desde <b>${esc(fmtDataBR(z.desde))}</b> · ${z.n} exame${z.n>1?"s":""}${rs!=null?` · <b style="color:#7effcf">${fmtBRL(rs)}</b>`:""}</div>`; }).join("")}
          <div style="font-size:11px;color:#9fe6ff;margin-top:6px">📈 categoria que ela <b>não mandava</b> e você fez começar — receita nova de verdade.</div>
        </div>` : "";
      // 🧠 interpretação do agente (só o caso porte-grande-volume-baixo; os demais recados vão nos blocos)
      let interp="";
      if(!falta.length && x.porte==="G" && prod!=null && prod<PORTE_PROD_BAIXA) interp=`🧠 ${det?"Manda todas as classes, MAS ":""}o volume é baixo pra um <b>porte grande</b> — potencial bem maior; provavelmente divide a QUANTIDADE com outro lab. Trabalhar.`;
      const detLinha=det?`<div class="ci" style="font-size:11.5px;margin-top:2px">📆 recente: <b>${det.prod30||0}</b> em 30d · ${det.prod7||0} em 7d${det.cats&&det.cats.length?` · <span style="color:#7effcf">✅ manda: ${det.cats.slice(0,4).map(c=>esc(c.setor)+" ("+c.qtd+")").join(", ")}</span>`:""}</div>`:"";
      const c2=cerebro2(det);
      const c2Linha=c2?`<div class="ci" style="font-size:11.5px;margin-top:4px;color:${c2.cor};font-weight:${c2.status==="ok"?"500":"700"}">🧠² ${c2.msg}</div>`:"";
      const c2Alerta=!!(c2 && (c2.status==="parou"||c2.status==="caiu"));
      const prodTxt = (prodDesde!=null&&temMarco) ? `📊 desde a reconquista: <b>${prodDesde}</b> exames` : (prod!=null?`📊 produção (12m): <b>${prod}</b> exames`:'<span class="t-mut">produção: — (vincule ao HF)</span>');
      const mLbl={nova:"🆕 conquistada",reconquistada:"♻️ reconquistada",divide:"🔀 trabalhando",particular:"🐾 particular desde"}[x.tipo]||"♻️ reconquistada";
      const marcoLinha = temMarco ? `<div class="ci" style="font-size:11.5px;margin-top:2px;color:#7effcf">${mLbl} em <b>${esc(fmtDataBR(x.reconq_data))}</b> <span class="t-mut">(${x.tipo==="nova"?"data da conquista":"marco zero"})</span></div>` : `<div class="ci" style="font-size:11px;margin-top:2px;color:#ffc266">⚠️ sem data — edite e ponha a data do marco zero</div>`;
      const perdaLinha = x.motivo_perda ? `<div class="ci" style="font-size:11.5px;margin-top:1px;color:#ffb3c0">💔 perdeu antes: "${esc(x.motivo_perda)}"</div>` : "";
      const tIco={nova:["🆕","#00E5A0"],reconquistada:["♻️","#00D4FF"],divide:["🔀","#9fe6ff"],particular:["🐾","#7effcf"]}[x.tipo]||["♻️","#00D4FF"];
      return `<div class="crow" data-cart="${esc(x.id)}" style="cursor:pointer;align-items:flex-start${(flag||mesaBox||c2Alerta)?';border-left:3px solid #FF2D55':''}">
        <div class="rk" style="color:${tIco[1]}">${tIco[0]}</div>
        <div style="flex:1"><div class="nm">${esc(x.nome)} ${x.porte?`<span class="pr" style="background:rgba(0,212,255,.14);color:#9fe6ff">${porteLbl[x.porte]}</span>`:""} ${vinc?'<span class="t-mut" style="font-size:11px">🔗 HF</span>':'<span class="pr" style="background:rgba(255,138,0,.18);color:#ffc266;font-size:11px">⚠️ pendente de vínculo</span>'}</div>
          <div class="ci">${x.cidade?"📍 "+esc(x.cidade)+" · ":""}${prodTxt}${ehDiretoria()?` · 💰 ${rsClin(x.cod, x.reconq_data)}`:""}</div>
          ${marcoLinha}${perdaLinha}${detLinha}
          ${c2Linha}
          ${conqBox}${mesaBox}${cheioBox}
          ${x.obs?`<div class="lastint">"${esc(x.obs)}"</div>`:""}
          ${interp?`<div class="ci" style="font-size:11.5px;margin-top:3px;${flag?'color:#ff8fa3;font-weight:600':'color:#9fe6ff'}">${interp}</div>`:""}
          ${x.cod?`<button class="exbtn" data-exames="${esc(x.cod)}" data-exnome="${esc(x.nome)}" type="button" style="margin-top:6px;background:rgba(0,212,255,.12);border:1px solid rgba(0,212,255,.3);color:#9fe6ff;border-radius:6px;padding:5px 10px;font-size:12px;font-weight:600;cursor:pointer">🔬 Ver exames (dia · PET · registro)</button>`:""}
          <div class="ci t-mut" style="font-size:11px;margin-top:4px">👤 ${esc(x.por||"—")}</div></div>
        <div class="mid"></div></div>`; };
    const CL=CLINICAS.length;
    const gcAtivos=(GC_CLIN||[]).filter(x=>x.ativo!==false).length;
    const subtabsClin=`<div class="subtabs"><button class="subtab ${clinView==='guardachuva'?'on':''}" data-cv="guardachuva" style="${clinView==='guardachuva'?'':'border-color:rgba(255,176,32,.5);color:#ffc266'}">🌂 Histopatologia${gcAtivos?` (${gcAtivos})`:''}</button><button class="subtab ${clinView==='reconquistada'?'on':''}" data-cv="reconquistada">♻️ Reconquistadas${rec.length?` (${rec.length})`:''}</button><button class="subtab ${clinView==='nova'?'on':''}" data-cv="nova">🆕 Novas${nov.length?` (${nov.length})`:''}</button><button class="subtab ${clinView==='divide'?'on':''}" data-cv="divide">🔀 Dividem material${divm.length?` (${divm.length})`:''}</button><button class="subtab ${clinView==='particular'?'on':''}" data-cv="particular">🐾 Particulares${part.length?` (${part.length})`:''}</button><button class="subtab ${clinView==='aaa'?'on':''}" data-cv="aaa">⭐ Clínicas A${aaaA.length?` (${aaaA.length})`:''}</button><button class="subtab ${clinView==='aab'?'on':''}" data-cv="aab">🅱️ Clínicas B${aaaB.length?` (${aaaB.length})`:''}</button><button class="subtab ${clinView==='aac'?'on':''}" data-cv="aac">🇨 Clínicas C${aaaC.length?` (${aaaC.length})`:''}</button><button class="subtab ${clinView==='aad'?'on':''}" data-cv="aad">🇩 Clínicas D${aaaD.length?` (${aaaD.length})`:''}</button><button class="subtab ${clinView==='relatorios'?'on':''}" data-cv="relatorios">📈 Relatórios${RELATORIOS.length?` (${RELATORIOS.length})`:''}</button></div>`;
    if(clinView==="guardachuva"){
      if(GC_CLIN===null){ loadGC();
        c.innerHTML=`${subtabsClin}<div class="empty" style="margin-top:18px">🌂 Carregando o guarda-chuva…</div>`;
        document.querySelectorAll("#content [data-cv]").forEach(el=>el.onclick=()=>{ clinView=el.dataset.cv; search=""; renderTab(); });
        return; }
      const cls=(GC_CLIN||[]), ativos=cls.filter(x=>x.ativo!==false), est=(GC_EST||[]);
      const porCli={}; est.forEach(e=>{ (porCli[e.cliente]=porCli[e.cliente]||[]).push(e); });
      const comProf=est.filter(e=>gcComProf(e.etapas)).length;
      const estourou=est.filter(e=>gcComProf(e.etapas)&&gcDiasProf(e.etapas)>=GC_SLA_PROF).length;
      const dl=`<datalist id="gcHF">${(CLINICAS||[]).slice(0,4000).map(m=>`<option value="${esc(m.nome)}">`).join("")}</datalist>`;
      const estadoBtns=Object.keys(GC_ESTADOS).map(k=>`<button class="opt ${GC_ESTADO_ADD===k?'on':''}" data-gce="${k}" type="button">${GC_ESTADOS[k].ic} ${GC_ESTADOS[k].nm}</button>`).join("");
      const GC_CORTE=15;   // 15 dias úteis = corte (meta do laudo); passou disso = atraso
      const gcTotalDias=e=>gcDiasUteis(e.data_entrada, new Date());   // dias úteis desde a entrada (atualiza dia a dia)
      const exCard=e=>{ const at=gcEtapaAtual(e.etapas), st=GC_STAGES[Math.min(at,GC_STAGES.length)-1], prof=gcComProf(e.etapas), d=gcDiasProf(e.etapas), hot=prof&&d>=GC_SLA_PROF;
        const etLbl=st?`E${st.n} · ${st.nome}`:'—';
        const total=gcTotalDias(e), atraso=Math.max(0,total-GC_CORTE);
        const totCor = atraso>0 ? '#ff6b81' : (total>=GC_CORTE-2 ? '#ffc266' : '#7effcf');
        // IDENTIDADE dourada calma (no prazo, o caminho todo) × VERMELHO só quando atrasa de verdade (anti-fadiga)
        const bl = (atraso>0||hot) ? '#FF2D55' : (total>=GC_CORTE-2 ? '#FFB020' : '#ffc24d');
        return `<div class="crow" style="align-items:flex-start;cursor:default;border-left:3px solid ${bl}">
          <div class="rk">${atraso>0?'⚠️':(prof?'🎓':'🌂')}</div>
          <div style="flex:1">
            <div class="nm" style="font-size:14px">${esc(e.nome_paciente||'—')} <span class="t-mut" style="font-size:11px">${esc(e.numero_registro||('HF '+(e.numero_hf||'?')))}</span></div>
            <div class="ci" style="margin-top:2px"><b style="color:#9fe6ff">${etLbl}</b></div>
            <div class="ci" style="margin-top:3px;font-size:13px">⏱️ <b style="color:${totCor}">${total} dia(s) útil(eis)</b> <span class="t-mut">/ corte ${GC_CORTE}</span>${atraso>0?` · <b style="color:#ff6b81">+${atraso} de atraso · ⚠️ ATENÇÃO</b>`:(total>=GC_CORTE-2?' · <b style="color:#ffc266">perto do corte</b>':'')}</div>
            ${prof?`<div class="ci" style="font-size:12px;margin-top:2px">🎓 com o Prof há <b style="color:${hot?'#ff6b81':'#ffc266'}">${d} dia(s)</b> (limite ${GC_SLA_PROF})${hot?' · estourou':''}</div>`:''}
          </div><div class="mid"></div></div>`; };
      const cliBlocos=ativos.map(cl=>{ const g=GC_ESTADOS[cl.estado]||GC_ESTADOS.reconquista, exs=(porCli[cl.nome]||[]).slice().sort((a,b)=>gcTotalDias(b)-gcTotalDias(a));
        const estSel=`<select class="repsel" style="max-width:160px;padding:5px 8px;font-size:12px" data-gcest="${cl.id}">${Object.keys(GC_ESTADOS).map(k=>`<option value="${k}" ${cl.estado===k?'selected':''}>${GC_ESTADOS[k].ic} ${GC_ESTADOS[k].nm}</option>`).join("")}</select>`;
        return `<div style="border:1px solid var(--line);border-left:3px solid ${g.cor};border-radius:12px;padding:12px 14px;margin-bottom:10px">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><div class="nm" style="font-size:15px">${g.ic} ${esc(cl.nome)}</div>${estSel}<span class="t-mut" style="font-size:11px">${exs.length} exame(s) na esteira</span><button class="delfb" data-gcdel="${cl.id}" title="Tirar do guarda-chuva" style="margin-left:auto">✕</button></div>
          ${cl.motivo?`<div class="ci" style="margin-top:2px">${esc(cl.motivo)}</div>`:''}
          ${exs.length?exs.map(exCard).join(""):`<div class="t-mut" style="font-size:12px;margin-top:6px">Nenhum exame de histopat em andamento agora. 👍</div>`}
        </div>`; }).join("");
      // PLACAR — reforço positivo (snapshot da esteira: no prazo × precisa de atenção)
      const gcExHot=e=>{ const t=gcTotalDias(e); return t>GC_CORTE || (gcComProf(e.etapas)&&gcDiasProf(e.etapas)>=GC_SLA_PROF); };
      const gcAtraso=est.filter(gcExHot).length, gcOk=est.length-gcAtraso, gcPct=est.length?Math.round(gcOk/est.length*100):0;
      let gcMsg,gcCor; if(!est.length){ gcMsg='🌂 nada na esteira agora'; gcCor='var(--mut)'; }
        else if(gcPct>=90){ gcMsg='🎉 quase tudo no prazo!'; gcCor='#7effcf'; }
        else if(gcPct>=70){ gcMsg='👏 bom ritmo'; gcCor='#ffd27a'; }
        else { gcMsg='⚠️ dá pra melhorar'; gcCor='#ff8fa3'; }
      c.innerHTML=`${subtabsClin}
        <div class="proxhint" style="border-color:rgba(255,194,77,.45);color:#ffe2ab;margin-bottom:12px;line-height:1.55">🌂 <b>Guarda-Chuva Histopatologia</b> — clientes que acompanhamos de perto (o exame de maior retenção). Todo exame carrega o <b style="color:#ffc24d">tom dourado o caminho todo</b> (identidade calma) e só vira <b style="color:#ff6b81">vermelho quando atrasa de verdade</b> (passou do corte de ${GC_CORTE} dias úteis ou ${GC_SLA_PROF} dias com o Prof.).</div>
        <div class="kgrid">
          ${kpi("g", ativos.length, "Sob o guarda-chuva", "clínicas ativas")}
          ${kpi("", est.length, "Exames na esteira", "histopat em andamento")}
          ${kpi("", comProf, "Com o Prof. Luís", "")}
          ${kpi(gcAtraso?"a":"", gcAtraso, "⚠️ Precisam de atenção", "atraso / SLA")}
        </div>
        <div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap;margin-bottom:14px;padding:12px 18px;border-radius:12px;background:linear-gradient(90deg,rgba(0,229,160,.12),rgba(255,194,77,.06));border:1px solid rgba(0,229,160,.35)">
          <div><div style="font-size:30px;font-weight:900;color:#7effcf;line-height:1">${gcOk}/${est.length}</div><div class="t-mut" style="font-size:12px">🌂 no prazo na esteira</div></div>
          <div><div style="font-size:30px;font-weight:900;color:#ffd27a;line-height:1">${gcPct}%</div><div class="t-mut" style="font-size:12px">no prazo</div></div>
          <div><div style="font-size:30px;font-weight:900;color:#ff8fa3;line-height:1">${gcAtraso}</div><div class="t-mut" style="font-size:12px">precisam de atenção</div></div>
          <div style="margin-left:auto;font-weight:800;color:${gcCor}">${gcMsg}</div>
        </div>
        <div style="border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin-bottom:14px">
          <div class="m-lbl" style="margin:0 0 8px">➕ Pôr uma clínica sob o guarda-chuva</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <input class="wlsearch" id="gcNome" list="gcHF" placeholder="Clínica (digite; puxo do HF)" style="min-width:220px">${dl}
            <button class="checkinbtn" id="gcAddBtn" type="button" style="max-width:200px;margin:0">➕ Adicionar</button>
          </div>
          <div class="t-mut" style="font-size:11.5px;margin:8px 0 4px">Estado do cliente:</div>
          <div class="m-opts">${estadoBtns}</div>
        </div>
        ${ativos.length?cliBlocos:`<div class="empty">Nenhuma clínica sob o guarda-chuva ainda. Adicione uma acima.</div>`}`;
      document.querySelectorAll("#content [data-cv]").forEach(el=>el.onclick=()=>{ clinView=el.dataset.cv; search=""; renderTab(); });
      document.querySelectorAll("#content [data-gce]").forEach(el=>el.onclick=()=>{ GC_ESTADO_ADD=el.dataset.gce; renderTab(); });
      const gab=document.getElementById("gcAddBtn"); if(gab) gab.onclick=gcAdd;
      document.querySelectorAll("#content [data-gcdel]").forEach(el=>el.onclick=()=>gcRemove(el.dataset.gcdel));
      document.querySelectorAll("#content [data-gcest]").forEach(el=>el.onchange=()=>gcSetEstado(el.dataset.gcest, el.value));
      return;
    }
    if(clinView==="relatorios"){
      const pl={G:"🐘 Grande",M:"🐎 Médio",P:"🐇 Pequeno","":"—"};
      const semLabel=r=>{ if(r.label) return "Sexta "+esc(r.label); const m=String(r.semana||"").match(/(\d{4})-W(\d+)/); return m?`Semana ${m[2]}/${m[1]}`:esc(r.semana||"—"); };
      // ---- FATURAMENTO AO VIVO (sempre atual — não espera sexta) · só diretoria ----
      const vinc=CARTEIRA.filter(x=>x.cod);
      const dados=vinc.map(x=>{ const m=clinByCod(x.cod), det=CLIN_DET[String(x.cod)]||null, prod=(det&&det.prod12!=null)?det.prod12:(m?m.prod:null);
        const rsv=rsVal(x.cod, x.reconq_data);
        const prodBase=(det&&det.prod_desde!=null&&x.reconq_data)?det.prod_desde:prod;   // exames desde o marco p/ o ticket bater com o R$
        const tk=(rsv!=null&&prodBase)?rsv/prodBase:null; const falta=(det&&det.falta)||[];
        const zero=!!(det&&Array.isArray(det.recent)&&det.recent.length===0&&!det.prod30);
        const desdeMarco=!!(x.reconq_data && det && det.prod_desde!=null);
        return {x,prod,prodBase,rsv,tk,falta,zero,desdeMarco}; });
      // TUDO em função da DATA DE CORTE (reconquista/conquista): R$ e exames contam desde o marco de cada clínica
      const totRS=dados.reduce((s,d)=>s+(d.rsv||0),0), totEx=dados.reduce((s,d)=>s+(d.prodBase||0),0);
      const tkGeral=totEx?totRS/totEx:0;
      const semDataN=dados.filter(d=>d.rsv!=null && !d.desdeMarco).length;   // clínicas ainda sem data de corte (caem no 12m)
      const comRS=dados.filter(d=>d.rsv!=null).sort((a,b)=>b.rsv-a.rsv);
      const mediaRS=comRS.length?totRS/comRS.length:0;
      // regras de mercado (interpretação automática)
      const regras=[];
      if(comRS.length){ const top=comRS[0]; regras.push(`🥇 <b>${esc(top.x.nome)}</b> é a que mais fatura (${fmtBRL(top.rsv)} = ${totRS?Math.round(top.rsv/totRS*100):0}% da carteira). Proteja essa — ligue antes que o concorrente.`); }
      const dividindo=dados.filter(d=>d.x.porte==="G" && d.rsv!=null && d.rsv<mediaRS*0.6);
      if(dividindo.length) regras.push(`⚖️ <b>${dividindo.map(d=>esc(d.x.nome)).join(", ")}</b> — porte grande faturando abaixo da média: quase certo que <b>dividem exame</b> com outro lab. Cada +10% de share = R$ direto.`);
      const semWallet=dados.filter(d=>d.falta.length>=3 && d.rsv!=null);
      if(semWallet.length) regras.push(`🎯 <b>${semWallet.slice(0,3).map(d=>esc(d.x.nome)).join(", ")}</b> não te mandam classes inteiras de exame (${esc((semWallet[0].falta||[]).slice(0,3).join(", "))}…) — dinheiro que vai pro concorrente. Puxa essas classes.`);
      const zeradas=dados.filter(d=>d.zero);
      if(zeradas.length) regras.push(`🚨 <b>${zeradas.map(d=>esc(d.x.nome)).join(", ")}</b>: comissão paga mas <b>0 exames</b> no HF. Confere o vínculo/código — ou a reconquista não converteu.`);
      if(comRS.length) regras.push(`🎫 Ticket médio da carteira = <b>${fmtBRL(tkGeral)}/exame</b>. Acima da média = exames caros (histopato/especializado); abaixo = rotina. Subir ticket > subir volume.`);
      let painel="";
      if(!ehDiretoria()){
        painel="";   // reps NÃO veem nada de R$ — nem que existe
      } else if(!CLIN_RS){
        painel=`<div class="proxhint" style="border-color:rgba(0,229,160,.45);margin:8px 0 6px;text-align:center;line-height:1.55">
            <div style="font-size:13px;color:#c9d4e0">💰 Abra o <b>faturamento em R$</b> da carteira (cifrado — só você).</div>
            <button class="checkinbtn" id="verRSrel" type="button" style="margin:10px auto 2px;max-width:320px;border-color:rgba(0,229,160,.5);color:#7effcf;font-weight:700">🔓 Abrir faturamento (senha financeira)</button>
          </div>`;
      } else {
        const dataBadge=x=> x.reconq_data ? `<span style="color:#7effcf;font-weight:600">${x.tipo==="nova"?"🆕 conquistada":"♻️ reconquistada"} ${esc(fmtDataBR(x.reconq_data))}</span>` : `<span style="color:#ffc266;font-weight:600">${x.tipo==="nova"?"🆕 nova":"♻️ reconq."} · <span class="t-mut">sem data</span></span>`;
        // 🎯 SIMULAÇÃO "na mesa": potencial R$ das categorias que ela NÃO manda, extrapolando o mix de valor do lab (catval)
        const naMesa=(cod,rsv)=>{ if(rsv==null||!(rsv>0)) return null; const det=CLIN_DET[String(cod)]; if(!det||!(det.cats||[]).length) return null;
          const vs=s=>CLIN_CATVAL[s]||0, her=det.cats.reduce((a,c)=>a+vs(c.setor),0), miss=(det.falta||[]).reduce((a,s)=>a+vs(s),0);
          return (her>0&&miss>0)?rsv*(miss/her):null; };
        const TG={reconquistada:{ic:"♻️",cor:"#00D4FF",lbl:"Reconquistadas"},nova:{ic:"🆕",cor:"#00E5A0",lbl:"Novas"},divide:{ic:"🔀",cor:"#9fe6ff",lbl:"Dividem material"},particular:{ic:"🐾",cor:"#7effcf",lbl:"Particulares"}};
        const fatCard=(d,i)=>{ const nm=naMesa(d.x.cod,d.rsv), tg=TG[d.x.tipo]||TG.reconquistada;
          return `<div class="crow" style="cursor:default;align-items:flex-start${d.rsv<=0?';opacity:.72':''}">
            <div class="rk" style="color:${tg.cor};display:flex;flex-direction:column;align-items:center;line-height:1.1"><span style="font-weight:800;font-variant-numeric:tabular-nums">${i+1}</span><span style="font-size:12px">${tg.ic}</span></div>
            <div style="flex:1"><div class="nm">${esc(d.x.nome)} ${d.x.porte?`<span class="pr" style="background:rgba(0,212,255,.14);color:#9fe6ff">${pl[d.x.porte]}</span>`:""} ${c2mini(d.x.cod)}</div>
              <div class="ci" style="font-size:11.5px">${dataBadge(d.x)}</div>
              <div class="ci">💰 <b style="color:#7effcf">${fmtBRL(d.rsv)}</b>${d.desdeMarco?' <span class="t-mut" style="font-size:10px">desde a reconq.</span>':''} · 📊 ${d.prodBase||0} exames${d.desdeMarco?"":"/12m"} · 🎫 ${d.tk!=null?fmtBRL(d.tk):"—"}/exame${totRS?` · ${Math.round(d.rsv/totRS*100)}% da carteira`:""}</div>
              ${nm!=null?`<div class="ci" style="font-size:11.5px;color:#ff8fa3">🎯 na mesa (estimado): <b>${fmtBRL(nm)}</b> <span class="t-mut">— potencial das classes que ela NÃO te manda</span></div>`:""}</div>
            <div class="mid"></div></div>`; };
        const rows=["reconquistada","nova","divide","particular"].map(tp=>{ const g=comRS.filter(d=>d.x.tipo===tp); if(!g.length) return "";
          const tot=g.reduce((a,d)=>a+(d.rsv||0),0), mesa=g.reduce((a,d)=>a+(naMesa(d.x.cod,d.rsv)||0),0), tg=TG[tp];
          return `<div class="seclabel" style="margin:13px 0 4px;color:${tg.cor}">${tg.ic} ${tg.lbl} <span class="t-mut" style="font-weight:500;font-size:11px">(${g.length}) · fatura ${fmtBRL(tot)}${mesa>0?` · 🎯 na mesa ~${fmtBRL(mesa)}`:""}</span></div>${g.map((d,i)=>fatCard(d,i)).join("")}`;
        }).join("");
        const zerLinha=dados.filter(d=>d.rsv==null&&d.x.cod).map(d=>`<div class="ci t-mut" style="font-size:11.5px">• ${esc(d.x.nome)} — sem R$ (0 exames / pendente)</div>`).join("");
        // 💰 SAFRA — dinheiro mês a mês por clínica desde o marco zero (matriz consolidada, pedido do Wal)
        let cohortHtml="";
        if(CLIN_FATMES){
          // TODAS as clínicas com marco (dated) — inclui as ZERADAS (0 exames) com R$ 0; ordena por total desc; numera
          // DINHEIRO NOVO: reconq/nova = tudo (fatmes); DIVIDE = só a CONQUISTA (conqmes) — o baseline/histopato é dinheiro VELHO, não entra; e só aparece quando converter
          const cqm=c=>(CLIN_CONQMES&&CLIN_CONQMES[String(c)])||[];
          const fmRows=dados.filter(d=>{ if(!d.x.cod) return false;
              if(d.x.tipo==="divide") return cqm(d.x.cod).length>0;   // divide só entra na safra depois de converter
              return d.x.reconq_data || (CLIN_FATMES[String(d.x.cod)]||[]).length; })
            .map(d=>({nome:d.x.nome,tipo:d.x.tipo,arr:(d.x.tipo==="divide"?cqm(d.x.cod):(CLIN_FATMES[String(d.x.cod)]||[]))}));
          fmRows.forEach(r=>r.tot=r.arr.reduce((s,a)=>s+a.fat,0));
          fmRows.sort((a,b)=>b.tot-a.tot);
          const mset={}; fmRows.forEach(r=>r.arr.forEach(m=>mset[m.ym]=1)); const meses=Object.keys(mset).sort();
          if(fmRows.length&&meses.length){
            const mlab=ym=>{const p=ym.split("-");return['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'][(+p[1])-1]+"/"+p[0].slice(2);};
            const fatOf=(arr,ym)=>{const x=arr.find(a=>a.ym===ym);return x?x.fat:0;};
            const totCol={}; meses.forEach(ym=>totCol[ym]=0); let grand=0;
            const sc="position:sticky;left:0;background:#0b1a2b;z-index:1;text-align:left;padding:5px 8px;border-right:1px solid rgba(0,229,160,.25)";
            const th="padding:5px 8px;text-align:right;color:var(--mut);font-size:10.5px";
            const td="padding:5px 8px;text-align:right";
            const body=fmRows.map((r,i)=>{const tot=r.tot,zer=tot<=0;grand+=tot;meses.forEach(ym=>totCol[ym]+=fatOf(r.arr,ym));
              return `<tr style="border-top:1px solid rgba(255,255,255,.06)${zer?';opacity:.72':''}"><td style="${sc}"><span class="t-mut" style="font-variant-numeric:tabular-nums">${i+1}.</span> ${({nova:'🆕',reconquistada:'♻️',divide:'🔀',particular:'🐾'})[r.tipo]||'♻️'} ${esc(r.nome)}</td>${meses.map(ym=>{const v=fatOf(r.arr,ym);return `<td style="${td};color:${v?'#7effcf':'var(--mut)'}">${v?fmtBRL(v):'–'}</td>`;}).join("")}<td style="${td};font-weight:800;color:${zer?'#ffc266':'#00E5A0'}">${fmtBRL(tot)}</td></tr>`;}).join("");
            const foot=`<tr style="border-top:2px solid rgba(0,229,160,.4)"><td style="${sc};font-weight:800">TOTAL (${fmRows.length})</td>${meses.map(ym=>`<td style="${td};font-weight:800">${fmtBRL(totCol[ym])}</td>`).join("")}<td style="${td};font-weight:900;color:#00E5A0">${fmtBRL(grand)}</td></tr>`;
            cohortHtml=`<div class="seclabel" style="margin:14px 0 6px">💰 Dinheiro por mês <span class="t-mut" style="font-weight:500;font-size:11px">(safra — desde a entrada de cada clínica)</span></div>
              <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid rgba(0,229,160,.25);border-radius:8px">
                <table style="border-collapse:collapse;font-size:12px;white-space:nowrap;min-width:100%">
                  <thead><tr style="background:rgba(0,229,160,.08)"><th style="${sc};color:var(--mut);font-size:10.5px">Clínica</th>${meses.map(ym=>`<th style="${th}">${mlab(ym)}</th>`).join("")}<th style="${th};color:#7effcf">Total</th></tr></thead>
                  <tbody>${body}</tbody><tfoot>${foot}</tfoot></table></div>
              <div class="t-mut" style="font-size:11px;margin-top:5px;line-height:1.5">📈 Aqui só entra <b>DINHEIRO NOVO</b>: reconquistadas/novas contam tudo (o cliente voltou/entrou); as <b>🔀 dividem material</b> só entram <b>quando convertem</b> — e só com a <b>conquista</b> (categoria nova), porque o que já mandavam (ex.: histopato) é dinheiro <b>velho</b>, não recuperação. O <b>TOTAL</b> = o quanto a carteira realmente recuperou. Acompanhe velho×novo das que dividem na seção 🎉 Conquistas abaixo.</div>`;
          }
        }
        // 🎯 BI DA CONQUISTA — dinheiro NOVO (novos+reconquista+conversão de categoria) e % do faturamento TOTAL do lab
        const cqmSum=cod=>((CLIN_CONQMES&&CLIN_CONQMES[String(cod)])||[]).reduce((s,a)=>s+(a.fat||0),0);
        const CB={nova:{n:0,rs:0},reconquistada:{n:0,rs:0},divide:{n:0,rs:0}};
        dados.forEach(d=>{ const t=d.x.tipo;
          if(t==="nova"||t==="reconquistada"){ if(d.rsv>0){CB[t].n++;CB[t].rs+=d.rsv;} }
          else if(t==="divide"){ const cf=cqmSum(d.x.cod); if(cf>0){CB.divide.n++;CB.divide.rs+=cf;} } });
        const conqTot=CB.nova.rs+CB.reconquistada.rs+CB.divide.rs, conqN=CB.nova.n+CB.reconquistada.n+CB.divide.n;
        const labFat=LAB_FAT_DESDE||null, pctTot=labFat?conqTot/labFat*100:null;
        // 📅 CONQUISTA MÊS A MÊS — dinheiro novo por mês + % do faturamento DAQUELE mês (pedido do Wal: "ver o mensal, depois o total")
        const MES={};
        dados.forEach(d=>{ const t=d.x.tipo, cod=String(d.x.cod);
          if(t==="nova"||t==="reconquistada"){ ((CLIN_FATMES&&CLIN_FATMES[cod])||[]).forEach(m=>{ MES[m.ym]=(MES[m.ym]||0)+(m.fat||0); }); }
          else if(t==="divide"){ ((CLIN_CONQMES&&CLIN_CONQMES[cod])||[]).forEach(m=>{ MES[m.ym]=(MES[m.ym]||0)+(m.fat||0); }); } });
        const labMes=LAB_MES||{};
        const mesesBI=Array.from(new Set([...Object.keys(MES),...Object.keys(labMes)])).sort();
        const mlab2=ym=>{const p=ym.split("-");return ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'][(+p[1])-1]+"/"+p[0].slice(2);};
        const mesAtual=mesesBI[mesesBI.length-1];
        const cqAtual=MES[mesAtual]||0, lfAtual=labMes[mesAtual]||0, pctAtual=lfAtual?cqAtual/lfAtual*100:null;
        const insightMes=(mesAtual&&cqAtual>0)?`<div style="margin-top:10px;background:rgba(0,229,160,.09);border-left:3px solid #00E5A0;border-radius:8px;padding:9px 12px;font-size:12.5px;color:#c9f5e6;line-height:1.55">🏆 <b>Este mês (${mlab2(mesAtual)})</b>: já entraram <b style="color:#00E5A0">${fmtBRL(cqAtual)}</b> de dinheiro novo${pctAtual!=null?` = <b>${pctAtual.toFixed(1)}%</b> do faturamento do mês`:''} — <span class="t-mut">dinheiro que estava parado na mesa.</span></div>`:"";
        const mesRows=mesesBI.map(ym=>{ const cq=MES[ym]||0, lf=labMes[ym]||0, pct=lf?cq/lf*100:null, cur=ym===mesAtual;
          return `<tr style="border-top:1px solid rgba(255,255,255,.05)${cur?';background:rgba(0,229,160,.10)':''}">
             <td style="padding:5px 10px;text-align:left;font-weight:${cur?'800':'600'};color:${cur?'#00E5A0':'#c9d4e0'};white-space:nowrap">${mlab2(ym)}${cur?' <span style="font-size:9.5px;background:#00E5A0;color:#052b20;border-radius:4px;padding:1px 5px;font-weight:800">ESTE MÊS</span>':''}</td>
             <td style="padding:5px 10px;text-align:right;font-weight:700;color:#7effcf">${fmtBRL(cq)}</td>
             <td style="padding:5px 10px;text-align:right;font-weight:${cur?'800':'600'};color:${cur?'#00E5A0':'#9fe6ff'}">${pct!=null?pct.toFixed(1)+'%':'—'}</td></tr>`; }).join("");
        const mesTabela=mesesBI.length?`<div style="margin-top:11px;border:1px solid rgba(0,229,160,.22);border-radius:10px;overflow:hidden">
             <div style="background:rgba(0,229,160,.08);padding:6px 10px;font-size:11px;font-weight:800;color:#7effcf;text-transform:uppercase;letter-spacing:.3px">📅 Mês a mês — conquista × % do faturamento do mês</div>
             <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12.5px;min-width:280px">
               <thead><tr style="color:var(--mut);font-size:10.5px"><th style="padding:5px 10px;text-align:left">Mês</th><th style="padding:5px 10px;text-align:right">💰 Conquista</th><th style="padding:5px 10px;text-align:right">📊 % do mês</th></tr></thead>
               <tbody>${mesRows}</tbody></table></div></div>`:"";
        const frenteCard=(ic,lbl,cor,o)=>`<div style="flex:1;min-width:118px;border:1px solid ${cor}55;border-left:3px solid ${cor};border-radius:10px;padding:9px 11px">
            <div style="font-size:11px;color:${cor};font-weight:700">${ic} ${lbl}</div>
            <div style="font-size:17px;font-weight:800;color:#eaf3ff;margin-top:2px">${fmtBRL(o.rs)}</div>
            <div class="t-mut" style="font-size:10.5px">${o.n} cliente(s)${labFat?` · <b style="color:${cor}">${(o.rs/labFat*100).toFixed(1)}%</b> da fatura`:""}</div></div>`;
        const biConq=conqN?`<div style="border:1px solid rgba(0,229,160,.4);border-radius:14px;padding:14px 16px;margin:8px 0 12px;background:linear-gradient(180deg,rgba(0,229,160,.10),rgba(0,229,160,.02))">
            <div style="display:flex;align-items:baseline;justify-content:space-between;flex-wrap:wrap;gap:8px">
              <div style="font-size:12px;font-weight:800;color:#7effcf;text-transform:uppercase;letter-spacing:.4px">🎯 BI da Conquista${LAB_MARCO?` · desde ${esc(fmtDataBR(LAB_MARCO))}`:""}</div>
              <div class="t-mut" style="font-size:11px">${conqN} clientes · novos + reconquista + conversão de categoria</div>
            </div>
            <div style="display:flex;align-items:baseline;gap:14px;margin:9px 0 3px;flex-wrap:wrap">
              <div style="font-size:30px;font-weight:900;color:#00E5A0;line-height:1">${fmtBRL(conqTot)}</div>
              ${pctTot!=null?`<div style="font-size:20px;font-weight:800;color:#7effcf">= ${pctTot.toFixed(1)}% do faturamento</div>`:`<div class="t-mut" style="font-size:11.5px">(faturamento total do lab chega no próximo ciclo do robô)</div>`}
              ${labFat?`<div class="t-mut" style="font-size:11px">fatura total do lab: <b>${fmtBRL(labFat)}</b></div>`:""}
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:9px">
              ${frenteCard("🔀","Conversão de categoria","#9fe6ff",CB.divide)}
              ${frenteCard("♻️","Reconquista","#00D4FF",CB.reconquistada)}
              ${frenteCard("🆕","Novos","#00E5A0",CB.nova)}
            </div>
            ${insightMes}
            ${mesTabela}
            <div class="t-mut" style="font-size:10.5px;margin-top:9px;line-height:1.5">📊 <b>De-para</b> — quanto do faturamento veio das frentes de conquista (dinheiro NOVO) desde o marco. A <b>conversão</b> conta só a <b>categoria nova</b> (o que já mandavam é dinheiro velho, não entra). O <b>mês a mês</b> mostra o que entrou em cada mês e quanto representa do faturamento daquele mês (o mês atual é parcial).</div>
          </div>`:"";
        painel=`
          ${biConq}
          <div class="proxhint" style="border-color:rgba(0,229,160,.4);color:#7effcf;margin:8px 0 10px">🔓 <b>Faturamento aberto (diretoria)</b> · ao vivo ${AUTO_REL_NOTE}${bioLinha()}</div>
          <div class="kgrid">
            ${kpi("g", fmtBRL(totRS), "Faturamento total", "desde a data de corte")}
            ${kpi("", totEx, "Exames", "desde a reconq./conquista")}
            ${kpi("", fmtBRL(tkGeral), "Ticket médio", "R$ por exame")}
            ${kpi("g", comRS.length, "Clínicas com R$", semDataN?`${semDataN} ainda sem data (12m)`:`${dados.length} na carteira`)}
          </div>
          <div class="seclabel" style="margin:12px 0 2px">💰 Faturamento por clínica <span class="t-mut" style="font-weight:500;font-size:11px">— agrupado por tipo, cada um do maior → menor</span></div>
          <div class="t-mut" style="font-size:11px;margin:0 0 4px;line-height:1.5">♻️ reconquistada · 🆕 nova · 🔀 divide material · 🐾 particular. <b style="color:#ff8fa3">🎯 na mesa (estimado)</b> = quanto ela poderia render nas classes que hoje <b>não</b> te manda (extrapolando o mix de valor do lab a partir do que ela já te dá). É estimativa pra priorizar — não valor fechado.</div>
          ${rows||'<div class="t-mut" style="font-size:12.5px">Sem R$ vinculado ainda.</div>'}
          ${zerLinha?`<div style="margin-top:6px">${zerLinha}</div>`:""}
          ${cohortHtml}
          <div class="card" style="margin:14px 0 6px;border-color:rgba(0,212,255,.3)">
            <h3>🧠 Como ler isso (regras de mercado)</h3>
            <div style="font-size:12.5px;line-height:1.65">${regras.map(r=>`<div style="margin:4px 0">${r}</div>`).join("")}</div>
          </div>`;
      }
      // 🧠² alerta de ritmo consolidado (pararam / caíram) — o mais urgente, vai no topo
      const c2all=CARTEIRA.filter(x=>x.cod).map(x=>({x,c2:cerebro2(CLIN_DET[String(x.cod)])})).filter(o=>o.c2);
      const parou=c2all.filter(o=>o.c2.status==="parou").sort((a,b)=>b.c2.diasSil-a.c2.diasSil), caiu=c2all.filter(o=>o.c2.status==="caiu");
      const c2Html=(parou.length||caiu.length)?`
        <div style="background:rgba(255,45,85,.1);border:1px solid rgba(255,45,85,.45);border-left:3px solid #FF2D55;border-radius:9px;padding:10px 12px;margin:8px 0 4px">
          <div style="font-size:12px;font-weight:800;color:#ff6b81;text-transform:uppercase;letter-spacing:.3px">🧠² Alerta de ritmo · ${parou.length} pararam · ${caiu.length} caíram</div>
          ${parou.map(o=>`<div style="font-size:12px;color:#ffc9d2;margin-top:6px">🔴 <b>${esc(o.x.nome)}</b> — <b>${o.c2.diasSil} dias</b> sem enviar (costuma a cada ~${o.c2.cad}d · ~${o.c2.semMed}/sem). <b style="color:#ff6b81">Liga hoje.</b></div>`).join("")}
          ${caiu.map(o=>`<div style="font-size:12px;color:#ffc266;margin-top:6px">🟡 <b>${esc(o.x.nome)}</b> — caiu vs a média dela (~${o.c2.semMed}/sem). Atenção antes de perder.</div>`).join("")}
        </div>`:"";
      // 🎯 consolidado "deixando na mesa" (só quem MANDA algo e deixa o resto) — visível a todos; R$ só diretoria
      const mesaList=dados.filter(d=>{ const det=CLIN_DET[String(d.x.cod)]; return det&&(det.cats||[]).length&&(d.falta||[]).length; }).sort((a,b)=>b.falta.length-a.falta.length);
      const mesaHtml = mesaList.length ? `
        <div class="seclabel" style="margin:14px 0 6px;color:#ff6b81">🎯 Deixando na mesa <span class="t-mut" style="font-weight:500;font-size:11px">(o que cada clínica NÃO te manda — vai pro concorrente)</span></div>
        ${mesaList.map(d=>{ const det=CLIN_DET[String(d.x.cod)]||{}, nsend=(det.cats||[]).length, ntot=nsend+d.falta.length;
          return `<div style="background:rgba(255,45,85,.1);border:1px solid rgba(255,45,85,.4);border-left:3px solid #FF2D55;border-radius:8px;padding:8px 11px;margin-bottom:7px">
            <div style="font-weight:800;color:#ff6b81;font-size:12px;text-transform:uppercase;letter-spacing:.3px">🎯 ${esc(d.x.nome)} · ${d.falta.length} na mesa</div>
            <div style="margin-top:5px;display:flex;flex-wrap:wrap;gap:4px">${d.falta.slice(0,8).map(f=>`<span style="background:rgba(255,45,85,.2);color:#ffc9d2;border:1px solid rgba(255,45,85,.4);border-radius:16px;padding:1px 9px;font-size:11px;font-weight:700">${esc(f)}</span>`).join("")}${d.falta.length>8?`<span style="color:#ff8fa3;font-size:11px;font-weight:700;align-self:center">+${d.falta.length-8}</span>`:""}</div>
            ${d.rsv!=null?`<div style="font-size:11px;color:#ffb3c0;margin-top:6px">já te rende <b style="color:#7effcf">${fmtBRL(d.rsv)}</b> mandando só <b>${nsend} de ${ntot}</b> classes — <b style="color:#ff6b81">puxa o resto</b></div>`:""}
          </div>`; }).join("")}` : "";
      const rcard=r=>`<div class="crow" style="cursor:default;align-items:flex-start">
          <div class="rk" style="color:#00D4FF">📈</div>
          <div style="flex:1"><div class="nm">📅 ${semLabel(r)}</div>
            <div class="ci">♻️ <b>${r.n_reconq||0}</b> reconquistadas · 🆕 <b>${r.n_novas||0}</b> novas · 📊 <b>${r.prod_total||0}</b> exames (12m)${(r.flags&&r.flags.length)?` · 🚩 <b>${r.flags.length}</b> p/ trabalhar`:""}${(r.zerados&&r.zerados.length)?` · 🚨 <b>${r.zerados.length}</b> zeradas`:""}</div>
            ${(r.zerados&&r.zerados.length)?`<div class="ci" style="font-size:11.5px;margin-top:3px;color:#ff8fa3">🚨 comissão paga mas 0 exames: ${r.zerados.map(f=>esc(f.nome)+(f.cidade?" ("+esc(f.cidade)+")":"")).join(" · ")}</div>`:""}
            ${(r.flags&&r.flags.length)?`<div class="ci" style="font-size:11.5px;margin-top:3px;color:#ffc266">🚩 ${r.flags.map(f=>esc(f.nome)+(f.prod!=null?" ("+f.prod+")":"")).join(" · ")}</div>`:""}</div>
          <div class="mid"></div></div>`;
      // 🎉 PLANILHA DE CONQUISTAS (Dividem material): TOTAL desde o marco × CONQUISTA (só o novo), lado a lado
      const divAll=CARTEIRA.filter(x=>x.tipo==="divide"&&x.cod).map(x=>({x,det:CLIN_DET[String(x.cod)]||null})).filter(o=>o.det);
      const dir=ehDiretoria();
      const conquistaHtml = divAll.length ? `
        <div class="seclabel" style="margin:16px 0 4px;color:#00E5A0">🔀 Dividem material — dinheiro VELHO × NOVO</div>
        <div class="t-mut" style="font-size:11.5px;margin:0 0 8px;line-height:1.5">Elas já te mandavam uma parte (💙 <b>velho</b> — ex.: só histopato). O trabalho é fazer abrir as <b>outras categorias</b> (💚 <b>novo</b>). <b>Só o verde conta como recuperação.</b> A barra mostra quanto já virou.</div>
        ${divAll.map(o=>{ const cod=String(o.x.cod), conq=(o.det.conq||[]), falta=(o.det.falta||[]);
          const totRs=dir?rsVal(cod,o.x.reconq_data):null;
          const conqRs=(dir&&CLIN_CONQFAT&&CLIN_CONQFAT[cod])?conq.reduce((s,z)=>s+(CLIN_CONQFAT[cod][z.setor]||0),0):0;
          const velhoRs=(dir&&totRs!=null)?Math.max(0,totRs-conqRs):null;
          const pctN=(dir&&totRs>0)?Math.round(conqRs/totRs*100):0;
          const convert=conq.length>0;
          const status=convert?`<span style="background:rgba(0,229,160,.2);color:#00E5A0;border-radius:12px;padding:1px 9px;font-size:11px;font-weight:700">🟢 convertendo · ${pctN}% novo</span>`:`<span style="background:rgba(255,138,0,.2);color:#ffc266;border-radius:12px;padding:1px 9px;font-size:11px;font-weight:700">🔴 ainda não converteu</span>`;
          // BARRA visual velho × novo (só diretoria; senão mostra só status/categorias)
          const bar=(dir&&totRs>0)?`<div style="display:flex;height:26px;border-radius:7px;overflow:hidden;border:1px solid rgba(255,255,255,.12);margin-top:8px;font-size:11px;font-weight:800">
              <div style="width:${Math.max(pctN<100?100-pctN:0,pctN>=100?0:6)}%;min-width:${velhoRs>0?'34px':'0'};background:linear-gradient(90deg,#2b7fb0,#1d6a92);color:#eaf6ff;display:flex;align-items:center;justify-content:center;white-space:nowrap;padding:0 6px">${velhoRs>0?"💙 "+fmtBRL(velhoRs):""}</div>
              <div style="width:${Math.max(pctN,pctN>0?8:0)}%;background:linear-gradient(90deg,#00c98a,#00E5A0);color:#062;display:flex;align-items:center;justify-content:center;white-space:nowrap;padding:0 6px">${conqRs>0?"💚 "+fmtBRL(conqRs):(pctN>0?"💚":"")}</div>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:10.5px;margin-top:3px"><span style="color:#9fe6ff">💙 velho (já mandava): <b>${fmtBRL(velhoRs||0)}</b></span><span style="color:#7effcf">💚 novo (conquista): <b>${fmtBRL(conqRs)}</b></span></div>`
            :(dir?`<div class="t-mut" style="font-size:11px;margin-top:6px">sem produção desde o marco ainda</div>`:`<div style="font-size:11px;margin-top:6px;color:#9fe6ff">🔒 R$ só diretoria — aqui você vê o que ela manda × o alvo</div>`);
          return `<div style="background:rgba(0,229,160,.06);border:1px solid rgba(0,229,160,.3);border-left:3px solid ${convert?'#00E5A0':'#ffc266'};border-radius:9px;padding:10px 12px;margin-bottom:8px">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px"><div style="font-weight:700;color:#e8f8f0;font-size:13px">🔀 ${esc(o.x.nome)}${o.x.reconq_data?` <span class="t-mut" style="font-weight:500;font-size:11px">· desde ${esc(fmtDataBR(o.x.reconq_data))}</span>`:""}</div>${status}</div>
            ${bar}
            ${conq.length?`<div style="margin-top:9px"><div style="font-size:11px;color:#00E5A0;font-weight:700;margin-bottom:3px">💚 Já conquistou (dinheiro novo):</div>${conq.map(z=>{ const rs=(dir&&CLIN_CONQFAT&&CLIN_CONQFAT[cod])?CLIN_CONQFAT[cod][z.setor]:null; return `<div style="font-size:11.5px;color:#7effcf;margin-top:2px">✅ <b>${esc(z.setor)}</b> — desde ${esc(fmtDataBR(z.desde))} · ${z.n} ex${rs!=null?` · <b>${fmtBRL(rs)}</b>`:""}</div>`; }).join("")}</div>`:""}
            ${falta.length?`<div style="margin-top:9px"><div style="font-size:11px;color:#ff8fa3;font-weight:700;margin-bottom:4px">🎯 Falta abrir (o alvo pra virar dinheiro novo):</div><div style="display:flex;flex-wrap:wrap;gap:4px">${falta.slice(0,10).map(f=>`<span style="background:rgba(255,45,85,.18);color:#ffc9d2;border:1px solid rgba(255,45,85,.4);border-radius:14px;padding:2px 10px;font-size:11px;font-weight:700">${esc(f)}</span>`).join("")}</div></div>`:(conq.length?`<div style="font-size:11px;color:#7effcf;margin-top:8px">👏 já manda todas as classes — conversão completa!</div>`:"")}
          </div>`; }).join("")}
        <div class="t-mut" style="font-size:11px;margin:2px 0 4px">💡 Enquanto a barra é só <b style="color:#9fe6ff">💙 azul</b>, é dinheiro que já entrava (não é mérito). Cada pedaço <b style="color:#7effcf">💚 verde</b> que você abre = recuperação real, e é o que <b>comissiona</b> o vendedor.</div>` : "";
      c.innerHTML=`${subtabsClin}
        <div class="t-mut" style="font-size:12.5px;margin:8px 0 6px;text-align:center;line-height:1.5">${ehDiretoria()?"📊 <b>Faturamento ao vivo</b> da carteira (atualiza sozinho a cada ciclo — você não precisa pedir). E-mail completo toda <b>sexta 9h</b>.":"📊 <b>Evolução da carteira</b> — produção e ritmo de cada clínica (atualiza sozinho a cada ciclo)."}</div>
        ${c2Html}
        ${painel}
        ${conquistaHtml}
        ${mesaHtml}
        <div class="seclabel" style="margin:14px 0 6px">🗂️ Histórico semanal <span class="t-mut" style="font-weight:500;font-size:11px">(evolução — sem R$, foto de cada sexta)</span></div>
        ${RELATORIOS.length?RELATORIOS.map(rcard).join(""):`<div class="empty">Ainda sem foto semanal. A 1ª já foi gerada — recarregue em instantes. Depois vai listando a evolução aqui.</div>`}`;
      document.querySelectorAll("#content [data-cv]").forEach(el=>el.onclick=()=>{ clinView=el.dataset.cv; search=""; renderTab(); });
      const vr=document.getElementById("verRSrel"); if(vr) vr.onclick=()=>abrirFinanceiro();
      return;
    }
    if(clinView==="aaa"||clinView==="aab"||clinView==="aac"||clinView==="aad"){
      const curva={aaa:"A",aab:"B",aac:"C",aad:"D"}[clinView];
      const AA=AAA.filter(a=>(a.curva||"A")===curva);
      const META={
        A:{ic:"⭐",cor:"#ffd166",bord:"rgba(255,209,102,.45)",nome:"Clínicas A",desc:`as maiores — top ${aaaA.length||40} em faturamento 12m`},
        B:{ic:"🅱️",cor:"#c9d4e0",bord:"rgba(201,212,224,.4)",nome:"Clínicas B",desc:`o miolo — as ${aaaB.length||60} seguintes (logo depois das A)`},
        C:{ic:"🇨",cor:"#9fe6ff",bord:"rgba(0,212,255,.4)",nome:"Clínicas C",desc:`a base larga — as ${aaaC.length||100} seguintes em faturamento 12m`},
        D:{ic:"🇩",cor:"#c0a8ff",bord:"rgba(150,133,233,.45)",nome:"Clínicas D",desc:`a cauda ativa — as ${aaaD.length||150} seguintes em faturamento 12m`}};
      const meta=META[curva];
      const q2=search.trim().toLowerCase();
      const aarr=q2?AA.filter(a=>((a.nome||"")+" "+(a.cidade||"")).toLowerCase().includes(q2)):AA;
      const porteDe=n=>n>=300?["G","🐘 Grande"]:n>=100?["M","🐎 Médio"]:["P","🐇 Pequeno"];
      const comMesa=AA.filter(a=>(a.falta||[]).length).length;
      const acard=(a,i)=>{ const [pv,pl2]=porteDe(a.qtd||0); const falta=(a.falta||[]).slice(); const cats=(a.cats||[]).slice();
        // 🎯 O QUE NÃO MANDA = bloco vermelho de MUITO destaque (pedido do Wal)
        const mesa = falta.length ? `<div style="background:rgba(255,45,85,.13);border:1px solid rgba(255,45,85,.5);border-left:3px solid #FF2D55;border-radius:8px;padding:7px 10px;margin-top:6px">
            <div style="font-weight:800;color:#ff6b81;font-size:11.5px;text-transform:uppercase;letter-spacing:.4px">🎯 Deixando na mesa · ${falta.length} classe(s) indo pro concorrente</div>
            <div style="margin-top:5px;display:flex;flex-wrap:wrap;gap:4px">${falta.slice(0,12).map(f=>`<span style="background:rgba(255,45,85,.22);color:#ffd0d8;border:1px solid rgba(255,45,85,.5);border-radius:14px;padding:2px 10px;font-size:11px;font-weight:700">${esc(f)}</span>`).join("")}${falta.length>12?`<span style="color:#ff8fa3;font-size:11px;font-weight:700;align-self:center">+${falta.length-12}</span>`:""}</div>
            <div style="font-size:11px;color:#ffb3c0;margin-top:5px">👉 <b>puxa essas</b> — ela já é grande e confia no lab; falta pedir.</div>
          </div>` : `<div class="swcheio" style="border:1px solid rgba(0,229,160,.5);border-left:3px solid #00E5A0;border-radius:8px;padding:7px 10px;margin-top:6px">
            <div style="font-weight:800;color:#00E5A0;font-size:11.5px;text-transform:uppercase;letter-spacing:.4px">✅ Share-of-wallet CHEIO · manda TODAS as classes 👏</div>
            <div style="font-size:11px;color:#7effcf;margin-top:5px">🛡️ cliente redondo — <b>nada indo pro concorrente</b>. Proteja essa: é o modelo do que as outras deveriam mandar.</div>
          </div>`;
        return `<div class="crow" style="cursor:default;align-items:flex-start${falta.length?';border-left:3px solid #FF2D55':''}">
          <div class="rk" style="color:${meta.cor};display:flex;flex-direction:column;align-items:center;line-height:1.1"><span style="font-weight:800;font-variant-numeric:tabular-nums">${i+1}</span><span style="font-size:11px">${meta.ic}</span></div>
          <div style="flex:1"><div class="nm">${esc(a.nome)} <span class="pr" style="background:rgba(0,212,255,.14);color:#9fe6ff">${pl2}</span> <span class="pr" style="background:${meta.cor}22;color:${meta.cor}">curva ${a.curva||curva}</span> <span class="t-mut" style="font-size:11px">🔗 HF</span></div>
            <div class="ci">${a.cidade?"📍 "+esc(a.cidade)+" · ":""}📊 <b>${a.qtd||0}</b> exames (12m) · 💰 ${rsClin(a.cod)}</div>
            ${cats.length?`<div class="ci" style="font-size:11.5px;margin-top:3px;color:#7effcf">✅ manda: ${cats.slice(0,6).map(c=>esc(c.setor)+" ("+c.qtd+")").join(", ")}</div>`:""}
            ${mesa}</div>
          <div class="mid"></div></div>`; };
      c.innerHTML=`${subtabsClin}
        <div class="proxhint" style="border-color:${meta.bord};color:${meta.cor};margin-bottom:10px;line-height:1.55">${meta.ic} <b>${meta.nome}</b> — ${meta.desc}. Trazidas <b>automaticamente</b> pelo robô (curva ABC), ranqueadas por faturamento. Mesma inteligência das Reconquistadas/Novas: <b>análise de 12 meses</b> do que manda × <b>o que deixa na mesa</b> (vermelho = indo pro concorrente).${ehDiretoria()?`<div style="margin-top:5px;color:#c9d4e0">🔒 Os <b>valores em R$</b> são <b>só seus</b> — cifrados, abrem só com sua senha financeira${bioAtivo()?" + Face ID":""}.</div>`:`<div style="margin-top:5px;color:#9fe6ff">🔒 Aqui você vê exames e categorias. O <b>faturamento</b> é exclusivo da diretoria.</div>`}${bioLinha()}</div>
        <div class="kgrid">
          ${kpi("g", AA.length, meta.nome, "curva "+curva+" · 12m")}
          ${kpi(comMesa?"a":"", comMesa, "Deixando na mesa", "classes indo pro concorrente")}
          ${kpi("", AAA_SETORES.length, "Categorias do lab", "universo de exames")}
          ${kpi("", AAA_TS?"✓":"—", "Sincronizado", AAA_TS?new Date(AAA_TS).toLocaleDateString("pt-BR"):"aguardando robô")}
        </div>
        <div class="t-mut" style="font-size:11.5px;margin:2px 0 8px;text-align:center">Numeradas por faturamento (maior → menor). ✅ o que manda × <b style="color:#ff8fa3">🎯 o que deixa na mesa</b>. R$ só diretoria (senha + Face ID).</div>
        <div class="tabsbar" style="margin:10px 0 8px"><div class="seclabel" style="margin:0">${meta.ic} Ranking ${meta.nome}</div><input class="wlsearch" id="lupaAAA" placeholder="🔍 clínica ou cidade…" value="${esc(search)}"></div>
        ${AA.length?(aarr.length?aarr.map(a=>acard(a, AA.indexOf(a))).join(""):`<div class="empty">Nada encontrado para "${esc(search)}".</div>`):`<div class="empty">⏳ As clínicas ${meta.nome} chegam quando o robô sincronizar (traz por faturamento 12m automaticamente).</div>`}`;
      document.querySelectorAll("#content [data-cv]").forEach(el=>el.onclick=()=>{ clinView=el.dataset.cv; search=""; renderTab(); });
      const la=document.getElementById("lupaAAA"); if(la){ la.addEventListener("input", e=>{ search=e.target.value; const p=la.selectionStart; renderTab(); const l2=document.getElementById("lupaAAA"); if(l2){l2.focus(); try{l2.setSelectionRange(p,p);}catch(_){}}}); }
      return;
    }
    const VM={nova:{add:"NOVA",kpi:"Novas",sec:"🆕 Clínicas novas",vazio:"nova"},reconquistada:{add:"RECONQUISTADA",kpi:"Reconquistadas",sec:"♻️ Clínicas reconquistadas",vazio:"reconquistada"},divide:{add:"que DIVIDE material",kpi:"Dividem material",sec:"🔀 Clínicas que dividem material",vazio:"que divide material"},particular:{add:"PARTICULAR",kpi:"Particulares",sec:"🐾 Clientes particulares",vazio:"particular"}}[clinView]||{add:"",kpi:"",sec:"",vazio:""};
    c.innerHTML=`
      ${subtabsClin}
      ${clinView==='divide'?`<div class="proxhint" style="border-color:rgba(0,212,255,.4);color:#9fe6ff;margin-bottom:10px;line-height:1.55">🔀 <b>Clínicas que repartem material com o concorrente</b> — mandam só uma categoria (ex.: só histopatologia) e o resto vai pra outro lab. Cadastre com a <b>data que vamos começar a trabalhar</b> (marco zero); eu rastreio a produção e mostro o que ela <b>NÃO</b> te manda (deixando na mesa). Vira comissão quando abrir as outras categorias.</div>`:""}
      ${clinView==='particular'?`<div class="proxhint" style="border-color:rgba(0,229,160,.4);color:#7effcf;margin-bottom:10px;line-height:1.55">🐾 <b>Clientes particulares</b> — você marca na mão quais são (não tem marca automática confiável no HF). Mesma análise das outras: vínculo ao HF, produção 12m, ✅ o que manda × 🎯 o que deixa na mesa, marco zero e drill-down. Cadastre e trabalhe igual.</div>`:""}
      <button class="checkinbtn" id="addCart" type="button" style="margin-bottom:6px">➕ Adicionar clínica ${VM.add}</button>
      <div class="t-mut" style="font-size:12px;margin-bottom:12px;text-align:center">Você digita o nome; eu acho no HF (${CL?CL+" clínicas":"aguardando o robô"}) e vinculo → puxo a produção. O input é seu.</div>
      <div class="kgrid">
        ${kpi("g", lista.length, VM.kpi, "na carteira")}
        ${kpi("", arr.filter(x=>x.cod).length, "Vinculadas ao HF", "produção correlacionada")}
        ${kpi(semVinc?"a":"", semVinc, "Pendentes", "sem vínculo HF")}
        ${kpi("", CL, "Master HF", CLIN_TS?("sinc. "+new Date(CLIN_TS).toLocaleDateString("pt-BR")):"aguardando robô")}
      </div>
      ${!CL?`<div class="proxhint" style="border-color:rgba(255,138,0,.4);color:#ffc266;margin-bottom:12px">⏳ A lista de clínicas do HF ainda não chegou (o robô sincroniza a cada ciclo). O autocomplete liga assim que ela vier.</div>`:""}
      ${!ehDiretoria()?"":(CLIN_RS?`<div class="proxhint" style="border-color:rgba(0,229,160,.4);color:#7effcf;margin-bottom:12px">🔓 R$ aberto · faturamento desta lista (desde a data de corte): <b>${fmtBRL(rsTotal||0)}</b>${bioLinha()}</div>`:`<button class="checkinbtn" id="verRSbtn" type="button" style="margin-bottom:12px;border-color:rgba(0,229,160,.4);color:#7effcf">🔓 Abrir faturamento em R$ (senha financeira)</button>`)}
      ${(()=>{ const z=CARTEIRA.filter(x=>{ const d=x.cod?CLIN_DET[String(x.cod)]:null; return x.cod&&d&&Array.isArray(d.recent)&&d.recent.length===0&&!d.prod30; });
        if(!z.length) return "";
        return `<div class="proxhint" style="border-color:rgba(255,45,85,.55);color:#ff8fa3;margin-bottom:12px;line-height:1.55">
          🚨 <b>Comissão paga mas 0 exames (${z.length})</b> — clínica na carteira mas o HF não registra <b>nenhum exame</b>:<br>
          ${z.map(x=>`• <b>${esc(x.nome)}</b>${x.cidade?" ("+esc(x.cidade)+")":""}${x.reconq_data?" · desde "+esc(fmtDataBR(x.reconq_data)):""}`).join("<br>")}
          <br><span class="t-mut" style="font-size:11.5px">Confira no HF: comissão de reconquista (normal) × exames em OUTRO código × ainda não digitados. Toque a clínica → 🔬 Ver exames.</span></div>`; })()}
      <div class="tabsbar" style="margin:10px 0 8px"><div class="seclabel" style="margin:0">${VM.sec}</div><input class="wlsearch" id="lupaCart" placeholder="🔍 clínica ou cidade…" value="${esc(search)}"></div>
      ${lista.length?(arr.length?arr.map(card).join(""):`<div class="empty">Nada encontrado para "${esc(search)}".</div>`):`<div class="empty">Nenhuma clínica ${VM.vazio} ainda. Toque <b>➕ Adicionar</b> e comece a digitar o nome — eu acho no HF.</div>`}`;
    document.querySelectorAll("#content [data-cv]").forEach(el=>el.onclick=()=>{ clinView=el.dataset.cv; search=""; renderTab(); });
    const ac=document.getElementById("addCart"); if(ac) ac.onclick=()=>openCarteira(clinView, null);
    const vrs=document.getElementById("verRSbtn"); if(vrs) vrs.onclick=()=>abrirFinanceiro();
    document.querySelectorAll("#content [data-cart]").forEach(el=>el.onclick=()=>openCarteira(null, el.dataset.cart));
    document.querySelectorAll("#content [data-exames]").forEach(el=>el.onclick=(e)=>{ e.stopPropagation(); openExames(el.dataset.exames, el.dataset.exnome); });
    const lc=document.getElementById("lupaCart"); if(lc){ lc.addEventListener("input", e=>{ search=e.target.value; const p=lc.selectionStart; renderTab(); const l2=document.getElementById("lupaCart"); if(l2){l2.focus(); try{l2.setSelectionRange(p,p);}catch(_){}}}); }
    return;
  }

  if(ACTIVE==="prospeccao"){
    const q=search.trim().toLowerCase();
    const all = q ? PROSP.filter(p=>(p.nome||"").toLowerCase().includes(q)||(p.cidade||"").toLowerCase().includes(q)||(p.contato||"").toLowerCase().includes(q)) : PROSP;
    const wk=Date.now()-7*864e5, novosSem=PROSP.filter(p=>(p.ts||0)>=wk).length, cont=k=>PROSP.filter(p=>p.status===k).length;
    let body="";
    PORDER.forEach(k=>{ const grp=all.filter(p=>p.status===k); if(!grp.length && q) return;
      body+=`<div class="seclabel" style="color:${PSTATUS[k].col}">${PSTATUS[k].lbl} (${grp.length})</div>`;
      body+= grp.length ? grp.map(p=>{ const lf=(p.feedbacks||[]).slice().sort((a,b)=>b.ts-a.ts)[0];
        return `<div class="crow" data-prosp="${esc(p.id)}" style="cursor:pointer">
          <div class="rk" style="color:var(--line)">•</div>
          <div><div class="nm">${esc(p.nome)}</div><div class="ci">${[esc(p.cidade||''),esc(p.contato||''),p.origem?'origem: '+esc(p.origem):'',p.visita?'📅 '+esc(p.visita):''].filter(Boolean).join(' · ')}</div>${lf?`<div class="lastint">💬 "${esc(lf.texto)}" · ${esc(diasAtras(lf.ts))}</div>`:''}</div>
          <div class="mid"></div>
          <div class="rcell"><span class="pr" style="background:${PSTATUS[k].col}22;color:${PSTATUS[k].col}">${PSTATUS[k].lbl}</span></div>
        </div>`; }).join("") : `<div class="t-mut" style="font-size:12.5px;padding:4px 0 8px">—</div>`;
    });
    c.innerHTML=`
      <div class="kgrid">
        ${kpi("", PROSP.length, "Prospects", "total na base")}
        ${kpi("a", novosSem, "Novos na semana", "leads adicionados")}
        ${kpi("a", cont('visita_agendada'), "Visitas agendadas", "")}
        ${kpi("g", cont('venda_ganha'), "Vendas ganhas", "")}
        ${kpi("r", cont('venda_perdida'), "Vendas perdidas", "")}
      </div>
      <div class="senshead"><div class="seclabel" style="margin:0">🧲 Prospecção — novos clientes (crescimento)</div>
        <input class="wlsearch" id="lupaP" placeholder="🔍 buscar prospect…" value="${esc(search)}"></div>
      <div class="card" style="margin:8px 0 14px">
        <div class="m-lbl" style="margin-top:0">+ Novo prospect</div>
        <div class="sensadd">
          <input id="npNome" class="wlsearch" placeholder="Nome *">
          <input id="npContato" class="wlsearch" placeholder="Contato (tel/e-mail)">
          <input id="npCidade" class="wlsearch" placeholder="Cidade">
          <input id="npOrigem" class="wlsearch" placeholder="Origem (feira, indicação…)">
          <button class="regbtn" id="npAdd">+ Adicionar</button>
        </div>
      </div>
      ${PROSP.length? body : `<div class="empty">Nenhum prospect ainda. Adicione o primeiro lead acima. 🧲</div>`}`;
    const add=document.getElementById("npAdd"); if(add) add.onclick=addProspInline;
    document.querySelectorAll("[data-prosp]").forEach(el=>el.onclick=()=>openProsp(el.dataset.prosp));
    const lp=document.getElementById("lupaP"); if(lp){ lp.addEventListener("input", e=>{ search=e.target.value; pinned=true; setPin(); const pos=lp.selectionStart; renderTab(); const l2=document.getElementById("lupaP"); if(l2){l2.focus(); try{l2.setSelectionRange(pos,pos);}catch(_){}}}); }
    return;
  }

  if(ACTIVE==="sensiveis"){
    const tv = locked==="sensiveis";
    const cards = SENS.length
      ? `<div class="sensgrid">${SENS.map(s=>`<div class="senscard"><div class="sc-ic">⚠️</div>
          <div class="sc-body"><div class="sc-nome">${esc(s.nome)}</div>${s.obs?`<div class="sc-obs">${esc(s.obs)}</div>`:""}<div class="sc-meta">incluído ${esc(diasAtras(s.ts))} · ${esc(s.por||"")}</div></div>
          ${tv?"":`<button class="sc-del" data-sens="${esc(s.id)}" title="remover">✕</button>`}</div>`).join("")}</div>`
      : `<div class="empty" style="margin-top:18px">Nenhum cliente sensível cadastrado.${tv?"":" Adicione acima."}</div>`;
    c.innerHTML = `
      <div class="senshead">
        <div class="seclabel" style="margin:0;color:var(--amber);font-size:15px">🚨 CLIENTES SENSÍVEIS — ATENÇÃO MÁXIMA</div>
        ${tv?"":`<div class="sensadd"><input id="sNome" class="wlsearch" placeholder="Nome do cliente"><input id="sObs" class="wlsearch" placeholder="Observação / por quê (opcional)"><button class="regbtn" id="sAdd">+ Adicionar</button></div>`}
      </div>
      ${cards}
      ${tv?"":`<div class="t-mut" style="font-size:12px;margin-top:18px;line-height:1.5">💡 <b>Telão do atendimento:</b> abra <b>…/telao.html</b> na TV — página própria, com <b>senha só do telão</b> (a recepção não acessa o resto do CRM). Mostra só estes cards pulsando e atualiza sozinho. A equipe edita aqui.</div>`}`;
    if(!tv){
      const add=document.getElementById("sAdd"); const sn=document.getElementById("sNome"), so=document.getElementById("sObs");
      if(add) add.onclick=()=>{ addSens(sn.value, so.value); };
      if(sn) sn.addEventListener("keydown", e=>{ if(e.key==="Enter" && add) add.click(); });
      document.querySelectorAll(".sc-del").forEach(b=>b.onclick=()=>removeSens(b.dataset.sens));
    }
    return;
  }

  if(ACTIVE==="reativados"){
    const allR=reativadosEvents();
    const q=search.trim().toLowerCase();
    const arr = q ? allR.filter(e=>(e.cliente||"").toLowerCase().includes(q)||((MOTLAB[e.motivo]||e.motivo||"").toLowerCase().includes(q))) : allR;
    let body="", curM=null;
    arr.forEach(e=>{ const d=new Date(e.ts), mk=d.getUTCFullYear()*100+(d.getUTCMonth()+1), col=MOTCOL[e.motivo]||"#00E5A0";
      if(mk!==curM){ curM=mk; body+=`<div class="monthhead">${MESF[d.getUTCMonth()+1]} ${d.getUTCFullYear()}</div>`; }
      body+=`<div class="crow" data-reg="${esc(e.cod)}" style="cursor:pointer">
        <div class="rk" style="color:var(--green)">✓</div>
        <div><div class="nm">${esc(e.cliente||('#'+e.cod))}</div><div class="ci">${e.cidade?esc(e.cidade)+' · ':''}recuperou ${esc(diasAtras(e.ts))} · ${e.fonte==='atual'?'detecção atual':esc(e.week)}</div></div>
        <div class="mid"></div>
        <div class="rcell"><span class="pr" style="background:${col}22;color:${col}">era ${esc(MOTLAB[e.motivo]||e.motivo||'—')}</span></div>
      </div>`; });
    const now=new Date(), mesN=allR.filter(e=>{const d=new Date(e.ts);return d.getUTCFullYear()===now.getUTCFullYear()&&d.getUTCMonth()===now.getUTCMonth();}).length;
    c.innerHTML=`
      <div class="kgrid">
        ${kpi("g", new Set(allR.map(e=>e.cod)).size, "Reativados (total)", "estavam ruins e voltaram")}
        ${kpi("g", mesN, "Reativados no mês", "recuperaram este mês")}
        ${kpi("", q?arr.length:allR.length, q?"Encontrados":"Eventos", q?`filtro: "${esc(search)}"`:"saídas do radar")}
      </div>
      <div class="tabsbar" style="margin:16px 0 8px">
        <div class="seclabel" style="margin:0">♻️ Reativados · por mês e ano <span class="t-mut" style="font-weight:500">— estavam parados / em queda / esfriando e voltaram</span></div>
        <input class="wlsearch" id="lupaReat" placeholder="🔍 buscar por cliente ou motivo…" value="${esc(search)}">
      </div>
      ${allR.length ? (arr.length? body : `<div class="empty">Nada encontrado para "${esc(search)}".</div>`) : `<div class="empty">Ainda sem reativados. Conforme os snapshots semanais acumulam e clientes saem do radar (ou contatos de clientes ruins se recuperam), eles aparecem aqui — por mês e ano.</div>`}`;
    const lp=document.getElementById("lupaReat");
    if(lp){ lp.addEventListener("input", e=>{ search=e.target.value; pinned=true; setPin(); const p=lp.selectionStart; renderTab(); const l2=document.getElementById("lupaReat"); if(l2){l2.focus(); try{l2.setSelectionRange(p,p);}catch(_){}}}); }
    return;
  }

  if(ACTIVE==="encerrados"){
    const allE=[...ENCERR.values()].sort((a,b)=>b.ts-a.ts);
    const q=search.trim().toLowerCase();
    const arr = q ? allE.filter(e=>(e.cliente||"").toLowerCase().includes(q)||(e.motivo||"").toLowerCase().includes(q)) : allE;
    const encMot = motCount(allE);
    // catálogo: Mês/Ano -> Classificação -> clientes
    const byM={};
    arr.forEach(e=>{ const d=new Date(e.ts), mk=d.getFullYear()*100+(d.getMonth()+1);
      (byM[mk]=byM[mk]||{y:d.getFullYear(),m:d.getMonth()+1,mots:{}}); (byM[mk].mots[e.motivo||"Outro"]=byM[mk].mots[e.motivo||"Outro"]||[]).push(e); });
    let body="";
    Object.keys(byM).sort((a,b)=>b-a).forEach(mk=>{ const g=byM[mk];
      const mTot=Object.values(g.mots).reduce((a,x)=>a+x.length,0);
      body+=`<div class="monthhead">${MESF[g.m]} ${g.y} <span>· ${mTot} encerrado${mTot>1?'s':''}</span></div>`;
      Object.entries(g.mots).sort((a,b)=>b[1].length-a[1].length).forEach(([mot,lst])=>{
        body+=`<div class="classhead"><span class="pr" style="background:rgba(255,84,112,.16);color:#ffb3c0">${esc(mot)}</span><span class="t-mut">${lst.length} · ${Math.round(100*lst.length/mTot)}% do mês</span></div>`;
        lst.sort((a,b)=>b.ts-a.ts).forEach(e=>{ body+=`<div class="crow" data-reg="${esc(e.cod)}" style="cursor:pointer">
          <div class="rk" style="color:var(--line)">•</div>
          <div><div class="nm">${esc(e.cliente||('#'+e.cod))}</div><div class="ci">${esc(e.cidade||'')} · encerrado ${esc(diasAtras(e.ts))} · ${esc(e.por||'')}</div>${e.nota?`<div class="lastint" style="cursor:pointer">"${esc(e.nota)}"</div>`:''}</div>
          <div class="mid"></div>
          <div class="rcell"></div>
        </div>`; });
      });
    });
    c.innerHTML=`
      <div class="kgrid">
        ${kpi("r", allE.length, "Clientes encerrados", "fora do % geral de queda")}
        ${kpi("a", encMot.length, "Classificações", "motivos distintos")}
        ${kpi("", q?arr.length:allE.length, q?"Encontrados":"No total", q?`filtro: "${esc(search)}"`:"clique p/ histórico / reabrir")}
      </div>
      <div class="card" style="margin:0 0 14px;border-color:rgba(255,84,112,.3)">
        <h3>🔒 % de encerramento por classificação <span class="tag">do total</span></h3>
        ${motBars(encMot, allE.length, "#FF5470")}
        <div class="t-mut" style="font-size:12px;margin-top:10px;line-height:1.5">Não entram no <b>% geral de queda</b> do CRM. Catálogo abaixo: por mês/ano, separado por classificação.</div>
      </div>
      <div class="tabsbar" style="margin:16px 0 8px">
        <div class="seclabel" style="margin:0">🔒 Catálogo · mês/ano → classificação</div>
        <input class="wlsearch" id="lupaEnc" placeholder="🔍 buscar por cliente ou motivo…" value="${esc(search)}">
      </div>
      ${allE.length ? (arr.length? body : `<div class="empty">Nada encontrado para "${esc(search)}".</div>`) : `<div class="empty">Nenhum cliente encerrado ainda. Use <b>🔒 Encerrar contato</b> no 📞 Registrar de qualquer cliente.</div>`}`;
    const lp=document.getElementById("lupaEnc");
    if(lp){ lp.addEventListener("input", e=>{ search=e.target.value; pinned=true; setPin(); const p=lp.selectionStart; renderTab(); const l2=document.getElementById("lupaEnc"); if(l2){l2.focus(); try{l2.setSelectionRange(p,p);}catch(_){}}}); }
    return;
  }

  if(ACTIVE==="inativos"){
    const allI=[...INAT.values()].sort((a,b)=>b.ts-a.ts);
    const total=allI.length;
    const ativos2 = D.carteira ? act(D.carteira).length : (r.ativos || r.carteira || 0);
    const base = ativos2 + total;                         // carteira "real" + inativos
    const pctInat = base ? 100*total/base : 0;            // % de inativos sobre a base
    // % de inativação POR MOTIVO (dentro deles mesmos)
    const motArr=motCount(allI);
    const breakdown = motBars(motArr, total, "#FF8A00");
    const q=search.trim().toLowerCase();
    const arr = q ? allI.filter(e=>(e.cliente||"").toLowerCase().includes(q)||(e.motivo||"").toLowerCase().includes(q)) : allI;
    let body="", curM=null;
    arr.forEach(e=>{ const d=new Date(e.ts), mk=d.getFullYear()*100+(d.getMonth()+1);
      if(mk!==curM){ curM=mk; body+=`<div class="monthhead">${MESF[d.getMonth()+1]} ${d.getFullYear()}</div>`; }
      body+=`<div class="crow" data-reg="${esc(e.cod)}" style="cursor:pointer">
        <div class="rk" style="color:#FF8A00">🚫</div>
        <div><div class="nm">${esc(e.cliente||('#'+e.cod))}</div><div class="ci">${esc(e.cidade||'')} · inativo ${esc(diasAtras(e.ts))} · ${esc(e.por||'')}</div>${e.nota?`<div class="lastint" style="cursor:pointer">"${esc(e.nota)}"</div>`:''}</div>
        <div class="mid"></div>
        <div class="rcell"><span class="pr" style="background:rgba(255,138,0,.16);color:#ffc266">${esc(e.motivo)}</span></div>
      </div>`; });
    c.innerHTML=`
      <div class="hero">${ring(pctInat, "#FF8A00", "inativos")}
        <div class="kgrid" style="margin:0">
          ${kpi("a", total, "Clientes inativos", "fora do % geral do estudo")}
          ${kpi("", ativos2, "Carteira real", "ativos sem inativos/encerrados")}
          ${kpi("a", motArr.length, "Motivos distintos", "editável")}
        </div></div>
      <div class="card" style="margin-bottom:14px;border-color:rgba(255,138,0,.3)">
        <h3>🚫 % de inativação por motivo <span class="tag">dentro dos inativos</span></h3>
        ${breakdown}
        <div class="t-mut" style="font-size:12px;margin-top:10px;line-height:1.5">Estes clientes <b>não entram</b> no percentual geral do CRM (parados, risco, carteira) — para não distorcer a estatística. Aparecem só aqui e no histórico.</div>
      </div>
      <div class="tabsbar" style="margin:16px 0 8px">
        <div class="seclabel" style="margin:0">🚫 Inativos · por mês e ano</div>
        <input class="wlsearch" id="lupaInat" placeholder="🔍 buscar por cliente ou motivo…" value="${esc(search)}">
      </div>
      ${total ? (arr.length? body : `<div class="empty">Nada encontrado para "${esc(search)}".</div>`) : `<div class="empty">Nenhum inativo ainda. Em <b>⛔ Parados</b>, abra o <b>📞 Registrar</b> do cliente travado e use <b>🚫 Marcar inativo</b> (calote, falta de pagamento…).</div>`}`;
    const lp=document.getElementById("lupaInat");
    if(lp){ lp.addEventListener("input", e=>{ search=e.target.value; pinned=true; setPin(); const p=lp.selectionStart; renderTab(); const l2=document.getElementById("lupaInat"); if(l2){l2.focus(); try{l2.setSelectionRange(p,p);}catch(_){}}}); }
    return;
  }

  if(ACTIVE==="pista"){
    const q=search.trim().toLowerCase(), all=pistaFiltrada();
    const rl=repList();
    const repBar=`<div class="repbar"><span class="t-mut" style="font-size:12.5px">Comercial:</span>`
      +`<select id="repSel" class="repsel"><option value="">Todos (${PISTA.length})</option>${rl.map(n=>`<option value="${esc(n)}"${n===repFilter?" selected":""}>${esc(n)} (${PISTA.filter(f=>f.por===n).length})</option>`).join("")}</select>`
      +`<button class="opt" id="repAdd" style="padding:6px 10px">＋ comercial</button></div>`;
    const rank={}; PISTA.forEach(f=>{const p=f.por||"(sem nome)"; (rank[p]=rank[p]||{n:0,fechou:0}); rank[p].n++; if(f.resultado==="fechou")rank[p].fechou++;});
    const rankHtml=Object.entries(rank).sort((a,b)=>b[1].n-a[1].n).map(([p,v])=>`<div class="leg-row"><span class="leg-dot" style="background:${p===repFilter?'#00E5A0':'#00D4FF'}"></span><b>${esc(p)}</b><span class="leg-n">${v.n}</span><span class="t-mut">— ${v.fechou} fechado(s)</span></div>`).join("");
    const _tISO=hojeISO();
    const naofeitosAtras=pistaRetornos(all).filter(f=>f.proximo<_tISO);
    const naofeitosDesm=all.filter(f=>f.baixa&&f.baixa.tipo==="desmarcado").sort((a,b)=>((b.baixa||{}).ts||0)-((a.baixa||{}).ts||0));
    const _ehPerdido=f=>!!(f.sem_retorno||(f.baixa&&f.baixa.destino==="perdido"));
    const naofeitosDesmReag=naofeitosDesm.filter(f=>!_ehPerdido(f));   // desmarcado a REAGENDAR (pisca)
    const naofeitosPerdidos=naofeitosDesm.filter(_ehPerdido);         // PERDIDO — resolvido, não pisca
    const naofeitosN=naofeitosAtras.length+naofeitosDesmReag.length;  // alerta da aba = só o que está pendente
    const realizados=all.filter(ehRealizada).sort((a,b)=>realizadaTs(b)-realizadaTs(a));   // check-in de chegada JÁ conta como realizada (não precisa da baixa formal)
    const arr= q ? all.filter(f=>(f.cliente||"").toLowerCase().includes(q)||(f.texto||"").toLowerCase().includes(q)||((PRES[f.resultado]||{}).lbl||"").toLowerCase().includes(q)) : all;
    const now=Date.now(), d0=new Date(); d0.setHours(0,0,0,0);
    const hoje=all.filter(f=>f.ts>=d0.getTime()).length, sem=all.filter(f=>f.ts>=now-7*864e5).length, fechou=all.filter(f=>f.resultado==="fechou").length;
    const fmt=ts=>{const d=new Date(ts);const dd=['dom','seg','ter','qua','qui','sex','sáb'][d.getDay()];const p=n=>String(n).padStart(2,'0');return `${dd} ${p(d.getDate())}/${p(d.getMonth()+1)} · ${p(d.getHours())}:${p(d.getMinutes())}`;};
    let body="",curM=null;
    arr.forEach(f=>{ const d=new Date(f.ts), mk=d.getFullYear()*100+(d.getMonth()+1), pr=PRES[f.resultado]||PRES.visita;
      if(mk!==curM){ curM=mk; body+=`<div class="monthhead">${MESF[d.getMonth()+1]} ${d.getFullYear()}</div>`; }
      body+=`<div class="crow" data-fb="${esc(f.id)}" style="cursor:pointer">
        ${selBox(f.id)}<div class="rk" style="color:${pr.col}">${pr.ic}</div>
        <div><div class="nm">${esc(f.cliente||"(sem nome)")} <span class="t-mut" style="font-weight:500;font-size:12px">· ${fmt(f.ts)}${(f.ts_upd&&f.ts_upd-f.ts>60000)?(" · ✏️ editado"+(f.edit_by?" por "+esc(f.edit_by):"")):""}</span></div>
          ${f.texto?`<div class="lastint" style="cursor:pointer">"${esc(f.texto)}"</div>`:""}
          ${f.sem_retorno?`<div class="rtbadge" style="background:rgba(255,138,0,.16);color:#ffc266">🚫 sem retorno</div>`:(f.proximo?`<div class="rtbadge fut">↻ retorno ${esc(f.proximo)}</div>`:"")}
          <div class="ci" style="font-size:11.5px;margin-top:2px">📍 ${esc(f.bairro||"—")} · ${checkinResumo(f.checkin,f.checkout)}</div>
          ${f.baixa?`<div class="ci" style="font-size:11.5px">${f.baixa.tipo==="compareceu"?`<span style="color:#7effcf;font-weight:700">✓ baixa: compareceu${(f.baixa.checkin&&f.baixa.checkin.ts)?` · <a href="https://maps.google.com/?q=${f.baixa.checkin.lat},${f.baixa.checkin.lng}" target="_blank" onclick="event.stopPropagation()" style="color:#7effcf">📍 mapa</a>`:""}</span>`:`<span style="color:#ffc266;font-weight:700">🚫 baixa: desmarcado · aut. diretoria${f.baixa.motivo?' ("'+esc(f.baixa.motivo)+'")':''}</span>`}</div>`:""}
          ${(f.reag_hist&&f.reag_hist.length)?`<div class="ci" style="font-size:11px;margin-top:2px;color:#ffc266">↻ ${f.reag_hist.map(rr=>`reagendado${rr.para?" p/ "+esc(fmtDataBR(rr.para)):""}${rr.motivo?': "'+esc(rr.motivo)+'"':""}`).join(" · ")}</div>`:""}
          ${(f.obs&&f.obs.length)?`<div class="ci" style="font-size:11.5px;margin-top:3px;color:#9fe6ff">${f.obs.map(o=>`<div>💬 "${esc(o.texto)}" <span class="t-mut">— ${esc(o.por||"")} · ${o.ts?diasAtras(o.ts):""}</span></div>`).join("")}</div>`:""}</div>
        <div class="mid"></div>
        <div class="rcell"><span class="pr" style="background:${pr.col}22;color:${pr.col}">${esc(pr.lbl)}</span><button class="delfb" data-obs="${esc(f.id)}" title="Adicionar observação (acompanhamento do escritório)" style="color:#9fe6ff">💬</button><button class="delfb" data-delfb="${esc(f.id)}" title="Excluir (vai pro histórico)">🗑️</button></div>
      </div>`; });
    const toggle=`<div class="subtabs"><button class="subtab ${pistaView==='feed'?'on':''}" data-pv="feed">🎤 Feedbacks</button><button class="subtab ${pistaView==='relatos'?'on':''}" data-pv="relatos">📣 Relatos${RELATOS.length?` (${RELATOS.length})`:''}</button><button class="subtab ${pistaView==='retornos'?'on':''}" data-pv="retornos">📅 Retornos / rotas</button><button class="subtab ${pistaView==='realizados'?'on':''}" data-pv="realizados">✅ Realizados${realizados.length?` (${realizados.length})`:''}</button><button class="subtab ${pistaView==='naofeitos'?'on':''} ${naofeitosN?'subtab-alert':''}" data-pv="naofeitos">⏰ Não feitos${naofeitosN?` (${naofeitosN})`:''}</button><button class="subtab ${pistaView==='bi'?'on':''}" data-pv="bi">📊 BI</button><button class="subtab ${pistaView==='exclusoes'?'on':''}" data-pv="exclusoes">🗑️ Exclusões${EXCL.length?` (${EXCL.length})`:''}</button></div>`;
    const wirePista=()=>{
      document.querySelectorAll("#content [data-pv]").forEach(el=>el.onclick=()=>{ pistaView=el.dataset.pv; selReset(); pinned=true; setPin(); search=""; renderTab(); });
      document.querySelectorAll("#content [data-fb]").forEach(el=>el.onclick=()=>{ if(selMode){ const id=el.dataset.fb; SEL.has(id)?SEL.delete(id):SEL.add(id); renderTab(); return; } openPistaRec(el.dataset.fb); });
      // ☑️ seleção em lote
      const _st=document.getElementById("selToggle"); if(_st) _st.onclick=()=>{ selMode=!selMode; if(!selMode) SEL.clear(); renderTab(); };
      const _sa=document.getElementById("selAll"); if(_sa) _sa.onclick=()=>{ const ids=(_sa.dataset.ids||"").split(",").filter(Boolean); const all=ids.length&&ids.every(i=>SEL.has(i)); ids.forEach(i=>all?SEL.delete(i):SEL.add(i)); renderTab(); };
      const _sc=document.getElementById("selClear"); if(_sc) _sc.onclick=()=>{ SEL.clear(); renderTab(); };
      document.querySelectorAll("#content [data-sel]").forEach(el=>el.onclick=(e)=>{ e.stopPropagation(); const id=el.dataset.sel; el.checked?SEL.add(id):SEL.delete(id); renderTab(); });
      const _sr=document.getElementById("selRetorno"); if(_sr) _sr.onclick=()=>bulkRetorno();
      const _srl=document.getElementById("selRelato"); if(_srl) _srl.onclick=()=>bulkRelato();
      const _sd=document.getElementById("selDel"); if(_sd) _sd.onclick=()=>bulkExcluir();
      document.querySelectorAll("#content [data-obs]").forEach(el=>el.onclick=(e)=>{ e.stopPropagation(); addObs(el.dataset.obs); });
      document.querySelectorAll("#content [data-delfb]").forEach(el=>el.onclick=(e)=>{ e.stopPropagation(); excluirFeedback(el.dataset.delfb); });
      document.querySelectorAll("#content [data-cheguei]").forEach(el=>el.onclick=(e)=>{ e.stopPropagation(); const f=PISTA.find(x=>x.id===el.dataset.cheguei); if(f) iniciarVisita({id:f.id,cliente:f.cliente,bairro:f.bairro}); });
      document.querySelectorAll("#content [data-desm]").forEach(el=>el.onclick=(e)=>{ e.stopPropagation(); darBaixaDesmarcou(el.dataset.desm); });
      document.querySelectorAll("#content [data-jafoi]").forEach(el=>el.onclick=(e)=>{ e.stopPropagation(); baixaEscritorio(el.dataset.jafoi); });
      document.querySelectorAll("#content [data-reag]").forEach(el=>el.onclick=(e)=>{ e.stopPropagation(); reagendarRetorno(el.dataset.reag); });
      document.querySelectorAll("#content [data-undobaixa]").forEach(el=>el.onclick=(e)=>{ e.stopPropagation(); desfazerBaixa(el.dataset.undobaixa); });
      const rec=document.getElementById("pistaRec"); if(rec) rec.onclick=()=>openPistaRec(null);
      const vi=document.getElementById("visIni"); if(vi) vi.onclick=()=>iniciarVisita();
      const vf=document.getElementById("visFim"); if(vf) vf.onclick=()=>{ const v=visitaLoad(); openPistaRec(v&&v.returnId?v.returnId:null); };
      const vcx=document.getElementById("visCancel"); if(vcx) vcx.onclick=()=>cancelVisita();
      const at=document.getElementById("agendarTel"); if(at) at.onclick=()=>openAgendar();
      const rs=document.getElementById("repSel"); if(rs) rs.onchange=()=>{ repFilter=rs.value; if(repFilter) localStorage.setItem("crm_rep",repFilter); pinned=true; setPin(); search=""; renderTab(); };
      const ra=document.getElementById("repAdd"); if(ra) ra.onclick=()=>{ const n=(prompt("Nome do comercial a cadastrar:")||"").trim(); if(n) addRep(n); };
    };

    if(pistaView==="relatos"){
      const base=relatosFiltrados();
      const q=search.trim().toLowerCase();
      const arr0=q?base.filter(r=>((r.clinica||"")+" "+(r.medico||"")+" "+(r.titulo||"")+" "+(r.texto||"")+" "+(r.por||"")).toLowerCase().includes(q)):base;
      const now=Date.now(), d0=new Date(); d0.setHours(0,0,0,0);
      const hoje=base.filter(r=>(r.ts||0)>=d0.getTime()).length, sem=base.filter(r=>(r.ts||0)>=now-7*864e5).length;
      const clinicas=new Set(base.map(r=>(r.clinica||"").toLowerCase()).filter(Boolean)).size;
      const criticos=base.filter(r=>relCritico((r.titulo||"")+" "+r.texto)).length;
      // 🔥 ranking de DORES (inteligência de mercado) — soma as dores de todos os relatos
      const painCount={}, painCli={};
      base.forEach(r=>{ detectPains((r.titulo||"")+" "+r.texto).forEach(p=>{ painCount[p.key]=(painCount[p.key]||0)+1; (painCli[p.key]=painCli[p.key]||new Set()).add((r.clinica||"").toLowerCase()); }); });
      const painArr=PAINS.filter(p=>painCount[p.key]).map(p=>({...p,n:painCount[p.key],cli:(painCli[p.key]||new Set()).size})).sort((a,b)=>b.n-a.n);
      const maxp=painArr.length?painArr[0].n:1;
      const doresBars=painArr.map(p=>`<div class="leg-row" style="gap:8px"><span style="width:170px;display:inline-block;font-size:13px">${p.ic} ${p.lbl}</span><div style="flex:1;background:rgba(255,255,255,.06);border-radius:6px;height:16px;overflow:hidden"><div style="width:${Math.round(p.n/maxp*100)}%;height:100%;background:#FF8A00"></div></div><b style="width:70px;text-align:right;font-size:12.5px">${p.n} <span class="t-mut" style="font-weight:500">/${p.cli} clín.</span></b></div>`).join("");
      let body="",curM=null;
      arr0.forEach(r=>{ const d=new Date(r.data?r.data+"T00:00:00":r.ts), mk=d.getFullYear()*100+(d.getMonth()+1);
        if(mk!==curM){ curM=mk; body+=`<div class="monthhead">${MESF[d.getMonth()+1]} ${d.getFullYear()}</div>`; }
        const ps=detectPains((r.titulo||"")+" "+r.texto), crit=relCritico((r.titulo||"")+" "+r.texto), o=RORIG[r.origem]||RORIG.outro;
        body+=`<div class="crow" data-rel="${esc(r.id)}" style="cursor:pointer;align-items:flex-start${crit?';border-left:3px solid #FF2D55':''}">
          ${selBox(r.id)}<div class="rk">📣</div>
          <div style="flex:1">
            <div class="nm">${esc(relTitulo(r))} ${crit?'<span class="pr" style="background:rgba(255,45,85,.2);color:#ff8fa3">🔴 IRRITADO</span>':''}</div>
            <div class="ci">🏥 <b>${esc(r.clinica||"—")}</b>${r.medico?" · "+esc(r.medico):""} · ${o.ic} ${o.lbl} · 📅 ${esc(fmtDataBR(r.data)||"")}${r.hora?" 🕐 "+esc(r.hora):""} · 👤 ${esc(r.por||"—")}</div>
            <div class="lastint" style="white-space:normal">"${esc((r.texto||"").slice(0,240))}${(r.texto||"").length>240?"…":""}"</div>
            ${ps.length?`<div class="complist" style="margin-top:6px">${ps.map(p=>`<span class="comp-pill">${p.ic} ${p.lbl}</span>`).join("")}</div>`:""}
          </div></div>`; });
      c.innerHTML=`${toggle}${repBar}
        ${rqCount()?`<div class="proxhint" style="border-color:#FFB020;color:#ffd94d;background:rgba(255,176,32,.12);margin-bottom:12px">📴 <b>${rqCount()}</b> relato(s) salvos sem sinal — sincroniza sozinho quando a internet voltar</div>`:""}
        <button class="bigmic" id="relNovo" type="button" style="margin-bottom:6px">📣 Novo relato — 🎤 gravar por voz</button>
        <div class="t-mut" style="font-size:12px;margin-bottom:12px;text-align:center">Conte o que a clínica falou (ligação/reunião). Organizo em título, clínica, médico, data e as dores.</div>
        <div class="kgrid">
          ${kpi("g", hoje, "Hoje", "relatos de hoje")}
          ${kpi("", sem, "Na semana", "últimos 7 dias")}
          ${kpi("", clinicas, "Clínicas", "com relato")}
          ${kpi(criticos?"r":"", criticos, "Críticos", "cliente irritado")}
        </div>
        ${painArr.length?`<div class="card" style="margin:14px 0;border-color:rgba(255,138,0,.3)"><h3>🔥 Dores mais citadas pelas clínicas <span class="tag">o que a rua está falando</span></h3>${doresBars}<div class="t-mut" style="font-size:12px;margin-top:10px;line-height:1.5">Soma as dores de <b>todos</b> os relatos → mostra onde mais dói (operação, laudo, atendimento) pra direção agir na causa, não no sintoma.</div></div>`:""}
        <div class="tabsbar" style="margin:12px 0 8px"><div class="seclabel" style="margin:0">📣 Relatos · por mês</div><input class="wlsearch" id="lupaRel" placeholder="🔍 clínica, médico, dor…" value="${esc(search)}"></div>
        ${selBar(arr0.map(r=>r.id))}
        ${base.length?(arr0.length?body:`<div class="empty">Nada encontrado para "${esc(search)}".</div>`):`<div class="empty">Nenhum relato ainda. Toque <b>📣 Novo relato</b> e conte por voz o que a clínica falou — eu organizo em título, clínica, médico e dores. (Ex.: o relatório do Eitor: Animiau, Veterinária Aguiar, Prime Vet…)</div>`}`;
      wirePista();
      const rn=document.getElementById("relNovo"); if(rn) rn.onclick=()=>openRelato(null);
      document.querySelectorAll("#content [data-rel]").forEach(el=>el.onclick=()=>{ if(selMode){ const id=el.dataset.rel; SEL.has(id)?SEL.delete(id):SEL.add(id); renderTab(); return; } openRelato(el.dataset.rel); });
      const lr=document.getElementById("lupaRel");
      if(lr){ lr.addEventListener("input", ev=>{ search=ev.target.value; pinned=true; setPin(); const p=lr.selectionStart; renderTab(); const l2=document.getElementById("lupaRel"); if(l2){l2.focus(); try{l2.setSelectionRange(p,p);}catch(_){}}}); }
      return;
    }

    if(pistaView==="retornos"){
      let _rotaSeq=0; PENDING_ROTAS=[];
      const ret=pistaRetornos(all);
      const today=new Date(); today.setHours(0,0,0,0); const tISO=today.toISOString().slice(0,10);
      const semFimISO=new Date(today.getTime()+7*864e5).toISOString().slice(0,10);
      const atras=ret.filter(f=>f.proximo<tISO).length, semana=ret.filter(f=>f.proximo>=tISO&&f.proximo<=semFimISO).length;
      const bc={}; ret.forEach(f=>{const b=f.bairro||"(sem bairro)"; bc[b]=(bc[b]||0)+1;});
      const chips=Object.entries(bc).sort((a,b)=>b[1]-a[1]).map(([b,n])=>`<span class="comp-pill"><b>📍 ${esc(b)}</b> ${n}</span>`).join("");
      const linha=f=>`<div class="crow" data-fb="${esc(f.id)}" style="cursor:pointer">${selBox(f.id)}<div class="rk" style="color:#00D4FF">↻</div>
        <div><div class="nm">${esc(f.cliente||"(sem nome)")}${f.origem==="telefone"?' <span class="pr" style="background:rgba(0,212,255,.16);color:#9fe6ff;font-size:11px">📞 telefone</span>':""}</div><div class="ci">${esc((PRES[f.resultado]||PRES.visita).lbl)}${f.texto?' · "'+esc(f.texto.slice(0,60))+'"':''}</div></div><div class="mid"></div>
        <div class="rcell" style="flex-direction:column;gap:5px;align-items:stretch"><button class="baixabtn ok" data-cheguei="${esc(f.id)}" onclick="event.stopPropagation()" title="Cheguei na clínica — check-in de chegada (depois: feedback + saída)">📍 Cheguei</button><button class="baixabtn" data-jafoi="${esc(f.id)}" onclick="event.stopPropagation()" style="border-color:rgba(0,229,160,.4);color:#7effcf" title="O rep já foi mas ficou pendente — marcar como visitado (escritório, sem GPS)">✓ Já foi</button><button class="baixabtn no" data-desm="${esc(f.id)}" onclick="event.stopPropagation()" title="Cliente desmarcou — precisa do código da diretoria">🚫 desmarcou</button></div></div>`;
      // agenda por COMERCIAL → dia → bairro (cada vendedor tem a SUA rota; incompatibilidade vale por vendedor)
      const byRep={}; ret.forEach(f=>{ const rp=f.por||"(sem comercial)"; (byRep[rp]=byRep[rp]||[]).push(f); });
      const diaCard=(d, items)=>{ const bgrp={}; items.forEach(f=>{const b=f.bairro||"(sem bairro)"; (bgrp[b]=bgrp[b]||[]).push(f);});
        const bairrosNomes=Object.keys(bgrp), nb=bairrosNomes.length, late=d<tISO, ehoje=d===tISO, prox=(d>tISO&&d<=semFimISO);
        const cls = late?"retday-late" : (ehoje?"retday-hoje" : (prox?"retday-pulse":""));
        const head=`<div class="retday-h">📅 <b>${fmtDataBR(d)}</b>${late?' <span class="pr" style="background:rgba(255,84,112,.16);color:#ffb3c0">ATRASADO</span>':ehoje?' <span class="pr" style="background:rgba(255,196,0,.22);color:#ffd94d">HOJE — VÁ AQUI</span>':''} <span class="t-mut">· ${items.length} cliente(s)</span></div>`;
        const av=rotaAvaliar(items);
        const rid="rota_"+(_rotaSeq++);
        if(av.geoN>=2) PENDING_ROTAS.push({id:rid, items});
        const rota = (av.geoN>=2)
          ? `<div id="${rid}" class="rota-calc" style="padding:8px 10px;border-radius:6px;background:rgba(0,212,255,.08);color:#8aa2bd;font-size:12.5px;margin:6px 0">🏍️ conferindo distância real de moto pela rua…</div>`
          : (nb>1
            ? `<div class="rota-inc">🚨 ${nb} bairros no mesmo dia: <b>${esc(bairrosNomes.join(" · "))}</b> <span style="font-weight:500">(ainda sem GPS p/ medir — confira)</span></div>`
            : `<div class="rota-ok">✅ Rota compatível — todos em <b>${esc(bairrosNomes[0]||"—")}</b></div>`);
        const blocks=Object.entries(bgrp).sort((a,b)=>b[1].length-a[1].length).map(([b,fs])=>`<div class="retbairro">📍 ${esc(b)} <span class="t-mut">(${fs.length})</span></div>`+fs.map(linha).join("")).join("");
        const rurl=mapsRotaURL(items);
        const rotaBtn=rurl?`<a class="baixabtn ok" href="${rurl}" target="_blank" onclick="event.stopPropagation()" style="display:inline-block;margin:0 0 8px">🗺️ Ver distância real + navegar no Maps (${ordenarRota(items).length} paradas, na melhor ordem)</a>`:"";
        return `<div class="card retday-card ${cls}" style="margin-bottom:12px">${head}${rota}${rotaBtn}${blocks}</div>`; };
      const agenda=Object.keys(byRep).sort().map(rp=>{ const items=byRep[rp], byDate={}; items.forEach(f=>{(byDate[f.proximo]=byDate[f.proximo]||[]).push(f);});
        const dias=Object.keys(byDate).sort().map(d=>diaCard(d, byDate[d])).join("");
        return `<div class="repagenda"><div class="repagenda-h">👤 <b>${esc(rp)}</b> · agenda de rota <span class="t-mut" style="font-weight:500">(${items.length} retorno${items.length>1?'s':''})</span></div>${dias}</div>`; }).join("");
      // 🎯 clientes lançados SEM data (o escritório põe; o vendedor decide quando ir)
      const aVisitar=all.filter(f=>f.a_visitar && !f.baixa && !f.proximo);
      const avByRep={}; aVisitar.forEach(f=>{ const rp=f.por||"(sem comercial)"; (avByRep[rp]=avByRep[rp]||[]).push(f); });
      const linhaAV=f=>`<div class="crow" data-fb="${esc(f.id)}" style="cursor:pointer">${selBox(f.id)}<div class="rk" style="color:#00E5A0">🎯</div>
        <div><div class="nm">${esc(f.cliente||"(sem nome)")} <span class="t-mut" style="font-weight:500;font-size:12px">· 📍 ${esc(f.bairro||"—")}</span></div><div class="ci">${f.texto?'"'+esc(f.texto.slice(0,70))+'"':"cliente pra visitar — sem data"}</div></div><div class="mid"></div>
        <div class="rcell" style="flex-direction:column;gap:5px;align-items:stretch"><button class="baixabtn ok" data-cheguei="${esc(f.id)}" onclick="event.stopPropagation()" title="Cheguei na clínica — check-in de chegada (depois: feedback + saída)">📍 Cheguei</button><button class="baixabtn no" data-delav="${esc(f.id)}" onclick="event.stopPropagation()" title="Remover da lista de visita">🗑️</button></div></div>`;
      const avSec=aVisitar.length?`<div class="seclabel" style="margin-top:4px;color:#7effcf">🎯 A visitar — SEM data <span class="t-mut" style="font-weight:500">— lançados pelo escritório; o vendedor escolhe quando ir (${aVisitar.length})</span></div>`+Object.keys(avByRep).sort().map(rp=>`<div class="repagenda" style="border-color:rgba(0,229,160,.3)"><div class="repagenda-h">👤 <b>${esc(rp)}</b> <span class="t-mut" style="font-weight:500">(${avByRep[rp].length} p/ visitar)</span></div>${avByRep[rp].map(linhaAV).join("")}</div>`).join(""):"";
      // 📅 ATIVIDADE DE HOJE — o que cada rep JÁ FEZ hoje (visitas realizadas + contatos por telefone), pra Luciane não caçar um por um
      const t0=today.getTime();
      const atvHoje=all.filter(f=>Math.max(f.ts||0, realizadaTs(f))>=t0)
        .filter(f=>ehRealizada(f)||f.origem==="telefone"||(f.baixa&&f.baixa.tipo==="desmarcado"))
        .sort((a,b)=>Math.max(b.ts||0,realizadaTs(b))-Math.max(a.ts||0,realizadaTs(a)));
      const atvByRep={}; atvHoje.forEach(f=>{ const rp=f.por||"(sem comercial)"; (atvByRep[rp]=atvByRep[rp]||[]).push(f); });
      const p3=n=>String(n).padStart(2,"0");
      const linhaAtv=f=>{ const t=new Date(Math.max(f.ts||0,realizadaTs(f)));
        const tipo=f.origem==="telefone"?'<span class="pr" style="background:rgba(0,212,255,.16);color:#9fe6ff;font-size:11px">📞 telefone</span>':(f.baixa&&f.baixa.tipo==="desmarcado")?'<span class="pr" style="background:rgba(255,138,0,.18);color:#ffc266;font-size:11px">🚫 desmarcou</span>':'<span class="pr" style="background:rgba(0,229,160,.16);color:#7effcf;font-size:11px">🚶 visita</span>';
        const mapa=(f.checkin&&f.checkin.ts)?` · <a href="https://maps.google.com/?q=${f.checkin.lat},${f.checkin.lng}" target="_blank" onclick="event.stopPropagation()" style="color:#7effcf">📍</a>`:"";
        return `<div class="crow" data-fb="${esc(f.id)}" style="cursor:pointer"><div class="rk" style="color:#00D4FF;font-size:12px;font-weight:700">${p3(t.getHours())}:${p3(t.getMinutes())}</div>
          <div><div class="nm">${esc(f.cliente||"(sem nome)")} ${tipo}</div><div class="ci">${esc((PRES[f.resultado]||PRES.visita).lbl)}${f.texto?' · "'+esc(f.texto.slice(0,60))+'"':''}${mapa}</div></div><div class="mid"></div></div>`; };
      const hojeSec=Object.keys(atvByRep).sort().map(rp=>`<div class="repagenda"><div class="repagenda-h">👤 <b>${esc(rp)}</b> · fez hoje <span class="t-mut" style="font-weight:500">(${atvByRep[rp].length})</span></div>${atvByRep[rp].map(linhaAtv).join("")}</div>`).join("")||`<div class="empty">Ninguém registrou visita ou contato hoje ainda.</div>`;
      c.innerHTML=`${toggle}${repBar}
        <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
          <button class="checkinbtn" id="addCliente" type="button" style="flex:1;min-width:160px;margin:0">🎯 Lançar cliente (sem data)</button>
          <button class="checkinbtn" id="agendarTel" type="button" style="flex:1;min-width:160px;margin:0">📞 Agendar por telefone</button>
        </div>
        <div class="subtabs" style="margin-bottom:10px"><button class="subtab ${!retHoje?'on':''}" id="retAgenda">📋 Agenda de rota</button><button class="subtab ${retHoje?'on':''}" id="retHojeBtn">📅 Fez hoje${atvHoje.length?` (${atvHoje.length})`:''}</button></div>
        ${retHoje?`
          <div class="seclabel">📅 Atividade de HOJE · por comercial <span class="t-mut" style="font-weight:500">— visitas e contatos que o rep fez hoje (não precisa procurar um por um)</span></div>
          ${hojeSec}
        `:`
        <div class="kgrid">
          ${kpi("r", atras, "Atrasados", "passaram da data")}
          ${kpi("a", semana, "Esta semana", "próximos 7 dias")}
          ${kpi("", ret.length, "Retornos", repFilter?("de "+esc(repFilter)):"pendentes")}
          ${kpi(aVisitar.length?"g":"", aVisitar.length, "A visitar", "sem data ainda")}
        </div>
        ${selBar([...ret.map(f=>f.id), ...aVisitar.map(f=>f.id)])}
        ${avSec}
        ${ret.length?`<div class="card" style="margin-bottom:14px;border-color:rgba(0,212,255,.3)"><h3>🗺️ Por bairro — pra montar a rota <span class="tag">junte o mesmo bairro no mesmo dia</span></h3><div class="complist">${chips}</div></div>`:""}
        <div class="seclabel">📅 Agenda de rota · por comercial → dia <span class="t-mut" style="font-weight:500">— dias da semana piscam amarelo (ir); ⚠️ mistura de bairros no mesmo dia = rota inviável</span></div>
        ${ret.length? agenda : `<div class="empty">Sem retornos agendados. Lance clientes acima (🎯 sem data ou 📞 por telefone) ou preencha o retorno num feedback — a agenda se monta aqui.</div>`}`}`;
      wirePista();
      const rAg=document.getElementById("retAgenda"); if(rAg) rAg.onclick=()=>{ retHoje=false; renderTab(); };
      const rHj=document.getElementById("retHojeBtn"); if(rHj) rHj.onclick=()=>{ retHoje=true; renderTab(); };
      const acb=document.getElementById("addCliente"); if(acb) acb.onclick=()=>openAddCliente();
      document.querySelectorAll("#content [data-delav]").forEach(el=>el.onclick=async(e)=>{ e.stopPropagation(); const f=PISTA.find(x=>x.id===el.dataset.delav); if(f && confirm(`Remover "${f.cliente||""}" da lista de visita?`)){ await removePista(f.id); renderTab(); } });
      upgradeRotas();   // troca a estimativa por reta pela distância de RUA real (OSRM) quando online
      return;
    }

    if(pistaView==="realizados"){
      const p2=n=>String(n).padStart(2,"0"), now=Date.now(); const d0=new Date(); d0.setHours(0,0,0,0);
      const rHoje=realizados.filter(f=>realizadaTs(f)>=d0.getTime()).length, rSem=realizados.filter(f=>realizadaTs(f)>=now-7*864e5).length, rMes=realizados.filter(f=>realizadaTs(f)>=now-30*864e5).length;
      const q=search.trim().toLowerCase();
      const arr=q?realizados.filter(f=>((f.cliente||"")+" "+(f.por||"")+" "+(f.bairro||"")).toLowerCase().includes(q)):realizados;
      let body="",curM=null;
      arr.forEach(f=>{ const d=new Date(realizadaTs(f)), mk=d.getFullYear()*100+(d.getMonth()+1), pr=PRES[f.resultado]||PRES.visita, dd=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'][d.getDay()];
        if(mk!==curM){ curM=mk; body+=`<div class="monthhead">${MESF[d.getMonth()+1]} ${d.getFullYear()}</div>`; }
        body+=`<div class="crow" data-fb="${esc(f.id)}" style="cursor:pointer">${selBox(f.id)}<div class="rk" style="color:#00E5A0">✅</div>
          <div><div class="nm">${esc(f.cliente||"(sem nome)")} <span class="t-mut" style="font-weight:500;font-size:12px">· realizado ${dd} ${p2(d.getDate())}/${p2(d.getMonth()+1)} ${p2(d.getHours())}:${p2(d.getMinutes())}</span>${(f.baixa&&f.baixa.manual)?' <span class="pr" style="background:rgba(255,196,0,.18);color:#ffd94d;font-size:10px">escritório (sem GPS)</span>':(temPresenca(f)?' <span class="pr" style="background:rgba(0,229,160,.16);color:#7effcf;font-size:10px">✓ check-in</span>':'')}</div>
            <div class="ci">👤 ${esc(f.por||"—")} · 📍 ${esc(f.bairro||"—")}${(f.baixa&&f.baixa.manual&&f.baixa.marcou)?` · marcou: ${esc(f.baixa.marcou)}`:''}</div>
            <div class="ci" style="font-size:11.5px;margin-top:2px">${checkinResumo(f.checkin&&f.checkin.ts?f.checkin:(f.baixa&&f.baixa.checkin),f.checkout&&f.checkout.ts?f.checkout:(f.baixa&&f.baixa.checkout))}</div>
            ${f.texto?`<div class="lastint">"${esc(f.texto.slice(0,80))}"</div>`:""}</div>
          <div class="mid"></div>
          <div class="rcell" style="flex-direction:column;gap:5px;align-items:stretch"><span class="pr" style="background:${pr.col}22;color:${pr.col}">${esc(pr.lbl)}</span><button class="baixabtn ok" data-reag="${esc(f.id)}" onclick="event.stopPropagation()" title="Cliente pediu outra revisita — marca nova data e volta pra Retornos">🔁 Reagendar</button><button class="baixabtn no" data-undobaixa="${esc(f.id)}" onclick="event.stopPropagation()" title="Desfazer baixa — confirmei errado">↩ Voltar etapa</button></div></div>`; });
      c.innerHTML=`${toggle}${repBar}
        <div class="kgrid">
          ${kpi("g", rHoje, "Hoje", "visitas realizadas")}
          ${kpi("", rSem, "Na semana", "últimos 7 dias")}
          ${kpi("g", rMes, "No mês", "últimos 30 dias")}
          ${kpi("", realizados.length, "Total", "com check-in")}
        </div>
        <div class="tabsbar" style="margin:16px 0 8px">
          <div class="seclabel" style="margin:0">✅ Visitas realizadas · por mês e ano <span class="t-mut" style="font-weight:500">— baixa por check-in (prova de presença)</span></div>
          <input class="wlsearch" id="lupaReal" placeholder="🔍 cliente, comercial, bairro…" value="${esc(search)}">
        </div>
        ${selBar(arr.map(f=>f.id))}
        ${realizados.length?(arr.length?body:`<div class="empty">Nada encontrado para "${esc(search)}".</div>`):`<div class="empty">Nenhuma visita com baixa ainda. Dê baixa num retorno (✓ check-in na clínica) e ela aparece aqui como realizada — com data, comercial e o pino do mapa.</div>`}`;
      wirePista();
      const lpr=document.getElementById("lupaReal");
      if(lpr){ lpr.addEventListener("input", ev=>{ search=ev.target.value; pinned=true; setPin(); const pp=lpr.selectionStart; renderTab(); const l4=document.getElementById("lupaReal"); if(l4){l4.focus(); try{l4.setSelectionRange(pp,pp);}catch(_){}}}); }
      return;
    }

    if(pistaView==="bi"){
      const base=all, total=base.length;
      const realiz=base.filter(ehRealizada).length;   // conta check-in de chegada, não só a baixa formal
      const desm=base.filter(f=>f.baixa&&f.baixa.tipo==="desmarcado").length;
      const fechou=base.filter(f=>f.resultado==="fechou").length;
      const taxaReal=(realiz+desm)?Math.round(100*realiz/(realiz+desm)):0;
      const conv=total?Math.round(100*fechou/total):0;
      c.innerHTML=`${toggle}${repBar}
        <div class="kgrid">
          ${kpi("", total, "Feedbacks", repFilter?("de "+esc(repFilter)):"total")}
          ${kpi("g", realiz, "Realizadas", "com check-in")}
          ${kpi("g", taxaReal+"%", "Taxa de realização", "feitas ÷ (feitas+desmarcadas)")}
          ${kpi("g", conv+"%", "Conversão", "fecharam ÷ total")}
        </div>
        <div class="bigrid">
          <div class="card"><h3>Visitas por comercial</h3><div class="cwrap"><canvas id="pbRep"></canvas></div></div>
          <div class="card"><h3>Resultados das visitas</h3><div class="cwrap"><canvas id="pbRes"></canvas></div></div>
        </div>
        <div class="bigrid">
          <div class="card"><h3>Visitas por dia <span class="tag">14 dias</span></h3><div class="cwrap"><canvas id="pbDia"></canvas></div></div>
          <div class="card"><h3>Objeções / não-avanço</h3><div class="cwrap"><canvas id="pbObj"></canvas></div></div>
        </div>
        ${(()=>{ const fech=base.filter(f=>f.resultado==="fechou").sort((a,b)=>(b.ts||0)-(a.ts||0)); if(!fech.length) return "";
          let bb="",cm=null; fech.forEach(f=>{const d=new Date(f.ts),mk=d.getFullYear()*100+(d.getMonth()+1),pp=n=>String(n).padStart(2,"0");
            if(mk!==cm){cm=mk;bb+=`<div class="monthhead">${MESF[d.getMonth()+1]} ${d.getFullYear()}</div>`;}
            bb+=`<div class="crow" data-fb="${esc(f.id)}" style="cursor:pointer"><div class="rk" style="color:#00E5A0">🏆</div><div><div class="nm">${esc(f.cliente||"(sem nome)")} <span class="t-mut" style="font-weight:500;font-size:12px">· ${pp(d.getDate())}/${pp(d.getMonth()+1)}</span></div><div class="ci">👤 ${esc(f.por||"—")} · 📍 ${esc(f.bairro||"—")}</div></div><div class="mid"></div><div class="rcell"><span class="pr" style="background:rgba(0,229,160,.16);color:#7effcf">✅ Fechou</span></div></div>`;});
          return `<div class="seclabel" style="margin-top:18px">🏆 Clientes fechados (${fech.length})</div>${bb}`; })()}
        ${total?"":`<div class="empty">Sem dados ainda — os gráficos aparecem conforme o time registra visitas.</div>`}`;
      wirePista();
      drawPistaBI(base);
      return;
    }

    if(pistaView==="naofeitos"){
      const linhaNF=(f, badge, isDesm, noPulse)=>`<div class="crow retday-card${noPulse?"":" retday-pulse"}" data-fb="${esc(f.id)}" style="margin-bottom:8px;padding:10px;cursor:pointer">
        ${selBox(f.id)}<div class="rk" style="color:${noPulse?"#FF8A00":"#FFD000"}">${noPulse?"🚫":"⏰"}</div>
        <div><div class="nm">${esc(f.cliente||"(sem nome)")} <span class="t-mut" style="font-weight:500;font-size:12px">${badge}</span></div>
          <div class="ci">👤 ${esc(f.por||"—")} · 📍 ${esc(f.bairro||"—")}${f.texto?' · "'+esc(f.texto.slice(0,50))+'"':''}</div>
          ${(f.baixa&&f.baixa.motivo)?`<div class="lastint">motivo: "${esc(f.baixa.motivo)}"</div>`:""}
          ${(f.obs&&f.obs.length)?`<div class="ci" style="font-size:11.5px;margin-top:2px;color:#9fe6ff">${f.obs.map(o=>`💬 "${esc(o.texto)}" <span class="t-mut">— ${esc(o.por||"")}</span>`).join("<br>")}</div>`:""}</div>
        <div class="mid"></div>
        <div class="rcell" style="flex-direction:column;gap:5px;align-items:stretch"><button class="baixabtn ok" data-reag="${esc(f.id)}" onclick="event.stopPropagation()">🔁 Reagendar</button><button class="baixabtn no" data-obs="${esc(f.id)}" onclick="event.stopPropagation()" title="Registrar o motivo de não ter ido (sem reagendar)" style="color:#9fe6ff">📝 Motivo</button>${isDesm?`<button class="baixabtn no" data-undobaixa="${esc(f.id)}" onclick="event.stopPropagation()" title="Desmarcaram por engano — desfaz e volta ao retorno original">↩ Voltar etapa</button>`:""}</div></div>`;
      const secA=naofeitosAtras.length?`<div class="seclabel">🔴 Atrasados — passou da data e não teve baixa (${naofeitosAtras.length})</div>`+naofeitosAtras.map(f=>linhaNF(f,"· venceu "+fmtDataBR(f.proximo))).join(""):"";
      const secB=naofeitosDesmReag.length?`<div class="seclabel" style="margin-top:16px">🚫 Desmarcados — a visita não aconteceu, reagende (${naofeitosDesmReag.length})</div>`+naofeitosDesmReag.map(f=>linhaNF(f,"· desmarcado",true)).join(""):"";
      const secC=naofeitosPerdidos.length?`<div class="seclabel" style="margin-top:16px;color:#ffc266">🚫 Perdidos — cliente não quis mais (fora da agenda, no histórico/BI) (${naofeitosPerdidos.length})</div>`+naofeitosPerdidos.map(f=>linhaNF(f,"· perdido",true,true)).join(""):"";
      const temAlgo=naofeitosN||naofeitosPerdidos.length;
      c.innerHTML=`${toggle}${repBar}
        <div class="kgrid">
          ${kpi("r", naofeitosAtras.length, "Atrasados", "venceu sem baixa")}
          ${kpi("a", naofeitosDesmReag.length, "Desmarcados", "reagende")}
          ${kpi("", naofeitosPerdidos.length, "Perdidos", "não quis mais")}
        </div>
        <div class="t-mut" style="font-size:12.5px;margin:2px 0 10px;line-height:1.5">⏰ Retornos que <b>não foram feitos</b> (venceram sem baixa) + <b>desmarcados</b> (a visita não aconteceu). A diretoria só <b>libera o código</b> — o <b>rep</b> escolhe o destino: <b>🔁 remarcar</b> (volta pra rota) ou <b>🚫 perdido</b> (sai da agenda, fica no histórico/BI). Nada some sem rastro.</div>
        ${selBar([...naofeitosAtras,...naofeitosDesmReag,...naofeitosPerdidos].map(f=>f.id))}
        ${temAlgo?(secA+secB+secC):`<div class="empty">Nada pendente aqui 👌 — retornos em dia.</div>`}`;
      wirePista();
      return;
    }

    if(pistaView==="exclusoes"){
      const qx=search.trim().toLowerCase();
      const arrx=qx?EXCL.filter(e=>((e.cliente||"")+" "+(e.por_exclusao||"")+" "+(e.motivo||"")+" "+(e.bairro||"")).toLowerCase().includes(qx)):EXCL;
      let bodyx="",curMx=null;
      arrx.forEach(e=>{ const d=new Date(e.ts), mk=d.getFullYear()*100+(d.getMonth()+1), p2=n=>String(n).padStart(2,"0");
        if(mk!==curMx){ curMx=mk; bodyx+=`<div class="monthhead">${MESF[d.getMonth()+1]} ${d.getFullYear()}</div>`; }
        bodyx+=`<div class="crow">
          <div class="rk" style="color:#FF5470">🗑️</div>
          <div><div class="nm">${esc(e.cliente||"(sem nome)")} <span class="t-mut" style="font-weight:500;font-size:12px">· ${['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'][d.getDay()]} ${p2(d.getDate())}/${p2(d.getMonth()+1)}/${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}</span></div>
            <div class="ci">excluído por <b>${esc(e.por_exclusao||"—")}</b>${e.por_registro?` · registrado por ${esc(e.por_registro)}`:""}${e.bairro?" · 📍 "+esc(e.bairro):""}</div>
            ${e.motivo?`<div class="lastint">motivo: "${esc(e.motivo)}"</div>`:""}${e.resumo?`<div class="t-mut" style="font-size:12px">era: "${esc(e.resumo)}"</div>`:""}</div>
          <div class="mid"></div>
          <div class="rcell"><span class="pr" style="background:rgba(255,84,112,.16);color:#ffb3c0">${esc(e.tipo||"excluído")}</span></div>
        </div>`; });
      c.innerHTML=`${toggle}
        <div class="kgrid">
          ${kpi("r", EXCL.length, "Exclusões", "total, permanente")}
          ${kpi("", new Set(EXCL.map(e=>e.por_exclusao)).size, "Quem excluiu", "pessoas distintas")}
          ${kpi("", EXCL.filter(e=>e.ts>=Date.now()-7*864e5).length, "Na semana", "últimos 7 dias")}
        </div>
        <div class="tabsbar" style="margin:16px 0 8px">
          <div class="seclabel" style="margin:0">🗑️ Histórico de exclusão · por mês e ano <span class="t-mut" style="font-weight:500">— quem, quando, motivo</span></div>
          <input class="wlsearch" id="lupaExcl" placeholder="🔍 cliente, quem excluiu, motivo…" value="${esc(search)}">
        </div>
        ${EXCL.length?(arrx.length?bodyx:`<div class="empty">Nada encontrado para "${esc(search)}".</div>`):`<div class="empty">Nenhuma exclusão ainda. Ao excluir um feedback (🗑️), ele vem parar aqui — permanente, com quem excluiu, quando e por quê.</div>`}`;
      wirePista();
      const lpx=document.getElementById("lupaExcl");
      if(lpx){ lpx.addEventListener("input", ev=>{ search=ev.target.value; pinned=true; setPin(); const pp=lpx.selectionStart; renderTab(); const l3=document.getElementById("lupaExcl"); if(l3){l3.focus(); try{l3.setSelectionRange(pp,pp);}catch(_){}}}); }
      return;
    }

    c.innerHTML=`${toggle}${repBar}
      ${pqCount()?`<div class="proxhint" style="border-color:#FFB020;color:#ffd94d;background:rgba(255,176,32,.12);margin-bottom:12px">📴 <b>${pqCount()}</b> feedback(s) salvos sem sinal — sincroniza sozinho quando a internet voltar${navigator.onLine?` · <a onclick="pqFlush()" style="color:var(--cyan);cursor:pointer;text-decoration:underline">sincronizar agora</a>`:""}</div>`:""}
      ${(()=>{ const v=visitaLoad(); if(!v||!v.checkin) return ""; const t=new Date(v.checkin.ts),pp=n=>String(n).padStart(2,"0");
        return `<div class="proxhint" style="border-color:#00E5A0;color:#7effcf;background:rgba(0,229,160,.14);margin-bottom:8px;font-size:14px">🟢 <b>Visita em andamento:</b> ${esc(v.cliente)}${v.bairro?" · 📍 "+esc(v.bairro):""} · chegou ${pp(t.getHours())}:${pp(t.getMinutes())}</div>
          <button class="bigmic" id="visFim" style="margin-bottom:6px">📝 Registrar feedback + check-out (sair)</button>
          <button class="baixabtn no" id="visCancel" type="button" style="width:100%;margin-bottom:12px">✖ Não cheguei ainda — cancelar chegada</button>`; })()}
      ${!visitaLoad()?`<button class="bigmic" id="visIni" type="button" style="margin-bottom:6px">📍 Cheguei — check-in de chegada (começa a visita)</button><div class="t-mut" style="font-size:12px;margin-bottom:12px;text-align:center">Bata o check-in ao CHEGAR. O feedback + saída você faz ao sair.</div>`:""}
      <div class="kgrid">
        ${kpi("g", hoje, "Hoje", "feedbacks de hoje")}
        ${kpi("", sem, "Na semana", "últimos 7 dias")}
        ${kpi("g", fechou, "Fecharam", "resultado = fechou")}
        ${kpi("", all.length, repFilter?"Do comercial":"Total", repFilter?esc(repFilter):"permanente")}
      </div>
      ${(rankHtml && !repFilter)?`<div class="card" style="margin-bottom:14px"><h3>🏆 Por comercial <span class="tag">feedbacks · fechados</span></h3><div class="legenda">${rankHtml}</div></div>`:""}
      <div class="tabsbar" style="margin:16px 0 8px">
        <div class="seclabel" style="margin:0">🏍️ Feedbacks da pista · por mês e ano <span class="t-mut" style="font-weight:500">— toque p/ editar</span></div>
        <input class="wlsearch" id="lupaPista" placeholder="🔍 cliente, texto ou resultado…" value="${esc(search)}">
      </div>
      ${selBar(arr.map(f=>f.id))}
      ${all.length ? (arr.length? body : `<div class="empty">Nada encontrado para "${esc(search)}".</div>`) : `<div class="empty">Nenhum feedback ainda. Toque <b>🎤 Gravar feedback</b> ao sair do cliente — fala 20s e pronto.</div>`}`;
    wirePista();
    const lp=document.getElementById("lupaPista");
    if(lp){ lp.addEventListener("input", e=>{ search=e.target.value; pinned=true; setPin(); const p=lp.selectionStart; renderTab(); const l2=document.getElementById("lupaPista"); if(l2){l2.focus(); try{l2.setSelectionRange(p,p);}catch(_){}}}); }
    return;
  }

  if(ACTIVE==="carteira"){
    const all = flt(act(D.carteira||[]));
    const q = search.trim().toLowerCase();
    const arr = q ? all.filter(x => (x.nome||"").toLowerCase().includes(q) || (x.cidade||"").toLowerCase().includes(q)) : all;
    c.innerHTML = `
      <div class="tabsbar" style="margin:16px 0 6px">
        <div class="seclabel" style="margin:0">👥 Carteira ativa — ${all.length} clientes</div>
        <input class="wlsearch" id="lupa" placeholder="🔍 buscar cliente ou cidade…" value="${esc(search)}">
      </div>
      ${list(arr, {badge:"sit", rank:false, fu:true})}`;
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
            : tb.k==="encerrados" ? ENCERR.size
            : tb.k==="inativos" ? INAT.size
            : tb.k==="reativados" ? new Set(reativadosEvents().map(e=>e.cod)).size
            : tb.k==="sensiveis" ? SENS.length
            : tb.k==="prospeccao" ? PROSP.length
            : tb.k==="pista" ? PISTA.length
            : (Array.isArray(D[tb.k]) ? act(D[tb.k]).length : (r[tb.k] || 0));
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
function brData(iso){ if(!iso) return "—"; const p=String(iso).slice(0,10).split("-"); return p.length===3?`${p[2]}/${p[1]}/${p[0]}`:iso; }
function footer(){
  const m = DATA.meta||{};
  const fora = ENCERR.size + INAT.size;
  document.getElementById("foot").innerHTML =
    `<b style="color:var(--ink)">🔒 ${ENCERR.size} encerrados${INAT.size?` + 🚫 ${INAT.size} inativos`:""} fora de todas as contagens</b> · base ${esc(brData(m.max_data))}<br>
     Fonte: ${esc(m.fonte||"—")} · ${esc(m.periodo||"")} · gerado ${esc(m.gerado_em||"—")}.<br>
     Sem valores financeiros. Atualização automática. — Agente CRM, frota Agentes de IA Alpha.`;
  const demo = /DEMO/i.test(m.fonte||"") || /DEMO/i.test(m.gerado_em||"");
  document.getElementById("demoFlag").classList.toggle("on", demo);
}

/* ---------- ciclo ---------- */
function renderAll(){ renderTabs(); renderTab(); if(DATA&&DATA.meta!==undefined) footer();
  const db=document.getElementById("diaBtn"); if(db){ db.classList.toggle("pinned",diaFilter); const n=dueCount(); db.innerHTML="📞 Contatos do dia"+(n?` (${n})`:""); } }
function applyLock(){
  locked = resolveLock();
  const rc = document.getElementById("rotctl"), db = document.getElementById("diaBtn");
  if(locked){ ACTIVE = locked; pinned = true; rc.style.display="none"; if(db) db.style.display="none"; }
  else { rc.style.display=""; if(db) db.style.display=""; }
}
function render(D){
  DATA = D;
  document.getElementById("app").style.display="block";
  applyLock();
  footer(); renderAll();
  renderOpBtn();
  const _ob=document.getElementById("opBtn"); if(_ob) _ob.onclick=()=>openIdentidade(false);
  loadOps().then(()=>{ if(!operadorAtual()) openIdentidade(true); });   // pede identidade 1x por aparelho
  if(!window.__fuwired){
    window.__fuwired = true;
    document.getElementById("content").addEventListener("click", e=>{
      const fb = e.target.closest(".fubtn"); if(fb){ toggleFollowup(fb.dataset.cod, fb.dataset.nome); return; }
      const rb = e.target.closest("[data-reg]"); if(rb){ openReg(rb.dataset.reg); return; }
    });
    const modal=document.getElementById("modal");
    if(modal) modal.addEventListener("click", e=>{ if(e.target===modal) closeModal(); });
    window.addEventListener("online", ()=>{ pqFlush(); rqFlush(); });   // voltou o sinal → sincroniza as filas offline
    Promise.all([loadFollowups(), loadInter(), loadHist(), loadEncerr(), loadInat(), loadSens(), loadProsp(), loadPista(), loadReps(), loadExcl(), loadRelatos(), loadOps(), loadClin(), loadCart(), loadClinRS(), loadRel(), loadDet(), loadAAA()]).then(async ()=>{
      const fc=dirCodeCache(); if(fc && CLIN_RS_ENV && !CLIN_RS && !localStorage.getItem("crm_bio_id")){ const ok=await decDirRS(fc); if(ok) localStorage.setItem("crm_operador_papel","diretoria"); }   // sem digital: R$ abre sozinho; COM digital: pede a biometria ao tocar
      pqFlush(); rqFlush(); renderOpBtn(); renderAll(); });
    setInterval(async()=>{ const sig=()=>[...FOLLOWED.keys()].sort().join()+"|"+INTER.length+"|"+HIST.length+"|"+ENCERR.size+"|"+INAT.size+"|"+SENS.length+"|"+PROSP.length+"|"+PISTA.length+"|"+REPS.length+"|"+EXCL.length+"|"+RELATOS.length+"|"+CARTEIRA.length+"|"+CLINICAS.length;
      await pqFlush(); await rqFlush(); const a=sig(); await Promise.all([loadFollowups(), loadInter(), loadHist(), loadEncerr(), loadInat(), loadSens(), loadProsp(), loadPista(), loadReps(), loadExcl(), loadRelatos(), loadClin(), loadCart(), loadDet(), loadAAA(), loadRel()]);
      if(ehDiretoria() && dirCodeCache()){ await loadClinRS(); await decDirRS(dirCodeCache()); }   // R$/conquistas frescos p/ diretoria
      if(a!==sig()) renderTab(); }, 45000);
  }
}
window.addEventListener("hashchange", ()=>{ if(DATA){ applyLock(); search=""; renderAll(); } });

document.getElementById("rotctl").addEventListener("click", ()=>{ if(locked) return; pinned=!pinned; setPin(); if(!pinned){search="";} renderAll(); });
document.getElementById("diaBtn").addEventListener("click", ()=>{ diaFilter=!diaFilter; if(diaFilter && !locked){ pinned=true; setPin(); } renderAll(); });
setInterval(clock, 1000); clock();
setInterval(()=>{ if(DATA) rotate(); }, ROT_MS);

initGate({ encUrl:"data/crm.enc", lsKey:"agente_crm_matriz", onData:render, refreshMs:600000 });

/* ---- LOGIN INDIVIDUAL (nome + PIN) — acaba a senha única; senha do time vira recuperação ---- */
async function initLogin(){
  const form=document.getElementById("loginForm"); if(!form) return;
  const nomeEl=document.getElementById("loginNome"), pinEl=document.getElementById("loginPin"),
        err=document.getElementById("loginErr"), dl=document.getElementById("loginNomes"), btn=document.getElementById("loginBtn");
  const fillNomes=()=>{ if(dl) dl.innerHTML=OPERADORES.map(o=>`<option value="${esc(o.nome)}">`).join(""); };
  try{ await loadOps(); fillNomes(); }catch(e){}
  form.addEventListener("submit", async e=>{ e.preventDefault(); err.textContent="";
    const nome=nomeEl.value.trim(), pin=pinEl.value.trim();
    if(!nome||!pin){ err.textContent="Preencha nome e PIN."; return; }
    btn.disabled=true; btn.textContent="Entrando…";
    try{
      const r=await fetch("/api/crm-operadores",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({acao:"login",nome,pin})});
      const j=await r.json();
      if(!j.ok){ err.textContent = j.motivo==="inativo" ? "Acesso desativado — fale com a diretoria." : (j.motivo==="nao_existe" ? "Nome não encontrado. Toque '➕ Criar meu acesso'." : "PIN incorreto."); btn.disabled=false; btn.textContent="Entrar"; pinEl.select(); return; }
      const D=await decryptEnc("data/crm.enc", j.key);
      localStorage.setItem("agente_crm_matriz", j.key); window.__pwd=j.key;
      setOperador(j.nome, j.papel);
      if(j.papel==="diretoria" && j.finkey) await autoRSdir(j.finkey);   // diretoria: R$ abre sozinho ao logar
      document.getElementById("gate").style.display="none";
      render(D);
      try{ if(typeof window.__crmMostraBioSetup==="function") window.__crmMostraBioSetup(); }catch(e){}   // oferece "👆 Proteger com digital" já no 1º login
    }catch(ex){ err.textContent="Erro ao entrar (sem internet?)."; btn.disabled=false; btn.textContent="Entrar"; }
  });
  document.getElementById("loginNovo").onclick=async()=>{
    const tp=(prompt("Para CRIAR um acesso novo, digite a senha do time (só quem já tem acesso pode criar):")||"").trim(); if(!tp) return;
    const nome=(prompt("Seu nome (ex.: Fábio):")||"").trim(); if(!nome) return;
    const pin=(prompt("Crie seu PIN (mínimo 6 números):")||"").trim(); if(pin.length<6){ alert("O PIN precisa de pelo menos 6 números."); return; }
    try{ const r=await fetch("/api/crm-operadores",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({acao:"add",nome,pin,senha:tp})});
      if(r.status===401){ alert("Senha do time incorreta."); return; }
      if(r.status===409){ alert("Já existe esse nome — é só entrar com ele e seu PIN."); return; }
      if(r.ok){ syncOps((await r.json()).operadores); fillNomes(); nomeEl.value=nome; alert("✅ Acesso criado! Agora entre com seu nome + PIN."); pinEl.focus(); }
      else alert("Não consegui criar (tente de novo).");
    }catch(ex){ alert("Sem internet — precisa de conexão."); } };
  document.getElementById("loginAdmin").onclick=()=>{ form.style.display="none"; document.getElementById("gateForm").style.display=""; document.getElementById("gatePwd").focus(); };
  const vlt=document.getElementById("loginVoltar"); if(vlt) vlt.onclick=()=>{ document.getElementById("gateForm").style.display="none"; form.style.display=""; nomeEl.focus(); };
}
initLogin();
