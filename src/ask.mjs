// Ask a model a question the gated way: retrieve the record, constrain the model to it, check every
// sentence it writes with fixed rules, and keep only what survives. The model writes; the rules decide
// what is shown as supported. Nothing here judges meaning: a kept sentence quotes words that are really
// in a real paper on this topic, and a person still has to read whether they mean what the sentence says.
import { createHash } from 'node:crypto';
import { checkTopic, checkAnswer, groundedPrompt, fetchAbstracts, sentences, gateSentences } from './topic.mjs';
export { sentences, gateSentences };

export const GATE_VERSION = 'ask-gate/1';

const sha = (s) => createHash('sha256').update(s).digest('hex');

// A model call through any OpenAI-compatible endpoint (a hosted model, or Ollama at http://localhost:11434/v1).
// An empty or cut-off reply is an error, never "nothing survived": a gate run on no text proves nothing.
export async function complete(prompt, { baseUrl, model, apiKey, temperature = 0, maxTokens = 6000, reasoningEffort, fetch: f = globalThis.fetch } = {}) {
  if (!baseUrl || !model) throw new Error('ask needs ORTHOHARNESS_BASE_URL and ORTHOHARNESS_MODEL');
  const r = await f(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify({ model, temperature, max_tokens: maxTokens, ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}), messages: [{ role: 'user', content: prompt }] }),
  });
  if (!r.ok) throw new Error(`model endpoint answered ${r.status}`);
  const j = await r.json();
  const choice = j.choices?.[0] ?? {};
  const text = String(choice.message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  if (!text) throw new Error(`model returned no answer text (finish_reason: ${choice.finish_reason ?? 'none'}); a reasoning model may have spent its tokens thinking, so raise ORTHOHARNESS_MAX_TOKENS`);
  if (choice.finish_reason === 'length') throw new Error('model reply was cut off at the token limit; raise ORTHOHARNESS_MAX_TOKENS rather than gate half an answer');
  // A local server with a small context window drops the start of a long prompt without saying so.
  // English runs about 4 characters a token; seeing fewer than 1 token per 8 characters means it was cut.
  const seen = j.usage?.prompt_tokens;
  if (seen && seen < prompt.length / 8) throw new Error(`the model saw ${seen} tokens of a prompt about ${Math.round(prompt.length / 4)} tokens long: its context window cut the records it must cite; raise the server's context length`);
  return text;
}

export async function ask(question, opts = {}) {
  const { scope = 'jbjs', since, until, fetch: f, gap, model, baseUrl, apiKey, maxTokens, reasoningEffort, now = new Date().toISOString() } = opts;
  const evidence = await checkTopic(question, { scope, since, until, fetch: f, gap });
  const abstracts = await fetchAbstracts(evidence, { fetch: f, gap });
  const prompt = groundedPrompt(evidence, abstracts);
  const reply = await complete(prompt, { baseUrl, model, apiKey, maxTokens, reasoningEffort, fetch: f });
  const check = await checkAnswer(reply, evidence, { fetch: f, gap });
  const gated = gateSentences(reply, check);
  const count = (v) => gated.filter((g) => g.verdict === v).length;
  const records = [...new Set([...evidence.levels.flatMap((l) => l.records), ...evidence.relevant].map((r) => r.pmid))].sort();
  // The receipt: enough to rerun it and to show the reply was not edited after the gate ran.
  // The key and the endpoint address are never recorded.
  const receipt = {
    gate: GATE_VERSION, question, scope, query: evidence.query, retrieved_at: now, pubmed_total: evidence.total,
    record_pmids: records, abstracts_given: Object.keys(abstracts).length, model, prompt_sha256: sha(prompt), reply_sha256: sha(reply),
    kept: count('KEPT'), listed: count('LISTED'), struck: count('STRUCK'), uncited: count('UNCITED'), abstained: count('ABSTAINED'),
  };
  receipt.receipt_sha256 = sha(JSON.stringify(receipt));
  return { evidence, prompt, reply, check, gated, receipt };
}

export function askMarkdown(r) {
  const L = [`# ${r.receipt.question}`, '', `Model \`${r.receipt.model}\` · ${r.evidence.scope_label} · ${r.evidence.total} matching articles · gate \`${r.receipt.gate}\``, ''];
  for (const n of r.evidence.runs_out) L.push(`> ${n}`);
  if (r.evidence.runs_out.length) L.push('');
  const kept = r.gated.filter((g) => g.verdict === 'KEPT' || g.verdict === 'ABSTAINED');
  L.push(`## What survived the gate (${kept.length})`, '');
  if (!kept.length) L.push('Nothing. No sentence both cited a retrieved record and quoted words that are really in its abstract.');
  for (const g of kept) L.push(`- ${g.text}${g.verdict === 'ABSTAINED' ? ' _(abstained)_' : ''}`);
  L.push('', 'Each kept sentence quotes words from the abstract of a real paper on this topic. Whether they mean what the sentence says is for a person to read.', '');
  const struck = r.gated.filter((g) => g.verdict === 'STRUCK');
  if (struck.length) { L.push(`## Struck (${struck.length})`, ''); for (const g of struck) L.push(`- ~~${g.text}~~ (${g.reason})`); L.push(''); }
  const listed = r.gated.filter((g) => g.verdict === 'LISTED');
  if (listed.length) { L.push(`## Listed papers, no claim checked (${listed.length})`, ''); for (const g of listed) L.push(`- ${g.text}`); L.push(''); }
  const uncited = r.gated.filter((g) => g.verdict === 'UNCITED');
  if (uncited.length) { L.push(`## Uncited, not shown as supported (${uncited.length})`, ''); for (const g of uncited) L.push(`- ${g.text}`); L.push(''); }
  if (r.check.left_out.length) {
    L.push(`## Strong evidence the model did not use (${r.check.left_out.length})`, '');
    for (const x of r.check.left_out) L.push(`- ${x.year ?? '–'} · ${x.journal} · ${x.title} ${x.url}`);
    L.push('');
  }
  L.push('## Receipt', '', '```json', JSON.stringify(r.receipt, null, 2), '```', '');
  return L.join('\n');
}
