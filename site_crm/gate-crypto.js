/* ============================================================
   SKIN BI ALPHA — padrão de GATE criptografado (reutilizável)
   AES-256-GCM + PBKDF2-SHA256 (Web Crypto), senha no localStorage,
   auto-refresh. Os dados ficam num .enc cifrado (gerado no robô em Python,
   ver encrypt() no build_*.py — mesmo formato: {v,kdf,iter,salt,iv,ct} base64).
   HTML precisa de: #gate, #gateForm, #gatePwd, #gateBtn, #gateErr e o container do app.
   ============================================================ */
const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

// descriptografa um .enc com a senha; retorna o objeto JSON (lança se senha errada)
// CUSTO: tenta a FUNÇÃO (/api/enc?f=<nome> — atualizada sem deploy) e CAI no arquivo estático se falhar.
async function decryptEnc(url, pwd){
  const base = (url.split('/').pop() || '').replace(/\?.*$/,'').replace(/\.enc$/,'') || 'data';
  let env = null;
  try{ const r = await fetch('/api/enc?f='+base+'&_='+Date.now());
    if(r.ok){ const j = await r.json(); if(j && j.ct && j.salt && j.iv) env = j; } }catch(e){}
  if(!env) env = await fetch(url + (url.includes('?')?'&':'?') + '_=' + Date.now())
    .then(r => { if(!r.ok) throw new Error('sem dados'); return r.json(); });
  const baseKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(pwd), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    {name:'PBKDF2', salt:b64(env.salt), iterations:env.iter, hash:'SHA-256'},
    baseKey, {name:'AES-GCM', length:256}, false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({name:'AES-GCM', iv:b64(env.iv)}, key, b64(env.ct));
  return JSON.parse(new TextDecoder().decode(plain));
}

