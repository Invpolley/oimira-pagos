// SW resiliente (PROTOCOLO PWA RESILIENTE, 2026-09-13). Network-first: guarda la cáscara para abrir sin internet
// y NUNCA guarda ni muestra un 502/503/504 del hosting si hay copia buena. Datos (Supabase) nunca pasan por caché.
const CACHE = "pagos-v3";
const PREFIJO = "pagos"; // solo se borran cachés viejas de ESTA app (en GitHub Pages varias apps comparten origen)
const ASSETS = ["./","./index.html","./app.js","./config.js","./manifest.json","./icons/icon-192.png","./icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS).catch(() => {})).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k.startsWith(PREFIJO) && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.hostname.endsWith("supabase.co")) return;
  if (url.searchParams.has("ping")) return; // chequeo de salud: debe llegar crudo al servidor
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        const buena = r.ok || r.type === "opaque"; // 200-299 u opaca (CDN). Un 5xx/403 del hosting NO es buena.
        if (buena) { const c = r.clone(); caches.open(CACHE).then((k) => k.put(e.request, c)); return r; }
        return caches.match(e.request).then((hit) =>
          hit || (e.request.mode === "navigate" ? caches.match("./index.html") : null) || r);
      })
      .catch(() => caches.match(e.request).then((r) => r || (e.request.mode === "navigate" ? caches.match("./index.html") : undefined)))
  );
});
