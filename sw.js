/* =====================================================================
   Abertura rápida e funcionamento sem sinal.
   - Páginas, scripts, ícones e bibliotecas: abre na hora com a cópia guardada no
     aparelho e, ao mesmo tempo, busca a versão publicada para a próxima abertura.
     Se a versão publicada mudou, a página recebe o aviso e oferece "Atualizar".
   - Sem cópia guardada (primeira vez): vai à internet normalmente.
   Os dados (Supabase) não passam por aqui.
   ===================================================================== */
// Só troque o número se mudar a lista BASICO (o que é guardado já na instalação).
const CACHE = 'obra-v15';
const BASICO = ['./', 'index.html', 'pendencias.html', 'personalizacoes.html', 'ceramicas.html', 'almoxarifado.html', 'planejamento.html', 'conferencia.html', 'risco.html', 'concretagem.html', 'fachadas.html',
  'estilo.css', 'listas-comum.js', 'plan-pdf.js', 'fvq-voz.js', 'fvq-modelos.js', 'relatorio-pdf.js', 'nuvem.js', 'config.js', 'app.js', 'manifest.webmanifest', 'icone-192.png', 'icone-aviso.png',
  'icones/principal.svg', 'icones/pendencias.svg', 'icones/risco.svg', 'icones/concretagem.svg', 'icones/fachadas.svg', 'icones/personalizacoes.svg', 'icones/ceramicas.svg', 'icones/almoxarifado.svg', 'icones/planejamento.svg', 'icones/conferencia.svg',
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

const guardar = u => /\.(html|js|css|png|svg|webmanifest|woff2?)(\?|$)/.test(u.pathname) || u.pathname.endsWith('/') ||
  /^(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|unpkg\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(u.hostname);

// do próprio site, a cópia é guardada sem o "?obra=…" (a página é a mesma para todas as obras)
const chave = u => u.origin === location.origin ? new Request(u.origin + u.pathname) : null;
// versão publicada mudou? (ETag/Last-Modified do GitHub Pages; sem eles, o tamanho)
const marca = r => r ? (r.headers.get('etag') || '') + '|' + (r.headers.get('last-modified') || '') + '|' + (r.headers.get('content-length') || '') : '';
let avisado = 0;
function avisarNovidade() {
  const agora = Date.now(); if (agora - avisado < 4000) return; avisado = agora;
  self.clients.matchAll({ type: 'window' }).then(cs => cs.forEach(c => c.postMessage({ tipo: 'versao-nova' })));
}

self.addEventListener('fetch', ev => {
  const r = ev.request; if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (/supabase\.co$/.test(u.hostname)) return;          // dados e arquivos: direto, sem cópia
  if (!guardar(u)) return;
  const meu = u.origin === location.origin;
  const k = chave(u) || r;
  ev.respondWith(caches.open(CACHE).then(async c => {
    const velho = await c.match(k);
    // do próprio site: confere a versão publicada (304 é rápido); bibliotecas: têm versão fixa no endereço
    const rede = (meu ? fetch(u.origin + u.pathname + u.search, { cache: 'no-cache', credentials: 'same-origin' }) : fetch(r)).then(res => {
      if (res && (res.ok || res.type === 'opaque')) {
        if (meu && velho && marca(velho) !== marca(res) && /\.(html|js|css)$|\/$/.test(u.pathname)) avisarNovidade();
        c.put(k, res.clone()).catch(() => {});
      }
      return res;
    });
    if (velho) { ev.waitUntil(rede.catch(() => {})); return velho; }
    return rede.catch(() => (r.mode === 'navigate' ? c.match(new Request(location.origin + new URL('pendencias.html', self.registration.scope).pathname)) : undefined).then(m => m || Response.error()));
  }));
});
