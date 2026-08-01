/* ============================================================
   BI ALPHA — Biometria (Touch ID / WebAuthn PRF) — igual ao Fênix.
   A SENHA do painel fica CIFRADA (AES-GCM) com uma chave derivada do
   Touch ID via WebAuthn PRF; NUNCA em texto puro. Sem PRF/sem suporte →
   cai pra senha, sem travar. Storage: localStorage 'bi:bio' = {credId,salt,iv,ct}.
   ============================================================ */
(function () {
  const LS = 'bi:bio';
  const enc = s => new TextEncoder().encode(s);
  const dec = b => new TextDecoder().decode(b);
  const rand = n => crypto.getRandomValues(new Uint8Array(n));
  const b64e = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const b64d = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

  const supported = () =>
    !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create);
  async function platformAvailable() {
    try { return supported() && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); }
    catch { return false; }
  }
  const enabled = () => !!localStorage.getItem(LS);
  const cfg = () => { try { return JSON.parse(localStorage.getItem(LS)); } catch { return null; } };
  async function aesFromPrf(prfBuf) {
    return crypto.subtle.importKey('raw', prfBuf, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }

  // ATIVAR: cria passkey, deriva chave do Touch ID (PRF) e cifra a senha.
  async function register(pwd) {
    if (!supported()) throw new Error('Este navegador não suporta Touch ID (WebAuthn).');
    if (!pwd) throw new Error('Entre com a senha antes de ativar o Touch ID.');
    const salt = rand(32);
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge: rand(32),
        rp: { name: 'BI Alpha', id: location.hostname },
        user: { id: rand(16), name: 'wal@bi-alpha', displayName: 'Wal' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'required' },
        timeout: 60000,
        extensions: { prf: { eval: { first: salt } } },
      }
    });
    if (!cred) throw new Error('Não foi possível criar a credencial.');
    let prf = cred.getClientExtensionResults?.().prf?.results?.first;
    if (!prf) {   // alguns navegadores só liberam o PRF numa asserção seguinte
      const asrt = await navigator.credentials.get({
        publicKey: {
          challenge: rand(32),
          allowCredentials: [{ id: cred.rawId, type: 'public-key' }],
          userVerification: 'required', timeout: 60000,
          extensions: { prf: { eval: { first: salt } } },
        }
      });
      prf = asrt.getClientExtensionResults?.().prf?.results?.first;
    }
    if (!prf) throw new Error('Seu navegador não liberou a chave biométrica (PRF). Use o Chrome do Mac.');
    const key = await aesFromPrf(prf);
    const iv = rand(12);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc(pwd));
    localStorage.setItem(LS, JSON.stringify({ credId: b64e(cred.rawId), salt: b64e(salt), iv: b64e(iv), ct: b64e(ct) }));
    return true;
  }

  // DESTRAVAR: Touch ID → PRF → decifra a senha e devolve.
  async function unlock() {
    const c = cfg(); if (!c) throw new Error('Touch ID não está ativo.');
    const asrt = await navigator.credentials.get({
      publicKey: {
        challenge: rand(32),
        allowCredentials: [{ id: b64d(c.credId), type: 'public-key' }],
        userVerification: 'required', timeout: 60000,
        extensions: { prf: { eval: { first: b64d(c.salt) } } },
      }
    });
    const prf = asrt.getClientExtensionResults?.().prf?.results?.first;
    if (!prf) throw new Error('Touch ID não liberou a chave.');
    const key = await aesFromPrf(prf);
    return dec(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(c.iv) }, key, b64d(c.ct)));
  }

  function disable() { localStorage.removeItem(LS); }

  window.BI_BIO = { supported, platformAvailable, enabled, register, unlock, disable };
})();
