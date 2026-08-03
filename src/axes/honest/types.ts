// The AxisReport contract and claim types are shared across axes — see
// src/axes/types.ts. Re-exported here so the honest module's imports stay local.
export type {
  AxisEvidence,
  AxisReport,
  AxisStatus,
  Claim,
  ClaimKind,
  ClaimReceipt,
  ReceiptVerdict,
} from '../types.js';

export interface CommandResult {
  /** null when the process was killed before exiting (timeout). */
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface SandboxRunResult {
  /** false when the sandbox itself could not run (no docker, install failed). */
  sandboxOk: boolean;
  /** Why the sandbox could not run, when sandboxOk is false. */
  reason?: string;
  test?: CommandResult;
  build?: CommandResult;
}

export interface SandboxRequest {
  runTest: boolean;
  runBuild: boolean;
  timeoutMs: number;
}

/** Injectable so unit tests never touch Docker. */
export type SandboxRunner = (root: string, req: SandboxRequest) => Promise<SandboxRunResult>;

export interface MeasureHonestOptions {
  /** Defaults to the Docker sandbox runner. */
  runner?: SandboxRunner;
  /** Per-command timeout inside the sandbox. Default 120_000 ms. */
  timeoutMs?: number;
}
