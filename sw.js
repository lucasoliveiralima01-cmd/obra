/* =====================================================================
   Funcionamento sem sinal: guarda uma cópia das páginas e bibliotecas
   para o painel de Pendências abrir mesmo sem internet.
   Sempre tenta a internet primeiro (assim as atualizações chegam na hora)
   e só usa a cópia guardada quando a conexão falha.
   Os dados (Supabase) não passam por aqui: ficam no IndexedDB da página.
   ===================================================================== */
const CACHE = 'obra-v3';
const BASICO = ['./', 'index.html', 'pendencias.html', 'nuvem.js', 'config.js', 'app.js', 'manifest.webmanifest', 'icone-192.png', 'icone-aviso.png',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'];

self.addEventListener('install', ev => {
  ev.waitUntil(caches.open(CACHE).then(c => Promise.all(BASICO.map(u => c.add(u).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', ev => {
  ev.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

/* ---------------- avisos (Web Push) ---------------- */
self.addEventListener('push', ev => {
  let d = {}; try { d = ev.data ? ev.data.json() : {}; } catch (e) { d = { title: 'Pendências de obra', body: ev.data ? ev.data.text() : '' }; }
  ev.waitUntil(self.registration.showNotification(d.title || 'Pendências de obra', {
    body: d.body || '', icon: 'icone-192.png', badge: 'icone-aviso.png', tag: d.tag || undefined, renotify: !!d.tag,
    data: { url: d.url || './index.html' }
  }));
});
self.addEventListener('notificationclick', ev => {
  ev.notification.close();
  const url = new URL((ev.notification.data && ev.notification.data.url) || './index.html', self.registration.scope).href;
  ev.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    for (const c of cs) if (c.url.split('?')[0] === url.split('?')[0] && 'focus' in c) { c.navigate(url).catch(() => {}); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});

const guardar = u => /\.(html|js|css|png|webmanifest)(\?|$)/.test(u.pathname) || u.pathname.endsWith('/') ||
  /^(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(u.hostname);

self.addEventListener('fetch', ev => {
  const r = ev.request; if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (/supabase\.co$/.test(u.hostname)) return;          // dados e arquivos: direto, sem cópia
  if (u.origin !== location.origin && !guardar(u)) return;
  if (u.origin === location.origin && !guardar(u)) return;
  ev.respondWith(fetch(r).then(res => {
    if (res && (res.ok || res.type === 'opaque')) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(r, cp)).catch(() => {}); }
    return res;
  }).catch(() => caches.match(r, { ignoreSearch: u.origin === location.origin }).then(m => m || (r.mode === 'navigate' ? caches.match('pendencias.html') : undefined)).then(m => m || Response.error())));
});
