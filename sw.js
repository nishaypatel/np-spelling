// Service worker: makes the app shell work offline after the first visit.
//
// Strategy:
//   - App shell (HTML/CSS/JS/icons + Firebase CDN scripts): stale-while-
//     revalidate — served instantly from cache, refreshed in the background.
//   - Week data (data/weeks/*.json): network-first so a new week shows up
//     immediately, with the cached copy as the offline fallback.
//   - /api/tts and every other origin (Firebase auth/Firestore): untouched.
//
// Bump CACHE_VERSION whenever shell files change so old caches are dropped.
const CACHE_VERSION = 'spell-squad-v3';

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
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))))
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
  if (sameOrigin && url.pathname.startsWith('/api/')) return;

  if (sameOrigin && url.pathname.includes('/data/weeks/')) {
    event.respondWith(networkFirst(request));
  } else {
    event.respondWith(staleWhileRevalidate(request));
  }
});

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
