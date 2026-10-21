// Check a topic against the published record, and check an AI answer against the same record.
// Runs in Node 18+ and in the browser (fetch only, no imports), so site/topic.mjs is a byte copy.
// It reads PubMed's public index (titles, journals, dates, publication types, DOIs). It shows titles
// and links, never abstracts or full text, and it never summarizes: it reports what exists.

const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

// The JBJS family as PubMed indexes it (journal title abbreviations), and the wider field.
export const SCOPES = {
  jbjs: {
    label: 'JBJS journals',
    journals: ['J Bone Joint Surg Am', 'J Bone Joint Surg Br', 'JBJS Rev', 'JB JS Open Access', 'JBJS Essent Surg Tech', 'JBJS Case Connect'],
  },
  ortho: {
    label: 'Orthopaedic journals',
    journals: ['J Bone Joint Surg Am', 'J Bone Joint Surg Br', 'JBJS Rev', 'JB JS Open Access', 'JBJS Essent Surg Tech', 'JBJS Case Connect',
      'Bone Joint J', 'Clin Orthop Relat Res', 'J Arthroplasty', 'Am J Sports Med', 'Arthroscopy', 'J Shoulder Elbow Surg',
      'Knee Surg Sports Traumatol Arthrosc', 'J Orthop Trauma', 'Spine (Phila Pa 1976)', 'J Am Acad Orthop Surg', 'Acta Orthop',
      'Osteoarthritis Cartilage', 'Foot Ankle Int', 'J Hand Surg Am', 'Bone Joint Res', 'J Pediatr Orthop'],
  },
  all: { label: 'All of PubMed', journals: [] },
};

// Highest level first. A record takes the first design its PubMed publication types match.
export const DESIGNS = [
  { id: 'guideline', label: 'Guidelines', pt: ['Practice Guideline', 'Guideline', 'Consensus Development Conference'] },
  { id: 'meta', label: 'Meta-analyses and systematic reviews', pt: ['Meta-Analysis', 'Systematic Review'] },
  { id: 'rct', label: 'Randomized trials', pt: ['Randomized Controlled Trial'] },
  { id: 'trial', label: 'Other clinical trials', pt: ['Clinical Trial', 'Controlled Clinical Trial', 'Clinical Trial, Phase III', 'Clinical Trial, Phase II'] },
  { id: 'study', label: 'Cohort, case-control and other studies', pt: ['Observational Study', 'Comparative Study', 'Multicenter Study', 'Journal Article'] },
  { id: 'review', label: 'Narrative reviews', pt: ['Review'] },
  { id: 'case', label: 'Case reports', pt: ['Case Reports'] },
];
const HIGH = new Set(['guideline', 'meta', 'rct']);

export function designOf(pubtypes = []) {
  const set = new Set(pubtypes);
  // Narrative reviews and case reports outrank the catch-all "Journal Article" type.
  for (const id of ['guideline', 'meta', 'rct', 'trial', 'case', 'review']) {
    const d = DESIGNS.find((x) => x.id === id);
    if (d.pt.some((p) => set.has(p))) return id;
  }
  return 'study';
}

export function buildQuery(topic, { scope = 'jbjs', since, until } = {}) {
  const t = String(topic ?? '').trim();
  if (!t) throw new Error('a topic is required');
  if (t.length > 300) throw new Error('keep the topic under 300 characters');
  const parts = [`(${t})`];
  const j = (SCOPES[scope] ?? SCOPES.jbjs).journals;
  if (j.length) parts.push(`(${j.map((x) => `"${x}"[ta]`).join(' OR ')})`);
  if (since || until) parts.push(`(${since ?? 1800}:${until ?? 3000}[dp])`);
  return parts.join(' AND ');
}

const designFilter = (d) => `(${d.pt.map((p) => `"${p}"[pt]`).join(' OR ')})`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// PubMed allows about 3 requests a second without a key. One request at a time, spaced.
// A 429 waits and tries again (up to three times); any other failure stops the check.
function client(fetchImpl = globalThis.fetch, gap = 400) {
  let last = 0;
  return async (path, params) => {
    const u = `${EUTILS}/${path}?${new URLSearchParams({ db: 'pubmed', retmode: 'json', tool: 'orthoharness', ...params })}`;
    params = { retmode: 'json', ...params };
    for (let attempt = 0; ; attempt++) {
      const wait = last + gap - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      const r = await fetchImpl(u);
      if (r.status === 429 && attempt < 3) { await sleep(gap * 2 ** (attempt + 1)); continue; }
      if (!r.ok) throw new Error(`PubMed answered ${r.status}`);
      return params.retmode === 'xml' ? r.text() : r.json();
    }
  };
}

