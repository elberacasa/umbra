# Umbra Scoring Rubric — v4

Umbra's score is deterministic: the same repo always produces the same score.
The rubric is versioned (`RUBRIC_VERSION = 4` in `src/score/score.ts`) so scores
stay comparable over time.

## Axes and weights

| Axis | Weight | How it's measured |
|------|--------|-------------------|
| SAFE | 35% | static rules (always) |
| RUNS | 25% | Docker sandbox: build, boot, HTTP probe (`--deep`) |
| HONEST | 25% | claim replay against sandbox reality (`--deep`) |
| CLEAN | 15% | static rules (always) |

RUNS and HONEST require a sandbox. A plain `umbra <path>` is the fast static
scan: the total is computed over the measured axes only (SAFE and CLEAN),
renormalized to 0–100, and every report states this explicitly. With
`--deep`, RUNS and HONEST join the total — but **only when their
AxisReport.status is not `'skipped'`**. A skipped axis (no Docker, no
detectable run path, no verifiable claims) is excluded and the remaining
weights renormalize. Unverifiable is never punished.

## Per-axis scoring

### SAFE and CLEAN (static)

Each axis starts at **100**. Every finding deducts points:

`deduction = severity_points × confidence_multiplier`

| Severity | Points |
|----------|--------|
| critical | 25 |
| high | 15 |
| medium | 8 |
| low | 3 |

| Confidence | Multiplier |
|------------|-----------|
| high | 1.0 |
| medium | 0.5 |
| low | not scored |

Low-confidence findings never affect the score. They appear in the report's
**notes** section so a heuristic hunch can't tank a repo's score — no phantom
findings.

Axis scores floor at 0 (no negative axes).

### The per-rule deduction ceiling

A single rule can deduct at most **25 points** from an axis, no matter how
many times it fires. Per rule, the highest deductions (severity points ×
confidence multiplier, descending) accumulate until the next one would exceed
the ceiling; every finding beyond it still appears in the report with full
file:line evidence — but deducts nothing, and the report counts them as
`cappedFindings`.

Without the ceiling, per-finding deductions scale linearly with repo size:
the same class of issue hits a 3,000-file repo 100x harder than a 30-file
one, flooring mature repos at 0. The ceiling makes each rule's maximum blast
radius size-independent while leaving small repos fully accountable — a repo
whose rules each stay under 25 points of deductions scores exactly as it
would uncapped.

### Non-production context suppression (SAFE)

SAFE rules suppress findings in paths that are not production code: test
files (`*.test.*`, `*.spec.*`, `__tests__/**`, `test/**`, `tests/**`,
`testing/**`, `e2e*/**`), `benchmarks/**`, `fixtures/**`, `scripts/**`,
`docs/**`, `*.md`,
`prompts/**`, `examples/**`, and `demo/**`. A SQL string in a prompt template
or an `eval()` in a test fixture is not a reachable vulnerability, so these
findings are dropped entirely — they do not even become notes. One exception:
`safe/hardcoded-secrets` still fires in non-production paths when it sees an
obviously-real live key (`sk_live_*`, `AKIA*`, or a decodable JWT), downgraded
to medium confidence — a real key leaked into a test is a breach class, a
placeholder is not. One exception to that exception: canonical documentation
example values (Stripe's docs `sk_live_4eC39HqLyjWDarjtT1zdp7dc`, AWS's
`AKIAIOSFODNN7EXAMPLE`, and the AWS docs example secret) are suppressed in
production paths — they are copy-paste artifacts from official docs, not
leaked credentials. In non-production paths they still fire at the live-key
exception's medium confidence, because fixtures and tests use them as
stand-ins for real payloads.

Text-pattern SAFE rules (injection-sinks, cors-wildcard, debug-flags,
jwt-misconfig, default-credentials) match against source with comments,
regex-literal source, and — where the pattern is a call expression — string
contents masked out, so a finding always points at executable code, never at
prose about code (`// never use eval()` does not fire). When the masker
cannot parse a file, the finding is kept but downgraded one confidence level
rather than dropped.

`clean/dead-exports` reports at **low confidence** — its findings are notes
and never move the score. Textual import detection cannot see path aliases,
dynamic imports, or dependency injection, so the heuristic is advisory only.

### Agent-config rules (SAFE)

Two rules cover the agent-configuration threat surface — files an agent reads
or executes at every session start, where a hostile edit is self-modification:

- `safe/prompt-injection` scans instruction-bearing files (`*.md`, `*.mdc`,
  `*.txt`, `.cursorrules`, `.cursor/**`, `.windsurf/**`,
  `.github/copilot-instructions.md`, `CLAUDE.md`, `AGENTS.md`, `skills/**`)
  for invisible Unicode (high/high), instruction-override phrases hidden in
  HTML comments (high/high), the same phrases in visible prose
  (medium/medium), and long base64 blobs (low-confidence note).
