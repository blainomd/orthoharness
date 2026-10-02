# orthoharness

**An open benchmark harness for orthopaedic AI.** The models are good enough; the test is not.
This is the test: everything around the model, so a system is scored on how surgeons actually
decide, not on board-style questions asked once.

Apache-2.0 · Node 18+ · no dependencies · runs offline with `--offline` · nothing leaves your machine except DOIs to CrossRef and, only if you choose the `chat` adapter, the case text to the endpoint you name

> **Status: a reference implementation, not a validated benchmark.** The six cases in `cases/demo/`
> are synthetic, written to exercise the harness. They are not real patients and not clinical
> guidance, and their reference answers have not been reviewed by a panel. The loss weights in
> `loss-matrix.json` are placeholders that show the shape. The real cases and weights belong to the
> specialty.

## What it does differently

| Today's tests | orthoharness |
|---|---|
| Fixed questions, asked once | The record is revealed one stage at a time (history, imaging, exam, op note…). The system may ask for the next stage, and committing before the record supports it is scored as **premature** |
| One yardstick, one score | Every case carries **two yardsticks**, the guideline and the treating attending. Each is scored on its own and they are **never averaged**; where they disagree, the report shows which side the system took |
| Guessing pays | **`not_enough_information` is a real answer** with its own row in the loss matrix. A correct "do not operate" scores the same as a correct "operate". Over-commitment and over-abstention are counted separately |
| Only the answer is graded | **The route is graded:** each case lists the contraindication checks a safe answer must show (for example an anticoagulant, or an infection at the operative site) |
| Only invented content counts | **Omissions count:** each case lists the facts the reasoning has to name |
| A citation passes if it exists | **Title checking:** every DOI is looked up at CrossRef and the title it returns is compared with the title the system gave. Whether the paper *supports* the claim is not machine-checked, and the report says how many a person has read: by default, none |
| Only the machine is measured | **The same rules score a person.** The `replay` adapter reads recorded answers, so a surgeon's own unaided answers go through the identical grader. `compare` puts aided and unaided side by side |
| Written once, then stale | **`delta`** turns a drafted note and the signed note into labeled kept / struck / added lines: the evidence a person looked, and new training data from real practice |
| Nobody owns the answer | **Signature:** every run records who signed. Without `--signer`, answers are reported as unsigned drafts |
| One leaderboard number | **There is no overall score.** The report is by kind of error. A test in the suite fails if a summary ever grows one |

And one thing for whoever holds the private test set: `orthoharness hash <cases>` gives a sha256
commitment to a case set. **Publish the hash and the loss matrix; withhold the questions.** Every
run report carries the hash, so results are tied to a version without the exam leaking into
training data.

## Run it

```bash
git clone https://github.com/blainomd/orthoharness && cd orthoharness
npm test                                                       # 13 checks, offline

node bin/orthoharness.mjs run cases/demo --adapter always-operate --offline   # baseline: commits every time
node bin/orthoharness.mjs run cases/demo --adapter always-abstain --offline   # baseline: never commits
node bin/orthoharness.mjs run cases/demo --adapter replay --answers examples/answers-careful.jsonl --label careful
```

Score a model behind any OpenAI-compatible endpoint, hosted or local (Ollama shown). The key is read
from the environment and never written to a run file:

```bash
ORTHOHARNESS_BASE_URL=http://localhost:11434/v1 ORTHOHARNESS_MODEL=llama3.1 \
  node bin/orthoharness.mjs run cases/demo --adapter chat --label llama3.1-local
```

Score a person on the same cases, then compare:

```bash
node bin/orthoharness.mjs run cases/demo --adapter replay --answers my-unaided.jsonl --label unaided --signer "attending surgeon"
node bin/orthoharness.mjs compare runs/unaided-*.json runs/aided-*.json
```

Turn a draft and a signed note into labeled lines:

```bash
node bin/orthoharness.mjs delta examples/draft.txt examples/signed.txt --case demo-02
```

