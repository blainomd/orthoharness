// estate-pwa v1 service worker for orthoharness.com. Made by estate-tests/pwa/pwa.mjs; re-run the installer, do not hand-edit.
// Opens "/" and the act page offline. Never caches /api/, other origins, a page with a ?query, or a private response.
const VERSION = "57492399ca";
const PRECACHE = ["/","/check","/manifest.webmanifest"];
const ACT = "/check";
var CACHE = "estate-pwa-" + VERSION, PRE = PRECACHE.slice(), ASSET = /\.(?:css|js|mjs|png|svg|webp|jpe?g|gif|ico|woff2?|webmanifest|json)$/i;
function same(u) { return u.origin === self.location.origin }
function privateRes(res) {
  var cc = (res.headers.get("cache-control") || "").toLowerCase();
  return res.headers.has("set-cookie") || /no-store|private/.test(cc)
}
function cacheable(res) { return res && res.ok && (res.type === "basic" || res.type === "default") && !privateRes(res) }
async function put(c, key, res) {
  if (!cacheable(res)) return;
  if (res.redirected) res = new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers });
  await c.put(key, res)
}
function subs(html, base) {
  var out = [], re = /(?:href|src)=["']([^"'#]+?\.(?:css|js|mjs|png|svg|webp|jpe?g|woff2?)(?:\?[^"'#]*)?)["']/gi, m, u;
  while ((m = re.exec(html)) && out.length < 80) {
    try { u = new URL(m[1], self.location.origin + base) } catch (e) { continue }
    if (same(u) && u.pathname.indexOf("/api/") !== 0 && out.indexOf(u.href) < 0) out.push(u.href)
  }
  return out
}
self.addEventListener("install", function (e) {
  e.waitUntil((async function () {
    var c = await caches.open(CACHE), i, j, r, s;
    for (i = 0; i < PRE.length; i++) { try { await put(c, PRE[i], await fetch(PRE[i], { cache: "no-cache" })) } catch (x) {} }
    for (i = 0; i < PRE.length; i++) {
      try {
        r = await c.match(PRE[i]); if (!r || !/html/.test(r.headers.get("content-type") || "")) continue;
        s = subs(await r.text(), PRE[i]);
        for (j = 0; j < s.length; j++) { try { await put(c, s[j], await fetch(s[j])) } catch (x) {} }
      } catch (x) {}
    }
    await self.skipWaiting()
  })())
});
self.addEventListener("activate", function (e) {
  e.waitUntil((async function () {
    var k = await caches.keys(), i;
    for (i = 0; i < k.length; i++) if (k[i].indexOf("estate-pwa-") === 0 && k[i] !== CACHE) await caches.delete(k[i]);
    await self.clients.claim()
  })())
});
self.addEventListener("fetch", function (e) {
  var r = e.request, u = new URL(r.url);
  if (r.method !== "GET" || !same(u) || u.pathname.indexOf("/api/") === 0) return;
  if (r.mode === "navigate" || (r.headers.get("accept") || "").indexOf("text/html") >= 0) {
    e.respondWith((async function () {
      var c = await caches.open(CACHE), res;
      try {
        res = await fetch(r);
        if (!u.search) e.waitUntil(put(c, u.pathname, res.clone()));
        return res
      } catch (x) {
        return (await c.match(u.pathname)) || (await c.match(u.pathname.replace(/\/$/, "") || "/")) ||
          (await c.match(u.pathname.replace(/\.html$/, ""))) || (await c.match("/")) || Response.error()
      }
    })());
    return
  }
  if (!ASSET.test(u.pathname)) return;
  e.respondWith((async function () {
    var c = await caches.open(CACHE), hit = await c.match(r), net = fetch(r).then(function (res) {
      return put(c, r, res.clone()).then(function () { return res }, function () { return res })
    });
    if (hit) { e.waitUntil(net.catch(function () {})); return hit }
    return net
  })())
});