- `safe/mcp-config` parses MCP configs (`.mcp.json`, `mcp.json`,
  `*.mcp.json`, `claude_desktop_config.json`, by basename) and flags servers
  that run unpinned packages via `npx -y`/`uvx`/`bunx` (medium/medium), pipe
  downloads into a shell (high/high), or embed literal secrets in `env` blocks
  or args (critical/high). `${VAR}` env indirection is the correct pattern and
  never flags; unparseable JSON fails closed with no findings.

Agent-config paths (`CLAUDE.md`, `AGENTS.md`, `.cursorrules`, `.cursor/**`,
`.windsurf/**`, `skills/**`, `.github/copilot-instructions.md`) are **always
production**, exempt from the `*.md` suppression above — but paths under
non-production directories (`fixtures/**`, `docs/**`, `tests/**`, …) stay
suppressed even when shaped like agent config, so fixture payloads and
threat-model write-ups never self-flag.

### RUNS (sandbox)

Verified end to end in a throwaway Docker container (temp copy of the repo,
`--network none` at runtime, 512m/1cpu limits). Score bands:

| Outcome | Score |
|---------|-------|
| build fails | 10 |
| builds but crashes on boot | 25 |
| boots but never answers HTTP | 50 |
| responds over HTTP | 100 |

### HONEST (claim replay)

Starts at **100**. Claims found in markdown and agent artifacts ("14 tests
pass", "build passes") are replayed against what actually happens in the
sandbox. Each **failed** claim deducts **25** points. Verified claims cost
nothing; unverifiable claims (e.g. coverage percentages, missing test
scripts, no Docker) are never scored either way.

## Total

```
total = round( Σ(axis_score × axis_weight) / Σ(measured axis weights) )
```

- Fast scan: `total = round((0.35 × SAFE + 0.15 × CLEAN) / 0.5)`.
- Full `--deep` scan, everything measured:
  `total = round(0.35 × SAFE + 0.25 × RUNS + 0.25 × HONEST + 0.15 × CLEAN)`.

### The liar cap

If any documented claim is **verified false** (a receipt with verdict
`failed` — "14 tests pass" when 3 do), the total is capped at **49**, below
the passing threshold, no matter how clean everything else is. A repo caught
lying does not get a passing trust score. The report prints the cap notice
and the JSON report sets `liarCapApplied: true`.

## Migrating from rubric v3

Rubric v4 adds two SAFE rules for the agent-configuration threat surface:
`safe/prompt-injection` and `safe/mcp-config` (see above). Both are
file-scope, so they also run in the inline guard (`umbra guard` / `protect`
hooks) when an agent edits its own config. Consequences:

- **Repos with agent config may score lower.** Hidden directives in
  instruction files, unpinned MCP servers, and literal secrets in MCP configs
  now deduct from SAFE where v3 saw nothing.
- **Repos without agent config are unchanged.** No existing rule, weight, or
  threshold moved; a repo with no instruction files or MCP configs gets the
  identical v3 score.

## Migrating from rubric v2

Rubric v3 introduces the per-rule deduction ceiling and a precision layer:
SAFE rules suppress non-production paths (above), and `clean/dead-exports`
both stops flagging entry points, framework-convention files, configs, tests,
type declarations, scripts, and a library's declared public API (package.json
`main`/`exports` entry points and the barrel files that re-export them) and
reports its remaining findings as low-confidence notes. Consequences:

- **Large repos score higher.** Once a rule's deductions pass 25 points, the
  excess findings no longer deduct; they are reported as `cappedFindings`.
  Test/script/prompt findings no longer count against SAFE at all, and
  dead-export hunches no longer count against CLEAN.
- **Libraries score higher.** Public API surface is no longer reported as
  dead exports.
- **Small repos are mostly unchanged.** If no rule exceeded 25 points of
  deductions and no finding was in a non-production path, the v3 score is
  identical to v2 — except that dead-export findings moved from scored
  (1.5 points each) to notes, which can raise CLEAN slightly.

## Migrating from rubric v1

Rubric v1 (Umbra ≤ 0.2.x) weighted SAFE 50% / CLEAN 30% and reserved RUNS and
HONEST at 10% each, unmeasured. Rubric v2 rebalances to the full four-axis
rubric above. Consequences:

- **Fast-scan scores shift.** The renormalized static total is now
  `(0.35 × SAFE + 0.15 × CLEAN) / 0.5` instead of `(0.5 × SAFE + 0.3 × CLEAN) / 0.8`.
  SAFE now dominates more heavily, so repos with security findings score
  lower than they did under v1; repos whose only findings are CLEAN score
  higher.
- **`--deep` scores are not comparable to v1 scores at all** — they include
  two axes v1 never measured.

Scores from different rubric versions should never be compared directly.
Every report prints the rubric version it was computed with.

## Exit codes

`umbra <path>` exits with code **1** when the total score is below **50**, so
CI pipelines can gate on it. Otherwise exit code 0.
