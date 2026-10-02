import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { createHash } from 'node:crypto';

export const DECISIONS = ['operate', 'do_not_operate', 'not_enough_information'];

// A case is revealed one stage at a time. Two yardsticks are kept apart and never merged.
export function validateCase(c, file = '') {
  const errs = [];
  const where = file ? `${file}: ` : '';
  if (!c.id || typeof c.id !== 'string') errs.push('id is required');
  if (!['dev', 'test'].includes(c.split)) errs.push('split must be "dev" or "test"');
  if (!Array.isArray(c.stages) || !c.stages.length) errs.push('stages must be a non-empty array');
  else c.stages.forEach((s, i) => { if (!s.label || typeof s.text !== 'string') errs.push(`stages[${i}] needs label and text`); });
  const y = c.yardsticks || {};
  for (const k of ['guideline', 'attending']) {
    if (!y[k] || !DECISIONS.includes(y[k].decision)) errs.push(`yardsticks.${k}.decision must be one of ${DECISIONS.join(', ')}`);
  }
  if (c.min_stage != null && !(Number.isInteger(c.min_stage) && c.min_stage >= 1 && c.min_stage <= (c.stages?.length || 0)))
    errs.push('min_stage must be a 1-based stage number');
  for (const k of ['required_checks', 'required_facts']) {
    if (c[k] != null && !(Array.isArray(c[k]) && c[k].every((r) => r.id && Array.isArray(r.any) && r.any.length)))
      errs.push(`${k} must be [{ id, any: [phrases] }]`);
  }
  return errs.map((e) => where + e);
}

function caseFiles(dir) {
  const st = statSync(dir);
  if (st.isFile()) return [dir];
  return readdirSync(dir).filter((f) => extname(f) === '.json').sort().map((f) => join(dir, f));
}

export function loadCases(dir) {
  const files = caseFiles(dir);
  const cases = [], errors = [];
  for (const f of files) {
    let c;
    try { c = JSON.parse(readFileSync(f, 'utf8')); } catch (e) { errors.push(`${f}: not JSON (${e.message})`); continue; }
    const errs = validateCase(c, f);
    if (errs.length) errors.push(...errs); else cases.push(c);
  }
  const ids = new Set();
  for (const c of cases) { if (ids.has(c.id)) errors.push(`duplicate id ${c.id}`); ids.add(c.id); }
  return { cases, errors, files };
}

// A commitment to a case set: publish the hash, keep the questions private.
// Canonical JSON (sorted keys) so whitespace and key order do not change it.
function canon(v) {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
export function caseSetHash(cases) {
  const h = createHash('sha256');
  for (const c of [...cases].sort((a, b) => a.id.localeCompare(b.id))) h.update(canon(c)).update('\n');
  return h.digest('hex');
}
