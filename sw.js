// Service worker: aplikace funguje i bez internetu. Soubory se berou z mezipaměti
// a na pozadí se obnovují ze sítě.
const CACHE = 'svycar-v7';
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'icons/icon.svg',
  'css/style.css',
  'js/app.js',
  'js/about.js',
  'js/model.js',
  'js/dutch.js',
  'js/matching.js',
  'js/roundrobin.js',
  'js/team.js',
  'js/teamui.js',
  'js/sync.js',
  'js/syncui.js',
  'js/vendor/qrcode.js',
  'js/tiebreaks.js',
  'js/trf.js',
  'js/store.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      const net = fetch(req, { cache: 'no-cache' })
        .then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() => hit);
      return hit || net;
    }),
  );
});
