<div align="center">

# Umbra

**Everyone is vibecoding. Nobody is verifying. Umbra scores it.**

A deterministic Trust Score (0–100) for AI-generated code — the vibe coding
security scanner that verifies what the agent shipped, not what it claimed.

[![npm version](https://img.shields.io/npm/v/@elberacasa/umbra)](https://www.npmjs.com/package/@elberacasa/umbra)
[![license: MIT](https://img.shields.io/npm/l/@elberacasa/umbra)](./LICENSE)
[![CI](https://github.com/elberacasa/umbra/actions/workflows/umbra-self.yml/badge.svg)](https://github.com/elberacasa/umbra/actions/workflows/umbra-self.yml)
[![node >=20](https://img.shields.io/node/v/@elberacasa/umbra)](https://www.npmjs.com/package/@elberacasa/umbra)

[Quickstart](#quickstart) · [Demo](#demo) · [The Four Axes](#the-four-axes) · [FAQ](#faq) · [Roadmap](#roadmap) · [Contributing](#contributing)

</div>

<a id="demo"></a>

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

Umbra is **SAST for AI code**, rebuilt for how software gets written now. One
command scans any repo an agent produced — Claude Code, Cursor, Copilot,
Windsurf, Lovable — and returns a score with file:line evidence for every
finding. With `--deep` it goes further: builds and boots the repo in a
locked-down Docker sandbox, then replays the agent's own claims ("14 tests
pass") against reality. If the AI agent is lying about tests, the score is
capped below passing — with receipts.

## Quickstart

```bash
npx @elberacasa/umbra ./your-repo
```

Real output, scanning a typical vibe-coded Next.js app
([fixtures/bad-app](./fixtures/bad-app) in this repo — Trust Score **24/100**):

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

The exit code is **1** when the score is below 50, so CI can gate on it.

```bash
umbra ./your-repo --json     # machine-readable output
umbra ./your-repo --offline  # skip npm registry checks, fully local
umbra ./your-repo --deep     # also verify RUNS and HONEST in a Docker sandbox
```

## `--deep`: verify AI code, don't trust it

The fast scan is static. `--deep` is LLM code verification with evidence:
Umbra copies the repo into a throwaway Docker container — `--network none` at
runtime, 512 MB / 1 CPU hard limits, 120-second kill switch — builds it,
boots it, HTTP-probes its endpoints, and replays every claim in the READMEs
and agent artifacts against what actually happens. Slower (minutes, not
seconds), needs a running Docker daemon. Without Docker the sandboxed axes
are skipped and left out of the score; unverifiable is never punished.

Real output, deep-scanning a repo whose README lies
([fixtures/claims-app](./fixtures/claims-app) — capped at **49/100** by the
liar cap):

```
$ npx @elberacasa/umbra ./fixtures/claims-app --deep

UMBRA TRUST SCORE: 49/100  🔴

SAFE   ✅ 100/100 — 0 findings
CLEAN  ✅ 97/100 — 2 findings
RUNS   — not measured — No detectable run path (no Dockerfile, no package.json start script or main entry)
HONEST ⚠️ 50/100 — 2 claims failed, 2 verified, 1 unverifiable

Score computed over measured axes only (full rubric: SAFE 35%, RUNS 25%, HONEST 25%, CLEAN 15%). Rubric v2.
Score capped below passing: a documented claim was verified false. Trust is the product.

Claim receipts:
  CLAIM FAILED: "14 tests pass" — README.md:7 — actually 3 tests pass, 0 fail
  CLAIM FAILED: "build passes" — README.md:9 — actually build exits 1
  CLAIM VERIFIED: "All tests pass" — CLAUDE.md:3 — 3 tests pass
  CLAIM VERIFIED: "All tests are passing" — README.md:8 — 3 tests pass
```

Any claim verified false caps the total at 49 — a repo caught lying does not
get a passing trust score. For contrast, a genuinely working app
([fixtures/runnable-app](./fixtures/runnable-app)) scores **100/100** under `--deep`.

## The Four Axes

| Axis | Question | How it's measured |
|------|----------|-------------------|
| **SAFE** (35%) | Is it vulnerable? | 15 deterministic static rules, every scan, fully offline. |
| **RUNS** (25%) | Does it actually build and boot? | Docker sandbox: install, build, start, HTTP probe. *(`--deep`)* |
| **HONEST** (25%) | Is the agent lying about tests or the build? | Claims extracted from READMEs/agent files, replayed against sandbox reality. Claim receipts emitted. *(`--deep`)* |
| **CLEAN** (15%) | How much is slop? | Static rules: dead exports, unused deps, mega-files, duplication. |

The SAFE rules cover the failures AI-generated code security actually ships:
hardcoded secrets (Stripe keys, JWTs, connection strings), Supabase
service-role keys exposed client-side and missing **Supabase RLS**, missing
auth on API routes, injection sinks, rate-limit hints, hallucinated and
typosquatted dependencies, CORS wildcard with credentials, JWT misconfig
(`alg: none`, no expiry, decode-as-authorization), debug flags and
stack-trace leaks, committed sensitive files (`.pem`, `id_rsa`, SQL dumps),
and default credentials.

Scoring is deterministic and versioned (**rubric v2**: SAFE 35 / RUNS 25 /
HONEST 25 / CLEAN 15, renormalized over measured axes). Every finding carries
a confidence level; low-confidence hunches go to notes and never move the
score. No phantom findings. Full math in [RUBRIC.md](./RUBRIC.md).

## Why Umbra?

| | Umbra | Traditional SAST (Semgrep, Snyk Code) | Secret scanners (trufflehog, Gitleaks) | Agent review bots |
|---|---|---|---|---|
| Built for AI-generated code | ✅ | generic rulesets | secrets only | ✅ |
| Verifies the app builds, boots, and answers HTTP | ✅ (sandbox) | — | — | — |
| Replays agent claims, caps liars below passing | ✅ | — | — | — |
| Deterministic score, versioned rubric | ✅ | findings list | findings list | prose review |
| Agent-native surfaces (skill, Action, MCP) | ✅ | — | — | partial |

Existing tools answer "is this code pattern dangerous?" Umbra answers the
question vibe coding actually raises: "the AI wrote this — can I trust it?"

## The badge

Every scan prints badge markdown. Paste it in your README and your repo
advertises its own trust score:

```markdown
[![Umbra Trust Score](https://img.shields.io/badge/Umbra_Trust_Score-24-red)](https://github.com/elberacasa/umbra)
```

[![Umbra Trust Score](https://img.shields.io/badge/Umbra_Trust_Score-24-red)](https://github.com/elberacasa/umbra)

## One engine, every surface

- **CLI** (`npx @elberacasa/umbra`) — the core. Available today.
- **Agent skill** — a [trust-review skill](./skills/README.md) installable into
  Claude Code, Cursor, Copilot, and Windsurf, so the agent checks its own work
  before you do. Claude Code / Cursor / Copilot security, from inside the agent.
- **GitHub Action** — [`uses: elberacasa/umbra@v1`](./action.yml) comments the
  Trust Score on every PR. Trust gating in CI, zero local setup.
- **`umbra init`** — installs both into a repo: a pre-commit hook that blocks
  commits below 50, and the Action. Existing hooks are appended to, never
  clobbered; `--force` refreshes, `--no-hook` / `--no-action` pick one side.
- **MCP server** *(coming)* — agents call Umbra mid-stream and catch their own
  mistakes before the code lands.

Day-to-day recipes (CI gating, JSON parsing, hooks): [docs/daily-use.md](./docs/daily-use.md).

## Roadmap

- **v0.1** *(shipped)* — CLI, SAFE + CLEAN static axes, deterministic score, verdict output, badge markdown.
- **v0.2** *(shipped)* — the surfaces: agent skill, GitHub Action, `umbra init`.
- **v0.3** *(shipped — current)* — RUNS axis: a sandbox that installs, builds, boots the repo and probes its endpoints. HONEST axis: claim receipts that replay what the agent said against what is true, plus the liar cap.
- **v1.0** — the MCP immune layer: Umbra sits between the agent and your codebase, intercepting writes mid-stream and scoring them before they land.
- **Beyond** — attack graphs across your dependency tree, a security twin of your app that gets probed so production doesn't, hosted report permalinks behind every badge.

The wedge is a score. The destination is the verification layer every
AI-built repo runs through.

## FAQ

**How is Umbra different from Semgrep, Snyk, or trufflehog?**
They scan code patterns; Umbra verifies outcomes. Static rules are one input
to the SAFE axis — Umbra additionally boots the app in a sandbox to prove it
runs, and replays the agent's documented claims to prove it isn't lying.
"README says 14 tests pass, actually 3 do" costs the repo a passing grade.

**Does Umbra send my code anywhere?**
No. Scanning is fully local; `--offline` skips even the npm registry checks.
`--deep` runs your repo in a local Docker container with `--network none` at
runtime — nothing leaves your machine.

**Does it need Docker?**
Only for `--deep` (RUNS and HONEST). The default fast scan is pure static
analysis. Without Docker the sandboxed axes are skipped and excluded from the
score — never punished.

**What languages does it support?**
JavaScript and TypeScript (including Next.js and Supabase apps) have the
deepest coverage today — that's where most vibe-coded repos live. The rule
engine is extensible; new rules need a fixture and a test.

**Is the score reproducible?**
Yes. Same repo, same rubric version, same score — every time. The rubric is
versioned (v2) and printed in every report, and low-confidence findings never
affect it. Skipped axes are excluded and renormalized over, never punished.

**What does it catch that my AI agent won't mention?**
The classics of AI-generated code: a Supabase `service_role` JWT shipped to
the browser (bypasses all row level security), live Stripe keys in `.env`,
API routes with no auth check, `alg: none` JWTs, CORS `*` with credentials,
hallucinated dependencies that don't exist on npm — and whether its own
claims about tests and builds are true.

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
