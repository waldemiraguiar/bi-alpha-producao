/* ============================================================
   SKIN BI ALPHA — padrão de GATE criptografado (reutilizável)
   AES-256-GCM + PBKDF2-SHA256 (Web Crypto), senha no localStorage,
   auto-refresh. Os dados ficam num .enc cifrado (gerado no robô em Python,
   ver encrypt() no build_*.py — mesmo formato: {v,kdf,iter,salt,iv,ct} base64).
   HTML precisa de: #gate, #gateForm, #gatePwd, #gateBtn, #gateErr e o container do app.
   ============================================================ */
const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

// descriptografa um .enc com a senha; retorna o objeto JSON (lança se senha errada)
async function decryptEnc(url, pwd){
  const env = await fetch(url + (url.includes('?')?'&':'?') + '_=' + Date.now())
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
  async function unlock(pw, fromLS){
    try{
      const D = await decryptEnc(encUrl, pw);
      localStorage.setItem(lsKey, pw); window.__pwd = pw;
      document.getElementById('gate').style.display='none';
      onData(D);
      if(timer) clearInterval(timer);
      timer = setInterval(async()=>{ try{ onData(await decryptEnc(encUrl, window.__pwd)); }catch(e){ console.warn(e); } }, refreshMs);
    }catch(e){
      if(fromLS){ localStorage.removeItem(lsKey); return; }
      er.textContent = /sem dados/.test(e.message) ? 'Dados indisponíveis.' : 'Senha incorreta.';
      b.disabled=false; b.textContent='Entrar'; p.select();
    }
  }
  f.addEventListener('submit', e=>{ e.preventDefault(); er.textContent=''; b.disabled=true; b.textContent='Verificando…'; unlock(p.value,false); });
  const saved = localStorage.getItem(lsKey); if(saved) unlock(saved, true);
}
