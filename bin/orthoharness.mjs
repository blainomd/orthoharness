#!/usr/bin/env node
// orthoharness: an open benchmark harness for orthopaedic AI. Apache-2.0. No dependencies.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCases, caseSetHash } from '../src/cases.mjs';
import { makeAdapter } from '../src/adapters.mjs';
import { runCase, gradeCase, summarize } from '../src/run.mjs';
import { markdown, compare } from '../src/report.mjs';
import { delta } from '../src/delta.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = `orthoharness <command>

  run <cases> --adapter <always-operate|always-abstain|replay|chat> [options]
      --answers <file.jsonl>   recorded answers for --adapter replay (a model's, or a surgeon's own)
      --label <name>           name for this run (default: the adapter)
      --signer <role>          who signs these answers; omit and they are reported as unsigned drafts
      --loss <file.json>       loss matrix (default: loss-matrix.json, placeholder weights)
      --split <dev|test|all>   which cases to run (default: all)
      --offline                skip CrossRef; every citation is reported UNCHECKED, never as a pass
      --out <dir>              where to write the run (default: runs/)
      chat adapter reads ORTHOHARNESS_BASE_URL, ORTHOHARNESS_MODEL and ORTHOHARNESS_API_KEY from the environment
  validate <cases>              check every case file against the format
  hash <cases>                  sha256 commitment to a case set: publish the hash, keep the questions
  compare <run-a.json> <run-b.json>   side by side, e.g. aided vs unaided
  delta <draft.txt> <signed.txt> [--case <id>]   keep-or-strike labels as JSON lines
`;

function args(argv) {
  const pos = [], flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; flags[k] = v; }
    else pos.push(a);
  }
  return { pos, flags };
}

function load(dir) {
  const { cases, errors } = loadCases(dir);
  if (errors.length) { console.error(errors.join('\n')); process.exit(2); }
  return cases;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, flags } = args(rest);
  if (!cmd || cmd === 'help' || flags.help) { process.stdout.write(USAGE); return; }

  if (cmd === 'validate') {
    const { cases, errors, files } = loadCases(pos[0] ?? join(ROOT, 'cases/demo'));
    if (errors.length) { console.error(errors.join('\n')); process.exit(2); }
    console.log(`${cases.length} of ${files.length} case files valid`);
    return;
  }
  if (cmd === 'hash') { console.log(caseSetHash(load(pos[0] ?? join(ROOT, 'cases/demo')))); return; }
  if (cmd === 'compare') {
    const [a, b] = pos.map((f) => JSON.parse(readFileSync(f, 'utf8')));
    if (!a || !b) { process.stdout.write(USAGE); process.exit(1); }
    process.stdout.write(compare(a, b));
    return;
  }
  if (cmd === 'delta') {
    if (pos.length < 2) { process.stdout.write(USAGE); process.exit(1); }
    const d = delta(readFileSync(pos[0], 'utf8'), readFileSync(pos[1], 'utf8'));
    for (const l of d.lines) console.log(JSON.stringify({ case_id: flags.case ?? null, ...l }));
    console.error(`kept ${d.kept} · struck ${d.struck} · added ${d.added}${d.unchanged ? ' · signed exactly as drafted: no evidence anyone edited it' : ''}`);
    return;
  }
  if (cmd !== 'run') { process.stdout.write(USAGE); process.exit(1); }

  const dir = pos[0] ?? join(ROOT, 'cases/demo');
  let cases = load(dir);
  const split = flags.split ?? 'all';
  if (split !== 'all') cases = cases.filter((c) => c.split === split);
  const adapterName = flags.adapter ?? 'always-abstain';
  const adapter = makeAdapter(adapterName, {
    answers: flags.answers,
    baseUrl: process.env.ORTHOHARNESS_BASE_URL,
    model: process.env.ORTHOHARNESS_MODEL,
    apiKey: process.env.ORTHOHARNESS_API_KEY,
  });
  const loss = JSON.parse(readFileSync(flags.loss ?? join(ROOT, 'loss-matrix.json'), 'utf8'));
  const cache = new Map();
  const results = [];
  for (const c of cases) {
    const run = await runCase(c, adapter);
    results.push(await gradeCase(c, run, loss, { offline: !!flags.offline, cache, signer: typeof flags.signer === 'string' ? flags.signer : null }));
  }
  const started = new Date().toISOString();
  const label = typeof flags.label === 'string' ? flags.label : adapterName;
  const summary = summarize(results, {
    label, adapter: adapterName, model: adapterName === 'chat' ? process.env.ORTHOHARNESS_MODEL : null,
    case_set_sha256: caseSetHash(cases), loss_matrix_version: loss.version, split, started,
  });
  const out = typeof flags.out === 'string' ? flags.out : 'runs';
  mkdirSync(out, { recursive: true });
  const base = join(out, `${label.replace(/[^a-z0-9._-]+/gi, '_')}-${started.replace(/[:.]/g, '-')}`);
  writeFileSync(`${base}.json`, JSON.stringify(summary, null, 2));
  writeFileSync(`${base}.md`, markdown(summary));
  process.stdout.write(markdown(summary));
  console.error(`\nwrote ${base}.json and ${base}.md`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
