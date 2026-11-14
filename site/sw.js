// orthoharness.com folded into decisionindex.com on 2026-11-14. This worker retires itself: on activate it deletes every
// cache this origin made and unregisters, so a phone that installed the old site gets the hand-off page from the network.
self.addEventListener("install", function () { self.skipWaiting() });
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (k) { return Promise.all(k.map(function (n) { return caches.delete(n) })) })
    .then(function () { return self.registration.unregister() })
    .then(function () { return self.clients.matchAll({ type: "window" }) })
    .then(function (cs) { cs.forEach(function (c) { try { c.navigate(c.url) } catch (x) {} }) }));
});
