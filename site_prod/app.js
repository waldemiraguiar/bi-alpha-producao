/* Painel de Produção (TV) — abas por categoria, derivações visuais, rotação automática.
   Trava por categoria via URL (#15 ou #citopatologia) para TVs de setor. Sem R$, sem volumes. */
const C={navy:'#0A1628',cyan:'#00D4FF',green:'#00E5A0',amber:'#FFB020',red:'#FF5470',purple:'#A78BFA',petlove:'#FF6AD5',mut:'#8aa2bd'};
const num=n=>Math.round(n||0).toLocaleString('pt-BR');
const LS='bi_prod_pwd', ROTATE=15000; // 15s por categoria
const b64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
let ENC=null,REFRESH=null,ROT=null,DATA=null,active=0,locked=null,pinned=false;
const URG_API='/api/urgentes';
let manual=new Set(), baixados=new Set(), baixasInfo=[];
// baixa de EXAME na Produção (PIN admin) — chave única por exame = registro|exame
let prodBaixados=new Set(), prodBaixaInfo=[];
// ESPELHO de "Avisar cliente" da Triagem (marcações insuficiente do sep_marks) — read-only, sempre pareado
let avisarMarks=[];
const exChave=e=>String(e.registro)+'|'+(e.exame||'');
const exBaixado=e=>prodBaixados.has(exChave(e));
// 🔒 TRAVADOS na Produção (reusa sep_marks com chave 'prod:registro|exame'; motivo em texto livre = obs)
let prodTravados=[], prodTravadoSet=new Set(), prodTravadosHist=[], prodTravaMap={};
// 🔬 ESPELHO Histotécnica · Controle de Amostras (mirror read-only da Triagem, cat Cito/Histo/Necrópsia)
let sepMarksMap={}, histotecQ='';
// normaliza p/ busca: tira ACENTO + minúsculas (mantém espaços/números) → busca com e sem acento
const normAcc=s=>String(s==null?'':s).normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
const HISTOTEC_CATS=['citopatologia','histologia','necropsia'];
function histotecItens(){ const sep=(typeof DATA!=='undefined'&&DATA&&DATA.separacao&&DATA.separacao.itens)||[]; return sep.filter(it=>HISTOTEC_CATS.includes(slug(it.cat))); }
const exTravado=e=>prodTravadoSet.has('prod:'+exChave(e));
const diasTravaP=m=>{const ini=Number(m.ts_sep)||0,fim=Number(m.ts_receb)||Date.now();if(!ini)return null;return Math.max(0,Math.floor((fim-ini)/86400000));};
const labelDiasP=m=>{const d=diasTravaP(m);if(d==null)return '';return d<1?'menos de 1 dia':`${d} dia${d>1?'s':''}`;};
const fmtDataHoraP=ts=>{const n=Number(ts);if(!n)return '—';const iso=new Date(n-3*3600e3).toISOString();return `${iso.slice(8,10)}/${iso.slice(5,7)}/${iso.slice(0,4)} às ${iso.slice(11,16)}`;};
// histórico de TRAVA que ACOMPANHA o paciente na fila normal (mostra na linha de trabalho, sem abrir a aba Travados)
function travHistLine(e){
  const m=prodTravaMap['prod:'+exChave(e)]; if(!m||m.estado!=='destravado') return '';   // só os já liberados voltam pra fila
  const vez=(Number(m.corte)||1)>1?` · 🔁 ${m.corte}×`:'';
  return `<div class="travahist"><b>📋 Já foi travado</b><div>🔒 <b>Motivo:</b> ${esc(m.obs||'(sem motivo)')}${vez}</div><div>🔒 <b>Travou:</b> ${esc(m.por||'—')} — ${fmtDataHoraP(m.ts_sep)}</div><div>✅ <b>Destravou:</b> ${esc(m.por_receb||'—')} — ${fmtDataHoraP(m.ts_receb)}</div><div>⏱️ <b>Ficou travado:</b> ${labelDiasP(m)}</div></div>`;
}
function setOverlays(j){manual=new Set((j.urgentes||[]).map(u=>String(u.registro))); baixados=new Set((j.baixas||[]).map(u=>String(u.registro))); baixasInfo=(j.baixas||[]);}
async function loadManual(){ try{ if(window.SUPA&&window.SUPA.ok){const o=await window.SUPA.loadUrg(); setOverlays({urgentes:o.urgentes,baixas:o.baixas}); try{prodBaixaInfo=await window.SUPA.loadProd(); prodBaixados=new Set(prodBaixaInfo.filter(b=>!b.desfeito).map(b=>String(b.chave)));}catch(e){} try{const s=await window.SUPA.loadSep(); const desc=new Set((s.descartes||[]).map(d=>String(d.chave))); avisarMarks=(s.marks||[]).filter(m=>m&&m.estado==='insuficiente'&&!desc.has(String(m.chave))); prodTravados=(s.marks||[]).filter(m=>m&&m.estado==='travado'&&String(m.chave).startsWith('prod:')&&!desc.has(String(m.chave))); prodTravadoSet=new Set(prodTravados.map(m=>String(m.chave))); prodTravadosHist=(s.marks||[]).filter(m=>m&&m.estado==='destravado'&&String(m.chave).startsWith('prod:')&&!desc.has(String(m.chave))).sort((a,b)=>(Number(b.ts_receb)||0)-(Number(a.ts_receb)||0)); prodTravaMap={}; (s.marks||[]).forEach(m=>{if(m&&String(m.chave).startsWith('prod:')&&(m.estado==='travado'||m.estado==='destravado'))prodTravaMap[String(m.chave)]=m;}); sepMarksMap={}; (s.marks||[]).forEach(m=>{if(m&&m.chave)sepMarksMap[String(m.chave)]=m;});}catch(e){} return;} const r=await fetch('/api/overlays?_='+Date.now()); if(r.ok){const o=await r.json(); setOverlays({urgentes:o.urgentes,baixas:o.urg_baixas});}}catch(e){} }
// urgente de verdade = (sistema OU manual) E NÃO baixado
const urgentOf=e=>{const r=String(e.registro);return (e.urgente||manual.has(r))&&!baixados.has(r);};
async function post(payload,errMsg){
  try{
    if(window.SUPA&&window.SUPA.ok){
      const tbl=payload.tipo==='baixa'?'urg_baixas':'urg_lista';
      if(payload.acao==='remove') await window.SUPA.delUrg(tbl,payload.registro);
      else await window.SUPA.upsertUrg(tbl,{registro:String(payload.registro),paciente:payload.paciente||'',exame:payload.exame||'',por:payload.por||'equipe',ts:Date.now()});
      await loadManual(); renderActive(); return;
    }
    const r=await fetch(URG_API,{method:'POST',headers:{'Content-Type':'application/json'},
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
  const d=ev.target.closest('.desfazbtn'); if(d){post({tipo:'baixa',registro:d.dataset.reg,acao:'remove'},'Não foi possível desfazer.');return;}
  const xb=ev.target.closest('.exbaixabtn'); if(xb){exBaixar(xb.dataset);return;}
  const tv=ev.target.closest('.travarbtn'); if(tv){travarEx(tv.dataset);return;}
  const dv=ev.target.closest('.destravabtn'); if(dv){destravarEx(dv.dataset.chave);return;}
  const lb=ev.target.closest('.limpabtn'); if(lb){limparAtrasados();return;}
  const hb=ev.target.closest('.histbtn'); if(hb){openHistBaix();return;}}
// 🔒 travar / destravar exame na Produção (motivo em texto livre)
async function travarEx(d){
  if(!(window.SUPA&&window.SUPA.ok)){alert('Trava exige conexão em nuvem.');return;}
  const motivo=prompt('TRAVAR este exame na Produção.\n\nMotivo (financeiro, cadastro, problema de amostra…):','');
  if(motivo===null) return;
  const chave='prod:'+String(d.reg)+'|'+(d.exm||'');
  const por=(typeof __op!=='undefined'&&__op&&__op.nome)||'produção';
  const prev=prodTravaMap[chave]; const vezes=((prev&&Number(prev.corte))||0)+1;   // quantas vezes já travou
  try{ await window.SUPA.upsertMark({chave,req:d.reg,exame:d.exm||'',cat:d.cat||'',paciente:d.pac||'',estado:'travado',por,obs:(motivo||'').trim()||null,ts_sep:Date.now(),corte:vezes,por_receb:null,ts_receb:null}); await loadManual(); buildTabs(); renderActive(); }
  catch(e){ alert('Não consegui travar (a coluna obs já foi criada no banco?).'); }
}
async function destravarEx(chave){
  if(!confirm('Destravar este exame? Volta pra fila da Produção (fica no histórico).')) return;
  const por=(typeof __op!=='undefined'&&__op&&__op.nome)||'produção';
  try{ await window.SUPA.updateMark(chave,{estado:'destravado',por_receb:por,ts_receb:Date.now()}); await loadManual(); buildTabs(); renderActive(); }   // arquiva (não apaga) — guarda o histórico
  catch(e){ alert('Não consegui destravar.'); }
}
// --- LOGIN do colaborador p/ baixa de exame (mesma equipe da Triagem) ---
let __op=null, __opTimer=null;            // {nome, senha, papel} — sessão na memória; zera no auto-reload da meia-noite
// cada colaborador tem o próprio PC -> logout por inatividade bem longo (12h = turno inteiro)
function opTouch(){ if(__opTimer)clearTimeout(__opTimer); __opTimer=setTimeout(()=>{__op=null;}, 12*3600*1000); }
async function pedeLogin(){
  if(!(window.SUPA&&window.SUPA.ok)){alert('Sem conexão com o servidor — baixa indisponível.');return null;}
  if(__op){ opTouch(); return __op; }
  return new Promise(res=>openLoginBaixa(res));
}
async function openLoginBaixa(resolve){
  let team=[]; try{ team=await window.SUPA.teamNames(); }catch(e){}
  const done=v=>{ if(resolve){const r=resolve;resolve=null;r(v);} };
  const old=document.querySelector('.oplogin'); if(old) old.remove();
  const wrap=document.createElement('div'); wrap.className='oplogin';
  const opts=team.slice().sort((a,b)=>a.nome.localeCompare(b.nome)).map(u=>`<option value="${escA(u.nome)}">${esc(u.nome)}</option>`).join('');
  wrap.innerHTML=`<div class="oplbox"><h3>👤 Quem está dando baixa?</h3>
    <label>Colaborador</label><select id="opnome">${opts||'<option value="">(ninguém cadastrado)</option>'}</select>
    <label>Senha</label><input id="oppin" type="password" autocomplete="off" placeholder="sua senha">
    <div class="opmsg" id="opmsg"></div>
    <div class="opbtns"><button class="opb cancel" id="opcancel">Cancelar</button><button class="opb ok" id="opgo">Entrar</button></div>
    <div class="opreg">Primeiro acesso? <button class="oplink" id="opnew">Criar meu login</button> · <button class="oplink" id="opchg">Trocar senha</button></div></div>`;
  document.body.appendChild(wrap);
  const close=()=>wrap.remove();
  wrap.onclick=e=>{ if(e.target===wrap){close();done(null);} };
  wrap.querySelector('#opcancel').onclick=()=>{close();done(null);};
  wrap.querySelector('#opnew').onclick=()=>{ close(); openRegBaixa(done); };
  wrap.querySelector('#opchg').onclick=()=>{ close(); openChgBaixa(done, team); };
  const pin=wrap.querySelector('#oppin'); pin.focus();
  const go=async()=>{ const nome=wrap.querySelector('#opnome').value, p=pin.value;
    if(!nome||!p){pin.focus();return;}
    wrap.querySelector('#opmsg').textContent='Conferindo…';
    const r=await window.SUPA.login(nome,p);
    if(r.ok){ __op={nome,senha:p,papel:r.papel}; opTouch(); close(); done(__op); }
    else { wrap.querySelector('#opmsg').textContent='❌ Senha incorreta.'; pin.value=''; pin.focus(); } };
  wrap.querySelector('#opgo').onclick=go; pin.onkeydown=e=>{ if(e.key==='Enter')go(); };
}
function openRegBaixa(done){
  const wrap=document.createElement('div'); wrap.className='oplogin';
  wrap.innerHTML=`<div class="oplbox"><h3>➕ Criar meu acesso</h3>
    <label>Seu nome / iniciais (aparece no histórico)</label><input id="rgnome" autocomplete="off" placeholder="ex.: Ana, A. Silva">
    <label>Seu time</label><select id="rgpapel"><option value="ambos">Separação + Recebidos</option><option value="separacao">Separação</option><option value="recebidos">Recebidos</option></select>
    <label>Crie uma senha</label><input id="rgpin" type="password" autocomplete="new-password" placeholder="senha">
    <label>Repita</label><input id="rgpin2" type="password" autocomplete="new-password" placeholder="confirme">
    <div class="opmsg" id="rgmsg"></div>
    <div class="opbtns"><button class="opb cancel" id="rgback">Voltar</button><button class="opb ok" id="rggo">Criar e entrar</button></div></div>`;
  document.body.appendChild(wrap);
  const close=()=>wrap.remove();
  wrap.onclick=e=>{ if(e.target===wrap){close(); if(done)done(null);} };
  wrap.querySelector('#rgback').onclick=()=>{ close(); openLoginBaixa(done); };
  wrap.querySelector('#rgnome').focus();
  const go=async()=>{ const nome=wrap.querySelector('#rgnome').value.trim(), pp=wrap.querySelector('#rgpapel').value;
    const p1=wrap.querySelector('#rgpin').value, p2=wrap.querySelector('#rgpin2').value, msg=wrap.querySelector('#rgmsg');
    if(!nome||!p1){msg.textContent='Preencha nome e senha.';return;}
    if(p1!==p2){msg.textContent='As senhas não conferem.';return;}
    msg.textContent='Criando…';
    try{ const r=await window.SUPA.register(nome,pp,p1);
      if(r.ok){ __op={nome,senha:p1,papel:pp}; opTouch(); close(); if(done)done(__op); }
      else msg.textContent='❌ '+(r.erro||'Não foi possível criar.'); }
    catch(e){ msg.textContent='Erro de conexão.'; } };
  wrap.querySelector('#rggo').onclick=go; wrap.querySelector('#rgpin2').onkeydown=e=>{ if(e.key==='Enter')go(); };
}
function openChgBaixa(done, team){
  const wrap=document.createElement('div'); wrap.className='oplogin';
  const opts=(team||[]).slice().sort((a,b)=>a.nome.localeCompare(b.nome)).map(u=>`<option value="${escA(u.nome)}">${esc(u.nome)}</option>`).join('');
  wrap.innerHTML=`<div class="oplbox"><h3>🔑 Trocar minha senha</h3>
    <label>Colaborador</label><select id="cgnome">${opts}</select>
    <label>Senha atual</label><input id="cgold" type="password" autocomplete="off" placeholder="senha de agora">
    <label>Nova senha</label><input id="cgnew" type="password" autocomplete="new-password" placeholder="nova">
    <label>Repita</label><input id="cgnew2" type="password" autocomplete="new-password" placeholder="confirme">
    <div class="opmsg" id="cgmsg"></div>
    <div class="opbtns"><button class="opb cancel" id="cgback">Voltar</button><button class="opb ok" id="cggo">Salvar</button></div>
    <div class="opreg" style="font-size:12px">Esqueceu e não sabe a atual? Peça ao Wal resetar (👥 Equipe na Triagem).</div></div>`;
  document.body.appendChild(wrap);
  const close=()=>wrap.remove();
  wrap.onclick=e=>{ if(e.target===wrap){close(); if(done)done(null);} };
  wrap.querySelector('#cgback').onclick=()=>{ close(); openLoginBaixa(done); };
  const go=async()=>{ const nome=wrap.querySelector('#cgnome').value, o=wrap.querySelector('#cgold').value, n1=wrap.querySelector('#cgnew').value, n2=wrap.querySelector('#cgnew2').value, msg=wrap.querySelector('#cgmsg');
    if(!o||!n1){msg.textContent='Preencha as senhas.';return;}
    if(n1!==n2){msg.textContent='A nova senha não confere.';return;}
    msg.textContent='Salvando…';
    try{ const r=await window.SUPA.changePin(nome,o,n1);
      if(r.ok){ close(); alert('Senha trocada! Entre com a nova.'); openLoginBaixa(done); }
      else msg.textContent='❌ '+(r.erro||'Não foi possível.'); }
    catch(e){ msg.textContent='Erro de conexão.'; } };
  wrap.querySelector('#cggo').onclick=go; wrap.querySelector('#cgnew2').onkeydown=e=>{ if(e.key==='Enter')go(); };
}
async function exBaixar(d){
  if(!confirm(`Dar baixa no EXAME?\n\n#${d.reg} · ${d.pac}\n${d.exm}\n\nSai da Produção (não depende do HF). Dá pra desfazer.`))return;
  const op=await pedeLogin(); if(!op) return;
  try{ await window.SUPA.prodBaixar([{chave:d.reg+'|'+d.exm,registro:d.reg,exame:d.exm,paciente:d.pac,cat:d.cat,atrasado:d.atr==='1'}],op.nome,op.senha);
    await loadManual(); renderActive(); }
  catch(e){ if(/login|senha/i.test(e.message||''))__op=null; alert('Não foi possível: '+(e.message||e)); }
}
async function limparAtrasados(){
  const alvo=window.__limparAlvo||[]; if(!alvo.length){alert('Nenhum atrasado nesta aba.');return;}
  if(!confirm(`Limpar ${alvo.length} atrasado(s) desta aba?\n\nTodos saem da Produção (dá pra desfazer).`))return;
  const op=await pedeLogin(); if(!op) return;
  try{ await window.SUPA.prodBaixar(alvo,op.nome,op.senha); await loadManual(); renderActive(); }
  catch(e){ if(/login|senha/i.test(e.message||''))__op=null; alert('Não foi possível: '+(e.message||e)); }
}
// --- HISTÓRICO de exames baixados (datado, por período) ---
function _brtDate(ts){return new Date(new Date(ts).getTime()-3*3600e3);}
function inPeriod(ts,p){
  if(p==='tudo') return true; if(!ts) return false;
  const t=new Date(ts).getTime(), now=Date.now(), bn=_brtDate(now), bt=_brtDate(t);
  if(p==='hoje') return bt.toISOString().slice(0,10)===bn.toISOString().slice(0,10);
  if(p==='semana') return t>=now-7*864e5;
  if(p==='mes') return bt.getUTCFullYear()===bn.getUTCFullYear()&&bt.getUTCMonth()===bn.getUTCMonth();
  if(p==='ano') return bt.getUTCFullYear()===bn.getUTCFullYear();
  return true;
}
function _fmtDT(ts){if(!ts)return'—';const d=_brtDate(ts).toISOString();return d.slice(8,10)+'/'+d.slice(5,7)+' '+d.slice(11,16);}
function openHistBaix(){
  let el=document.getElementById('histmodal'); if(el) el.remove();
  el=document.createElement('div'); el.id='histmodal'; el.className='histmodal'; document.body.appendChild(el);
  let period='hoje', q='';
  function render(){
    // BIBLIOTECA COMPLETA do exame: baixas + travados (ativos) + liberações — tudo ponta a ponta
    const vez=m=>{const n=Number(m.corte)||1;return n>1?` · 🔁 ${n}×`:'';};
    const baixas=(prodBaixaInfo||[]).map(b=>({ts:Number(b.ts)||0,registro:b.registro,exame:b.exame,paciente:b.paciente,cat:b.cat,por:b.por,kind:'baixa',desfeito:b.desfeito,ts_undo:b.ts_undo,chave:b.chave}));
    const trAtivo=(prodTravados||[]).map(m=>({ts:Number(m.ts_sep)||0,registro:m.req,exame:m.exame,paciente:m.paciente,cat:m.cat,por:m.por,kind:'travado',obs:m.obs,m}));
    const trLib=(prodTravadosHist||[]).map(m=>({ts:Number(m.ts_receb)||0,registro:m.req,exame:m.exame,paciente:m.paciente,cat:m.cat,por:m.por_receb,kind:'liberado',obs:m.obs,m}));
    const all=[...baixas,...trAtivo,...trLib].sort((a,b)=>b.ts-a.ts);
    const qq=q.trim().toLowerCase();
    const rows=all.filter(b=>inPeriod(b.ts,period)).filter(b=>!qq||(String(b.registro)+' '+String(b.exame)+' '+String(b.paciente)+' '+String(b.cat)).toLowerCase().includes(qq));
    const per=(k,l)=>`<button class="hper ${period===k?'on':''}" data-per="${k}">${l}</button>`;
    const statusCell=b=>{
      if(b.kind==='baixa') return b.desfeito?`<span class="stundo">↩ desfeito ${_fmtDT(b.ts_undo)}</span>`:'<span class="stok">✓ baixado</span>';
      if(b.kind==='travado') return `<span class="stok" style="background:rgba(220,38,38,.18);color:#ff8a9a">🔒 travado</span> ${esc(b.obs||'')}${vez(b.m)}`;
      return `<span class="stok" style="background:rgba(22,163,74,.18);color:#86efac">✅ liberado</span> 🔒 ${esc(b.obs||'')} · travou <b>${esc(b.m.por||'')}</b> ${fmtDataHoraP(b.m.ts_sep)} · liberou <b>${esc(b.m.por_receb||'')}</b> · ⏱️ ${labelDiasP(b.m)}${vez(b.m)}`;
    };
    el.innerHTML=`<div class="histcard">
      <div class="histhd"><b>🗂 Histórico do exame — tudo (baixas · travados · liberações)</b><button class="histclose" data-act="close">✕</button></div>
      <div class="histbar">${per('hoje','Hoje')}${per('semana','Semana')}${per('mes','Mês')}${per('ano','Ano')}${per('tudo','Tudo')}
        <input class="histq" placeholder="🔍 buscar registro / paciente / exame" value="${escA(q)}">
        <span class="histcnt">${rows.length} no período</span></div>
      <div class="histscroll"><table class="histtbl"><thead><tr><th>Quando</th><th>#Reg</th><th>Exame</th><th>Paciente</th><th>Categoria</th><th>Por</th><th>O que aconteceu</th><th></th></tr></thead><tbody>
      ${rows.map(b=>`<tr class="${b.kind==='baixa'&&b.desfeito?'undone':''}"><td>${_fmtDT(b.ts)}</td><td>#${esc(b.registro)}</td><td>${esc(b.exame)}</td><td>${esc(b.paciente||'—')}</td><td>${esc(b.cat||'—')}</td><td>${esc(b.por||'—')}</td><td>${statusCell(b)}</td><td>${(b.kind==='baixa'&&!b.desfeito)?`<button class="histundo" data-chave="${escA(b.chave)}">↩ desfazer</button>`:''}</td></tr>`).join('')||'<tr><td colspan="8" style="padding:16px;color:var(--mut)">Nada no período.</td></tr>'}
      </tbody></table></div></div>`;
  }
  el.addEventListener('click',async ev=>{
    const p=ev.target.closest('.hper'); if(p){period=p.dataset.per;render();return;}
    if(ev.target.closest('.histclose')||ev.target===el){el.remove();return;}
    const u=ev.target.closest('.histundo'); if(u){const ch=u.dataset.chave;
      if(!confirm('Desfazer esta baixa? O exame volta pra fila (continua no histórico como desfeito).'))return;
      const op=await pedeLogin(); if(!op)return;
      try{ await window.SUPA.prodUnbaixar([ch],op.nome,op.senha);
        prodBaixaInfo=await window.SUPA.loadProd(); prodBaixados=new Set(prodBaixaInfo.filter(x=>!x.desfeito).map(x=>String(x.chave)));
        renderActive(); render(); }
      catch(e){ if(/login|senha/i.test(e.message||''))__op=null; alert('Não foi possível: '+(e.message||e)); } return; }
  });
  el.addEventListener('input',ev=>{ if(ev.target.classList.contains('histq')){q=ev.target.value; render(); const i=el.querySelector('.histq'); if(i){i.focus();i.setSelectionRange(q.length,q.length);} }});
  render();
}
const escA=s=>esc(s).replace(/"/g,'&quot;');
const isPetlove=s=>/pet\s*love/i.test(String(s||''));
let searchTerm='';
function filterWL(){const t=searchTerm.trim().toLowerCase();
  document.querySelectorAll('#content .wl').forEach(row=>{
    const reg=(row.querySelector('.reg')?.textContent||'').toLowerCase();
    const pac=(row.querySelector('.pac')?.textContent||'').toLowerCase();
    row.style.display=(!t||reg.includes(t)||pac.includes(t))?'':'none';});}
function onSearch(ev){
  if(ev.target.id==='htsearch'){histotecQ=ev.target.value; pinned=true; if(ROT)clearInterval(ROT); const rc=document.getElementById('rotctl'); if(rc){rc.classList.add('pinned');rc.textContent='⏸ fixado · clique p/ girar';} filterHistotec(); return;}
  if(ev.target.id!=='wlsearch')return;
  searchTerm=ev.target.value; pinned=true; if(ROT)clearInterval(ROT);
  const rc=document.getElementById('rotctl'); if(rc){rc.classList.add('pinned');rc.textContent='⏸ fixado · clique p/ girar';}
  filterWL();}
// ORDEM das abas (nomes/trechos na ordem desejada; vazio = ordem padrão por gravidade).
// EXAMES URGENTES é sempre a 1ª. Preencher conforme o usuário definir.
const ORDER=['hematologia','bioquimica','uroanalise','parasito','citopatologia','histologia','especializados','molecular','imunologia','bacteriologia','necropsia'];
function catOrderIdx(name){const i=ORDER.findIndex(o=>slug(name).includes(slug(o)));return i<0?99:i;}
function buildSpecial(list,pred,opts){
  const items=[];
  list.forEach(c=>(c.exames||[]).forEach(e=>{
    if(pred(e,c)&&!exBaixado(e)&&!exTravado(e)) items.push({...e,categoria:c.categoria,_urg:urgentOf(e),_manual:manual.has(String(e.registro))&&!e.urgente&&!baixados.has(String(e.registro))});
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
// ESPELHO de "Avisar cliente" (amostra insuficiente da Triagem) — read-only na Produção
function buildAvisoCat(){return {cod:'__AVI__',categoria:'AVISAR CLIENTE / ESCRITÓRIO',special:true,kind:'aviso',sla:null,em_processo:avisarMarks.length,atrasado:0,no_prazo:avisarMarks.length,pct_no_prazo:100,tat_medio:null,urgentes:0,urgentes_list:[],exames:[],derivacoes:[]};}
// 🔒 TRAVADOS na Produção (a equipe trava direto aqui) — vermelho pulsante
function buildTravaCat(){return {cod:'__TRAVA__',categoria:'TRAVADOS / ESCRITÓRIO',special:true,kind:'trava',sla:null,em_processo:prodTravados.length,atrasado:0,no_prazo:prodTravados.length,pct_no_prazo:100,tat_medio:null,urgentes:0,urgentes_list:[],exames:[],derivacoes:[]};}
// 🔬 ESPELHO Histotécnica · Controle de Amostras (mirror read-only da Triagem)
function buildHistotecCat(){const n=histotecItens().length;return {cod:'__HISTOTEC__',categoria:'HISTOTÉCNICA · CONTROLE DE AMOSTRAS',special:true,kind:'histotec',sla:null,em_processo:n,atrasado:0,no_prazo:n,pct_no_prazo:100,tat_medio:null,urgentes:0,urgentes_list:[],exames:[],derivacoes:[]};}
// Desconta os exames baixados (PIN) E os TRAVADOS de uma categoria NORMAL — contadores, derivações e lista batem.
function adjustCat(x){
  if(!x||x.special||(!prodBaixados.size&&!prodTravadoSet.size)) return x;
  const oculto=e=>exBaixado(e)||exTravado(e);
  const ex=x.exames||[], baix=ex.filter(oculto);
  if(!baix.length) return x;
  const byT={},byTA={}; baix.forEach(e=>{const t=e.exame||'';byT[t]=(byT[t]||0)+1;if(e.atrasado)byTA[t]=(byTA[t]||0)+1;});
  const nB=baix.length, nBA=baix.filter(e=>e.atrasado).length;
  const emp=Math.max(0,(x.em_processo||0)-nB), atr=Math.max(0,(x.atrasado||0)-nBA);
  const ders=(x.derivacoes||[]).map(d=>{const ep=Math.max(0,d.em_processo-(byT[d.exame]||0)),at=Math.max(0,d.atrasado-(byTA[d.exame]||0));return {...d,em_processo:ep,atrasado:at,pct:ep?Math.round(100*(ep-at)/ep):100};}).filter(d=>d.em_processo>0);
  return {...x,exames:ex.filter(e=>!oculto(e)),em_processo:emp,atrasado:atr,no_prazo:emp-atr,pct_no_prazo:emp?Math.round(100*(emp-atr)/emp):100,derivacoes:ders};
}

// Busca o .enc da FUNÇÃO (/api/enc, baratíssimo — atualizado sem deploy) e CAI no arquivo
// estático data/producao.enc se a função falhar/estiver vazia. Nunca quebra o painel.
async function fetchEnc(){
  try{
    const r=await fetch('/api/enc?_='+Date.now());
    if(r.ok){const j=await r.json(); if(j&&j.ct&&j.salt&&j.iv) return j;}
  }catch(e){}
  return await fetch('data/producao.enc?_='+Date.now()).then(r=>{if(!r.ok)throw new Error('sem dados');return r.json();});
}
async function decrypt(pwd){
  ENC=await fetchEnc();
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
  return [buildUrgentCat(list), buildAvisoCat(), buildTravaCat(), buildPetCat(list), buildAtrasCat(list), ...list, buildHistotecCat()];   // especiais primeiro; Histotécnica (espelho) por ÚLTIMO
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
  // urgentes só importam no modo TV. Com Supabase: Realtime (push, zero polling); senão: polling 90s
  if(window.SUPA&&window.SUPA.ok){
    if(!window.__urgsub) window.__urgsub=window.SUPA.subscribe(['urg_lista','urg_baixas','sep_marks','sep_descartes'],async()=>{if(document.getElementById('content').style.display!=='none'&&!typingSearch()){await loadManual();buildTabs();renderActive();}});
  }else{
    window.__muref=setInterval(async()=>{if(document.hidden||document.getElementById('content').style.display==='none'||typingSearch())return;const k=[...manual].sort().join();await loadManual();if(k!==[...manual].sort().join())renderActive();},90000);
  }
  if(!window.__visref){window.__visref=true;document.addEventListener('visibilitychange',()=>{if(!document.hidden&&document.getElementById('content').style.display!=='none'){loadManual().then(renderActive).catch(()=>{});}});}
}

// 🔄 ATUALIZAR (recarga instantânea, grátis): rebusca o .enc do último build + marcações, sem esperar os 10 min.
let __atualizando=false;
async function atualizarProd(btn){
  if(__atualizando) return; __atualizando=true;
  const b=btn||document.getElementById('atualizarBtn'); if(b){b.classList.add('spin');b.disabled=true;b.textContent='🔄 atualizando…';}
  try{ DATA=await decrypt(window.__pwd); await loadManual(); buildTabs(); renderActive(); }
  catch(e){ console.warn(e); }
  finally{
    __atualizando=false;
    const b2=document.getElementById('atualizarBtn');
    if(b2){ b2.classList.remove('spin'); b2.disabled=false; b2.classList.add('done'); b2.textContent='✓ atualizado';
      setTimeout(()=>{ const b3=document.getElementById('atualizarBtn'); if(b3){b3.classList.remove('done');b3.textContent='🔄 Atualizar';} },1800); }
  }
}
window.atualizarProd=atualizarProd;
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
  const KT={urg:{t:'urgtab',i:'🚨',b:'urgb'},aviso:{t:'avisotab',i:'📧',b:'avisob'},trava:{t:'travatab',i:'🔒',b:'travab'},histotec:{t:'histotectab',i:'🔬',b:'histotecb'},pet:{t:'pettab',i:'💗',b:'petb'},atras:{t:'atrastab',i:'⏰',b:'atrasb'}};
  tabsEl.innerHTML=`<button class="atualizar-btn" id="atualizarBtn" title="Puxar agora os dados do último build (sem esperar os 10 min)">🔄 Atualizar</button>`
    + list.map((x,i)=>{x=adjustCat(x);const k=x.special?KT[x.kind]:null;return `
    <div class="tab ${i===active?'on':''} ${k?k.t:''} ${x.kind==='aviso'?'avisopulse':''} ${x.kind==='trava'&&x.em_processo>0?'travapulse':''}" data-i="${i}">
      <span class="tn">${k&&x.kind==='aviso'?'<span class="fwt">🎆</span> '+k.i+' '+esc(x.categoria)+' <span class="fwt">🎇</span>':(k?k.i+' '+esc(x.categoria):esc(x.categoria))}</span>
      <span class="tb ${k?k.b:(x.atrasado>0?'late':'')}">${x.special?num(x.em_processo):(x.atrasado>0?num(x.atrasado)+' atras':num(x.em_processo))}</span>
      <span class="prog"></span>
    </div>`;}).join('')
    + `<div class="rotctl ${pinned?'pinned':''}" id="rotctl">${pinned?'⏸ fixado · clique p/ girar':'🔄 girando 15s'}</div>`;
  { const _ab=document.getElementById('atualizarBtn'); if(_ab) _ab.addEventListener('click',()=>atualizarProd(_ab)); }
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

// banner laranja "clientes a avisar" (espelho) — aparece em qualquer aba da Produção
function avisoBannerHtml(){ const list=avisarMarks; if(!list.length) return '';
  return `<div class="urgbanner aviso"><span class="ico">📧</span><span class="ttl">${num(list.length)} CLIENTE${list.length>1?'S':''} A AVISAR · AMOSTRA INSUFICIENTE (recoleta)</span><div class="ul">${list.slice(0,10).map(m=>`<span class="u"><span class="r">#${esc(m.req)}</span>${esc(m.paciente)} · ${esc(m.exame)}</span>`).join('')}</div></div>`; }
function renderAviso(){
  const list=avisarMarks.slice().sort((a,b)=>(Number(a.ts_sep)||0)-(Number(b.ts_sep)||0));
  const rows = list.length
    ? list.map(m=>`<div class="wl"><span class="reg">#${esc(m.req)}</span><div><div class="pac">${esc(m.paciente)}</div><div class="exm">${esc(m.exame)} · insuf. por <b>${esc(m.por||'')}</b></div></div><div class="wlact"><span class="db late">📧 avisar cliente</span></div></div>`).join('')
    : '<div style="color:var(--green);padding:16px;font-size:16px">✓ Nenhum cliente a avisar. 👍</div>';
  document.getElementById('content').innerHTML=avisoBannerHtml()+`<div class="cgrid"><div class="card avisocard"><h3><span>📧 Avisar cliente / Escritório <span class="tag">${num(list.length)} · amostra insuficiente · responsabilidade do Escritório</span></span></h3><div class="scroll">${rows}</div></div></div>`;
}
// banner vermelho "exames travados" — aparece em qualquer aba da Produção
function travaBannerHtml(){ const list=prodTravados; if(!list.length) return '';
  return `<div class="urgbanner trava"><span class="ico">🔒</span><span class="ttl">${num(list.length)} EXAME${list.length>1?'S':''} TRAVADO${list.length>1?'S':''} · RESOLVA O MOTIVO E DESTRAVE</span><div class="ul">${list.slice(0,10).map(m=>`<span class="u"><span class="r">#${esc(m.req)}</span>${esc(m.paciente)} · ${esc(m.exame)}${m.obs?' · 🔒 '+esc(m.obs):''}</span>`).join('')}</div></div>`; }
function renderTrava(){
  const vez=m=>{const n=Number(m.corte)||1;return n>1?` · 🔁 ${n}×`:'';};
  const list=prodTravados.slice().sort((a,b)=>(Number(a.ts_sep)||0)-(Number(b.ts_sep)||0));
  const rows = list.length
    ? list.map(m=>`<div class="wl"><span class="reg">#${esc(m.req)}</span><div><div class="pac">${esc(m.paciente)}</div><div class="exm">${esc(m.exame)}</div><div class="travahist"><div>🔒 <b>Travado:</b> ${esc(m.obs||'(sem motivo)')}${vez(m)}</div><div>🔒 <b>Travou:</b> ${esc(m.por||'—')} — ${fmtDataHoraP(m.ts_sep)}</div><div>⏱️ <b>Há:</b> ${labelDiasP(m)}</div></div></div><div class="wlact"><button class="destravabtn" data-chave="${escA(m.chave)}">✓ destravar</button></div></div>`).join('')
    : '<div style="color:var(--green);padding:16px;font-size:15px">✓ Nenhum exame travado agora. Veja o histórico abaixo. 👍</div>';
  // 📋 HISTÓRICO (liberados) EXPLÍCITO: motivo, quem travou (dia/hora), quem destravou (dia/hora), dias, quantas vezes
  const hist=prodTravadosHist;
  const histHtml = hist.length
    ? `<div class="card travahistcard"><h3><span>📋 Histórico de travados (liberados) <span class="tag">${num(hist.length)}</span></span></h3><div class="scroll">${hist.slice(0,100).map(m=>`<div class="wl travahistrow"><span class="reg">#${esc(m.req)}</span><div><div class="pac">${esc(m.paciente)} <span class="db ok">✅ liberado</span></div><div class="exm">${esc(m.exame)}</div><div class="travahist"><b>📋 Histórico</b><div>🔒 <b>Travado:</b> ${esc(m.obs||'(sem motivo)')}${vez(m)}</div><div>🔒 <b>Travou:</b> ${esc(m.por||'—')} — ${fmtDataHoraP(m.ts_sep)}</div><div>✅ <b>Destravou:</b> ${esc(m.por_receb||'—')} — ${fmtDataHoraP(m.ts_receb)}</div><div>⏱️ <b>Ficou travado:</b> ${labelDiasP(m)}</div></div></div></div>`).join('')}</div></div>`
    : '';
  document.getElementById('content').innerHTML=travaBannerHtml()+`<div class="cgrid"><div class="card travacard"><h3><span>🔒 Travados / Escritório <span class="tag">${num(list.length)} · responsabilidade do Escritório · motivo em texto livre</span></span></h3><div class="scroll">${rows}</div></div>${histHtml}</div>`;
}
// 🔬 ESPELHO: Histotécnica · Controle de Amostras (read-only) — o que entra na Triagem aparece aqui, ao vivo
function histotecStatus(it){
  const k=String(it.req)+'-'+String(it.codex);
  const tr=sepMarksMap['trava:'+k]; if(tr&&tr.estado==='travado') return {t:'🔒 travado',c:'#ff8a9a',bg:'rgba(220,38,38,.16)'};
  const m=sepMarksMap[k]; const e=m&&m.estado;
  if(e==='suficiente') return {t:'✅ tem amostra',c:'#86efac',bg:'rgba(22,163,74,.18)'};
  if(e==='insuficiente'||e==='insuficiente_avisado') return {t:'🚫 sem amostra',c:'#ff8a9a',bg:'rgba(220,38,38,.16)'};
  if(e==='recebido') return {t:'✓ recebido',c:'#fde68a',bg:'rgba(234,179,8,.16)'};
  if(e==='separado'||e==='enviado') return {t:'✓ separado',c:'#7dd3fc',bg:'rgba(2,132,199,.18)'};
  return {t:'⏳ aguardando separar',c:'#f0a020',bg:'rgba(240,160,32,.14)'};
}
function renderHistotec(){
  const itens=histotecItens().slice().sort((a,b)=>(b.dias||0)-(a.dias||0));
  const byCat={}; itens.forEach(it=>{const c=it.cat||'—';(byCat[c]=byCat[c]||[]).push(it);});
  const CATORD=['Citopatologia','Histologia','NECRÓPSIA'];
  const cats=Object.keys(byCat).sort((a,b)=>{const ia=CATORD.findIndex(x=>slug(x)===slug(a)),ib=CATORD.findIndex(x=>slug(x)===slug(b));return (ia<0?9:ia)-(ib<0?9:ib);});
  const banner=`<div class="urgbanner histotec"><span class="ico">🔬</span><span class="ttl">HISTOTÉCNICA · CONTROLE DE AMOSTRAS — ${num(itens.length)} amostra${itens.length!==1?'s':''} (espelho ao vivo da Triagem)</span></div>`;
  const busca=`<input id="htsearch" class="wlsearch" style="margin:0 0 12px;width:100%;box-sizing:border-box" placeholder="🔍 buscar em tudo — nº, ano, paciente, exame, categoria, status (com ou sem acento)" value="${escA(histotecQ)}">`;
  const cards=cats.length?cats.map(c=>{
    const arr=byCat[c];
    const rows=arr.map(it=>{const st=histotecStatus(it);const pl=isPetlove(it.paciente);
      const ds=escA(normAcc([it.req,it.ano,it.req+'/'+it.ano,it.paciente,it.exame,it.cat,st.t].join(' ')));
      return `<div class="wl" data-s="${ds}"><span class="reg">#${esc(it.req)}<span style="opacity:.5">/${esc(it.ano)}</span></span><div><div class="pac${pl?' petlove':''}">${esc(it.paciente)}${pl?'<span class="plove">PET LOVE</span>':''}</div><div class="exm">${esc(it.exame)} · entrou ${fmtD(it.entrada)}${(it.dias||0)>=1?` · <b style="color:var(--amber)">${it.dias}d parada</b>`:''}</div></div><div class="wlact"><span class="db" style="background:${st.bg};color:${st.c}">${st.t}</span></div></div>`;}).join('');
    return `<div class="card"><h3><span>${esc(c)} <span class="tag">${arr.length} amostra(s)</span></span></h3><div class="scroll">${rows}</div></div>`;
  }).join(''):'<div class="card"><div style="color:var(--green);padding:18px;font-size:16px">✓ Nenhuma amostra de Histotécnica em processo agora. 👍</div></div>';
  document.getElementById('content').innerHTML=banner+busca+`<div class="cgrid histoteccols">${cards}</div><p class="note" style="padding:8px 4px">🔬 Espelho read-only — a separação/recebimento é feita na Triagem (Histotécnica). Atualiza ao vivo.</p><div id="htempty" style="display:none;color:var(--mut);padding:14px">Nada encontrado.</div>`;
  if(histotecQ) filterHistotec();
}
// true enquanto o cursor está numa BUSCA (não deixar o auto-refresh apagar o que se digita)
function typingSearch(){const a=document.activeElement;return !!(a&&(a.id==='htsearch'||a.id==='wlsearch'));}
// busca da aba Histotécnica: mostra/esconde linhas (com e sem acento), sem re-render (não perde o foco)
function filterHistotec(){
  const t=normAcc(histotecQ.trim()); let vis=0;
  document.querySelectorAll('#content .wl').forEach(r=>{const s=r.dataset.s||'';const ok=!t||s.includes(t);r.style.display=ok?'':'none';if(ok)vis++;});
  // esconde cards que ficaram sem nenhuma linha visível
  document.querySelectorAll('#content .histoteccols .card').forEach(cd=>{const any=[...cd.querySelectorAll('.wl')].some(r=>r.style.display!=='none');cd.style.display=(t&&!any)?'none':'';});
  const em=document.getElementById('htempty'); if(em) em.style.display=(t&&vis===0)?'':'none';
}
function renderActive(){
  const list=cats(); if(!list.length){document.getElementById('content').innerHTML='<div style="padding:40px;color:var(--mut)">Sem fila no momento.</div>';return;}
  const x = adjustCat(locked || list[active] || list[0]);
  if(!locked){ [...document.querySelectorAll('.tab')].forEach((t,i)=>t.classList.toggle('on',i===active)); animateProg(); }
  if(x.special && x.kind==='aviso'){ renderAviso(); return; }   // ESPELHO de Avisar cliente (read-only)
  if(x.special && x.kind==='trava'){ renderTrava(); return; }   // 🔒 Travados (trava direto na Produção)
  if(x.special && x.kind==='histotec'){ renderHistotec(); return; }   // 🔬 espelho da Histotécnica (read-only)
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
  // alvo do "Limpar atrasados" = os atrasados visíveis nesta aba
  const atrasAlvo=wlItems.filter(e=>e.atrasado);
  window.__limparAlvo=atrasAlvo.map(e=>({chave:exChave(e),registro:String(e.registro),exame:e.exame||'',paciente:e.paciente||'',cat:e.categoria||x.categoria||'',atrasado:true}));
  window.__curCat=special?'':x.categoria;
  const banner = (!special && urgCount>0) ? `<div class="urgbanner"><span class="ico">🚨</span>
      <span class="ttl">${num(urgCount)} URGENTE${urgCount>1?'S':''}</span>
      <div class="ul">${urgItems.slice(0,10).map(u=>`<span class="u"><span class="r">#${esc(u.registro)}</span> ${esc(u.paciente)} · ${esc(u.exame||'')} · ${u.dias}d</span>`).join('')}</div>
    </div>` : '';
  document.getElementById('content').innerHTML=(special?'':avisoBannerHtml())+(special?'':travaBannerHtml())+banner+`
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
        <div class="exleg">
          <span class="lg"><b style="color:var(--amber,#f0a020)">baixa na urgência</b> = tira só do alerta 🔴 (o exame continua)</span>
          <span class="lg"><b style="color:var(--cyan,#22d3ee)">✓ no exame</b> = tira o exame da Produção · não depende do HF · pede seu login</span>
          ${atrasAlvo.length?`<button class="limpabtn">🧹 Limpar atrasados (${atrasAlvo.length})</button>`:''}
          <button class="histbtn">🗂 Histórico do exame${(prodBaixaInfo.length+prodTravados.length+prodTravadosHist.length)?` (${prodBaixaInfo.length+prodTravados.length+prodTravadosHist.length})`:''}</button>
        </div>
        <div class="scroll">${wlItems.map(e=>{const pl=isPetlove(e.paciente);return `
          <div class="wl"><span class="reg">#${esc(e.registro!=null?e.registro:'—')}</span>
            <div><div class="pac${pl?' petlove':''}">${esc(e.paciente)}${pl?'<span class="plove">PET LOVE</span>':''}${e._urg?`<span class="urg">URGENTE${e._manual?' ★':''}</span>`:''}</div><div class="exm">${special?`<b style="color:var(--cyan)">${esc(e.categoria)}</b> · `:''}${esc(e.exame||'—')} · entrou ${fmtD(e.entrada)} · <b style="color:${e.atrasado?C.red:C.amber}">limite ${fmtD(e.limite)}</b>${e.dono?' · '+esc(e.dono):''}</div>${travHistLine(e)}</div>
            <div class="wlact">${e._urg
              ? `<button class="baixabtn" data-reg="${esc(e.registro)}" data-pac="${escA(e.paciente)}" data-exm="${escA(e.exame||'')}" data-manual="${e._manual?'1':'0'}" title="tira do alerta de urgência (o exame continua na fila)">baixa na urgência</button>`
              : `<button class="urgbtn" data-reg="${esc(e.registro)}" data-pac="${escA(e.paciente)}" data-exm="${escA(e.exame||'')}" title="marcar como urgente">🚨</button>`}<button class="exbaixabtn" data-reg="${esc(e.registro)}" data-exm="${escA(e.exame||'')}" data-pac="${escA(e.paciente)}" data-cat="${escA(e.categoria||x.categoria||'')}" data-atr="${e.atrasado?'1':'0'}" title="baixa no EXAME — tira da Produção (não depende do HF)">✓ no exame</button><button class="travarbtn" data-reg="${esc(e.registro)}" data-exm="${escA(e.exame||'')}" data-pac="${escA(e.paciente)}" data-cat="${escA(e.categoria||x.categoria||'')}" title="travar o exame (financeiro, cadastro, problema de amostra…) — vai pra aba 🔒 Travados">🔒 Travar</button><span class="db ${e.atrasado?'late':'ok'}">${e.dias}d</span></div></div>`;}).join('')||(special?'<div style="color:var(--green);padding:14px">✓ Nenhum urgente no momento.</div>':'<div style="color:var(--green);padding:14px">✓ Nada em processo.</div>')}
        </div>
      </div>
    </div></div>`;
  if(searchTerm) filterWL();
}
function fmtD(d){if(!d)return'—';const p=String(d).slice(0,10).split('-');return p.length===3?`${p[2]}/${p[1]}`:d;}
function esc(s){return String(s==null?'':s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}

/* Auto-reload na virada do dia (meia-noite BRT): a TV/PC fica ligada a noite toda;
   isso garante que ela pegue o codigo novo + o reset diario da Triagem sem F5 manual. */
(function(){
  function msAteMeiaNoiteBRT(){
    const now=Date.now();
    const brt=new Date(now-3*3600e3);                                            // relogio em BRT (UTC-3)
    const alvo=Date.UTC(brt.getUTCFullYear(),brt.getUTCMonth(),brt.getUTCDate()+1)+3*3600e3; // proxima 00:00 BRT em UTC
    return alvo-now;
  }
  setTimeout(function(){ location.reload(); }, msAteMeiaNoiteBRT()+8000);         // +8s de folga p/ a data ja ter virado
})();
