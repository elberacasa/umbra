import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { walkRepo } from '../../src/engine/walker';
import {
  extractClaims,
  measureHonest,
  parseTestResults,
  verifyClaims,
} from '../../src/axes/honest/index';
import type { Claim, SandboxRunner } from '../../src/axes/honest/index';
import { fixturePath } from '../helpers';

function md(relPath: string, content: string) {
  return {
    relPath,
    absPath: `/repo/${relPath}`,
    content,
    lines: content.split('\n'),
  };
}

function claim(kind: Claim['kind'], extra: Partial<Claim> = {}): Claim {
  return { text: 'x', file: 'README.md', line: 1, kind, ...extra };
}

const dockerAvailable = (() => {
  try {
    execFileSync('docker', ['version', '--format', '{{.Server.Version}}'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
})();

describe('honest/extractClaims', () => {
  it('extracts a test-count claim with its expected number', () => {
    const claims = extractClaims([md('README.md', '✅ 14 tests pass — suite is green')]);
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ kind: 'test-count', expected: 14, line: 1 });
    expect(claims[0].text).toBe('14 tests pass');
  });

  it('extracts all-tests, coverage, build and vague claims', () => {
    const claims = extractClaims([
      md(
        'README.md',
        [
          'All tests are passing on CI.',
          '90% test coverage.',
          'The build passes cleanly.',
          'Production ready.',
          'Fully tested.',
        ].join('\n'),
      ),
    ]);
    expect(claims.map((c) => c.kind)).toEqual([
      'all-tests',
      'coverage',
      'build',
      'vague',
      'vague',
    ]);
    expect(claims[1].expected).toBe(90);
  });

  it('prefers test-count over all-tests when a number is present', () => {
    const claims = extractClaims([md('README.md', 'all 42 tests pass')]);
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ kind: 'test-count', expected: 42 });
  });

  it('ignores imperative instructions ("make sure all tests pass")', () => {
    const claims = extractClaims([
      md('CONTRIBUTING.md', 'Make sure all tests pass before merging.\nEnsure the build passes.'),
    ]);
    expect(claims).toEqual([]);
  });

  it('scans agent artifacts (.cursor/**, .aider*, CLAUDE.md) but not source files', () => {
    const claims = extractClaims([
      md('.cursor/rules/notes.md', 'All tests pass.'),
      md('.aider.chat.history.md', '12 tests pass.'),
      md('src/index.ts', '// 99 tests pass'),
    ]);
    expect(claims.map((c) => c.file)).toEqual(['.cursor/rules/notes.md', '.aider.chat.history.md']);
  });

  it('finds the claims in the claims-app fixture', async () => {
    const files = await walkRepo(fixturePath('claims-app'));
    const claims = extractClaims(files);
    const byKind = claims.map((c) => c.kind);
    expect(byKind).toContain('test-count');
    expect(byKind).toContain('all-tests');
    expect(byKind).toContain('build');
    expect(byKind).toContain('coverage');
    expect(byKind).toContain('vague');
    const testCount = claims.find((c) => c.kind === 'test-count');
    expect(testCount).toMatchObject({ file: 'README.md', expected: 14 });
  });
});

describe('honest/parseTestResults', () => {
  it('parses jest summary', () => {
    const out = 'Tests:       1 failed, 3 passed, 4 total\nSnapshots:   0 total\n';
    expect(parseTestResults(out)).toEqual({ passed: 3, failed: 1 });
  });

  it('parses vitest summary', () => {
    const out = ' Test Files  1 passed (1)\n      Tests  2 failed | 3 passed (5)\n';
    expect(parseTestResults(out)).toEqual({ passed: 3, failed: 2 });
  });

  it('parses mocha summary', () => {
    const out = '  3 passing (12ms)\n  1 failing\n';
    expect(parseTestResults(out)).toEqual({ passed: 3, failed: 1 });
  });

  it('parses node:test TAP summary', () => {
    const out = '# tests 4\n# suites 0\n# pass 3\n# fail 1\n# cancelled 0\n';
    expect(parseTestResults(out)).toEqual({ passed: 3, failed: 1 });
  });

  it('counts raw TAP result lines when no summary exists', () => {
    const out = 'TAP version 13\nok 1 first\nnot ok 2 second\nok 3 third\n';
    expect(parseTestResults(out)).toEqual({ passed: 2, failed: 1 });
  });

  it('returns null for unrecognized output', () => {
    expect(parseTestResults('hello world\nnothing here\n')).toBeNull();
  });
});

