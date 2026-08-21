// OiMira Pagos — SW "shell siempre desde la red" (leccion: nunca cachear HTML/JS)
const CACHE = "pagos-v1";
const ESTATICOS = ["./manifest.json", "./icons/icon-192.png", "./icons/icon-512.png"];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ESTATICOS).catch(() => {})));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  if (e.request.mode === "navigate" || /\.(html|js)$/.test(url.pathname)) { e.respondWith(fetch(e.request)); return; }
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => {
    if (r && r.ok) { const c = r.clone(); caches.open(CACHE).then((cc) => cc.put(e.request, c)); }
    return r;
  })));
});
