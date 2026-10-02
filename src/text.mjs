// Word matching shared by the citation and omission checks. Same method as citecheck
// (github.com/blainomd/citecheck): normalize, drop stop words, measure title coverage.
const STOP = new Set(('the and for with from into over under that this than then its their are was were has have had ' +
  'not but all any can our out who how why what when does did using use based versus among between ' +
  'after before about via per of in on at to by an a or as is be et al doi org https http www ' +
  'journal surg bone joint vol pages').split(' '));

export function normalize(s) {
  return String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, ' ').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
export function words(s) {
  return normalize(s).split(' ').filter((w) => w.length >= 3 && !STOP.has(w));
}
export function coverage(title, claim) {
  const t = new Set(words(title));
  if (!t.size) return 0;
  const c = new Set(words(claim));
  let hit = 0;
  for (const w of t) if (c.has(w)) hit++;
  return hit / t.size;
}
// True when any of the phrases appears in the text (phrase match on normalized text).
export function mentions(text, phrases) {
  const hay = ` ${normalize(text)} `;
  return phrases.some((p) => hay.includes(` ${normalize(p)} `));
}
