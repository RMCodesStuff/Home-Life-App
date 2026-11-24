/* Home Life service worker. Same-origin: stale-while-revalidate. Fonts, the
   Anthropic SDK and the QR library: cache-first. Everything else goes straight to the network, and the
   Firebase SDK (www.gstatic.com), OpenStreetMap and RainViewer are never intercepted. */
const VERSION = 'home-life-v8';
const CORE = VERSION + '-core';
const RUNTIME = VERSION + '-runtime';

const PRECACHE = [
  './', './index.html', './styles.css', './app.js',
  './js/store.js', './js/time.js', './js/weather.js', './js/geo.js',
  './js/calendar.js', './js/travel.js', './js/insights.js', './js/ai.js',
  './js/icons.js', './js/render.js', './js/settings.js',
  './js/parks.js', './js/tripprep.js', './js/evening.js', './js/compose.js',
  './js/briefing.js', './js/calendars.js', './js/phoenix.js', './js/meals.js', './js/workout.js', './js/speech.js',
  './js/connections.js', './js/fb.js', './js/settings2.js', './js/devicesetup.js', './js/setupui.js',
  './js/plan.js', './js/planui.js', './js/uistate.js', './js/jumpbar.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png',
  './icons/favicon.svg', './calendar-bridge/Code.gs', './calendar-bridge/appsscript.json'
];

// Hosts the worker must leave alone (live data and SDK modules with their own caching).
const PASS_THROUGH = /(^|\.)(gstatic\.com|openstreetmap\.org|rainviewer\.com)$/;
const FONT_HOST = 'fonts.gstatic.com';

const CACHE_FIRST_PREFIXES = [
  'https://fonts.googleapis.com/',
  'https://fonts.gstatic.com/',
  'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@',
  'https://cdn.jsdelivr.net/npm/qrcode-generator@'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CORE);
    await Promise.all(PRECACHE.map(async (url) => {
      try {
        const res = await fetch(new Request(url, { cache: 'reload' }));
        if (res && res.ok) await cache.put(url, res);
      } catch (_) { /* ignore individual failures */ }
    }));
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = [CORE, RUNTIME];
    const names = await caches.keys();
    await Promise.all(names.filter((n) => !keep.includes(n)).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

async function staleWhileRevalidate(request, event) {
  const cache = await caches.open(CORE);
  const cached = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
  const network = fetch(request).then((res) => {
    if (res && res.ok && res.type === 'basic') cache.put(request, res.clone());
    return res;
  });
  if (cached) {
    event.waitUntil(network.catch(() => {}));
    return cached;
  }
  try {
    return await network;
  } catch (err) {
    if (request.mode === 'navigate') {
      const fallback = await cache.match('./index.html') || await cache.match('./');
      if (fallback) return fallback;
    }
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(RUNTIME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res && (res.ok || res.type === 'opaque')) cache.put(request, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(request, event));
    return;
  }
  if (url.hostname !== FONT_HOST && PASS_THROUGH.test(url.hostname)) return;
  if (CACHE_FIRST_PREFIXES.some((p) => request.url.startsWith(p))) {
    event.respondWith(cacheFirst(request));
  }
  // Anything else is not intercepted.
});