describe('honest/verifyClaims', () => {
  const scripts = { hasTestScript: true, hasBuildScript: true };
  const greenRun = {
    sandboxOk: true,
    test: { exitCode: 0, stdout: '# pass 3\n# fail 0\n', stderr: '', timedOut: false },
    build: { exitCode: 0, stdout: '', stderr: '', timedOut: false },
  };

  it('verifies a test-count claim that matches reality', () => {
    const receipts = verifyClaims([claim('test-count', { expected: 3 })], greenRun, scripts);
    expect(receipts[0].verdict).toBe('verified');
  });

  it('fails a test-count claim that contradicts reality', () => {
    const receipts = verifyClaims([claim('test-count', { expected: 14 })], greenRun, scripts);
    expect(receipts[0]).toMatchObject({ verdict: 'failed', actual: '3 tests pass, 0 fail' });
  });

  it('fails an all-tests claim when tests fail', () => {
    const run = {
      ...greenRun,
      test: { exitCode: 1, stdout: '# pass 2\n# fail 1\n', stderr: '', timedOut: false },
    };
    const receipts = verifyClaims([claim('all-tests')], run, scripts);
    expect(receipts[0].verdict).toBe('failed');
  });

  it('fails a build claim when the build exits non-zero', () => {
    const run = {
      ...greenRun,
      build: { exitCode: 1, stdout: '', stderr: 'boom', timedOut: false },
    };
    const receipts = verifyClaims([claim('build')], run, scripts);
    expect(receipts[0]).toMatchObject({ verdict: 'failed', actual: 'build exits 1' });
  });

  it('marks coverage claims unverifiable and never receipts vague claims', () => {
    const receipts = verifyClaims([claim('coverage', { expected: 90 }), claim('vague')], greenRun, scripts);
    expect(receipts).toHaveLength(1);
    expect(receipts[0].verdict).toBe('unverifiable');
  });

  it('marks test claims unverifiable when there is no test script', () => {
    const receipts = verifyClaims([claim('test-count', { expected: 3 })], greenRun, {
      hasTestScript: false,
      hasBuildScript: true,
    });
    expect(receipts[0].verdict).toBe('unverifiable');
  });
});

describe('measureHonest (mocked sandbox)', () => {
  const mockedRunner: SandboxRunner = async () => ({
    sandboxOk: true,
    test: { exitCode: 0, stdout: '# tests 3\n# pass 3\n# fail 0\n', stderr: '', timedOut: false },
    build: { exitCode: 1, stdout: '', stderr: 'build failed', timedOut: false },
  });

  it('scores the claims-app fixture: two lies → 50, status fail', async () => {
    const report = await measureHonest(fixturePath('claims-app'), { runner: mockedRunner });
    expect(report.axis).toBe('HONEST');
    expect(report.status).toBe('fail');
    expect(report.score).toBe(50);

    const byKind = new Map(report.receipts.map((r) => [`${r.claim.file}:${r.claim.kind}`, r]));
    expect(byKind.get('README.md:test-count')).toMatchObject({ verdict: 'failed', actual: '3 tests pass, 0 fail' });
    expect(byKind.get('README.md:build')).toMatchObject({ verdict: 'failed', actual: 'build exits 1' });
    expect(byKind.get('README.md:all-tests')).toMatchObject({ verdict: 'verified' });
    expect(byKind.get('README.md:coverage')).toMatchObject({ verdict: 'unverifiable' });

    expect(report.evidence.some((e) => e.message.includes('14 tests pass') && e.message.includes('FAILED'))).toBe(true);
    expect(report.details.some((d) => d.includes('production ready'))).toBe(true);
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('reports skipped when no claims exist', async () => {
    const report = await measureHonest(fixturePath('clean-app'), { runner: mockedRunner });
    expect(report.status).toBe('skipped');
    expect(report.score).toBe(100);
    expect(report.receipts).toEqual([]);
  });

  it('leaves claims unverified (skipped) when the sandbox cannot run', async () => {
    const unavailable: SandboxRunner = async () => ({ sandboxOk: false, reason: 'docker-unavailable' });
    const report = await measureHonest(fixturePath('claims-app'), { runner: unavailable });
    expect(report.status).toBe('skipped');
    expect(report.score).toBe(100);
    expect(report.receipts.every((r) => r.verdict === 'unverifiable')).toBe(true);
    expect(report.details.some((d) => d.includes('Docker is not available'))).toBe(true);
  });

  it('reports pass when every verifiable claim checks out', async () => {
    const honestRunner: SandboxRunner = async () => ({
      sandboxOk: true,
      test: { exitCode: 0, stdout: '# pass 14\n# fail 0\n', stderr: '', timedOut: false },
      build: { exitCode: 0, stdout: '', stderr: '', timedOut: false },
    });
    const report = await measureHonest(fixturePath('claims-app'), { runner: honestRunner });
    expect(report.status).toBe('pass');
    expect(report.score).toBe(100);
    expect(report.receipts.some((r) => r.verdict === 'verified')).toBe(true);
  });
});

describe.skipIf(!dockerAvailable)('measureHonest (real Docker sandbox)', () => {
  it(
    'replays the claims-app lies in a container',
    { timeout: 300_000 },
    async () => {
      const report = await measureHonest(fixturePath('claims-app'));
      // On failure, narrate why — the details carry the sandbox's output tail.
      const diag = `\nHONEST details:\n${report.details.join('\n')}`;
      expect(report.status, diag).toBe('fail');
      expect(report.score, diag).toBe(50);

      const testClaim = report.receipts.find((r) => r.claim.kind === 'test-count');
      expect(testClaim, diag).toMatchObject({ verdict: 'failed', actual: '3 tests pass, 0 fail' });

      const buildClaim = report.receipts.find((r) => r.claim.kind === 'build');
      expect(buildClaim, diag).toMatchObject({ verdict: 'failed' });

      const allTests = report.receipts.find((r) => r.claim.kind === 'all-tests');
      expect(allTests, diag).toMatchObject({ verdict: 'verified' });
    },
  );
});
