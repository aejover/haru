// Service worker: lets 하루 install as a phone/desktop app and open instantly.
// App files are network-first (always fresh when online, cached copy otherwise); uploaded files are
// cache-first; /api and anything on another origin (the computer, seen from GitHub Pages) is never cached.
// Paths are relative so the same files work at "/" (the 하루 server) and at "/haru/" (GitHub Pages).
const CACHE = 'haru-shell-v8';
const SHELL = ['./', 'index.html', 'css/app.css', 'js/main.js', 'js/core.js', 'js/local.js', 'js/claude-local.js', 'js/remind.js', 'js/sync.js', 'manifest.webmanifest', 'icon.svg', 'icons/icon-192.png', 'icons/apple-touch-icon.png'];
const ROOT = new URL('./', self.location).href;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return;
  if (url.pathname.includes('/files/')) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok && res.status === 200) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  // the app's own page (with or without #tab, ?server=…) is one cache entry; guide and policy pages are their own
  const isApp = url.pathname === new URL(ROOT).pathname || url.pathname.endsWith('/index.html') && url.pathname.slice(0, -10) === new URL(ROOT).pathname;
  const key = req.mode === 'navigate' && isApp ? ROOT : req;
  e.respondWith(fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(key, copy)); }
    return res;
  }).catch(() => caches.match(key, { ignoreSearch: true })));
});
