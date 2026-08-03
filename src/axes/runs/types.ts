/** Types for the RUNS axis (Docker sandbox verification). */

// The AxisReport contract is shared across axes — see src/axes/types.ts.
export type { AxisEvidence, AxisReport, AxisStatus } from '../types.js';

export interface ExecResult {
  /** Process exit code; -1 when the process was killed after timing out. */
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Runs the docker CLI with the given arguments. Injectable for tests. */
export type DockerExecutor = (
  args: string[],
  opts?: { timeoutMs?: number },
) => Promise<ExecResult>;

export interface MeasureRunsOptions {
  /** Wall-clock budget for the whole verification. Default 120_000. */
  timeoutMs?: number;
  /** Set false to disable Docker verification (axis reports 'skipped'). */
  docker?: boolean;
  /** Testing hook: substitute the docker CLI executor. */
  exec?: DockerExecutor;
}
