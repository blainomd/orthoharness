// Plain-text report, by kind of error. No leaderboard number.
export function markdown(s) {
  const L = [];
  const y = (k, label) => {
    const v = s.yardsticks[k];
    L.push(`| ${label} | ${v.agree} of ${v.of} | ${v.decision_loss} | ${v.over_commit} | ${v.over_abstain} |`);
  };
  L.push(`# orthoharness run: ${s.label}`, '');
  L.push(`Adapter \`${s.adapter}\` · ${s.cases} cases · case set sha256 \`${s.case_set_sha256.slice(0, 16)}…\` · loss matrix \`${s.loss_matrix_version}\` · ${s.started}`, '');
  L.push('## Decisions, against each yardstick separately', '');
  L.push('| Yardstick | Agrees | Decision loss (lower is better) | Over-committed | Over-abstained |', '|---|---|---|---|---|');
  y('guideline', 'Guideline'); y('attending', 'Treating attending');
  L.push('', 'The two rows are never averaged. Where they disagree, the gap is the finding.', '');
  const g = s.yardstick_gap;
  L.push(`**Where the yardsticks disagree (${g.cases} ${g.cases === 1 ? "case" : "cases"}):** sided with the guideline ${g.sided_with_guideline}, with the attending ${g.sided_with_attending}, neither ${g.neither}.`, '');
  L.push('## The route, not just the answer', '');
  L.push(`- Committed before the record supported it: **${s.sequence.premature_commits}**`);
  L.push(`- Ran out of record without deciding: ${s.sequence.ran_out_of_record}`);
  L.push(`- Required contraindication checks missed: **${s.process.missed}** of ${s.process.required_checks}`);
  L.push(`- Required facts left out of the reasoning: **${s.omissions.omitted}** of ${s.omissions.required_facts}`);
  L.push(`- Unreadable or missing answers: ${s.invalid_answers}`, '');
  const c = s.citations;
  L.push('## Citations', '');
  L.push(`${c.total} cited · verified ${c.VERIFIED} · different paper ${c.TITLE_MISMATCH} · nothing to compare ${c.NO_CLAIMED_TITLE} · not found ${c.DOES_NOT_RESOLVE} · not checked ${c.UNCHECKED}`, '');
  L.push(`Whether each paper says what the claim says: read by a person for ${c.support_read_by_a_person} of ${c.total}. A DOI that resolves is not a verified citation.`, '');
  L.push('## Signature', '');
  L.push(s.signature.unsigned ? `${s.signature.unsigned} of ${s.cases} answers are unsigned drafts. Nobody has put a name on them.` : `All ${s.cases} answers carry a signer.`, '');
  L.push('## Per case', '', '| Case | Decision | Stage | Guideline | Attending | Missed checks | Omitted facts | Citations |', '|---|---|---|---|---|---|---|---|');
  for (const r of s.results) {
    const ok = (k) => (r.yardsticks[k].agree ? 'agrees' : `≠ ${r.yardsticks[k].truth}`);
    L.push(`| ${r.id} | ${r.decision}${r.premature_commit ? ' (early)' : ''} | ${r.commit_stage}/${r.stages} | ${ok('guideline')} | ${ok('attending')} | ${r.missed_checks.join(', ') || '–'} | ${r.omitted_facts.join(', ') || '–'} | ${r.citations.map((x) => x.verdict).join(', ') || '–'} |`);
  }
  return L.join('\n') + '\n';
}

export function compare(a, b) {
  const row = (label, f) => `| ${label} | ${f(a)} | ${f(b)} |`;
  return [
    `# Compare: ${a.label} vs ${b.label}`, '',
    a.case_set_sha256 === b.case_set_sha256 ? 'Same case set.' : '**Different case sets: these runs are not comparable.**', '',
    `| | ${a.label} | ${b.label} |`, '|---|---|---|',
    row('Agrees with guideline', (s) => `${s.yardsticks.guideline.agree} of ${s.cases}`),
    row('Agrees with attending', (s) => `${s.yardsticks.attending.agree} of ${s.cases}`),
    row('Decision loss vs guideline', (s) => s.yardsticks.guideline.decision_loss),
    row('Decision loss vs attending', (s) => s.yardsticks.attending.decision_loss),
    row('Over-committed (guideline)', (s) => s.yardsticks.guideline.over_commit),
    row('Premature commits', (s) => s.sequence.premature_commits),
    row('Missed contraindication checks', (s) => `${s.process.missed} of ${s.process.required_checks}`),
    row('Omitted facts', (s) => `${s.omissions.omitted} of ${s.omissions.required_facts}`),
    row('Citations verified', (s) => `${s.citations.VERIFIED} of ${s.citations.total}`),
    '', 'Use it for aided vs unaided: score a surgeon\'s own answers (replay adapter) on the same cases, with and without the tool.', '',
  ].join('\n');
}
