// Service worker minimal : permet d'installer l'appli et de l'ouvrir même avec une connexion faible.
// Stratégie "réseau d'abord" : on prend toujours la version en ligne la plus récente.
// cache: "no-cache" → le navigateur redemande toujours au serveur s'il y a du nouveau
// (sinon GitHub Pages peut resservir l'ancienne version pendant 10 minutes).
const CACHE = "factures-v3";
const BASE = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(BASE)).catch(() => {}));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Firebase, polices, etc. : on ne touche pas
  e.respondWith(
    fetch(req.mode === "navigate" ? new Request(req.url, { cache: "no-cache", credentials: "same-origin" }) : new Request(req, { cache: "no-cache" }))
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req).then(m => m || caches.match("./")))
  );
});
