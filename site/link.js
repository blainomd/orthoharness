// A link can carry a topic (2026-11-20): /check?q=anterior+cruciate+ligament+reconstruction&scope=jbjs&since=2015
// fills the form and runs the check through the same submit handler. The copy button shares the topic and scope only;
// text pasted into the second box never goes into a link. The address is never rewritten on its own.
(function () {
  var SCOPES = ['jbjs', 'ortho', 'all'];
  var $ = function (id) { return document.getElementById(id); };
  var f = $('f'), topic = $('topic'), scope = $('scope'), since = $('since');
  if (!f || !topic) return;
  var qs = new URLSearchParams(location.search);
  var q = (qs.get('q') || '').trim().slice(0, 300);
  var sc = qs.get('scope'), yr = (qs.get('since') || '').trim();
  if (q) {
    topic.value = q;
    if (scope && SCOPES.indexOf(sc) >= 0) scope.value = sc;
    if (since && /^\d{4}$/.test(yr)) since.value = yr;
    // Run after every deferred and module script has attached its handlers.
    var run = function () { try { f.requestSubmit(); } catch (e) {} };
    if (document.readyState === 'complete') run(); else addEventListener('load', run);
  }
  var share = $('share');
  if (share) share.addEventListener('click', function () {
    var p = new URLSearchParams({ q: topic.value.trim().slice(0, 300) });
    if (scope && scope.value !== 'jbjs' && SCOPES.indexOf(scope.value) >= 0) p.set('scope', scope.value);
    if (since && /^\d{4}$/.test(since.value.trim())) p.set('since', since.value.trim());
    var url = location.origin + '/check?' + p.toString();
    var done = function (t) { share.textContent = t; setTimeout(function () { share.textContent = 'Copy a link to this topic'; }, 2500); };
    try { navigator.clipboard.writeText(url).then(function () { done('Link copied'); }, function () { prompt('Copy this link', url); }); }
    catch (e) { prompt('Copy this link', url); }
  });
})();
