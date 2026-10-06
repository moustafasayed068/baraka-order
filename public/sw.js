// El Baraka service worker: keeps the customer menu usable on weak connections.
// - Build assets and icons: cache first (file names change with every build).
// - Customer pages (home, branch menus): network first, fall back to the last copy, then to /offline.html.
// - Never cached: APIs, order tracking (private), and all staff screens.
const CACHE = "baraka-v2"; // bump to clear old saved copies on every phone
const SHELL = ["/offline.html", "/icons/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const PRIVATE = /^\/(api|t|admin|kitchen|screen|rider)(\/|$)/;

// Save a copy before handing the response to the page (a response body can only be read once).
function keep(req, res) {
  if (res.ok) {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(req, copy));
  }
  return res;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || PRIVATE.test(url.pathname)) return;

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => keep(req, res))));
    return;
  }

  if (req.mode === "navigate" && (url.pathname === "/" || url.pathname.startsWith("/b/"))) {
    e.respondWith(fetch(req).then((res) => keep(req, res))
      .catch(() => caches.match(req, { ignoreVary: true }).then((hit) => hit || caches.match("/offline.html"))));
  }
});
