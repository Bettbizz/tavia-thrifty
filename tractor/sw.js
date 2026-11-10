// Keeps the booking apps' files on the phone so they open quickly with weak signal.
// Change the version whenever you upload new app files, so phones fetch them.
const CACHE = 'tractor-v1';
const SHELL = ['./', './index.html', './owner.html', './client.js', './owner.js', './common.js', './api.js', './config.js',
  './style.css', './manifest.webmanifest', './manifest-owner.webmanifest',
  './icon-192.png', './icon-512.png', './icon-owner-192.png', './icon-owner-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
// Internet first (bookings must be fresh); the saved copy is only used when offline.
// Database calls are never stored.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin && url.hostname !== 'cdn.jsdelivr.net') return;
  e.respondWith(fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  }).catch(async () => (await caches.match(req, { ignoreSearch: true }))
    || (req.mode === 'navigate' ? caches.match('./index.html') : new Response('', { status: 504 }))));
});
