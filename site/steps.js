// estate steps for /check (2026-11-20): counts that the job was started, finished and followed, nothing else.
// Sends the step, this page's path, a mobile flag and the referring host on the view. Never what was typed or shown.
// Do Not Track, Global Privacy Control and bots: nothing is sent.
(function () {
  try {
    var n = navigator;
    if (n.doNotTrack === "1" || n.globalPrivacyControl || n.webdriver || /bot|headless|lighthouse/i.test(n.userAgent)) return;
    var u = "https://solvinghealth.com/api/arrive", m = matchMedia("(max-width:700px)").matches ? 1 : 0, sent = {};
    var send = function (o) { try { o.p = location.pathname; o.m = m; n.sendBeacon(u, JSON.stringify(o)); } catch (e) {} };
    var step = function (s) { if (sent[s]) return; sent[s] = 1; send({ s: s }); };
    var r = ""; try { r = document.referrer ? new URL(document.referrer).hostname : ""; } catch (e) {}
    send({ r: r });
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
