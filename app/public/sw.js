// Service worker: abre o app sem rede (casca em cache) e mostra as notificações.
const CACHE = "radar-v1";
const CASCA = ["/", "/app.js", "/estilo.css", "/manifest.webmanifest", "/icone.svg", "/icone-192.png"];

self.addEventListener("install", (ev) => {
  ev.waitUntil(caches.open(CACHE).then((c) => c.addAll(CASCA)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (ev) => {
  ev.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Rede primeiro (o app sempre na versão nova); sem rede, a casca guardada. A API nunca vai para o cache.
self.addEventListener("fetch", (ev) => {
  const url = new URL(ev.request.url);
  if (ev.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  ev.respondWith(
    fetch(ev.request)
      .then((r) => {
        if (r.ok) {
          const copia = r.clone();
          caches.open(CACHE).then((c) => c.put(ev.request.mode === "navigate" ? "/" : ev.request, copia));
        }
        return r;
      })
      .catch(() => caches.match(ev.request.mode === "navigate" ? "/" : ev.request)),
  );
});

self.addEventListener("push", (ev) => {
  let d = {};
  try {
    d = ev.data ? ev.data.json() : {};
  } catch {
    d = { corpo: ev.data?.text() };
  }
  ev.waitUntil(
    self.registration.showNotification(d.titulo || "Radar de ofertas", {
      body: d.corpo || "",
      icon: "/icone-192.png",
      badge: "/icone-mono.png",
      tag: "radar-coleta",
      renotify: true,
      data: { url: d.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (ev) => {
  ev.notification.close();
  const alvo = new URL(ev.notification.data?.url || "/", location.origin).href;
  ev.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((ws) => {
      for (const w of ws) if ("focus" in w) return w.navigate(alvo).then((x) => (x || w).focus());
      return self.clients.openWindow(alvo);
    }),
  );
});