/* Liga o gate. opts: {encUrl, lsKey, onData(D), refreshMs} */
function initGate(opts){
  const {encUrl, lsKey, onData, refreshMs=600000} = opts;
  const f=document.getElementById('gateForm'), p=document.getElementById('gatePwd'),
        er=document.getElementById('gateErr'), b=document.getElementById('gateBtn');
  let timer=null;
  const _BIO=lsKey+'_bio';
  const _be=x=>btoa(String.fromCharCode(...new Uint8Array(x))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const _bd=x=>{x=x.replace(/-/g,'+').replace(/_/g,'/');return Uint8Array.from(atob(x),c=>c.charCodeAt(0));};
  const gbio=document.getElementById('gateBio'), bset=document.getElementById('bioSetup'), lbio=document.getElementById('loginBio');
  async function unlock(pw, fromLS){
    try{
      const D = await decryptEnc(encUrl, pw);
      if(!localStorage.getItem(_BIO)) localStorage.setItem(lsKey, pw);  // aparelho com digital PRF não guarda senha em texto puro
      window.__pwd = pw;
      document.getElementById('gate').style.display='none';
      onData(D);
      if(window.PublicKeyCredential && bset && !localStorage.getItem(_BIO)) bset.style.display='';
      if(timer) clearInterval(timer);
      timer = setInterval(async()=>{ try{ onData(await decryptEnc(encUrl, window.__pwd)); }catch(e){ console.warn(e); } }, refreshMs);
    }catch(e){
      if(fromLS){ localStorage.removeItem(lsKey); return; }
      er.textContent = /sem dados/.test(e.message) ? 'Dados indisponíveis.' : 'Senha incorreta.';
      b.disabled=false; b.textContent='Entrar'; p.select();
    }
  }
  f.addEventListener('submit', e=>{ e.preventDefault(); er.textContent=''; b.disabled=true; b.textContent='Verificando…'; unlock(p.value,false); });
  /* ---- digital / Touch ID (PRF): a senha vira BLOB CIFRADO; sem texto puro no aparelho do dono; equipe intacta ---- */
  const _enc=s=>new TextEncoder().encode(s), _dec=b=>new TextDecoder().decode(b), _rnd=n=>crypto.getRandomValues(new Uint8Array(n));
  const _aes=k=>crypto.subtle.importKey('raw',k,{name:'AES-GCM'},false,['encrypt','decrypt']);
  const _prf=r=>{try{return r.getClientExtensionResults().prf.results.first;}catch(e){return null;}};
  const _bioMeta=()=>{try{const j=JSON.parse(localStorage.getItem(_BIO));return (j&&j.c&&j.s&&j.i&&j.t)?j:null;}catch(e){return null;}};
  const _bioOn=()=>!!_bioMeta();
  async function entrarComDigital(btn,label){ const m=_bioMeta(); if(!m)return;
    try{ if(btn) btn.textContent='👆 Toque o leitor…';
      const a=await navigator.credentials.get({publicKey:{challenge:_rnd(32),allowCredentials:[{type:'public-key',id:_bd(m.c)}],userVerification:'required',timeout:60000,rpId:location.hostname,extensions:{prf:{eval:{first:_bd(m.s)}}}}});
      const prf=_prf(a); if(!prf)throw new Error('sem PRF');
      const key=await _aes(prf);
      const pw=_dec(await crypto.subtle.decrypt({name:'AES-GCM',iv:_bd(m.i)},key,_bd(m.t)));
      unlock(pw,true);
    }catch(e){console.warn(e); if(btn) btn.textContent=label;} }
  if(gbio) gbio.onclick=()=>entrarComDigital(gbio,'👆 Entrar com digital');
  if(lbio) lbio.onclick=()=>entrarComDigital(lbio,'👆 Entrar com a digital / Face ID');
  if(bset) bset.onclick=async()=>{ const pw=window.__pwd||localStorage.getItem(lsKey); if(!pw){bset.textContent='entre com a senha primeiro';return;}
    try{bset.textContent='👆 Toque p/ ativar…';
      const salt=_rnd(32);
      const c=await navigator.credentials.create({publicKey:{challenge:_rnd(32),rp:{name:'Alpha — CRM',id:location.hostname},user:{id:_rnd(16),name:'wal@crm-alpha',displayName:'Wal'},pubKeyCredParams:[{type:'public-key',alg:-7},{type:'public-key',alg:-257}],authenticatorSelection:{authenticatorAttachment:'platform',userVerification:'required',residentKey:'required'},timeout:60000,attestation:'none',extensions:{prf:{eval:{first:salt}}}}});
      let prf=_prf(c);
      if(!prf){const a=await navigator.credentials.get({publicKey:{challenge:_rnd(32),allowCredentials:[{type:'public-key',id:c.rawId}],userVerification:'required',timeout:60000,rpId:location.hostname,extensions:{prf:{eval:{first:salt}}}}});prf=_prf(a);}
      if(!prf)throw new Error('PRF indisponível — use Chrome/Safari do Mac');
      const key=await _aes(prf), iv=_rnd(12);
      const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,_enc(pw));
      localStorage.setItem(_BIO,JSON.stringify({c:_be(c.rawId),s:_be(salt),i:_be(iv),t:_be(ct)}));
      localStorage.removeItem(lsKey);  // tira a senha em TEXTO PURO deste aparelho — agora só a digital abre
      bset.textContent='✅ Digital ativa (senha protegida)'; setTimeout(()=>{bset.style.display='none';},1800);
    }catch(e){console.warn(e);bset.textContent='👆 Proteger com digital';} };
  window.__crmMostraBioSetup=()=>{ if(window.PublicKeyCredential && bset && !_bioOn()) bset.style.display=''; };
  const saved = localStorage.getItem(lsKey);
  if(_bioOn()){
    // aparelho do dono: sem texto puro → pede a digital (login individual ou gate)
    const lf=document.getElementById('loginForm');
    if(lbio && lf && lf.style.display!=='none'){ lbio.style.display=''; entrarComDigital(lbio,'👆 Entrar com a digital / Face ID'); }
    else if(gbio){ gbio.style.display=''; p.placeholder='ou use a senha'; entrarComDigital(gbio,'👆 Entrar com digital'); }
  }
  else if(saved){ unlock(saved, true); }
}
