import { readFileSync } from 'node:fs';

// An adapter answers one stage at a time. It sees only the stages revealed so far and returns
// { decision, rationale, contraindications_checked, citations }, where decision is one of
// operate | do_not_operate | not_enough_information | need_next.

export const SYSTEM_PROMPT = [
  'You are being evaluated on orthopaedic surgical decisions. The record is revealed one stage at a time.',
  'At each stage answer with ONE JSON object and nothing else:',
  '{"decision": "operate" | "do_not_operate" | "not_enough_information" | "need_next",',
  ' "rationale": "your reasoning, naming every fact that drove the decision",',
  ' "contraindications_checked": ["each contraindication or risk you checked"],',
  ' "citations": [{"doi": "10.xxxx/...", "title": "exact title of the paper", "claim": "the sentence it supports"}]}',
  'Use "need_next" to see the next stage of the record. "not_enough_information" is a real answer and is',
  'scored as one. Deciding not to operate is scored the same as deciding to operate. Cite only papers you',
  'are sure exist; every DOI is checked against the title you give.',
].join('\n');

const BASELINES = {
  // Commits at the first stage, every time. Shows what over-commitment costs under the loss matrix.
  'always-operate': () => ({ decision: 'operate', rationale: 'Baseline: always operate.', contraindications_checked: [], citations: [] }),
  // Never commits. Shows what over-abstention costs.
  'always-abstain': () => ({ decision: 'not_enough_information', rationale: 'Baseline: always abstain.', contraindications_checked: [], citations: [] }),
};

// Replays recorded answers: a model's saved outputs, or a surgeon's own unaided answers,
// so a person and a machine are scored on the same cases by the same rules.
// One JSON object per line: { case_id, decision, stage?, rationale?, contraindications_checked?, citations?, signed_by? }
export function replayAdapter(file) {
  const rows = new Map();
  readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.trim()).forEach((l, i) => {
    let r;
    try { r = JSON.parse(l); } catch { throw new Error(`${file}:${i + 1} is not JSON`); }
    if (!r.case_id) throw new Error(`${file}:${i + 1} has no case_id`);
    rows.set(r.case_id, r);
  });
  return async ({ caseId, stageIndex, totalStages }) => {
    const r = rows.get(caseId);
    if (!r) return { decision: 'missing', rationale: '', contraindications_checked: [], citations: [] };
    const at = Number.isInteger(r.stage) ? Math.min(Math.max(r.stage, 1), totalStages) : totalStages;
    if (stageIndex + 1 < at) return { decision: 'need_next' };
    return { ...r };
  };
}

// Any OpenAI-compatible chat endpoint: a hosted model, or a local one (Ollama: http://localhost:11434/v1).
// The key is read from the environment and never written to a run file.
export function chatAdapter({ baseUrl, model, apiKey, temperature = 0 }) {
  if (!baseUrl || !model) throw new Error('chat adapter needs ORTHOHARNESS_BASE_URL and ORTHOHARNESS_MODEL');
  return async ({ revealed, stageIndex, totalStages }) => {
    const record = revealed.map((s, i) => `Stage ${i + 1} of ${totalStages}: ${s.label}\n${s.text}`).join('\n\n');
    const last = stageIndex + 1 === totalStages ? '\n\nThis is the last stage. "need_next" is no longer available.' : '';
    const body = { model, temperature, messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: record + last },
    ] };
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
          body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        return parseAnswer(j.choices?.[0]?.message?.content ?? '');
      } catch (e) {
        lastErr = e;
        await new Promise((res) => setTimeout(res, 800 * (attempt + 1)));
      }
    }
    return { decision: 'error', rationale: `adapter error: ${lastErr?.message ?? 'unknown'}`, contraindications_checked: [], citations: [] };
  };
}

// Pull the first JSON object out of a model's reply. Anything unreadable is recorded as unparseable.
export function parseAnswer(text) {
  const s = String(text);
  const start = s.indexOf('{');
  for (let end = s.lastIndexOf('}'); start >= 0 && end > start; end = s.lastIndexOf('}', end - 1)) {
    try {
      const o = JSON.parse(s.slice(start, end + 1));
      return {
        decision: String(o.decision ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_'),
        rationale: String(o.rationale ?? ''),
        contraindications_checked: Array.isArray(o.contraindications_checked) ? o.contraindications_checked.map(String) : [],
        citations: Array.isArray(o.citations) ? o.citations.filter((c) => c && c.doi) : [],
      };
    } catch { /* try a shorter span */ }
  }
  return { decision: 'unparseable', rationale: s.slice(0, 2000), contraindications_checked: [], citations: [] };
}

export function makeAdapter(name, opts = {}) {
  if (BASELINES[name]) return async () => BASELINES[name]();
  if (name === 'replay') return replayAdapter(opts.answers);
  if (name === 'chat') return chatAdapter(opts);
  throw new Error(`unknown adapter "${name}" (use always-operate, always-abstain, replay or chat)`);
}
