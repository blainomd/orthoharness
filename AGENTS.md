# AGENTS.md — orthoharness

> Read `~/Documents/AGENTS.md` first. This file is this repo's own rules.

## What this is
An open benchmark harness for orthopaedic AI (Apache-2.0, Node 18+, no dependencies). A reference implementation, not a validated benchmark: the demo cases in `cases/demo/` are synthetic and the loss weights are placeholders. Never describe a run on the demo cases as clinical validation. Never put patient information in a case, an issue or a pull request.

## Ship path (2026-10-02, used again 2026-10-12)
- `npm test` before every push (`node --test test/*.test.mjs`).
- **A push is not the deploy.** The site is `site/` only (index.html, llms.txt, robots.txt, sitemap.xml, .well-known/agent.json), served by Firebase Hosting site `orthoharness` in project `solvinghealth` (apex orthoharness.com; Vercel holds the DNS). `gcp-static-deploy.sh` refuses this repo because package.json has scripts. Deploy with:
  ```
  mkdir -p /tmp/oh-site && git archive HEAD:site | tar -x -C /tmp/oh-site && cd /tmp/oh-site
  printf '%s\n' '{ "hosting": { "site": "orthoharness", "public": ".", "ignore": ["firebase.json", "**/.*", "!**/.well-known/**"], "cleanUrls": true } }' > firebase.json
  firebase deploy --only hosting:orthoharness --project solvinghealth
  ```
  then curl the apex cache-busted (`/?v=…`, `/llms.txt`, `/.well-known/agent.json`) and audit that `/README.md`, `/package.json`, `/src/…` and `/cases/…` are 404 (only the five site files may be served).
- Three layers move together: a claim on the page is also in `site/llms.txt` and, when it is a fact an agent would use, in `site/.well-known/agent.json` (bump `updated`).

## Sourcing rule (the Luks and DOCSF digests, 10/3 and 10/12)
Every number on the site names its source (study or report, year). A conference presentation or a recap may be attributed as such, in words, with "not yet published"; its numbers stay out of the site until the paper exists. Cite the study, never the blog or the post. No "free", no price, no "validated", no "accurate to N".
