import { promises as fs } from 'node:fs';
import path from 'node:path';
import { walkRepo } from '../../engine/walker.js';
import { extractClaims } from './claims.js';
import { runDockerSandbox } from './sandbox.js';
import { verifyClaims, type PackageScripts } from './verify.js';
import type {
  AxisEvidence,
  AxisReport,
  Claim,
  ClaimReceipt,
  MeasureHonestOptions,
  SandboxRunResult,
} from './types.js';

export type {
  AxisEvidence,
  AxisReport,
  Claim,
  ClaimKind,
  ClaimReceipt,
  MeasureHonestOptions,
  ReceiptVerdict,
  SandboxRunner,
} from './types.js';
export { extractClaims } from './claims.js';
export { parseTestResults } from './parse.js';
export { runDockerSandbox } from './sandbox.js';
export { verifyClaims } from './verify.js';

const DEFAULT_TIMEOUT_MS = 120_000;
/** A lie about tests/builds is the core sin: -25 per failed claim. */
const FAILED_CLAIM_DEDUCTION = 25;

const DEFAULT_TEST_SCRIPT_RE = /no test specified/i;

async function readPackageScripts(root: string): Promise<PackageScripts> {
  let pkg: { scripts?: Record<string, string> };
  try {
    pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  } catch {
    return { hasTestScript: false, hasBuildScript: false };
  }
  const scripts = pkg.scripts ?? {};
  return {
    hasTestScript: typeof scripts.test === 'string' && !DEFAULT_TEST_SCRIPT_RE.test(scripts.test),
    hasBuildScript: typeof scripts.build === 'string',
  };
}

function needsSandbox(claims: Claim[], scripts: PackageScripts): boolean {
  return claims.some(
    (c) =>
      ((c.kind === 'test-count' || c.kind === 'all-tests') && scripts.hasTestScript) ||
      (c.kind === 'build' && scripts.hasBuildScript),
  );
}

function describeReceipt(r: ClaimReceipt): string {
  const where = `${r.claim.file}:${r.claim.line}`;
  switch (r.verdict) {
    case 'verified':
      return `Claim "${r.claim.text}" (${where}) — VERIFIED (${r.actual})`;
    case 'failed':
      return `Claim "${r.claim.text}" (${where}) — FAILED (actually: ${r.actual})`;
    case 'unverifiable':
      return `Claim "${r.claim.text}" (${where}) — could not be verified`;
  }
}

export async function measureHonest(
  root: string,
  opts: MeasureHonestOptions = {},
): Promise<AxisReport> {
  const start = Date.now();
  const details: string[] = [];
  const evidence: AxisEvidence[] = [];
  let receipts: ClaimReceipt[] = [];
  let score = 100;
  let status: AxisReport['status'] = 'skipped';

  const files = await walkRepo(root);
  const claims = extractClaims(files);
  const verifiable = claims.filter((c) => c.kind !== 'vague');
  const vague = claims.filter((c) => c.kind === 'vague');

  for (const claim of vague) {
    details.push(`Note: vague claim "${claim.text}" (${claim.file}:${claim.line}) — not scored`);
  }

  if (verifiable.length === 0) {
    details.push('No verifiable claims found in markdown or agent artifacts');
    return { axis: 'HONEST', score, status, details, evidence, receipts, durationMs: Date.now() - start };
  }

  const scripts = await readPackageScripts(root);
  let run: SandboxRunResult;

  if (!needsSandbox(verifiable, scripts)) {
    run = { sandboxOk: false, reason: 'no-runnable-scripts' };
    details.push('Claims found, but package.json has no usable test/build script to check them against');
  } else if (opts.runner) {
    run = await opts.runner(root, {
      runTest: scripts.hasTestScript,
      runBuild: scripts.hasBuildScript,
      timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
  } else {
    run = await runDockerSandbox(root, {
      runTest: scripts.hasTestScript,
      runBuild: scripts.hasBuildScript,
      timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
  }

  if (!run.sandboxOk) {
    const why =
      run.reason === 'docker-unavailable'
        ? 'Docker is not available — claims left unverified'
        : run.reason === 'install-failed'
          ? 'Dependency install failed inside the sandbox — claims left unverified'
          : 'Sandbox could not run — claims left unverified';
    details.push(why);
    if (run.detail) details.push(run.detail);
    receipts = verifiable.map((claim) => ({ claim, verdict: 'unverifiable' }));
  } else {
    receipts = verifyClaims(verifiable, run, scripts);
  }

  const failedCount = receipts.filter((r) => r.verdict === 'failed').length;
  const verifiedCount = receipts.filter((r) => r.verdict === 'verified').length;
  score = Math.max(0, 100 - FAILED_CLAIM_DEDUCTION * failedCount);
  status = failedCount > 0 ? 'fail' : verifiedCount > 0 ? 'pass' : 'skipped';

  for (const receipt of receipts) {
    if (receipt.verdict === 'unverifiable') {
      details.push(describeReceipt(receipt));
    } else {
      evidence.push({
        message: describeReceipt(receipt),
        file: receipt.claim.file,
        line: receipt.claim.line,
      });
    }
  }
  details.push(
    `${receipts.length} verifiable claims: ${verifiedCount} verified, ${failedCount} failed, ` +
      `${receipts.length - verifiedCount - failedCount} unverifiable`,
  );

  return { axis: 'HONEST', score, status, details, evidence, receipts, durationMs: Date.now() - start };
}
