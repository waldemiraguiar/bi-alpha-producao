/* ============================================================================
   OUTBOX — fila local durável (IndexedDB) + carteiro de sincronização.
   Coração do offline-first: o clique é salvo AQUI na hora (sobrevive a fechar o
   navegador / reiniciar o PC) e sobe pra nuvem sozinho quando dá.
   Idempotente: reenviar a mesma op 2x é seguro (o envio real é upsert por chave).

   API:
     OUTBOX.init(sendFn)   -> sendFn(op) faz o envio REAL (retorna Promise; throw = falhou)
     OUTBOX.enqueue(op)    -> {id?, kind, chave, payload} enfileira + dispara sync
     OUTBOX.pending()      -> Promise<Array> ops ainda não enviadas
     OUTBOX.count()        -> nº pendente (cache síncrono, p/ a UI)
     OUTBOX.onChange(cb)   -> chamado sempre que a fila muda (p/ atualizar o selo)
     OUTBOX.sync()         -> força uma rodada de envio
   ============================================================================ */
(function () {
  const DB_NAME = 'sep_outbox_v1', STORE = 'ops';
  let dbp = null, sendFn = null, pendingCount = 0, listeners = [], syncing = false, timer = null;

  function openDB() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      let r;
      try { r = indexedDB.open(DB_NAME, 1); } catch (e) { return rej(e); }
      r.onupgradeneeded = () => { const db = r.result; if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' }); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  function tx(mode) { return openDB().then(db => db.transaction(STORE, mode).objectStore(STORE)); }
  function req(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }

  const uid = () => 'op_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);

  async function all() { const s = await tx('readonly'); return (await req(s.getAll())) || []; }
  async function count() { const s = await tx('readonly'); return await req(s.count()); }
  async function refreshCount() { try { pendingCount = await count(); } catch (e) { } fire(); }
  function fire() { listeners.forEach(cb => { try { cb(pendingCount); } catch (e) { } }); }

  async function enqueue(op) {
    const rec = { id: op.id || uid(), kind: op.kind, chave: op.chave || null, payload: op.payload || op, ts: op.ts || nowTs(), tries: 0 };
    const s = await tx('readwrite'); await req(s.put(rec));
    await refreshCount();
    sync();          // tenta subir já
    return rec.id;
  }
  async function remove(id) { const s = await tx('readwrite'); await req(s.delete(id)); }

  // relógio sem Date.now() proibido em alguns ambientes de build — no browser é normal
  function nowTs() { try { return Date.now(); } catch (e) { return 0; } }

  async function sync() {
    if (syncing || !sendFn) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { schedule(4000); return; }
    syncing = true;
    let hadError = false;
    try {
      const ops = (await all()).sort((a, b) => a.ts - b.ts);
      for (const op of ops) {
        try {
          await sendFn(op);          // ENVIO REAL (throw = falhou → mantém na fila)
          await remove(op.id);
          await refreshCount();
        } catch (e) {
          hadError = true;
          try { const s = await tx('readwrite'); const cur = await req(s.get(op.id)); if (cur) { cur.tries = (cur.tries || 0) + 1; cur.lastErr = String((e && e.message) || e); await req(s.put(cur)); } } catch (_) { }
          break;                     // para a rodada; tenta de novo no schedule (mantém ordem)
        }
      }
    } finally {
      syncing = false;
      await refreshCount();
      if (hadError || pendingCount > 0) schedule(hadError ? 5000 : 2000);
    }
  }

  function schedule(ms) { if (timer) return; timer = setTimeout(() => { timer = null; sync(); }, ms); }

  function init(fn) {
    sendFn = fn;
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => sync());
      document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
    }
    refreshCount();
    sync();
  }

  window.OUTBOX = {
    init, enqueue, sync,
    pending: all,
    count: () => pendingCount,
    onChange: (cb) => { listeners.push(cb); try { cb(pendingCount); } catch (e) { } },
  };
})();
