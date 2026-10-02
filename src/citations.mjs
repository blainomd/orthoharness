import { words, coverage } from './text.mjs';

// Existence AND identity: a DOI passes only if it resolves and the title CrossRef returns matches the
// title the system gave. Whether the paper supports the claim is NOT machine-checked here; the report
// says so and counts it as unread.
export const VERDICTS = ['VERIFIED', 'TITLE_MISMATCH', 'NO_CLAIMED_TITLE', 'DOES_NOT_RESOLVE', 'UNCHECKED'];

export function verdict(status, crossrefTitle, claimedTitle, threshold = 0.6) {
  if (status === 'missing') return { verdict: 'DOES_NOT_RESOLVE', coverage: 0 };
  if (status !== 'ok') return { verdict: 'UNCHECKED', coverage: 0 };
  if (words(claimedTitle).length < 3 || !crossrefTitle) return { verdict: 'NO_CLAIMED_TITLE', coverage: 0 };
  const c = coverage(crossrefTitle, claimedTitle);
  return { verdict: c >= threshold ? 'VERIFIED' : 'TITLE_MISMATCH', coverage: Math.round(c * 100) / 100 };
}

// CrossRef asks for one request at a time per address: callers run these in sequence.
export async function lookup(doi, tries = 3) {
  try {
    const r = await fetch(`https://api.crossref.org/works/${doi.split('/').map(encodeURIComponent).join('/')}`);
    if (r.status === 404) return { status: 'missing' };
    if (!r.ok) throw new Error(String(r.status));
    const j = await r.json();
    return { status: 'ok', title: (j.message?.title || [])[0] || '' };
  } catch {
    if (tries > 0) { await new Promise((res) => setTimeout(res, 700 * (4 - tries))); return lookup(doi, tries - 1); }
    return { status: 'error' };
  }
}

export async function checkCitations(citations, { offline = false, cache = new Map() } = {}) {
  const out = [];
  for (const c of citations) {
    const doi = String(c.doi).trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/[).\]}>]+$/, '');
    let r = cache.get(doi.toLowerCase());
    if (!r) { r = offline ? { status: 'offline' } : await lookup(doi); cache.set(doi.toLowerCase(), r); }
    out.push({ doi, claimed_title: c.title ?? '', claim: c.claim ?? '', crossref_title: r.title ?? null, ...verdict(r.status, r.title, c.title ?? '') });
  }
  return out;
}
