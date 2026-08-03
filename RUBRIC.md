# Umbra Scoring Rubric — v2

Umbra's score is deterministic: the same repo always produces the same score.
The rubric is versioned (`RUBRIC_VERSION = 2` in `src/score/score.ts`) so scores
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
