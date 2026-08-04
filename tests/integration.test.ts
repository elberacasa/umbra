import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { execute } from '../src/cli';
import type { JsonReport } from '../src/report';
import { fixturePath, stubResolver } from './helpers';

// These tests run the real Docker sandbox end to end. Docker is expected on
// dev/CI machines; where it is missing we skip loudly rather than fake a pass.
const dockerAvailable = (() => {
  try {
    execFileSync('docker', ['version', '--format', '{{.Server.Version}}'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
})();
if (!dockerAvailable) {
  console.warn('[integration.test] Docker daemon unavailable — skipping --deep integration tests');
}

describe.skipIf(!dockerAvailable)('execute --deep (real Docker sandbox)', () => {
  it(
    'fixtures/runnable-app: RUNS verifies 100 — builds, boots, responds',
    { timeout: 300_000 },
    async () => {
      // Assert on the structured report, not rendered text — the text renderer
      // injects ANSI codes when color is forced (e.g. GitHub Actions).
      const { output, exitCode } = await execute(fixturePath('runnable-app'), {
        deep: true,
        json: true,
        scanOptions: { resolvePackage: stubResolver },
      });
      const report = JSON.parse(output) as JsonReport;

      expect(report.axisReports).toBeDefined();
      const runs = report.axisReports?.find((r) => r.axis === 'RUNS');
      expect(runs, `\nRUNS details:\n${runs?.details.join('\n')}`).toMatchObject({
        status: 'pass',
        score: 100,
      });
      // No verifiable claims in this fixture — HONEST is skipped, never punished.
      const honest = report.axisReports?.find((r) => r.axis === 'HONEST');
      expect(honest).toMatchObject({ status: 'skipped', score: 100 });
      expect(exitCode).toBe(0);
    },
  );

  it(
    'fixtures/claims-app: HONEST catches the "14 tests pass" lie (3 do) and the broken build',
    { timeout: 300_000 },
    async () => {
      const { output } = await execute(fixturePath('claims-app'), {
        deep: true,
        json: true,
        scanOptions: { resolvePackage: stubResolver },
      });
      const report = JSON.parse(output) as JsonReport;

      expect(report.axisReports).toBeDefined();
      const honest = report.axisReports?.find((r) => r.axis === 'HONEST');
      // On failure, narrate why — the details carry the sandbox's output tail.
      const diag = `\nHONEST details:\n${honest?.details.join('\n')}`;
      expect(honest, diag).toMatchObject({ status: 'fail', score: 50 });

      const testClaim = honest?.receipts?.find((r) => r.claim.kind === 'test-count');
      expect(testClaim, diag).toMatchObject({
        verdict: 'failed',
        actual: '3 tests pass, 0 fail',
      });
      expect(testClaim?.claim).toMatchObject({ text: '14 tests pass', file: 'README.md' });

      const buildClaim = honest?.receipts?.find((r) => r.claim.kind === 'build');
      expect(buildClaim, diag).toMatchObject({ verdict: 'failed' });

      // HONEST joined the total; RUNS has no run path in this fixture and is excluded.
      expect(report.measuredAxes).toContain('HONEST');
      expect(report.unmeasuredAxes).toEqual(['RUNS']);
    },
  );

  it(
    'fast scan leaves axisReports out of the JSON report',
    { timeout: 60_000 },
    async () => {
      const { output } = await execute(fixturePath('claims-app'), {
        json: true,
        scanOptions: { resolvePackage: stubResolver },
      });
      const report = JSON.parse(output) as JsonReport;
      expect(report.axisReports).toBeUndefined();
      expect(report.measuredAxes).toEqual(['SAFE', 'CLEAN']);
      expect(report.unmeasuredAxes).toEqual(['RUNS', 'HONEST']);
    },
  );
});