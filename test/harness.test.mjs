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
    if (url.pathname.endsWith('efetch.fcgi')) {
      const xml = p.id.split(',').filter((i) => recs[i]).map((i) => `<PubmedArticle><PMID Version="1">${i}</PMID><ArticleTitle>${recs[i].title}</ArticleTitle>${recs[i].abstract ? `<AbstractText Label="CONCLUSIONS">${recs[i].abstract}</AbstractText>` : ''}</PubmedArticle>`).join('');
      return { ok: true, status: 200, text: async () => `<PubmedArticleSet>${xml}</PubmedArticleSet>` };
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

import { extractQuotes, parseAbstracts, groundedPrompt, squash } from '../src/topic.mjs';
test('quote gate: a real quote passes, an invented one under the same real PMID is caught, a bare quote has no source', async () => {
  const recs = { 50: rec('50', 2023, ['Randomized Controlled Trial'], '10.2106/jbjs.q', { abstract: 'There is no evidence that knee injections with PRP have superior effects when compared with placebo.' }) };
  const f = pubmedStub({ designCounts: { '"Randomized Controlled Trial"[pt]': { count: 1, ids: ['50'] } }, recs });
  const e = await checkTopic('x', { fetch: f, gap: 0 });
  const ans = 'It does not help: \u201cthere is NO evidence that knee injections with PRP have superior effects\u201d (PMID 50). '
    + 'Yet "PRP produced dramatically better outcomes than every other injection" (PMID 50). '
    + 'And "experts agree this is the best option for all patients".';
  const a = await checkAnswer(ans, e, { fetch: f, gap: 0 });
  assert.deepEqual(a.quotes.map((q) => q.verdict), ['QUOTE_IN_SOURCE', 'QUOTE_NOT_IN_ABSTRACT', 'QUOTE_NO_SOURCE']);
  assert.equal(a.counts.quotes_in_source, 1);
  assert.ok(topicMarkdown(e, a).includes('may be in the full text'));
});

test('quote gate: a paper with no abstract is never a pass', async () => {
  const recs = { 60: rec('60', 2020, ['Journal Article'], null) };
  const f = pubmedStub({ count: 1, recs: { 60: { ...recs[60], relevant: true } } });
  const e = await checkTopic('x', { fetch: f, gap: 0 });
  const a = await checkAnswer('"a long enough quoted claim with many words" (PMID 60)', e, { fetch: f, gap: 0 });
  assert.equal(a.quotes[0].verdict, 'QUOTE_NO_ABSTRACT');
});

test('quote extraction: short quotes are ignored; the nearest PMID after, else before, is the source', () => {
  const q = extractQuotes('PMID 11 says "this short one" and later "a quote with at least five real words" then PMID 22.');
  assert.equal(q.length, 1);
  assert.deepEqual(q[0].source, { pmid: '22' });
  assert.equal(parseAbstracts('<PubmedArticle><PMID>9</PMID><ArticleTitle>T</ArticleTitle></PubmedArticle>')['9'].has_abstract, false);
});

test('grounded prompt lists only retrieved records and makes "not enough information" a correct answer', async () => {
  const recs = { 70: rec('70', 2024, ['Meta-Analysis'], '10.1/x') };
  const e = await checkTopic('acl', { fetch: pubmedStub({ designCounts: { '"Meta-Analysis"[pt]': { count: 1, ids: ['70'] } }, recs }), gap: 0 });
  const p = groundedPrompt(e);
  assert.ok(p.includes('PMID 70'));
  assert.ok(p.includes('not enough information'));
  assert.ok(p.includes('exact words'));
});

test('quote gate: quoting a paper\'s own title is not support; its abstract is (positive control)', async () => {
  const recs = { 80: rec('80', 2022, ['Meta-Analysis'], '10.2106/jbjs.t', { title: 'Tranexamic acid in total knee replacement a meta analysis', abstract: 'Tranexamic acid reduced total blood loss by a mean of 591 ml without raising the rate of thrombosis.' }) };
  const f = pubmedStub({ designCounts: { '"Meta-Analysis"[pt]': { count: 1, ids: ['80'] } }, recs });
  const e = await checkTopic('x', { fetch: f, gap: 0 });
  const a = await checkAnswer('See "Tranexamic acid in total knee replacement a meta analysis" (PMID 80). It "reduced total blood loss by a mean of 591 ml" (PMID 80).', e, { fetch: f, gap: 0 });
  assert.deepEqual(a.quotes.map((q) => q.verdict), ['QUOTE_IS_TITLE', 'QUOTE_IN_SOURCE']);
  assert.ok(groundedPrompt(e).includes('not the title'));
});

import { ask, gateSentences, sentences, complete, askMarkdown, GATE_VERSION } from '../src/ask.mjs';
import { createHash } from 'node:crypto';

function askStub(reply, recs, extra = {}) {
  const pm = pubmedStub({ designCounts: { '"Meta-Analysis"[pt]': { count: 1, ids: ['80'] } }, recs });
  const calls = [];
  const f = async (u, init) => {
    if (String(u).includes('/chat/completions')) {
      calls.push({ u, init });
      return { ok: true, status: 200, json: async () => ({ choices: [{ finish_reason: extra.finish ?? 'stop', message: { content: reply } }], ...(extra.usage ? { usage: extra.usage } : {}) }) };
    }
    return pm(u);
  };
  f.calls = calls;
  return f;
}
const ASK_RECS = {
  80: rec('80', 2022, ['Meta-Analysis'], '10.2106/jbjs.t', { title: 'Tranexamic acid in total knee replacement a meta analysis', abstract: 'Tranexamic acid reduced total blood loss by a mean of 591 ml without raising the rate of thrombosis.' }),
  20: rec('20', 2019, ['Journal Article'], null, { abstract: 'Platelet rich plasma injections for knee osteoarthritis improved pain scores at six months.' }),
};

test('ask: each sentence gets one verdict; only an abstract quote under an evidence PMID is kept', async () => {
  const reply = [
    'TXA "reduced total blood loss by a mean of 591 ml" (PMID 80).',
    'Meta-analysis: "Tranexamic acid in total knee replacement a meta analysis" (PMID 80).',
    'It "eliminated the need for transfusion in every patient studied" (PMID 80).',
    'PRP "improved pain scores at six months" in a related paper (PMID 20).',
    'TXA is safe for everyone.',
    'There is not enough information on dosing in these records.',
  ].join('\n');
  const f = askStub(reply, ASK_RECS);
  const r = await ask('txa tka', { fetch: f, gap: 0, baseUrl: 'http://model.local/v1', model: 'm', apiKey: 'sk-test-not-real', now: '2026-10-21T00:00:00Z' });
  assert.deepEqual(r.gated.map((g) => g.verdict), ['KEPT', 'LISTED', 'STRUCK', 'STRUCK', 'UNCITED', 'ABSTAINED']);
  assert.match(r.gated[2].reason, /not in the cited abstract/);
  assert.match(r.gated[3].reason, /outside the retrieved records/);
  assert.deepEqual([r.receipt.kept, r.receipt.listed, r.receipt.struck, r.receipt.uncited, r.receipt.abstained], [1, 1, 2, 1, 1]);
  assert.equal(r.receipt.gate, GATE_VERSION);
  // the receipt hash covers everything else in it, and the key and endpoint are never recorded
  const { receipt_sha256, ...body } = r.receipt;
  assert.equal(receipt_sha256, createHash('sha256').update(JSON.stringify(body)).digest('hex'));
  assert.equal(r.receipt.reply_sha256, createHash('sha256').update(reply).digest('hex'));
  const md = askMarkdown(r);
  assert.ok(!JSON.stringify(r.receipt).includes('sk-test') && !md.includes('sk-test') && !md.includes('model.local'));
  assert.equal(f.calls[0].init.headers.authorization, 'Bearer sk-test-not-real');
  assert.ok(md.includes('Listed papers, no claim checked (1)'));
});

test('ask: an empty or cut-off model reply is an error, never "nothing survived"', async () => {
  await assert.rejects(ask('txa', { fetch: askStub('', ASK_RECS, { finish: 'length' }), gap: 0, baseUrl: 'http://m/v1', model: 'm' }), /no answer text \(finish_reason: length\)/);
  await assert.rejects(ask('txa', { fetch: askStub('TXA "reduced total blood loss by a mean', ASK_RECS, { finish: 'length' }), gap: 0, baseUrl: 'http://m/v1', model: 'm' }), /cut off/);
  await assert.rejects(complete('p', { fetch: async () => ({ ok: true }) }), /ORTHOHARNESS_BASE_URL/);
  // positive control: the same stub with a normal reply runs
  const ok = await complete('p', { baseUrl: 'http://m/v1', model: 'm', fetch: askStub('fine.', ASK_RECS) });
  assert.equal(ok, 'fine.');
});

test('ask: reasoning_effort is sent only when set; thinking blocks are stripped', async () => {
  const f = askStub('<think>long private reasoning</think>Answer.', ASK_RECS);
  assert.equal(await complete('p', { baseUrl: 'http://m/v1', model: 'm', fetch: f }), 'Answer.');
  await complete('p', { baseUrl: 'http://m/v1', model: 'm', reasoningEffort: 'none', fetch: f });
  const bodies = f.calls.map((c) => JSON.parse(c.init.body));
  assert.equal('reasoning_effort' in bodies[0], false);
  assert.equal(bodies[1].reasoning_effort, 'none');
});

test('sentences: quotes and "et al." do not split a sentence', () => {
  assert.deepEqual(sentences('Smith et al. found "a drop. then a rise" here (PMID 1). Next one.'), ['Smith et al. found "a drop. then a rise" here (PMID 1).', 'Next one.']);
  assert.equal(gateSentences('', { cited: [], quotes: [] }).length, 0);
});

test('ask: the model is shown each record\'s abstract, so it can quote it; a record with none says so', async () => {
  const recs = { ...ASK_RECS, 81: { ...rec('81', 2021, ['Journal Article'], null), relevant: true } };
  const f = askStub('There is not enough information.', recs);
  const r = await ask('txa', { fetch: f, gap: 0, baseUrl: 'http://m/v1', model: 'm' });
  assert.ok(r.prompt.includes('Abstract: Tranexamic acid reduced total blood loss by a mean of 591 ml'));
  assert.ok(r.prompt.includes('Abstract: none in PubMed (do not quote this record)'));
  assert.equal(r.receipt.abstracts_given, 1);
  // without abstracts the prompt carries titles only (the site preview and old callers)
  assert.ok(!groundedPrompt(r.evidence).includes('Abstract:'));
});

test('ask: a prompt the server cut short is an error; a full one passes (positive control)', async () => {
  const long = 'x'.repeat(8000);
  await assert.rejects(complete(long, { baseUrl: 'http://m/v1', model: 'm', fetch: askStub('ok.', ASK_RECS, { usage: { prompt_tokens: 500 } }) }), /context window cut/);
  assert.equal(await complete(long, { baseUrl: 'http://m/v1', model: 'm', fetch: askStub('ok.', ASK_RECS, { usage: { prompt_tokens: 2000 } }) }), 'ok.');
});

test('quote gate: hex entities like &#xb1; (±) match, and a short quote never pairs with the next one', async () => {
  const xml = '<PubmedArticle><PMID>90</PMID><ArticleTitle>T</ArticleTitle><AbstractText>Blood loss was 348.1 &#xb1; 158.2 mL on day 1 &#x2264; day 3.</AbstractText></PubmedArticle>';
  const a = parseAbstracts(xml)['90'];
  assert.ok(a.abstract.includes(squash('Blood loss was 348.1 ± 158.2 mL on day 1')));
  assert.ok(!a.abstract.includes('xb1'));
  const q = extractQuotes('TXA is "effective and safe" (PMID 1) and "safe in patients with a history of coronary disease" (PMID 2).');
  assert.deepEqual(q.map((x) => [x.quote, x.source.pmid]), [['safe in patients with a history of coronary disease', '2']]);
});
