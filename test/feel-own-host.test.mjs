// "Something wrong?" (estate-feel) counts on THIS site's own host (2026-11-20, the co-op.care e157070 pattern): the button
// is on the pages, a tap is a GET for an empty /s/f-<answer>.txt here and a noticed signal a GET for /s/x-<signal>.txt;
// no feel code names solvinghealth.com/api/arrive or sendBeacon; the 11 empty files exist under the deploy root.
// Fail-first: ROOT=<a checkout of the tree before the restore> node --test <this file>  (fails: no own-host button).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(ROOT, 'site');
const SKIP = new Set(['node_modules', 'tests', 'test', '.git', '.next', 'out', 'dist', 'build', 'archive', '_archive', '.claude', '.vercel', '.firebase', 'coverage']);
function files(d, out = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name.startsWith('.') || SKIP.has(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) files(p, out);
    else if (/\.(html|js|mjs|ts|tsx|jsx)$/.test(e.name)) out.push(p);
  }
  return out;
}
const feel = files(ROOT).map((f) => [f, fs.readFileSync(f, 'utf8')]).filter(([, t]) => /estate-feel|ESTATE_FEEL|estateFeel/.test(t));
const FETCH = /fetch\(\\?"\/s\/\\?"\+\(o\.f\?\\?"f-\\?"\+o\.f:\\?"x-\\?"\+o\.x\)\+\\?"\.txt\\?"/;

test('the "Something wrong?" button is on the site, own-host', () => {
  const own = feel.filter(([, t]) => /estate-feel v\d own-host/.test(t) && FETCH.test(t));
  assert.ok(own.length > 0, 'no file carries the own-host feel script');
  assert.ok(feel.some(([, t]) => /data-estate-feel/.test(t)), 'no page renders <script data-estate-feel>');
});

test('no feel code sends to another host', () => {
  const bad = feel.filter(([, t]) => /api\/arrive|sendBeacon|solvinghealth\.com\/api/.test(t.split('\n').filter((l) => /estate-feel|ESTATE_FEEL|estateFeel|function send\(o\)/.test(l)).join('\n'))).map(([f]) => path.relative(ROOT, f));
  assert.deepEqual(bad, []);
});

test('the 11 feel files exist and are empty under the deploy root', () => {
  for (const f of ['f-helped', 'f-confusing', 'f-too_long', 'f-no_answer', 'f-broken', 'f-pushy', 'f-not_for_me', 'x-error', 'x-rage', 'x-quick_exit', 'x-slow']) {
    const p = path.join(PUB, 's', f + '.txt');
    assert.ok(fs.existsSync(p), path.relative(ROOT, p));
    assert.equal(fs.statSync(p).size, 0, f);
  }
});
