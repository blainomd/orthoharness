import { DECISIONS } from './cases.mjs';
import { mentions } from './text.mjs';
import { checkCitations, VERDICTS } from './citations.mjs';

// Reveal one stage at a time until the system commits or the record runs out.
export async function runCase(c, adapter) {
  const transcript = [];
  let answer = null, commitStage = c.stages.length, ranOut = false;
  for (let i = 0; i < c.stages.length; i++) {
    const a = await adapter({ caseId: c.id, stageIndex: i, totalStages: c.stages.length, revealed: c.stages.slice(0, i + 1) });
    transcript.push({ stage: i + 1, decision: a.decision });
    if (a.decision === 'need_next' && i + 1 < c.stages.length) continue;
    answer = a; commitStage = i + 1;
    if (a.decision === 'need_next') { ranOut = true; answer = { ...a, decision: 'not_enough_information' }; }
    break;
  }
  return { answer, commitStage, ranOut, transcript };
}

// Grade one case. Each yardstick is scored on its own; nothing here averages them together.
export async function gradeCase(c, run, loss, opts = {}) {
  const a = run.answer ?? {};
  const d = a.decision;
  const valid = DECISIONS.includes(d);
  const worst = Math.max(...DECISIONS.flatMap((t) => DECISIONS.map((p) => loss.loss[t][p])));
  const yard = {};
  for (const k of ['guideline', 'attending']) {
    const truth = c.yardsticks[k].decision;
    yard[k] = {
      truth,
      agree: valid && d === truth,
      loss: valid ? loss.loss[truth][d] : worst,
      over_commit: valid && truth === 'not_enough_information' && d !== truth,
      over_abstain: valid && truth !== 'not_enough_information' && d === 'not_enough_information',
    };
  }
  const premature = valid && d !== 'not_enough_information' && c.min_stage != null && run.commitStage < c.min_stage;
  const checkedText = [...(a.contraindications_checked ?? []), a.rationale ?? ''].join(' . ');
  const missedChecks = (c.required_checks ?? []).filter((r) => !mentions(checkedText, r.any)).map((r) => r.id);
  const omitted = (c.required_facts ?? []).filter((r) => !mentions(a.rationale ?? '', r.any)).map((r) => r.id);
  const citations = await checkCitations(a.citations ?? [], { offline: opts.offline, cache: opts.cache });
  const penalty = (premature ? loss.premature_commit : 0)
    + missedChecks.length * loss.missed_required_check + omitted.length * loss.omitted_required_fact;
  return {
    id: c.id, split: c.split, decision: d, valid, commit_stage: run.commitStage, stages: c.stages.length,
    ran_out_of_record: run.ranOut, transcript: run.transcript, yardsticks: yard, yardsticks_disagree: c.yardsticks.guideline.decision !== c.yardsticks.attending.decision,
    premature_commit: premature, n_checks: (c.required_checks ?? []).length, n_facts: (c.required_facts ?? []).length, missed_checks: missedChecks, omitted_facts: omitted, process_penalty: penalty, citations,
    signed_by: a.signed_by ?? opts.signer ?? null,
  };
}

// The report is by kind of error. There is deliberately no single overall score.
export function summarize(results, meta) {
  const n = results.length;
  const per = {};
  for (const k of ['guideline', 'attending']) {
    const confusion = Object.fromEntries(DECISIONS.map((t) => [t, Object.fromEntries([...DECISIONS, 'invalid'].map((p) => [p, 0]))]));
    let agree = 0, lossSum = 0, oc = 0, oa = 0;
    for (const r of results) {
      const y = r.yardsticks[k];
      confusion[y.truth][r.valid ? r.decision : 'invalid']++;
      if (y.agree) agree++; lossSum += y.loss; if (y.over_commit) oc++; if (y.over_abstain) oa++;
    }
    per[k] = { agree, of: n, decision_loss: round(lossSum), over_commit: oc, over_abstain: oa, confusion };
  }
  const split = results.filter((r) => r.yardsticks_disagree);
  const cites = results.flatMap((r) => r.citations);
  return {
    ...meta,
    cases: n,
    yardsticks: per,
    yardstick_gap: {
      cases: split.length,
      sided_with_guideline: split.filter((r) => r.yardsticks.guideline.agree).length,
      sided_with_attending: split.filter((r) => r.yardsticks.attending.agree).length,
      neither: split.filter((r) => !r.yardsticks.guideline.agree && !r.yardsticks.attending.agree).length,
    },
    sequence: { premature_commits: results.filter((r) => r.premature_commit).length, ran_out_of_record: results.filter((r) => r.ran_out_of_record).length },
    process: { required_checks: results.reduce((s, r) => s + r.n_checks, 0), missed: results.reduce((s, r) => s + r.missed_checks.length, 0) },
    omissions: { required_facts: results.reduce((s, r) => s + r.n_facts, 0), omitted: results.reduce((s, r) => s + r.omitted_facts.length, 0) },
    citations: { total: cites.length, ...Object.fromEntries(VERDICTS.map((v) => [v, cites.filter((c) => c.verdict === v).length])), support_read_by_a_person: 0 },
    invalid_answers: results.filter((r) => !r.valid).length,
    signature: { signed: results.filter((r) => r.signed_by).length, unsigned: results.filter((r) => !r.signed_by).length },
    results,
  };
}

function round(x) { return Math.round(x * 100) / 100; }
