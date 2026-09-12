/**
 * sw.js — Service Worker do GameRetroProject
 * ------------------------------------------------------------
 * Estratégias:
 *   • App shell (HTML/CSS/JS locais)      → cache-first com revalidação
 *   • Capas e assets locais               → cache-first (stale-while-revalidate)
 *   • ROMs locais                         → cache-first (após 1º uso)
 *   • CDN do EmulatorJS (loader/wasm)     → stale-while-revalidate
 *   • jogos.json                          → network-first (com fallback cache)
 *   • Navegação (HTML)                    → network-first com fallback offline
 */

const VERSION    = 'v1.0.0';
const CACHE_APP  = `gr-app-${VERSION}`;
const CACHE_IMG  = `gr-img-${VERSION}`;
const CACHE_ROM  = `gr-rom-${VERSION}`;
const CACHE_CDN  = `gr-cdn-${VERSION}`;

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/app.js',
  './js/emulator.js',
  './js/storage.js',
  './data/jogos.json',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png'
];

/* ============================================================
   INSTALL — pré-cache do app shell
   ============================================================ */
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_APP);
    // addAll falha inteiro se 1 recurso falhar — usamos adds individuais
    await Promise.all(APP_SHELL.map(async (url) => {
      try { await cache.add(new Request(url, { cache: 'reload' })); }
      catch (e) { console.warn('[SW] Falha ao pré-cachear:', url, e.message); }
    }));
    await self.skipWaiting();
  })());
});

/* ============================================================
   ACTIVATE — limpa caches de versões antigas
   ============================================================ */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => {
      if (![CACHE_APP, CACHE_IMG, CACHE_ROM, CACHE_CDN].includes(k)) {
        console.info('[SW] Removendo cache antigo:', k);
        return caches.delete(k);
      }
    }));
    await self.clients.claim();
  })());
});

/* ============================================================
   HELPERS
   ============================================================ */

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

function isHtmlRequest(req) {
  return req.mode === 'navigate' ||
    (req.method === 'GET' && req.headers.get('accept')?.includes('text/html'));
}

function isRomRequest(url) {
  return /\.(nes|sfc|smc|gb|gbc|gba|bin|md|gen|a26|sms|gg|zip|7z)$/i.test(url.pathname);
}

function isImageRequest(req, url) {
  return req.destination === 'image' ||
    /\.(png|jpe?g|webp|gif|svg|avif)$/i.test(url.pathname);
}

function isEmulatorJsCdn(url) {
  return url.hostname === 'cdn.emulatorjs.org';
}

function isFontOrStyleCdn(url) {
  return url.hostname === 'fonts.googleapis.com' ||
         url.hostname === 'fonts.gstatic.com'   ||
         url.hostname === 'cdn.tailwindcss.com';
}

/* ============================================================
   ESTRATÉGIAS
   ============================================================ */

/** Cache-first + revalidação em background. */
async function staleWhileRevalidate(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request).then(response => {
    if (response && response.status === 200 && response.type !== 'opaque') {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => cached);

  return cached || fetchPromise;
}

/** Cache-first puro (para ROMs, que não mudam). */
async function cacheFirst(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response && response.status === 200) {
    cache.put(request, response.clone());
  }
  return response;
}

/** Network-first com fallback para cache (catálogo e HTML). */
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && response.status === 200 && request.method === 'GET') {
      cache.put(request, response.clone());
    }
    return response;
  } catch (e) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw e;
  }
}

/* ============================================================
   FETCH — roteamento por tipo de requisição
   ============================================================ */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Ignora requisições que não são http(s) (chrome-extension, etc.)
  if (!url.protocol.startsWith('http')) return;

  // ---------- Navegação (HTML) ----------
  if (isHtmlRequest(req)) {
    event.respondWith((async () => {
      try {
        return await networkFirst(req, CACHE_APP);
      } catch {
        const cache = await caches.open(CACHE_APP);
        const fallback = await cache.match('./index.html');
        return fallback || new Response(
          '<h1>Offline</h1><p>Sem conexão e sem cache disponível.</p>',
          { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      }
    })());
    return;
  }

  // ---------- CDN do EmulatorJS ----------
  if (isEmulatorJsCdn(url)) {
    event.respondWith(staleWhileRevalidate(req, CACHE_CDN));
    return;
  }

  // ---------- Fontes / Tailwind CDN ----------
  if (isFontOrStyleCdn(url)) {
    event.respondWith(staleWhileRevalidate(req, CACHE_CDN));
    return;
  }

  // ---------- Apenas same-origin daqui pra baixo ----------
  if (!isSameOrigin(url)) return;

  // ---------- ROMs ----------
  if (isRomRequest(url)) {
    event.respondWith(cacheFirst(req, CACHE_ROM));
    return;
  }

  // ---------- Capas / imagens ----------
  if (isImageRequest(req, url)) {
    event.respondWith(staleWhileRevalidate(req, CACHE_IMG));
    return;
  }

  // ---------- jogos.json (sempre tenta rede) ----------
  if (url.pathname.endsWith('/data/jogos.json')) {
    event.respondWith(networkFirst(req, CACHE_APP));
    return;
  }

  // ---------- Resto do app shell ----------
  event.respondWith(staleWhileRevalidate(req, CACHE_APP));
});

/* ============================================================
   MENSAGENS — permite ao app forçar atualização / limpar caches
   ============================================================ */
self.addEventListener('message', (event) => {
  const { type } = event.data || {};

  if (type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  if (type === 'CLEAR_CACHES') {
    event.waitUntil((async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
      event.source?.postMessage({ type: 'CACHES_CLEARED' });
    })());
    return;
  }

  if (type === 'GET_VERSION') {
    event.source?.postMessage({ type: 'VERSION', version: VERSION });
  }
});