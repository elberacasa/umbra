# Umbra Scoring Rubric — v1

Umbra's score is deterministic: the same repo always produces the same score.
The rubric is versioned (`RUBRIC_VERSION = 1` in `src/score/score.ts`) so scores
stay comparable over time.

## Axes and weights

| Axis | Weight | Measured in v0.1? |
|------|--------|-------------------|
| SAFE | 50% | yes |
| CLEAN | 30% | yes |
| RUNS | 10% | no (reserved) |
| HONEST | 10% | no (reserved) |

RUNS and HONEST require a sandbox and claim-replay respectively; in v0.1 the
total is computed over the measured axes only (SAFE and CLEAN), renormalized to
0–100. Every report states this explicitly.

## Per-axis scoring

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

## Total

```
total = round( Σ(axis_score × axis_weight) / Σ(measured axis weights) )
```

For v0.1: `total = round((0.5 × SAFE + 0.3 × CLEAN) / 0.8)`.

## Exit codes

`umbra <path>` exits with code **1** when the total score is below **50**, so
CI pipelines can gate on it. Otherwise exit code 0.
