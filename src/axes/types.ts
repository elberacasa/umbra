/**
 * Shared report contract for the sandboxed axes (RUNS, HONEST).
 * Both axes produce the same shape so the scorer and the report renderer can
 * treat them uniformly. There is exactly one AxisReport definition — here.
 */
import type { Axis } from '../engine/types.js';

export type AxisStatus = 'pass' | 'fail' | 'skipped';

export interface AxisEvidence {
  message: string;
  file?: string;
  line?: number;
}

export type ClaimKind = 'test-count' | 'all-tests' | 'coverage' | 'build' | 'vague';

export interface Claim {
  /** The exact text of the claim as written. */
  text: string;
  /** Repo-relative path of the file containing the claim. */
  file: string;
  /** 1-based line number. */
  line: number;
  kind: ClaimKind;
  /** Expected number for 'test-count' / 'coverage' claims. */
  expected?: number;
}

export type ReceiptVerdict = 'verified' | 'failed' | 'unverifiable';

export interface ClaimReceipt {
  claim: Claim;
  verdict: ReceiptVerdict;
  /** What was actually observed, e.g. "3 tests pass". */
  actual?: string;
}

export interface AxisReport {
  axis: Axis;
  /** 0-100. Always 0 when status is 'skipped'. */
  score: number;
  status: AxisStatus;
  /** Human-readable narration of what was verified, in order. */
  details: string[];
  evidence: AxisEvidence[];
  durationMs: number;
  /** HONEST only: one receipt per verifiable claim (vague claims are never receipted). */
  receipts?: ClaimReceipt[];
}
