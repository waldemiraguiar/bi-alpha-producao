/**
 * Service worker do Freio — existe por UM motivo: a página tem que abrir mesmo com 1 barra
 * de sinal, porque quem abre isto está com pressa.
 *
 * ⚠️ A REGRA QUE IMPORTA: o SHELL (html, css, ícone) pode vir do cache; o ESTADO DO FREIO
 * nunca. Se eu cacheasse a resposta do Supabase, a tela diria "rodando normal" com o robô
 * parado — ou pior, "PARADO" com ele mandando mensagem. Uma tela de emergência que mente
 * sobre o estado é mais perigosa que não ter tela nenhuma. Por isso toda chamada que não
 * seja deste diretório passa direto para a rede, sem tocar no cache.
 */
const CACHE = 'freio-v1'
const SHELL = ['./', './index.html', './manifest.webmanifest', './icone-192.png', './icone-512.png']

self.addEventListener('install', ev => {
  ev.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', ev => {
  ev.waitUntil(
    caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', ev => {
  const u = new URL(ev.request.url)
  // ⛔ qualquer coisa fora deste diretório (= a API do Supabase) NUNCA vem do cache
  if (u.origin !== location.origin || !u.pathname.startsWith('/freio/')) return
  if (ev.request.method !== 'GET') return
  // rede primeiro (para pegar versão nova do app), cache como rede de segurança
  ev.respondWith(
    fetch(ev.request).then(r => {
      if (r && r.ok) { const c = r.clone(); caches.open(CACHE).then(k => k.put(ev.request, c)) }
      return r
    }).catch(() => caches.match(ev.request).then(r => r || caches.match('./index.html')))
  )
})