function record(s) {
  const ids = Object.fromEntries((s.articleids ?? []).map((a) => [a.idtype, a.value]));
  const year = Number(String(s.pubdate ?? s.sortpubdate ?? '').slice(0, 4)) || null;
  return {
    pmid: String(s.uid), title: String(s.title ?? '').replace(/<[^>]+>/g, ''), journal: s.source ?? '', year,
    design: designOf(s.pubtype), pubtypes: s.pubtype ?? [], doi: ids.doi ?? null,
    retracted: (s.pubtype ?? []).includes('Retracted Publication'),
    url: `https://pubmed.ncbi.nlm.nih.gov/${s.uid}/`,
  };
}

async function summaries(get, ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 100) {
    const r = await get('esummary.fcgi', { id: ids.slice(i, i + 100).join(',') });
    for (const id of r.result?.uids ?? []) out.push(record(r.result[id]));
  }
  return out;
}

// The evidence map: how much exists at each level, the strongest records, and where it runs out.
export async function checkTopic(topic, opts = {}) {
  const { scope = 'jbjs', since, until, per = 5, fetch: f, gap } = opts;
  const get = client(f, gap);
  const term = buildQuery(topic, { scope, since, until });
  const total = Number((await get('esearch.fcgi', { term, retmax: 0 })).esearchresult?.count ?? 0);
  const levels = [];
  for (const d of DESIGNS.filter((x) => ['guideline', 'meta', 'rct', 'trial'].includes(x.id))) {
    const r = await get('esearch.fcgi', { term: `${term} AND ${designFilter(d)}`, retmax: per, sort: 'pub_date' });
    levels.push({ id: d.id, label: d.label, count: Number(r.esearchresult?.count ?? 0), ids: r.esearchresult?.idlist ?? [] });
  }
  const rel = await get('esearch.fcgi', { term, retmax: per * 2, sort: 'relevance' });
  const ids = [...new Set([...levels.flatMap((l) => l.ids), ...(rel.esearchresult?.idlist ?? [])])];
  const recs = await summaries(get, ids);
  const byId = Object.fromEntries(recs.map((r) => [r.pmid, r]));
  for (const l of levels) { l.records = l.ids.map((id) => byId[id]).filter(Boolean); delete l.ids; }
  const relevant = (rel.esearchresult?.idlist ?? []).map((id) => byId[id]).filter(Boolean);
  const high = levels.filter((l) => HIGH.has(l.id)).reduce((s, l) => s + l.count, 0);
  const newestHigh = Math.max(0, ...levels.filter((l) => HIGH.has(l.id)).flatMap((l) => l.records.map((r) => r.year ?? 0)));
  const thisYear = opts.now ? new Date(opts.now).getFullYear() : new Date().getFullYear();
  const runsOut = [];
  if (!total) runsOut.push(`Nothing in ${SCOPES[scope]?.label ?? scope} matches this topic. Try other words, or widen the scope.`);
  else if (!high) runsOut.push('No article PubMed types as a guideline, meta-analysis or randomized trial matches. Read the titles: a trial summary or commentary may not be typed.');
  else if (newestHigh && thisYear - newestHigh >= 5) runsOut.push(`The newest article PubMed types as a guideline, meta-analysis or randomized trial here is from ${newestHigh}.`);
  if (levels.find((l) => l.id === 'rct')?.count === 0 && levels.find((l) => l.id === 'meta')?.count > 0)
    runsOut.push('Reviews exist, but no article in this scope is typed as a randomized trial. A review is only as strong as what it pooled; trial summaries and commentaries may not be typed, so read the titles.');
  const retracted = recs.filter((r) => r.retracted);
  if (retracted.length) runsOut.push(`${retracted.length} retracted ${retracted.length === 1 ? 'record' : 'records'} in the results; they are marked.`);
  return { topic, scope, scope_label: SCOPES[scope]?.label ?? scope, query: term, total, levels, relevant, runs_out: runsOut, source: 'PubMed (NCBI E-utilities), titles and links only' };
}

