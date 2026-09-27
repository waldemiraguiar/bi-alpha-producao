/**
 * Service worker do painel Movimento.
 *
 * ⚠️ A REGRA QUE IMPORTA (a mesma do freio): o SHELL (html, css, js, ícone) pode vir do
 * cache para o app abrir com sinal ruim; os DADOS nunca. Se eu cacheasse a resposta do
 * Supabase, o painel mostraria o número de ontem com cara de hoje — e um painel que mente
 * sobre quando o dado é de é pior que um painel que demora a abrir.
 *
 * ⚠️ E aqui o shell é REDE PRIMEIRO, não cache primeiro: este app muda com frequência (é
 * novo), e um cache agressivo faria o Wal ver a versão velha depois de eu publicar uma
 * correção — foi exatamente o que aconteceu com o `?v=` que não subia em 5 commits.
 * O cache só entra quando a rede falha.
 */
const CACHE = 'movimento-v1'
const SHELL = ['./', './index.html', './op.css', './op.js', './manifest.webmanifest', './icone-192.png', './icone-512.png']

self.addEventListener('install', ev => {
  ev.waitUntil(caches.open(CACHE)
    .then(c => Promise.allSettled(SHELL.map(u => c.add(u))))   // um arquivo que falhe não derruba a instalação
    .then(() => self.skipWaiting()))
})

self.addEventListener('activate', ev => {
  ev.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()))
})

self.addEventListener('fetch', ev => {
  const u = new URL(ev.request.url)
  // ⛔ qualquer coisa fora deste diretório (= o Supabase) NUNCA vem do cache
  if (u.origin !== location.origin || !u.pathname.startsWith('/operacao/')) return
  if (ev.request.method !== 'GET') return
  ev.respondWith(
    fetch(ev.request).then(r => {
      if (r && r.ok) { const c = r.clone(); caches.open(CACHE).then(k => k.put(ev.request, c)) }
      return r
    }).catch(() => caches.match(ev.request).then(r => r || caches.match('./index.html')))
  )
})
