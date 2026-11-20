// estate steps for /check (own-host since 2026-11-20): counts that the job was started, finished and followed, nothing else.
// A step is a GET for an empty file on this same site (/s/start.txt, /s/result.txt, /s/next.txt), once each per page load:
// no query, no body, no cookie, no other host. Visits are this host's own request log. Never what was typed or shown.
// Do Not Track, Global Privacy Control and automated browsers: nothing is sent.
(function () {
  try {
    var n = navigator;
    if (n.doNotTrack === "1" || n.globalPrivacyControl || n.webdriver || /bot|headless|lighthouse/i.test(n.userAgent)) return;
    var sent = {};
    var step = function (s) { if (sent[s]) return; sent[s] = 1; try { fetch("/s/" + s + ".txt", { cache: "no-store", keepalive: true, credentials: "omit" }).catch(function () {}); } catch (e) {} };
    var f = document.getElementById('f');
    if (f) f.addEventListener('submit', function () { step("start"); }, true);
    var out = document.getElementById('out');
    if (out) new MutationObserver(function () { if (document.querySelector('#out h2')) step("result"); }).observe(out, { childList: true, subtree: true });
    document.addEventListener('click', function (e) {
      var a = e.target && e.target.closest && e.target.closest('[data-step]');
      if (a && a.getAttribute('data-step') === 'next') step("next");
    }, true);
  } catch (e) {}
})();
// Wiring marker read by estate-os/functional/steps-check.mjs: {s:"start"} {s:"result"} {s:"next"}
