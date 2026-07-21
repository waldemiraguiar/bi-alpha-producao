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
      localStorage.setItem(lsKey, pw); window.__pwd = pw;
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
  /* ---- digital / Touch ID / Face ID (por aparelho; preserva auto-login da TV) ---- */
  async function entrarComDigital(btn, label){ const id=localStorage.getItem(_BIO), pw=localStorage.getItem(lsKey); if(!id||!pw)return;
    try{ if(btn) btn.textContent='👆 Toque o leitor…';
      await navigator.credentials.get({publicKey:{challenge:crypto.getRandomValues(new Uint8Array(32)),allowCredentials:[{type:'public-key',id:_bd(id)}],userVerification:'required',timeout:60000,rpId:location.hostname}});
      unlock(pw,true);
    }catch(e){console.warn(e); if(btn) btn.textContent=label;} }
  if(gbio) gbio.onclick=()=>entrarComDigital(gbio,'👆 Entrar com digital');
  if(lbio) lbio.onclick=()=>entrarComDigital(lbio,'👆 Entrar com a digital / Face ID');
  if(bset) bset.onclick=async()=>{ const pw=localStorage.getItem(lsKey); if(!pw)return;
    try{bset.textContent='👆 Toque p/ ativar…';
      const c=await navigator.credentials.create({publicKey:{challenge:crypto.getRandomValues(new Uint8Array(32)),rp:{name:'Alpha — Atlas Digital',id:location.hostname},user:{id:crypto.getRandomValues(new Uint8Array(16)),name:'alpha',displayName:'Alpha'},pubKeyCredParams:[{type:'public-key',alg:-7},{type:'public-key',alg:-257}],authenticatorSelection:{authenticatorAttachment:'platform',userVerification:'required'},timeout:60000,attestation:'none'}});
      localStorage.setItem(_BIO,_be(c.rawId)); bset.textContent='✅ Digital ativa neste aparelho'; setTimeout(()=>{bset.style.display='none';},1800);
    }catch(e){console.warn(e);bset.textContent='👆 Proteger com digital';} };
  window.__crmMostraBioSetup=()=>{ if(window.PublicKeyCredential && bset && !localStorage.getItem(_BIO)) bset.style.display=''; };
  const saved = localStorage.getItem(lsKey);
  if(saved && localStorage.getItem(_BIO)){
    // digital cadastrada → oferece entrar com o dedo NO LOGIN INDIVIDUAL (não auto-loga sozinho)
    const lf=document.getElementById('loginForm');
    if(lbio && lf && lf.style.display!=='none'){ lbio.style.display=''; entrarComDigital(lbio,'👆 Entrar com a digital / Face ID'); }
    else if(gbio){ gbio.style.display=''; p.placeholder='ou use a senha'; }
  }
  else if(saved){ unlock(saved, true); }
}
