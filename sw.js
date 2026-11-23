// App files: fresh from the network when online (so updates show up straight away), the cached
// copy when offline or slow. Spotify cover images are kept once seen. Songs, playlists and lyrics live in IndexedDB, not here.
const VERSION = 'stash-1.1.1';
const SHELL = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/db.js', 'js/tags.js', 'js/match.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== 'stash-art').map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.hostname === 'i.scdn.co') {
    e.respondWith(
      caches.open('stash-art').then(async (c) => {
        const hit = await c.match(e.request);
        if (hit) return hit;
        const res = await fetch(e.request);
        if (res.ok || res.type === 'opaque') c.put(e.request, res.clone());
        return res;
      })
    );
    return;
  }
  if (url.origin !== location.origin) return;
  e.respondWith(
    caches.open(VERSION).then(async (c) => {
      const net = fetch(e.request, { cache: 'no-cache' })
        .then((res) => {
          if (res.ok) c.put(e.request, res.clone());
          return res;
        })
        .catch(() => null);
      const slow = new Promise((r) => setTimeout(() => r(null), 3000));
      const res = await Promise.race([net, slow]);
      if (res) return res;
      const hit = await c.match(e.request, { ignoreSearch: true });
      if (hit) return hit;
      const late = await net;
      if (late) return late;
      if (e.request.mode === 'navigate') return c.match('index.html');
      return new Response('', { status: 504 });
    })
  );
});
