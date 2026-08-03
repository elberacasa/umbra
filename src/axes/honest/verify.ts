import { parseTestResults } from './parse.js';
import type { Claim, ClaimReceipt, SandboxRunResult } from './types.js';

export interface PackageScripts {
  hasTestScript: boolean;
  hasBuildScript: boolean;
}

/**
 * Turns claims into receipts. Neutral by default: a claim is only 'failed'
 * when observed reality directly contradicts it, and only 'verified' when it
 * directly confirms it. Anything else is 'unverifiable' and never scored.
 */
export function verifyClaims(
  claims: Claim[],
  run: SandboxRunResult,
  scripts: PackageScripts,
): ClaimReceipt[] {
  const receipts: ClaimReceipt[] = [];
  const testOutput = run.test ? `${run.test.stdout}\n${run.test.stderr}` : '';
  const results = run.test && !run.test.timedOut ? parseTestResults(testOutput) : null;

  for (const claim of claims) {
    switch (claim.kind) {
      case 'vague':
        // Never receipted — surfaced as low-stakes notes by the caller.
        break;

      case 'coverage':
        // Coverage tooling and config vary too much to measure a claimed
        // percentage reliably. Neutral.
        receipts.push({ claim, verdict: 'unverifiable' });
        break;

      case 'test-count': {
        if (!scripts.hasTestScript || !run.test || results === null) {
          receipts.push({ claim, verdict: 'unverifiable' });
          break;
        }
        const actual = `${results.passed} tests pass, ${results.failed} fail`;
        receipts.push(
          results.passed === claim.expected && results.failed === 0
            ? { claim, verdict: 'verified', actual }
            : { claim, verdict: 'failed', actual },
        );
        break;
      }

      case 'all-tests': {
        if (!scripts.hasTestScript || !run.test || results === null) {
          receipts.push({ claim, verdict: 'unverifiable' });
          break;
        }
        if (results.passed === 0 && results.failed === 0) {
          receipts.push({ claim, verdict: 'unverifiable' });
        } else if (results.failed > 0) {
          receipts.push({
            claim,
            verdict: 'failed',
            actual: `${results.passed} tests pass, ${results.failed} fail`,
          });
        } else {
          receipts.push({ claim, verdict: 'verified', actual: `${results.passed} tests pass` });
        }
        break;
      }

      case 'build': {
        if (!scripts.hasBuildScript || !run.build || run.build.timedOut) {
          receipts.push({ claim, verdict: 'unverifiable' });
          break;
        }
        receipts.push(
          run.build.exitCode === 0
            ? { claim, verdict: 'verified', actual: 'build exits 0' }
            : { claim, verdict: 'failed', actual: `build exits ${run.build.exitCode}` },
        );
        break;
      }
    }
  }

  return receipts;
}