// Pull every DOI and PMID out of an answer, then say which are real, which belong to the topic,
// and which strong records the answer left out.
export function extractIds(text) {
  const s = String(text ?? '');
  const dois = [...new Set([...s.matchAll(/\b10\.\d{4,9}\/[^\s"'<>\])]+/gi)].map((m) => m[0].replace(/[.,;:]+$/, '').toLowerCase()))];
  const pmids = [...new Set([...s.matchAll(/\bPMID[:\s#]*?(\d{1,9})\b|pubmed\.ncbi\.nlm\.nih\.gov\/(\d{6,9})/gi)].map((m) => m[1] ?? m[2]))];
  // Author-year mentions with no identifier cannot be checked; they are counted, never passed.
  const bare = [...s.matchAll(/\(([A-Z][A-Za-z'\-]+(?: et al\.?)?,? (?:19|20)\d{2})\)/g)].map((m) => m[1]);
  return { dois, pmids, bare };
}

export async function checkAnswer(answer, evidence, opts = {}) {
  const get = client(opts.fetch, opts.gap);
  const { dois, pmids, bare } = extractIds(answer);
  const known = [...evidence.levels.flatMap((l) => l.records), ...evidence.relevant];
  const inSet = (r) => known.some((k) => k.pmid === r.pmid || (k.doi && r.doi && k.doi.toLowerCase() === r.doi.toLowerCase()));
  const found = [];
  if (pmids.length) found.push(...(await summaries(get, pmids)).filter((r) => r.title));
  const missingDoi = dois.filter((d) => !found.some((r) => r.doi?.toLowerCase() === d));
  for (const d of missingDoi) {
    const r = await get('esearch.fcgi', { term: `"${d}"[doi]`, retmax: 1 });
    const id = r.esearchresult?.idlist?.[0];
    if (id) found.push(...(await summaries(get, [id])));
  }
  const cited = [
    ...pmids.map((p) => ({ id: `PMID ${p}`, rec: found.find((r) => r.pmid === p) })),
    ...dois.filter((d) => !pmids.some((p) => found.find((r) => r.pmid === p)?.doi?.toLowerCase() === d))
      .map((d) => ({ id: d, rec: found.find((r) => r.doi?.toLowerCase() === d) })),
  ].map(({ id, rec }) => ({
    cited: id,
    verdict: !rec ? 'NOT_IN_PUBMED' : rec.retracted ? 'RETRACTED' : inSet(rec) ? 'IN_EVIDENCE' : 'REAL_OUTSIDE_SEARCH',
    record: rec ?? null,
  }));
  const quotes = await quoteGate(get, extractQuotes(answer), found);
  const citedPmids = new Set(cited.filter((c) => c.record).map((c) => c.record.pmid));
  const left_out = evidence.levels.filter((l) => HIGH.has(l.id)).flatMap((l) => l.records).filter((r) => !citedPmids.has(r.pmid) && !r.retracted);
  return {
    cited, quotes, unverifiable: bare, left_out,
    counts: {
      cited: cited.length,
      ...Object.fromEntries(['IN_EVIDENCE', 'REAL_OUTSIDE_SEARCH', 'NOT_IN_PUBMED', 'RETRACTED'].map((v) => [v, cited.filter((c) => c.verdict === v).length])),
      unverifiable: bare.length, high_level_left_out: left_out.length,
      quotes: quotes.length, quotes_in_source: quotes.filter((q) => q.verdict === 'QUOTE_IN_SOURCE').length,
    },
  };
}

// The quote gate. A claim that quotes its source can be checked without reading for meaning:
// the quoted words either appear in that paper's PubMed abstract, or they do not (its title alone does not count).
// Abstracts are matched against and handed to the model to quote; the page never displays them. A quote not in the abstract may be in the
// full text, so that verdict is a reason to look, not a finding of fabrication.
export function squash(s) {
  return String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;|&#x[0-9a-f]+;|&#\d+;/gi, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
}

export function extractQuotes(text) {
  const s = String(text ?? '');
  const out = [];
  // Pair quote marks in order first, then skip the short ones: filtering inside the pattern would
  // pair a short quote's closing mark with the next quote's opening one.
  for (const m of s.matchAll(/["“]([^"“”]*)["”]/g)) {
    const quote = m[1].trim();
    if (quote.length < 20 || quote.length > 600 || squash(quote).split(' ').length < 5) continue;
    const end = m.index + m[0].length;
    // Look only inside the quote's own sentence, so a bare quote never borrows its neighbour's citation.
    const tail = s.slice(end, end + 160); const stop = tail.search(/[.!?]\s+(?=[A-Z"\u201c])/);
    const after = extractIds(stop < 0 ? tail : tail.slice(0, stop + 1));
    const head = s.slice(Math.max(0, m.index - 160), m.index); const cut = Math.max(-1, ...[...head.matchAll(/[.!?]\s+/g)].map((x) => x.index + x[0].length - 1));
    const before = extractIds(head.slice(cut + 1));
    const pick = (x) => (x.pmids[0] ? { pmid: x.pmids[0] } : x.dois[0] ? { doi: x.dois[0] } : null);
    out.push({ quote, source: pick(after) ?? pick(before) });
  }
  return out;
}

export function parseAbstracts(xml) {
  const out = {};
  for (const block of String(xml).split('</PubmedArticle>')) {
    const pmid = /<PMID[^>]*>(\d+)<\/PMID>/.exec(block)?.[1];
    if (!pmid) continue;
    const title = /<ArticleTitle[^>]*>([\s\S]*?)<\/ArticleTitle>/.exec(block)?.[1] ?? '';
    const abs = [...block.matchAll(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g)].map((x) => x[1]).join(' ');
    const text = abs.replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&#?[a-z0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
    out[pmid] = { title: squash(title), abstract: squash(abs), has_abstract: Boolean(abs.trim()), text };
  }
  return out;
}

// The abstracts a model is allowed to quote: one PubMed request for every record in the evidence.
export async function fetchAbstracts(evidence, opts = {}) {
  const pmids = [...new Set([...evidence.levels.flatMap((l) => l.records), ...evidence.relevant].map((r) => r.pmid))];
  if (!pmids.length) return {};
  const parsed = parseAbstracts(await client(opts.fetch, opts.gap)('efetch.fcgi', { id: pmids.join(','), rettype: 'abstract', retmode: 'xml' }));
  return Object.fromEntries(Object.entries(parsed).filter(([, v]) => v.text).map(([k, v]) => [k, v.text]));
}

async function quoteGate(get, quotes, resolved) {
  const byDoi = (d) => resolved.find((r) => r.doi && r.doi.toLowerCase() === d);
  const items = quotes.map((q) => ({ ...q, record: q.source?.pmid ? resolved.find((r) => r.pmid === q.source.pmid) : q.source?.doi ? byDoi(q.source.doi) : null }));
  const pmids = [...new Set(items.filter((i) => i.record).map((i) => i.record.pmid))];
  const src = pmids.length ? parseAbstracts(await get('efetch.fcgi', { id: pmids.join(','), rettype: 'abstract', retmode: 'xml' })) : {};
  return items.map((i) => {
    if (!i.record) return { quote: i.quote, verdict: 'QUOTE_NO_SOURCE', record: null };
    const t = src[i.record.pmid];
    const q = squash(i.quote);
    if (t && t.abstract.includes(q)) return { quote: i.quote, verdict: 'QUOTE_IN_SOURCE', record: i.record };
    // A paper's own title is always found in its own record, so quoting it proves nothing about a claim.
    if (t && t.title.includes(q)) return { quote: i.quote, verdict: 'QUOTE_IS_TITLE', record: i.record };
    return { quote: i.quote, verdict: t?.has_abstract ? 'QUOTE_NOT_IN_ABSTRACT' : 'QUOTE_NO_ABSTRACT', record: i.record };
  });
}

// The instruction that turns a model into one the gates can check: cite only from this list,
// quote the sentence that supports each claim, and say so when the list does not answer it.
// Pass the abstracts (fetchAbstracts) or the model is asked to quote words it was never shown.
export function groundedPrompt(e, abstracts = null) {
  const recs = [...new Map([...e.levels.flatMap((l) => l.records), ...e.relevant].map((r) => [r.pmid, r])).values()];
  const ab = (r) => {
    if (!abstracts) return [];
    const t = abstracts[r.pmid];
    return [t ? `  Abstract: ${t.length > 1600 ? t.slice(0, 1600) + ' [abstract cut here]' : t}` : '  Abstract: none in PubMed (do not quote this record)'];
  };
  return [
    `Question: ${e.topic}`,
    '',
    `You may cite only these records (${e.scope_label}, from PubMed). Do not cite anything else.`,
    ...recs.flatMap((r) => [`- PMID ${r.pmid} · ${r.year ?? ''} · ${r.journal} · ${DESIGNS.find((d) => d.id === r.design)?.label ?? r.design} · ${r.title}`, ...ab(r)]),
    '',
    'Rules:',
    '1. Every claim ends with the PMID it rests on, written as (PMID 12345678).',
    '2. Every claim quotes, in double quotes, the exact words from that paper\'s abstract that support it (a finding, not the title). Copy them; do not paraphrase inside the quotes.',
    '3. If these records do not answer the question, say "not enough information" and say what is missing. That is a correct answer.',
    '4. Name the level of each source (guideline, meta-analysis, randomized trial, other). Prefer the highest level.',
    ...e.runs_out.map((n) => `Note: ${n}`),
  ].join('\n');
}

const VERDICT_WORDS = {
  IN_EVIDENCE: 'real, and in the evidence for this topic',
  REAL_OUTSIDE_SEARCH: 'real, but not in this search (another journal, or other words): check that it is about this question',
  NOT_IN_PUBMED: 'not in PubMed: check it by hand (not a finding of fabrication)',
  RETRACTED: 'retracted',
  QUOTE_IN_SOURCE: 'the quoted words are in that paper\'s abstract',
  QUOTE_IS_TITLE: 'the quoted words are the paper\'s title: that names the paper, it does not support a claim',
  QUOTE_NOT_IN_ABSTRACT: 'the quoted words are not in that paper\'s abstract: they may be in the full text, so read it',
  QUOTE_NO_ABSTRACT: 'PubMed has no abstract for that paper: read the full text',
  QUOTE_NO_SOURCE: 'no PMID or DOI next to the quote, so there is nothing to check it against',
};

export function topicMarkdown(e, a = null) {
  const L = [`# ${e.topic}`, '', `${e.scope_label} · ${e.total} matching ${e.total === 1 ? 'article' : 'articles'} in PubMed · titles and links only`, ''];
  for (const n of e.runs_out) L.push(`> ${n}`);
  if (e.runs_out.length) L.push('');
  L.push('| Level | Articles |', '|---|---|', ...e.levels.map((l) => `| ${l.label} | ${l.count} |`), '');
  const line = (r) => `- ${r.year ?? '–'} · ${r.journal} · ${r.title}${r.retracted ? ' **(RETRACTED)**' : ''} ${r.url}`;
  for (const l of e.levels.filter((x) => x.records.length)) L.push(`## ${l.label}, newest first`, '', ...l.records.map(line), '');
  if (e.relevant.length) L.push('## Most relevant, any level', '', ...e.relevant.map(line), '');
  if (a) {
    L.push('## The answer you pasted', '');
    if (!a.cited.length) L.push('It cites no DOI or PMID, so none of its sources can be checked.');
    for (const c of a.cited) L.push(`- ${c.cited}: ${VERDICT_WORDS[c.verdict]}${c.record ? ` (${c.record.year} · ${c.record.journal} · ${c.record.title})` : ''}`);
    for (const q of a.quotes ?? []) L.push(`- "${q.quote.length > 120 ? q.quote.slice(0, 117) + '…' : q.quote}": ${VERDICT_WORDS[q.verdict]}${q.record ? ` (PMID ${q.record.pmid})` : ''}`);
    if (a.unverifiable.length) L.push(`- ${a.unverifiable.length} author-year ${a.unverifiable.length === 1 ? 'mention' : 'mentions'} with no DOI or PMID (${a.unverifiable.join('; ')}): cannot be checked, never counted as a pass`);
    L.push('', a.left_out.length ? `**Strong evidence the answer did not cite (${a.left_out.length}):**` : 'It cites every guideline, meta-analysis and randomized trial shown above.', '');
    L.push(...a.left_out.map(line), '');
  }
  L.push('Levels come from PubMed publication types; the newest articles may not be typed yet. This is what exists, not what it shows: read the papers.', '');
  return L.join('\n');
}
