/* Helper de escrita SEGURA no Netlify Blobs — elimina LOST UPDATE.
   Todo handler fazia load()→modifica→setJSON() sem trava: dois POSTs quase juntos
   (ex.: comercial salva feedback enquanto o escritório dá baixa) faziam um sobrescrever o outro.
   updateBlob lê com ETag e grava condicional (onlyIfMatch). Se outra escrita entrou no meio,
   RECARREGA e REAPLICA a mutação sobre o dado FRESCO (não a lista velha do cliente). CAS + retry. */
export async function updateBlob(store, key, mutate, { tries = 8 } = {}) {
  for (let i = 0; i < tries; i++) {
    let cur = null;
    try { cur = await store.getWithMetadata(key, { type: "json", consistency: "strong" }); }
    catch (_) { cur = null; }
    const prev = cur && cur.data != null ? cur.data : null;
    const etag = cur && cur.etag;
    const next = await mutate(prev);
    if (next === undefined) return prev;   // mutate decidiu não gravar (validação abortou)
    try {
      const res = etag
        ? await store.setJSON(key, next, { onlyIfMatch: etag })     // só grava se ninguém mexeu desde a leitura
        : await store.setJSON(key, next, { onlyIfNew: true });      // criação: só se a chave ainda não existe
      if (res && res.modified) return next;                          // gravou com sucesso
      // modified:false → houve escrita concorrente; recarrega e reaplica
    } catch (_) { /* corrida na criação/rede — tenta de novo */ }
    await new Promise((r) => setTimeout(r, 25 + 35 * i));
  }
  // último recurso (raro): grava sem condição — melhor gravar reaplicando sobre o fresco do que perder o dado
  let prev = null;
  try { prev = (await store.get(key, { type: "json", consistency: "strong" })) || null; } catch (_) {}
  const next = await mutate(prev);
  if (next !== undefined) await store.setJSON(key, next);
  return next;
}
