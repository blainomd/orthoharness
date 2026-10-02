// The keep-or-strike delta: line-level difference between what the AI drafted and what a person signed.
// Every kept, struck or added line becomes a labeled example. The delta is the evidence a person looked.
export function delta(draft, signed) {
  const a = split(draft), b = split(signed);
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--)
    dp[i][j] = norm(a[i]) === norm(b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (norm(a[i]) === norm(b[j])) { out.push({ label: 'kept', line: b[j] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ label: 'struck', line: a[i++] });
    else out.push({ label: 'added', line: b[j++] });
  }
  while (i < m) out.push({ label: 'struck', line: a[i++] });
  while (j < n) out.push({ label: 'added', line: b[j++] });
  const count = (l) => out.filter((x) => x.label === l).length;
  return { lines: out, kept: count('kept'), struck: count('struck'), added: count('added'), unchanged: count('struck') === 0 && count('added') === 0 };
}
function split(s) { return String(s ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean); }
function norm(s) { return s.toLowerCase().replace(/\s+/g, ' '); }
