import type { Finding } from '../engine/types.js';

/**
 * 'applied' — a provably-safe transform was written (or, in dry-run, would be).
 * 'manual'  — no provably-safe transform exists; a human/agent must fix it.
 * 'skipped' — nothing to do (already fixed, or the target vanished).
 */
export type FixStatus = 'applied' | 'manual' | 'skipped';

export interface FixOutcome {
  status: FixStatus;
  description: string;
}

/** A fix outcome paired with the finding it addresses. */
export interface FindingFix extends FixOutcome {
  finding: Finding;
}

export interface FixReport {
  applied: FindingFix[];
  manual: FindingFix[];
  skipped: FindingFix[];
}
