// Офлайн кеш за приложението и прегледаните части от картата.
const VERSION = 'obhod-v16';
const SHELL = [
  './', './index.html', './styles.css', './app.js', './data.js', './config.js',
  './manifest.webmanifest', './lib/leaflet/leaflet.js', './lib/leaflet/leaflet.css',
  './icons/icon-192.png', './icons/favicon-32.png', './media/keepawake.mp4', './media/keepawake.webm'
];
const TILE_CACHE = 'obhod-tiles';
const TILE_LIMIT = 800;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== TILE_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function trimTiles() {
  const c = await caches.open(TILE_CACHE);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - TILE_LIMIT; i++) await c.delete(keys[i]);
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Връзката с таблицата винаги минава през мрежата.
  if (url.hostname.endsWith('script.google.com') || url.hostname.endsWith('googleusercontent.com')) return;

  if (url.hostname.endsWith('tile.openstreetmap.org')) {
    e.respondWith(caches.open(TILE_CACHE).then(async c => {
      const hit = await c.match(req);
      const net = fetch(req).then(r => { if (r.ok) { c.put(req, r.clone()); trimTiles(); } return r; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }

  if (url.origin === self.location.origin) {
    // Първо мрежата, за да идват новите версии веднага; кешът е резерва без връзка.
    // no-cache: винаги пита сървъра дали има нова версия (иначе браузърът държи старата до 10 мин.)
    const net = req.mode === 'navigate' ? fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }) : fetch(req, { cache: 'no-cache' });
    e.respondWith(
      net.then(r => {
        if (r.ok) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
        return r;
      }).catch(() => caches.match(req).then(h => h || caches.match('./index.html')))
    );
  }
});
