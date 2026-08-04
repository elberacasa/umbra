/** Contextual next-step suggestions printed after a scan (TTY only). */
import type { ScoreResult } from './score/score.js';

export interface NextStepContext {
  deep?: boolean;
  report?: boolean;
}

/**
 * At most two suggestions, ordered by value. The rules: never suggest what
 * already ran, never suggest more than the user can act on, and a passing
 * repo gets the "keep it green" path instead of remediation noise.
 */
export function nextSteps(score: ScoreResult, ctx: NextStepContext = {}): string[] {
  const steps: string[] = [];

  if (score.scoredFindings.length > 0 && ctx.report !== true) {
    steps.push('get an agent-actionable fix list: `npx umbra-scan --report` writes UMBRA.md');
  }
  if (ctx.deep !== true && score.scoredFindings.length > 0) {
    steps.push('verify the app actually runs and the README is honest: `npx umbra-scan --deep`');
  }
  if (score.total >= 80) {
    steps.push('keep it green: `npx umbra-scan --setup` installs the pre-commit gate and agent guardrails');
  } else if (steps.length < 2) {
    steps.push('stop regressions at the source: `npx umbra-scan --setup`');
  }

  return steps.slice(0, 2);
}