Each run writes `runs/<label>-<time>.json` (every case, every verdict) and a `.md` report.

## Case format

One JSON file per case. See `cases/demo/` for six complete examples.

```json
{
  "id": "demo-03-tka-skin-infection",
  "split": "dev",
  "min_stage": 3,
  "stages": [
    { "label": "History", "text": "…" },
    { "label": "Imaging report", "text": "…" },
    { "label": "Pre-operative exam", "text": "…" }
  ],
  "yardsticks": {
    "guideline": { "decision": "do_not_operate", "note": "…" },
    "attending": { "decision": "do_not_operate", "note": "…" }
  },
  "required_checks": [{ "id": "active_infection", "any": ["infection", "cellulitis", "wound"] }],
  "required_facts":  [{ "id": "failed_nonoperative", "any": ["failed", "despite"] }]
}
```

- `decision` is one of `operate`, `do_not_operate`, `not_enough_information`.
- `min_stage` (1-based) is the earliest stage at which a commitment is supportable. Abstaining is never premature.
- `split` is `dev` or `test`. Keep `test` cases out of any public repository; publish their hash.
- `required_checks` and `required_facts` match whole phrases in the answer. That is crude on
  purpose and easy to replace: a reader, or a second grader, can take its place. The point is that
  the route and the omissions are scored at all.

## Answer format

The `chat` adapter asks for, and `replay` reads, one JSON object per answer:

```json
{ "decision": "operate | do_not_operate | not_enough_information | need_next",
  "rationale": "…", "contraindications_checked": ["…"],
  "citations": [{ "doi": "10.…", "title": "…", "claim": "…" }] }
```

An answer that cannot be read takes the worst loss in the matrix. It is never a pass.

## Why

Every row above comes from a published finding. Sources, with each DOI checked at CrossRef:
**[surgeonvalue.com/docsf#harness](https://surgeonvalue.com/docsf#harness)**.

- Practice-based scores fall far below knowledge scores across 39 medical AI benchmarks (Gong, *JMIR* 2025, doi:10.2196/84120).
- The same 100 vignettes matched the guideline 90 times and the treating attending 78 times (Dagher, *CORR* 2024, doi:10.1097/CORR.0000000000003234).
- With abstention inside the scoring, all 16 systems tested over-committed more than they abstained (CliniCARE-Bench, arXiv 2608.07796, preprint).
- Treatment advice without a contraindication check is a process-safety failure (*PLOS Medicine* 2026, doi:10.1371/journal.pmed.1005170).
- 7.9% of 2,556 citations were fabricated, and about nine in ten real ones were misattributed (McCavitt, *JBJS OA* 2026, doi:10.2106/JBJS.OA.25.00225).
- With the source supplied, omissions were 60–74% of extraction errors (Shankar, *J Biomed Inform* 2026, doi:10.1016/j.jbi.2026.105086).
- Adenoma detection fell from 28.4% to 22.4% after endoscopists started using AI (Budzyń, *Lancet Gastroenterol Hepatol* 2025, doi:10.1016/S2468-1253(25)00133-5).
- General-purpose models now beat specialized clinical tools on benchmarks (Vishwanath, *Nature Medicine* 2026, doi:10.1038/s41591-026-04431-5). The specialty does not need its own model. It needs its own test.

## Who should own it

Not a vendor, including us. The cases, the loss weights and the held-out test set belong with the
specialty's own societies, journals and registries, versioned and independent. This repository is
the plumbing: fork it, replace the demo cases, publish your loss matrix and your hash.

Contributions welcome: cases (synthetic, or properly de-identified with the right approvals, never
PHI in an issue or pull request), graders that replace phrase matching, adapters.

Made by Blaine Warkentine, MD, for the DOCSF 2026 breakout on agentic search. Sibling project:
[citecheck](https://github.com/blainomd/citecheck), the title-checking citation tool this harness
borrows its matching from.
