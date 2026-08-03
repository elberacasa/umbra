/** Pure scoring for the RUNS axis. Deterministic: same outcome → same score. */

export type RunOutcome =
  | { kind: 'build-failed' }
  | { kind: 'boot-failed' }
  | { kind: 'booted-no-response' }
  | { kind: 'responded' };

/**
 * Score bands, per the v0.3 spec:
 * - build fails            → 0-20  (we use 10)
 * - boots but no response  → 50
 * - responds over HTTP     → 100
 * Boot failure after a successful build (process crashes) sits between the
 * first two bands at 25: the artifact built, but the app does not stay up.
 */
export function scoreOutcome(outcome: RunOutcome): number {
  switch (outcome.kind) {
    case 'build-failed':
      return 10;
    case 'boot-failed':
      return 25;
    case 'booted-no-response':
      return 50;
    case 'responded':
      return 100;
  }
}

export function statusForScore(score: number): 'pass' | 'fail' {
  return score >= 50 ? 'pass' : 'fail';
}
