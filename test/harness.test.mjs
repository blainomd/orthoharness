import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadCases, caseSetHash, validateCase } from '../src/cases.mjs';
import { makeAdapter, parseAnswer } from '../src/adapters.mjs';
import { runCase, gradeCase, summarize } from '../src/run.mjs';
import { verdict, checkCitations } from '../src/citations.mjs';
import { delta } from '../src/delta.mjs';
import { mentions } from '../src/text.mjs';

const loss = JSON.parse(readFileSync(new URL('../loss-matrix.json', import.meta.url)));
const { cases, errors } = loadCases(new URL('../cases/demo', import.meta.url).pathname);

async function runAll(adapterName, opts = {}) {
  const adapter = makeAdapter(adapterName, opts);
  const out = [];
  for (const c of cases) out.push(await gradeCase(c, await runCase(c, adapter), loss, { offline: true, ...opts }));
  return summarize(out, { label: adapterName, adapter: adapterName, case_set_sha256: caseSetHash(cases), loss_matrix_version: loss.version });
}

test('demo cases are valid', () => {
  assert.deepEqual(errors, []);
  assert.equal(cases.length, 6);
});

test('a bad case is rejected (positive control for the validator)', () => {
  assert.ok(validateCase({ id: 'x', split: 'dev', stages: [], yardsticks: {} }).length >= 3);
});

test('always-operate pays the heaviest loss where the answer was do-not-operate', async () => {
  const s = await runAll('always-operate');
  const knee = s.results.find((r) => r.id === 'demo-01-knee-oa-no-trial');
  assert.equal(knee.yardsticks.guideline.loss, loss.loss.do_not_operate.operate);
  assert.equal(knee.premature_commit, true);
  assert.ok(s.results.find((r) => r.id === 'demo-05-shoulder-incomplete').yardsticks.guideline.over_commit);
});

test('always-abstain over-abstains, and abstaining is never counted as premature', async () => {
  const s = await runAll('always-abstain');
  assert.equal(s.sequence.premature_commits, 0);
  assert.equal(s.yardsticks.guideline.over_abstain, 5);
  assert.equal(s.yardsticks.guideline.agree, 1);
});

test('the two yardsticks are reported apart and there is no single overall score', async () => {
  const s = await runAll('replay', { answers: new URL('../examples/answers-careful.jsonl', import.meta.url).pathname });
  assert.equal(s.yardsticks.guideline.agree, 5);
  assert.equal(s.yardsticks.attending.agree, 6);
  assert.equal(s.yardstick_gap.sided_with_attending, 1);
  for (const k of ['score', 'overall', 'total_score', 'rank']) assert.equal(k in s, false);
  assert.equal(s.process.missed, 0);
  assert.equal(s.omissions.omitted, 0);
});

test('offline citations are UNCHECKED, never a pass', async () => {
  const r = await checkCitations([{ doi: '10.1097/CORR.0000000000003234', title: 'anything at all here' }], { offline: true });
  assert.equal(r[0].verdict, 'UNCHECKED');
});

test('citation verdicts compare titles, not just existence', () => {
  assert.equal(verdict('ok', 'Endoscopist deskilling risk after exposure to artificial intelligence in colonoscopy', 'Endoscopist deskilling risk after exposure to artificial intelligence in colonoscopy').verdict, 'VERIFIED');
  assert.equal(verdict('ok', 'Endoscopist deskilling risk after exposure to artificial intelligence in colonoscopy', 'ChatGPT-4 Knows Its A B C D E but Cannot Cite Its Source').verdict, 'TITLE_MISMATCH');
  assert.equal(verdict('missing', null, 'whatever title').verdict, 'DOES_NOT_RESOLVE');
  assert.equal(verdict('ok', 'A real title of a paper', '').verdict, 'NO_CLAIMED_TITLE');
});

test('parseAnswer reads JSON out of prose and marks garbage unparseable', () => {
  assert.equal(parseAnswer('Sure. {"decision": "Do not operate", "rationale": "x"} thanks').decision, 'do_not_operate');
  assert.equal(parseAnswer('no json here').decision, 'unparseable');
});

test('an unparseable answer takes the worst loss, not a free pass', async () => {
  const c = cases[0];
  const g = await gradeCase(c, { answer: { decision: 'unparseable' }, commitStage: 1, ranOut: false, transcript: [] }, loss, { offline: true });
  assert.equal(g.valid, false);
  assert.equal(g.yardsticks.guideline.loss, 2);
});

test('need_next at the last stage becomes not enough information', async () => {
  const r = await runCase(cases[0], async () => ({ decision: 'need_next' }));
  assert.equal(r.ranOut, true);
  assert.equal(r.answer.decision, 'not_enough_information');
});

test('delta labels kept, struck and added lines; an unedited signature is flagged', () => {
  const d = delta(readFileSync(new URL('../examples/draft.txt', import.meta.url), 'utf8'), readFileSync(new URL('../examples/signed.txt', import.meta.url), 'utf8'));
  assert.equal(d.kept, 2); assert.equal(d.struck, 2); assert.equal(d.added, 2);
  assert.equal(delta('a\nb', 'a\nb').unchanged, true);
});

test('the case-set hash ignores key order and changes with content', () => {
  const a = caseSetHash(cases);
  const reordered = cases.map((c) => Object.fromEntries(Object.entries(c).reverse()));
  assert.equal(caseSetHash(reordered), a);
  assert.notEqual(caseSetHash([{ ...cases[0], id: 'changed' }, ...cases.slice(1)]), a);
});

test('phrase matching is whole-phrase, not substring', () => {
  assert.equal(mentions('the patient fell', ['fell']), true);
  assert.equal(mentions('the patient felled a tree', ['fell']), false);
});
