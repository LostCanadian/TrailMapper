const CACHE = 'trailmapper-v2';
const BASE = self.location.pathname.replace(/\/[^/]*$/, '/');
const ASSETS = [
  BASE,
  `${BASE}index.html`,
  `${BASE}styles.css`,
  `${BASE}app.js`,
  `${BASE}manifest.webmanifest`,
  `${BASE}icon.svg`
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener('fetch', (event) => {
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
