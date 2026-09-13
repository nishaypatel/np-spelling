// Service worker: makes the app shell work offline after the first visit.
//
// Strategy:
//   - App shell (HTML/CSS/JS/icons + Firebase CDN scripts): stale-while-
//     revalidate — served instantly from cache, refreshed in the background.
//   - Week data (data/weeks/*.json): network-first so a new week shows up
//     immediately, with the cached copy as the offline fallback.
//   - Spoken words (/api/tts?text=…): cache-first in a cache of their own that
//     survives version bumps. A week's list is practised over and over, and the
//     cloud voices are metered, so each clip is fetched once and then replayed
//     from disk — which also makes practice work offline.
//   - Everything else under /api/ and every other origin (Firebase): untouched.
//
// Bump CACHE_VERSION whenever shell files change so old caches are dropped.
const CACHE_VERSION = 'spell-squad-v8';

// Deliberately not versioned: spoken audio stays valid across deploys, and
// re-fetching it costs provider quota. Pruned to the most recent entries.
const TTS_CACHE = 'spell-squad-tts';
const TTS_CACHE_MAX = 400;

const SHELL = [
  '.',
  'index.html',
  'styles/base.css',
  'styles/themes.css',
  'js/words.js',
  'js/weeks.js',
  'js/firebase-config.js',
  'js/app.js',
  'js/activities.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
  'data/weeks/manifest.json',
  'data/weeks/shard-001.json',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore-compat.js',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      // Cache each file independently: one flaky URL (e.g. the CDN) must not
      // block the whole install — misses are picked up at runtime instead.
      .then(cache => Promise.all(SHELL.map(url => cache.add(url).catch(e => console.warn('sw precache skipped', url, e.message)))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_VERSION && k !== TTS_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;
  const firebaseCdn = url.hostname === 'www.gstatic.com';
  if (!sameOrigin && !firebaseCdn) return;
  if (sameOrigin && url.pathname === '/api/tts' && url.searchParams.has('text')) {
    event.respondWith(speechCacheFirst(request));
    return;
  }
  if (sameOrigin && url.pathname.startsWith('/api/')) return;

  if (sameOrigin && url.pathname.includes('/data/weeks/')) {
    event.respondWith(networkFirst(request));
  } else {
    event.respondWith(staleWhileRevalidate(request));
  }
});

// Spoken clips never change for a given word/voice/speed, so a hit is served
// without touching the network. Only successful audio is stored: an error
// response would otherwise be replayed forever.
async function speechCacheFirst(request) {
  const cache = await caches.open(TTS_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const fresh = await fetch(request);
  if (fresh.ok && (fresh.headers.get('Content-Type') || '').includes('audio')) {
    await cache.put(request, fresh.clone());
    pruneSpeechCache(cache);
  }
  return fresh;
}

// Oldest-first: Cache API keeps insertion order, so dropping from the front
// removes the least recently added clips.
async function pruneSpeechCache(cache) {
  const keys = await cache.keys();
  if (keys.length <= TTS_CACHE_MAX) return;
  await Promise.all(keys.slice(0, keys.length - TTS_CACHE_MAX).map(k => cache.delete(k)));
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const fresh = await fetch(request);
    if (fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch (e) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw e;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);
  const refresh = fetch(request)
    .then(res => {
      if (res && (res.ok || res.type === 'opaque')) cache.put(request, res.clone());
      return res;
    })
    .catch(() => cached);
  return cached || refresh;
}
