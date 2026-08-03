# Umbra

**Everyone is vibecoding. Nobody is verifying. Umbra scores it.**

`npx @elberacasa/umbra <path>` gives any AI-built repo a deterministic **Trust Score (0–100)**
in under a minute — with file:line evidence for every finding, a verdict you can
screenshot, and a badge for your README. No signup, no config, no daemon.

![Umbra scanning a vibe-coded app: Trust Score 24/100](demo/demo.gif)

<!--
  DEMO GIF — recorded from demo/demo.tape via charmbracelet/vhs.
  Specs:
    - Terminal recording, 1200x600, dark theme
    - < 25 seconds total runtime
    - Beats per docs/demo-script.md: fresh shell → cd into vibe-coded app →
      `npx @elberacasa/umbra .` → verdict streams in → hold 3s on the final score
    - Render: `cd demo && vhs demo.tape`
  Re-record whenever the verdict format changes; stale demo output is a
  credibility bug (see docs/demo-script.md).
-->

## Quickstart

```bash
npx @elberacasa/umbra ./your-repo
```

Real output, scanning a typical vibe-coded Next.js app
([fixtures/bad-app](./fixtures/bad-app) in this repo):

```
$ npx @elberacasa/umbra ./fixtures/bad-app

UMBRA TRUST SCORE: 24/100  🔴

SAFE   🔴 0/100 — 15 findings
CLEAN  ✅ 81/100 — 10 findings
RUNS   — not measured — run with --deep
HONEST — not measured — run with --deep

Score computed over measured axes only (full rubric: SAFE 35%, RUNS 25%, HONEST 25%, CLEAN 15%). Rubric v2.

Top findings:
  [safe/hardcoded-secrets] Hardcoded Stripe live secret key in source — .env:3
  [safe/hardcoded-secrets] Hardcoded Supabase service_role JWT — bypasses all row level security — .env:2
  [safe/hardcoded-secrets] Hardcoded Supabase service_role JWT — bypasses all row level security — lib/supabase.ts:5
  [safe/supabase-antipatterns] Supabase service_role key reachable from client-side code — full database bypass for anyone who opens the bundle — .env:2
  [safe/supabase-antipatterns] Supabase service_role key reachable from client-side code — full database bypass for anyone who opens the bundle — app/components/UserList.tsx:10

Notes (low confidence — not scored):
  [safe/missing-rate-limit] Auth endpoint with no rate-limiting signal in the repo — brute-force / credential-stuffing exposure (heuristic) — app/api/login/route.ts:3

Badge: [![Umbra Trust Score](https://img.shields.io/badge/Umbra_Trust_Score-24-red)](https://github.com/elberacasa/umbra)
```

Exit code is **1** when the score is below 50, so CI can gate on it.

```bash
umbra ./your-repo --json     # machine-readable output
umbra ./your-repo --offline  # skip npm registry checks, fully local
umbra ./your-repo --deep     # also verify RUNS and HONEST in a Docker sandbox
```

`--deep` is the full verification: Umbra copies the repo into a throwaway
Docker container (no network at runtime, 512m/1cpu hard limits), builds and
boots it, probes its endpoints, and replays the README's claims against what
actually happens. Slower — minutes, not seconds — and needs a running Docker
daemon. Without Docker the sandboxed axes are reported as skipped and simply
left out of the score; unverifiable is never punished.

Deep-scanning a repo whose README lies
([fixtures/claims-app](./fixtures/claims-app) in this repo):

```
RUNS   — not measured — No detectable run path (no Dockerfile, no package.json start script or main entry)
HONEST ⚠️ 50/100 — 2 claims failed, 2 verified, 1 unverifiable

Claim receipts:
  CLAIM FAILED: "14 tests pass" — README.md:7 — actually 3 tests pass, 0 fail
  CLAIM FAILED: "build passes" — README.md:9 — actually build exits 1
  CLAIM VERIFIED: "All tests pass" — CLAUDE.md:3 — 3 tests pass
  CLAIM VERIFIED: "All tests are passing" — README.md:8 — 3 tests pass
```

## Make it a habit: `umbra init`

```bash
npx @elberacasa/umbra init ./your-repo
```

installs Umbra into the repo's daily workflow: a pre-commit hook that blocks
commits when the Trust Score drops below 50, and a GitHub Action that scores
every PR. Existing hooks are appended to, never clobbered; re-run with
`--force` to refresh, `--no-hook` / `--no-action` to install just one side.

## The four axes

- **RUNS** — does it actually build and boot? Verified in a Docker sandbox, not claimed in a README. *(measured with `--deep`)*
- **HONEST** — is the agent lying? Its claims ("14 tests pass") replayed against reality, with receipts. *(measured with `--deep`)*
- **SAFE** — is it vulnerable? Hardcoded secrets, client-side service keys, missing RLS, injection sinks, hallucinated dependencies, wildcard CORS, JWT misconfigurations, debug flags left on, exposed sensitive files, default credentials. *(measured)*
- **CLEAN** — how much is slop? Dead exports, unused deps, mega-files, copy-paste duplication. *(measured)*

Scoring is deterministic and versioned — the same repo always gets the same
score. Every finding carries a confidence level; only high/medium confidence
moves the score, low-confidence hunches go to the notes section. No phantom
findings. Full math in [RUBRIC.md](./RUBRIC.md).

## The badge

Every scan prints badge markdown. Paste it in your README and your repo
advertises its own trust score:

```markdown
[![Umbra Trust Score](https://img.shields.io/badge/Umbra_Trust_Score-24-red)](https://github.com/elberacasa/umbra)
```

[![Umbra Trust Score](https://img.shields.io/badge/Umbra_Trust_Score-24-red)](https://github.com/elberacasa/umbra)

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

Umbra today: SAFE and CLEAN measured statically and offline on every scan;
RUNS and HONEST verified in a Docker sandbox with `--deep`. The roadmap builds
the full trust layer for AI-generated software:

- **v0.2** — the surfaces above: skill, GitHub Action, launch. *(shipped)*
- **v0.3** — RUNS axis: a sandbox that installs, builds, boots the repo and
  hits its endpoints. HONEST axis: claim-receipts that replay what the agent
  said against what is true ("agent claimed 14 tests pass — 3 do").
  *(shipped — run any repo with `--deep`)*
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
