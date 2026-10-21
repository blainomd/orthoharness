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

// topic: PubMed answers are stubbed, so the tests never touch the network.
import { checkTopic, checkAnswer, extractIds, designOf, buildQuery, topicMarkdown } from '../src/topic.mjs';
function pubmedStub({ count = 3, designCounts = {}, recs = {} } = {}) {
  return async (u) => {
    const url = new URL(u); const p = Object.fromEntries(url.searchParams);
    const json = (b) => ({ ok: true, status: 200, json: async () => b });
    if (url.pathname.endsWith('esearch.fcgi')) {
      const doi = /"([^"]+)"\[doi\]/.exec(p.term)?.[1];
      if (doi) { const hit = Object.values(recs).find((r) => r.articleids?.some((a) => a.idtype === 'doi' && a.value === doi)); return json({ esearchresult: { count: hit ? 1 : 0, idlist: hit ? [hit.uid] : [] } }); }
      for (const [k, v] of Object.entries(designCounts)) if (p.term.includes(k)) return json({ esearchresult: { count: v.count, idlist: v.ids } });
      if (/\[pt\]/.test(p.term)) return json({ esearchresult: { count: 0, idlist: [] } });
      return json({ esearchresult: { count, idlist: Object.keys(recs).filter((id) => recs[id].relevant) } });
    }
    const ids = p.id.split(','); const result = { uids: ids.filter((i) => recs[i]) };
    for (const i of result.uids) result[i] = recs[i];
    return json({ result });
  };
}
const rec = (uid, year, pubtype, doi, extra = {}) => ({ uid, title: `Paper ${uid}`, source: 'J Bone Joint Surg Am', pubdate: `${year} Jan`, pubtype, articleids: doi ? [{ idtype: 'doi', value: doi }] : [], ...extra });

test('topic: the default scope is every JBJS journal, and the topic is required', () => {
  const q = buildQuery('acl', {});
  for (const j of ['J Bone Joint Surg Am', 'JBJS Rev', 'JB JS Open Access', 'JBJS Case Connect']) assert.ok(q.includes(`"${j}"[ta]`));
  assert.throws(() => buildQuery('  '));
  assert.equal(buildQuery('acl', { scope: 'all' }), '(acl)');
});

test('topic: levels by publication type, highest first', () => {
  assert.equal(designOf(['Journal Article', 'Meta-Analysis']), 'meta');
  assert.equal(designOf(['Journal Article', 'Randomized Controlled Trial']), 'rct');
  assert.equal(designOf(['Journal Article', 'Review']), 'review');
  assert.equal(designOf(['Journal Article']), 'study');
});

test('topic: says where the evidence runs out (no high-level evidence, and an old newest trial)', async () => {
  const none = await checkTopic('x', { fetch: pubmedStub({ count: 4 }), gap: 0 });
  assert.ok(none.runs_out.some((n) => n.includes('No article PubMed types as a guideline')));
  const empty = await checkTopic('x', { fetch: pubmedStub({ count: 0 }), gap: 0 });
  assert.ok(empty.runs_out[0].startsWith('Nothing in JBJS journals'));
  const old = await checkTopic('x', { now: '2026-10-20', gap: 0, fetch: pubmedStub({ designCounts: { '"Randomized Controlled Trial"[pt]': { count: 1, ids: ['1'] } }, recs: { 1: rec('1', 2012, ['Randomized Controlled Trial']) } }) });
  assert.ok(old.runs_out.some((n) => n.includes('from 2012')));
});

test('topic: an AI answer is checked citation by citation, and strong evidence it skipped is listed', async () => {
  const recs = {
    10: rec('10', 2024, ['Meta-Analysis'], '10.2106/jbjs.a'),
    11: rec('11', 2023, ['Randomized Controlled Trial'], '10.2106/jbjs.b'),
    20: rec('20', 2025, ['Meta-Analysis'], '10.1177/other'),
    30: rec('30', 2019, ['Retracted Publication', 'Journal Article'], '10.1000/retracted'),
  };
  const f = pubmedStub({ designCounts: { '"Meta-Analysis"[pt]': { count: 1, ids: ['10'] }, '"Randomized Controlled Trial"[pt]': { count: 1, ids: ['11'] } }, recs });
  const e = await checkTopic('x', { fetch: f, gap: 0 });
  const a = await checkAnswer('See 10.2106/JBJS.A, PMID: 20, doi 10.1000/retracted and 10.9999/made.up. (Smith et al., 2021)', e, { fetch: f, gap: 0 });
  const v = Object.fromEntries(a.cited.map((c) => [c.cited, c.verdict]));
  assert.equal(v['10.2106/jbjs.a'], 'IN_EVIDENCE');
  assert.equal(v['PMID 20'], 'REAL_OUTSIDE_SEARCH');
  assert.equal(v['10.1000/retracted'], 'RETRACTED');
  assert.equal(v['10.9999/made.up'], 'NOT_IN_PUBMED');
  assert.deepEqual(a.unverifiable, ['Smith et al., 2021']);
  assert.deepEqual(a.left_out.map((r) => r.pmid), ['11']);
  assert.ok(topicMarkdown(e, a).includes('not a finding of fabrication'));
});

test('topic: an answer with no identifiers passes nothing', async () => {
  const e = await checkTopic('x', { fetch: pubmedStub({ count: 1 }), gap: 0 });
  const a = await checkAnswer('Studies show it works (Jones, 2020).', e, { fetch: pubmedStub(), gap: 0 });
  assert.equal(a.cited.length, 0);
  assert.equal(a.counts.unverifiable, 1);
  assert.ok(topicMarkdown(e, a).includes('cites no DOI or PMID'));
});

test('topic: PubMed 429 is retried, other errors stop the check', async () => {
  let n = 0;
  const flaky = async (u) => (++n === 1 ? { ok: false, status: 429 } : pubmedStub({ count: 0 })(u));
  const e = await checkTopic('x', { fetch: flaky, gap: 0 });
  assert.equal(e.total, 0);
  await assert.rejects(checkTopic('x', { fetch: async () => ({ ok: false, status: 500 }), gap: 0 }), /500/);
});

test('topic: extractIds finds DOIs, PMIDs and pubmed links, and trims punctuation', () => {
  const x = extractIds('doi:10.2106/JBJS.25.01497. and https://pubmed.ncbi.nlm.nih.gov/41490410/ PMID 123456');
  assert.deepEqual(x.dois, ['10.2106/jbjs.25.01497']);
  assert.deepEqual(x.pmids.sort(), ['123456', '41490410']);
});

test('the site serves the same topic module the CLI runs (byte copy)', () => {
  assert.equal(readFileSync(new URL('../site/topic.mjs', import.meta.url), 'utf8'), readFileSync(new URL('../src/topic.mjs', import.meta.url), 'utf8'));
});
