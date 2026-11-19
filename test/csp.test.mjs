// The served home page's enforced CSP (2026-11-18): firebase.hosting.json carries a policy that names every
// executable inline script on site/index.html by its sha256. Edit that script without updating the hash and the
// browser blocks it on the live page, so this test fails first. JSON-LD (type=application/ld+json) does not run and
// needs no hash. Only index.html is served: /check and every other path 301 to decisionindex.com/ortho.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const host = JSON.parse(readFileSync(new URL('../firebase.hosting.json', import.meta.url)));
const csp = host.hosting.headers.flatMap((h) => h.headers).find((x) => x.key === 'Content-Security-Policy')?.value || '';
const html = readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');
const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi)]
  .filter((m) => !/type\s*=\s*["']?application\/ld\+json/i.test(m[1])).map((m) => m[2]);

test('the CSP limits scripts, not only framing', () => {
  for (const d of ["default-src 'self'", "script-src 'self'", "object-src 'none'", "base-uri 'self'", "frame-ancestors 'self'"]) assert.ok(csp.includes(d), d);
  assert.ok(!/script-src[^;]*'unsafe-inline'/.test(csp), 'no unsafe-inline for scripts');
});

test('every executable inline script on the home page is named by its hash', () => {
  assert.ok(inline.length > 0);
  for (const s of inline) {
    const h = `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`;
    assert.ok(csp.includes(h), `missing ${h}: update firebase.hosting.json (node ~/Documents/estate-os/functional/csp.mjs prints it)`);
  }
});

test('the home page has no inline handler or javascript: link the policy would block', () => {
  assert.ok(!/\son[a-z]+\s*=\s*["']/i.test(html.replace(/<meta[^>]*>/gi, '')), 'inline handler');
  assert.ok(!/href\s*=\s*["']javascript:/i.test(html), 'javascript: link');
});
