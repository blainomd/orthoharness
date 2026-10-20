import { checkCitations } from './citations.mjs';

// Screen a reference list: the check a small journal can run on a submission before peer review.
// Each reference with a DOI is looked up at CrossRef and the title CrossRef returns is compared with
// the reference as written. A flag is a reason for a person to look, not a finding of fabrication:
// a DOI can fail on a typo. References without a DOI are listed, never passed. Whether a paper
// supports the sentence that cites it is not checked here.
const DOI = /10\.\d{4,9}\/[^\s"<>]+/i;

export function parseRefs(text) {
  const t = String(text ?? '').trim();
  if (!t) return [];
  const lines = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.every((l) => l.startsWith('{'))) {
    return lines.map((l, i) => {
      const j = JSON.parse(l);
      return { n: i + 1, raw: j.title ?? '', doi: j.doi ? String(j.doi) : null, title: j.title ?? '' };
    });
  }
  // Blank-line separated blocks if there are any, else one reference per line.
  const blocks = /\n\s*\n/.test(t) ? t.split(/\n\s*\n/).map((b) => b.replace(/\s+/g, ' ').trim()) : lines;
  return blocks.filter(Boolean).map((raw, i) => {
    const m = raw.match(DOI);
    const doi = m ? m[0].replace(/[).,;\]}>]+$/, '') : null;
    const title = doi ? raw.replace(m[0], ' ').replace(/https?:\/\/(dx\.)?doi\.org\/?/gi, ' ').replace(/\bdoi:?\s*/gi, ' ') : raw;
    return { n: i + 1, raw, doi, title: title.replace(/\s+/g, ' ').trim() };
  });
}

export async function screenRefs(text, { offline = false, cache = new Map() } = {}) {
  const refs = parseRefs(text);
  const withDoi = refs.filter((r) => r.doi);
  const checked = await checkCitations(withDoi.map((r) => ({ doi: r.doi, title: r.title })), { offline, cache });
  const byN = new Map(withDoi.map((r, i) => [r.n, checked[i]]));
  const rows = refs.map((r) => (r.doi
    ? { n: r.n, reference: r.raw, ...byN.get(r.n) }
    : { n: r.n, reference: r.raw, doi: null, verdict: 'NO_DOI', coverage: 0 }));
  const count = (v) => rows.filter((x) => x.verdict === v).length;
  const counts = Object.fromEntries(['VERIFIED', 'TITLE_MISMATCH', 'DOES_NOT_RESOLVE', 'NO_CLAIMED_TITLE', 'NO_DOI', 'UNCHECKED'].map((v) => [v, count(v)]));
  return {
    references: rows.length,
    counts,
    flagged: counts.TITLE_MISMATCH + counts.DOES_NOT_RESOLVE,
    support_read: 0,
    rows,
  };
}

export function refsMarkdown(s) {
  const out = [
    '# Reference screen', '',
    `${s.references} references · ${s.counts.VERIFIED} matched at CrossRef · ${s.flagged} flagged for a person to look at · ${s.counts.NO_DOI} without a DOI (not checked) · ${s.counts.UNCHECKED + s.counts.NO_CLAIMED_TITLE} unchecked`,
    '',
    'A flag is a reason to look, not a finding: a DOI can fail on a typo. A match means the paper exists and its title fits the reference; it does not mean the paper supports the sentence that cites it.',
    `Support read by a person: ${s.support_read} of ${s.references}. When someone reads, read past the abstract: only 12 of 201 orthopaedic abstracts named a limitation (Parisien, JBJS 2026, doi 10.2106/JBJS.26.00433).`,
    '',
    '| # | Verdict | DOI | Reference |',
    '|---|---|---|---|',
  ];
  for (const r of s.rows) out.push(`| ${r.n} | ${r.verdict} | ${r.doi ?? '—'} | ${String(r.reference).replace(/\|/g, '/').slice(0, 160)} |`);
  return out.join('\n') + '\n';
}
