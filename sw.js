'use strict';

// Change this version when changing the offline assets or worker behavior.
const CACHE_PREFIX = 'hitomidori-offline-';
const CACHE_NAME = CACHE_PREFIX + '20261025-v1';
const BASE_URL = new URL('./', self.location.href);
const PAGE_URL = BASE_URL.href;
const INDEX_URL = new URL('index.html', BASE_URL).href;
const ASSETS = [
  PAGE_URL,
  ...['pwa.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png']
    .map(path => new URL(path, BASE_URL).href)
];
const ASSET_URLS = new Set(ASSETS);

async function saveOffline() {
  const cache = await caches.open(CACHE_NAME);
  await cache.addAll(ASSETS.map(url => new Request(url, {cache: 'reload'})));
}

async function isOfflineReady() {
  const cache = await caches.open(CACHE_NAME);
  const responses = await Promise.all(ASSETS.map(url => cache.match(url)));
  return responses.every(Boolean);
}

self.addEventListener('install', event => {
  event.waitUntil(saveOffline().then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

async function networkFirst(request, key, event) {
  const cache = await caches.open(CACHE_NAME);
  const network = (async () => {
    const response = await fetch(request, {cache: 'no-cache'});
    if (!response.ok || response.redirected) throw new Error('No usable network response');
    // A storage failure must not stop an otherwise successful online visit.
    try { await cache.put(key, response.clone()); } catch (_) {}
    return response;
  })();
  // Keep refreshing the saved copy if a slow network answers after the fallback.
  event.waitUntil(network.then(() => {}, () => {}));
  let timer;
  try {
    return await Promise.race([
      network,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Network timeout')), 3500); })
    ]);
  } catch (_) {
    const saved = await cache.match(key);
    if (saved) return saved;
    try { return await network; } catch (_) { return Response.error(); }
  } finally {
    clearTimeout(timer);
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== BASE_URL.origin) return;
  url.hash = '';
  url.search = '';
  const key = url.href;
  // Only this page and its known assets are cached; other project URLs pass through.
  if (request.mode === 'navigate' && (key === PAGE_URL || key === INDEX_URL)) {
    event.respondWith(networkFirst(request, PAGE_URL, event));
  } else if (ASSET_URLS.has(key) && key !== PAGE_URL) {
    event.respondWith(networkFirst(request, key, event));
  }
});

self.addEventListener('message', event => {
  const type = event.data && event.data.type;
  if (type !== 'GET_OFFLINE_STATUS' && type !== 'SAVE_OFFLINE') return;
  const port = event.ports && event.ports[0];
  if (!port) return;
  event.waitUntil((async () => {
    try {
      if (type === 'SAVE_OFFLINE') await saveOffline();
      port.postMessage({ready: await isOfflineReady()});
    } catch (_) {
      port.postMessage({ready: false});
    }
  })());
});
