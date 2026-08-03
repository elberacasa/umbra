# Umbra

**Everyone is vibecoding. Nobody is verifying. Umbra scores it.**

`npx @elberacasa/umbra <path>` gives any AI-built repo a deterministic **Trust Score (0–100)**
in under a minute — with file:line evidence for every finding, a verdict you can
screenshot, and a badge for your README. No signup, no config, no daemon.

<!--
  DEMO GIF — drop here before launch.
  File: demo/demo.gif (recorded from demo/demo.tape via charmbracelet/vhs)
  Specs:
    - Terminal recording, 1200x600, dark theme
    - < 25 seconds total runtime
    - Beats per docs/demo-script.md: fresh shell → cd into vibe-coded app →
      `npx @elberacasa/umbra .` → verdict streams in → hold 3s on the final score
    - Render: `cd demo && vhs demo.tape`
  Markdown to uncomment:
  ![Umbra scanning a vibe-coded app: Trust Score 30/100](demo/demo.gif)
-->

## Quickstart

```bash
npx @elberacasa/umbra ./your-repo
```

Real output, scanning a typical vibe-coded Next.js app
([fixtures/bad-app](./fixtures/bad-app) in this repo):

```
$ npx @elberacasa/umbra ./fixtures/bad-app

UMBRA TRUST SCORE: 30/100  🔴

SAFE   🔴 0/100 — 15 findings
CLEAN  ✅ 81/100 — 10 findings
RUNS   — not yet measured in v0.1
HONEST — not yet measured in v0.1

Score computed over measured axes only (SAFE 50%, CLEAN 30% of the full rubric). Rubric v1.

Top findings:
  [safe/hardcoded-secrets] Hardcoded Stripe live secret key in source — .env:3
  [safe/hardcoded-secrets] Hardcoded Supabase service_role JWT — bypasses all row level security — .env:2
  [safe/hardcoded-secrets] Hardcoded Supabase service_role JWT — bypasses all row level security — lib/supabase.ts:5
  [safe/supabase-antipatterns] Supabase service_role key reachable from client-side code — full database bypass for anyone who opens the bundle — .env:2
  [safe/supabase-antipatterns] Supabase service_role key reachable from client-side code — full database bypass for anyone who opens the bundle — app/components/UserList.tsx:10

Notes (low confidence — not scored):
  [safe/missing-rate-limit] Auth endpoint with no rate-limiting signal in the repo — brute-force / credential-stuffing exposure (heuristic) — app/api/login/route.ts:3

Badge: [![Umbra Trust Score](https://img.shields.io/badge/Umbra_Trust_Score-30-red)](https://github.com/elberacasa/umbra)
```

Exit code is **1** when the score is below 50, so CI can gate on it.

```bash
umbra ./your-repo --json     # machine-readable output
umbra ./your-repo --offline  # skip npm registry checks, fully local
```

## The four axes

- **RUNS** — does it actually build and boot? Verified in a sandbox, not claimed in a README. *(reserved in v0.1)*
- **HONEST** — is the agent lying? Its claims ("14 tests pass") replayed against reality, with receipts. *(reserved in v0.1)*
- **SAFE** — is it vulnerable? Hardcoded secrets, client-side service keys, missing RLS, injection sinks, hallucinated dependencies. *(measured)*
- **CLEAN** — how much is slop? Dead exports, unused deps, mega-files, copy-paste duplication. *(measured)*

Scoring is deterministic and versioned — the same repo always gets the same
score. Every finding carries a confidence level; only high/medium confidence
moves the score, low-confidence hunches go to the notes section. No phantom
findings. Full math in [RUBRIC.md](./RUBRIC.md).

## The badge

Every scan prints badge markdown. Paste it in your README and your repo
advertises its own trust score:

```markdown
[![Umbra Trust Score](https://img.shields.io/badge/Umbra_Trust_Score-30-red)](https://github.com/elberacasa/umbra)
```

[![Umbra Trust Score](https://img.shields.io/badge/Umbra_Trust_Score-30-red)](https://github.com/elberacasa/umbra)

## One engine, four surfaces

- **CLI** (`npx @elberacasa/umbra`) — the core. Available today.
- **Skill** — a [trust-review skill](./skills/README.md) installable into Claude
  Code, Cursor, and other agent harnesses, so the agent checks its own work
  before you do.
- **GitHub Action** — [`elberacasa/umbra@v1`](./action.yml) comments the Trust
  Score on every PR. Trust gating in CI, zero local setup.
- **MCP server** *(coming)* — agents call Umbra mid-stream and catch their own
  mistakes before the code lands.

## Where this goes

v0.1 is static analysis: SAFE and CLEAN, measured deterministically, offline.
The roadmap builds the full trust layer for AI-generated software:

- **v0.2** — the surfaces above: skill, GitHub Action, launch.
- **v0.3** — RUNS axis: a sandbox that installs, builds, boots the repo and
  hits its endpoints. HONEST axis: claim-receipts that replay what the agent
  said against what is true ("agent claimed 14 tests pass — 3 do").
- **v1.0** — the MCP immune layer: Umbra sits between the agent and your
  codebase, intercepting writes mid-stream and scoring them before they land.
- **Beyond** — attack graphs across your dependency tree, a security twin of
  your app that gets probed so production doesn't, hosted report permalinks
  behind every badge.

The wedge is a score. The destination is the verification layer every
AI-built repo runs through.

## Contributing

Issues and PRs welcome. The highest-value contributions right now:

- New SAFE/CLEAN rules with real evidence (file:line, no heuristics that can't
  point at code). Every rule needs a fixture and a test.
- False-positive reports — a phantom finding in a viral screenshot is fatal,
  so these are treated as severity-one bugs.
- Renders of Umbra against real AI-generated repos. If it scored your repo
  wrong, that's a bug report we want.

Build and test before submitting:

```bash
npm install
npm run build
npm test
```

## Ethical use

Umbra is a defensive tool. Scan repos you own, repos you are about to depend
on, or repos you have permission to audit. Findings point at weaknesses —
they are not exploits, and publishing someone else's low score to shame them
is not the point. The point is that "the AI wrote it" stops being the end of
the verification conversation.

## License

[MIT](./LICENSE)
