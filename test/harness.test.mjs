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
  assert.equal(cases.length, 7);
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
  const scan = s.results.find((r) => r.id === 'demo-07-degenerative-meniscus-scan');
  assert.equal(scan.yardsticks.guideline.loss, loss.loss.do_not_operate.operate);
  assert.deepEqual(scan.missed_checks, ['mechanical_block']);
});

test('always-abstain over-abstains, and abstaining is never counted as premature', async () => {
  const s = await runAll('always-abstain');
  assert.equal(s.sequence.premature_commits, 0);
  assert.equal(s.yardsticks.guideline.over_abstain, 6);
  assert.equal(s.yardsticks.guideline.agree, 1);
});

test('the two yardsticks are reported apart and there is no single overall score', async () => {
  const s = await runAll('replay', { answers: new URL('../examples/answers-careful.jsonl', import.meta.url).pathname });
  assert.equal(s.yardsticks.guideline.agree, 6);
  assert.equal(s.yardsticks.attending.agree, 7);
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

test('refs parses blocks, pulls the DOI out of the title, and lists references without one', async () => {
  const { parseRefs, screenRefs } = await import('../src/refs.mjs');
  const r = parseRefs('A B. Some real title here. J. 2026. doi:10.2106/JBJS.26.00433.\n\nNo DOI here at all.');
  assert.equal(r.length, 2);
  assert.equal(r[0].doi, '10.2106/JBJS.26.00433');
  assert.equal(r[0].title.includes('10.2106'), false);
  assert.equal(r[1].doi, null);
  const s = await screenRefs(readFileSync(new URL('../examples/references.txt', import.meta.url), 'utf8'), { offline: true });
  assert.equal(s.references, 6);
  assert.equal(s.counts.NO_DOI, 1);
  assert.equal(s.counts.UNCHECKED, 5);
  assert.equal(s.counts.VERIFIED, 0);
  assert.equal(s.flagged, 0);
  assert.equal(s.support_read, 0);
});

test('refs flags a borrowed DOI and a dead one (positive control, CrossRef answers stubbed)', async () => {
  const { screenRefs } = await import('../src/refs.mjs');
  const real = 'Epistemic Asymmetry Between Abstracts and Discussion Sections in the Orthopaedic Literature';
  const cache = new Map([
    ['10.9999/a', { status: 'ok', title: real }],
    ['10.9999/b', { status: 'ok', title: real }],
    ['10.9999/c', { status: 'missing' }],
  ]);
  const s = await screenRefs([
    `X. ${real}. JBJS 2026. doi:10.9999/a`,
    'Y. Robotic knee replacement doubles ten-year survival. JBJS 2026. doi:10.9999/b',
    'Z. Anything. doi:10.9999/c',
  ].join('\n'), { cache });
  assert.deepEqual(s.rows.map((x) => x.verdict), ['VERIFIED', 'TITLE_MISMATCH', 'DOES_NOT_RESOLVE']);
  assert.equal(s.flagged, 2);
});

test('right for the wrong reason: same decision, none of the yardstick reasons named', async () => {
  const c = cases.find((x) => x.id === 'demo-03-tka-skin-infection');
  const at = (rationale) => async () => ({ decision: 'do_not_operate', rationale, contraindications_checked: ['active infection at the operative site'], citations: [] });
  const wrong = await gradeCase(c, await runCase(c, at('BMI is high and she should lose weight before a knee replacement.')), loss, { offline: true });
  const right = await gradeCase(c, await runCase(c, at('Draining wound with cellulitis over the knee. Treat the infection first.')), loss, { offline: true });
  for (const k of ['guideline', 'attending']) {
    assert.equal(wrong.yardsticks[k].agree, true);
    assert.equal(wrong.yardsticks[k].wrong_reason, true);
    assert.deepEqual(wrong.yardsticks[k].reasons_missed, ['active_infection']);
    assert.equal(right.yardsticks[k].wrong_reason, false);
    assert.deepEqual(right.yardsticks[k].reasons_named, ['active_infection']);
  }
  const s = summarize([wrong, right], { label: 't', adapter: 't', case_set_sha256: 'x', loss_matrix_version: 'v' });
  assert.equal(s.yardsticks.attending.right_for_wrong_reason, 1);
  assert.equal(s.yardsticks.attending.agreements_with_stated_reasons, 2);
});

test('a disagreeing answer is never counted as wrong-reason (it is just wrong)', async () => {
  const c = cases.find((x) => x.id === 'demo-03-tka-skin-infection');
  const r = await gradeCase(c, await runCase(c, async () => ({ decision: 'operate', rationale: 'Non-operative care failed.', citations: [] })), loss, { offline: true });
  assert.equal(r.yardsticks.guideline.wrong_reason, false);
});

test('reasons must be [{ id, any }] when present', () => {
  const bad = JSON.parse(JSON.stringify(cases[0]));
  bad.yardsticks.guideline.reasons = [{ id: 'x' }];
  assert.ok(validateCase(bad).some((e) => e.includes('reasons')));
});
