import { afterEach, describe, expect, it, vi } from 'vitest';
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execute } from '../src/cli';
import { runScan } from '../src/engine/runner';
import type { Finding } from '../src/engine/types';
import { allRules } from '../src/rules/index';
import { BASELINE_FILENAME, loadBaseline, writeBaseline } from '../src/baseline';
import type { BaselineFile } from '../src/baseline';
import { computeScore, fingerprintFinding, RUBRIC_VERSION } from '../src/score/score';
import type { JsonReport } from '../src/report';
import { fixturePath, stubResolver } from './helpers';

function finding(overrides: Partial<Finding>): Finding {
  return {
    ruleId: 'test/rule',
    axis: 'SAFE',
    severity: 'high',
    confidence: 'high',
    message: 'test finding',
    file: 'src/app.ts',
    line: 10,
    ...overrides,
  };
}

function copyFixture(name: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'umbra-baseline-'));
  const dest = path.join(dir, name);
  cpSync(fixturePath(name), dest, { recursive: true });
  return dest;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fingerprintFinding', () => {
  it('is stable across line-number movement', () => {
    expect(fingerprintFinding(finding({ line: 10 }))).toBe(fingerprintFinding(finding({ line: 87 })));
    expect(fingerprintFinding(finding({ line: 10 }))).toBe(fingerprintFinding(finding({ line: undefined })));
  });

  it('normalizes message whitespace', () => {
    const a = finding({ message: 'hardcoded  secret\nin   config' });
    const b = finding({ message: 'hardcoded secret in config' });
    expect(fingerprintFinding(a)).toBe(fingerprintFinding(b));
  });

  it('changes with ruleId, file, or message', () => {
    const base = fingerprintFinding(finding({}));
    expect(fingerprintFinding(finding({ ruleId: 'test/other' }))).not.toBe(base);
    expect(fingerprintFinding(finding({ file: 'src/other.ts' }))).not.toBe(base);
    expect(fingerprintFinding(finding({ message: 'different message' }))).not.toBe(base);
  });
});

describe('computeScore with a baseline', () => {
  it('grandfathered findings do not move the score', () => {
    const findings = [finding({}), finding({ ruleId: 'test/other', severity: 'critical' })];
    const baseline = new Set(findings.map(fingerprintFinding));
    const result = computeScore(findings, [], baseline);
    expect(result.total).toBe(100);
    expect(result.baselinedCount).toBe(2);
    expect(result.newFindingsCount).toBe(0);
    expect(result.scoredFindings).toHaveLength(0);
  });

  it('new findings still move the score', () => {
    const old = finding({});
    const added = finding({ ruleId: 'test/new', severity: 'critical' });
    const withBaseline = computeScore([old, added], [], new Set([fingerprintFinding(old)]));
    const withoutBaseline = computeScore([old, added]);
    expect(withBaseline.baselinedCount).toBe(1);
    expect(withBaseline.newFindingsCount).toBe(1);
    // The baselined high finding (15 pts) is gone; only the new critical (25) deducts.
    expect(withBaseline.axes.find((a) => a.axis === 'SAFE')?.score).toBe(75);
    expect(withBaseline.total).toBeGreaterThan(withoutBaseline.total);
  });

  it('is a no-op without a baseline', () => {
    const result = computeScore([finding({})]);
    expect(result.baselinedCount).toBe(0);
    expect(result.newFindingsCount).toBe(1);
  });

  it('is a no-op with an empty baseline', () => {
    const findings = [finding({})];
    const withEmpty = computeScore(findings, [], new Set());
    const without = computeScore(findings);
    expect(withEmpty.total).toBe(without.total);
    expect(withEmpty.baselinedCount).toBe(0);
    expect(withEmpty.newFindingsCount).toBe(1);
  });
});

describe('loadBaseline', () => {
  it('returns none when auto-detect finds no file', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'umbra-baseline-'));
    expect(loadBaseline(path.join(dir, BASELINE_FILENAME)).status).toBe('none');
  });

  it('warns when an explicit path does not exist', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'umbra-baseline-'));
    const result = loadBaseline(path.join(dir, 'missing.json'), { explicit: true });
    expect(result.status).toBe('ignored');
    expect(result.status === 'ignored' && result.warning).toContain('not found');
  });

  it('warns and ignores a baseline from a different rubric version', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'umbra-baseline-'));
    const p = path.join(dir, BASELINE_FILENAME);
    const stale: BaselineFile = {
      version: 1,
      createdAt: new Date().toISOString(),
      rubricVersion: RUBRIC_VERSION - 1,
      findings: [{ fingerprint: fingerprintFinding(finding({})), ruleId: 'test/rule', file: 'src/app.ts' }],
    };
    writeFileSync(p, JSON.stringify(stale), 'utf8');
    const result = loadBaseline(p);
    expect(result.status).toBe('ignored');
    expect(result.status === 'ignored' && result.warning).toContain('rubric');
  });

  it('warns and ignores corrupted JSON', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'umbra-baseline-'));
    const p = path.join(dir, BASELINE_FILENAME);
    writeFileSync(p, '{ not json', 'utf8');
    const result = loadBaseline(p);
    expect(result.status).toBe('ignored');
    expect(result.status === 'ignored' && result.warning).toContain('not valid JSON');
  });

  it('warns and ignores a file with the wrong shape', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'umbra-baseline-'));
    const p = path.join(dir, BASELINE_FILENAME);
    writeFileSync(p, JSON.stringify({ version: 2, findings: 'nope' }), 'utf8');
    expect(loadBaseline(p).status).toBe('ignored');
  });
});

describe('execute with baselines', () => {
  it('--baseline-write snapshots findings, then a rescan grandfathers them all', async () => {
    const repo = copyFixture('bad-app');
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const written = await execute(repo, { baselineWrite: true, offline: true });
    expect(existsSync(path.join(repo, BASELINE_FILENAME))).toBe(true);
    expect(written.exitCode).toBe(1); // the write run itself still reports reality
    expect(stderr.mock.calls.flat().join('')).toContain('grandfathered');

    const rescan = await execute(repo, { offline: true });
    expect(rescan.exitCode).toBe(0);
    expect(rescan.output).toMatch(/baseline: \d+ existing findings grandfathered \(0 new\)/);
    expect(rescan.output).toContain('UMBRA TRUST SCORE: 100/100');
  });

  it('a new finding after baselining is flagged and fails the gate', async () => {
    const repo = copyFixture('bad-app');
    await execute(repo, { baselineWrite: true, offline: true });

    // One new file, several distinct rules — enough new deductions to fail.
    writeFileSync(
      path.join(repo, 'lib', 'new-danger.ts'),
      [
        "import cors from 'cors';",
        "import express from 'express';",
        "import jwt from 'jsonwebtoken';",
        '',
        'const app = express();',
        "app.use(cors({ origin: '*', credentials: true }));",
        '',
        "export const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJvbGUiOiJzZXJ2aWNlX3JvbGUiLCJpYXQiOjE3MDAwMDAwMDAsImV4cCI6MTkwMDAwMDAwMH0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5c';",
        '',
        'export function run(script: string) {',
        '  return eval(script);',
        '}',
        '',
        'export function verify(token: string) {',
        "  return jwt.verify(token, 'secret', { algorithms: ['none', 'HS256'] });",
        '}',
        '',
        'app.listen(3000);',
        '',
      ].join('\n'),
      'utf8',
    );
    const rescan = await execute(repo, { offline: true });
    expect(rescan.exitCode).toBe(1);
    expect(rescan.output).toMatch(/baseline: \d+ existing findings grandfathered \([1-9]\d* new\)/);
    expect(rescan.output).toContain('new-danger.ts');
  });

  it('line drift does not resurrect a baselined finding', async () => {
    const repo = copyFixture('bad-app');
    await execute(repo, { baselineWrite: true, offline: true });

    // Prepend a line to a file with known findings: every finding in it moves
    // down one line, but fingerprints exclude line numbers.
    const target = path.join(repo, 'lib', 'db.ts');
    writeFileSync(target, `// comment added after baselining\n${readFileSync(target, 'utf8')}`, 'utf8');
    const rescan = await execute(repo, { offline: true });
    expect(rescan.output).toMatch(/baseline: \d+ existing findings grandfathered \(0 new\)/);
    expect(rescan.exitCode).toBe(0);
  });

  it('--baseline write is shorthand for --baseline-write', async () => {
    const repo = copyFixture('bad-app');
    await execute(repo, { baseline: 'write', offline: true });
    expect(existsSync(path.join(repo, BASELINE_FILENAME))).toBe(true);
  });

  it('--baseline <path> loads an explicit baseline outside the repo', async () => {
    const repo = copyFixture('bad-app');
    const scan = await runScan(repo, allRules, { resolvePackage: async () => 'unknown' });
    expect(scan.findings.length).toBeGreaterThan(0);
    const file: BaselineFile = {
      version: 1,
      createdAt: new Date().toISOString(),
      rubricVersion: RUBRIC_VERSION,
      findings: scan.findings.map((f) => ({
        fingerprint: fingerprintFinding(f),
        ruleId: f.ruleId,
        ...(f.file !== undefined ? { file: f.file } : {}),
      })),
    };
    const elsewhere = mkdtempSync(path.join(tmpdir(), 'umbra-baseline-explicit-'));
    const baselinePath = path.join(elsewhere, 'my-baseline.json');
    writeFileSync(baselinePath, JSON.stringify(file), 'utf8');

    const result = await execute(repo, { baseline: baselinePath, offline: true });
    expect(result.exitCode).toBe(0);
    expect(result.output).toMatch(/baseline: \d+ existing findings grandfathered \(0 new\)/);
  });

  it('a stale-rubric baseline is ignored with a stderr warning', async () => {
    const repo = copyFixture('bad-app');
    await execute(repo, { baselineWrite: true, offline: true });
    const p = path.join(repo, BASELINE_FILENAME);
    const parsed = JSON.parse(readFileSync(p, 'utf8')) as BaselineFile;
    writeFileSync(p, JSON.stringify({ ...parsed, rubricVersion: RUBRIC_VERSION - 1 }), 'utf8');

    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const result = await execute(repo, { offline: true });
    expect(stderr.mock.calls.flat().join('')).toContain('rubric');
    expect(result.exitCode).toBe(1); // unfiltered: bad-app fails the gate again
    expect(result.output).not.toContain('grandfathered');
  });

  it('a corrupted baseline is ignored with a stderr warning', async () => {
    const repo = copyFixture('bad-app');
    writeFileSync(path.join(repo, BASELINE_FILENAME), 'not json at all', 'utf8');
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const result = await execute(repo, { offline: true });
    expect(stderr.mock.calls.flat().join('')).toContain('not valid JSON');
    expect(result.exitCode).toBe(1);
  });

  it('--baseline-write overwrites an existing baseline with a note', async () => {
    const repo = copyFixture('bad-app');
    await execute(repo, { baselineWrite: true, offline: true });
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await execute(repo, { baselineWrite: true, offline: true });
    expect(stderr.mock.calls.flat().join('')).toContain('overwrote');
  });

  it('--json gains baselinedCount, newFindingsCount, and a per-finding baselined flag', async () => {
    const repo = copyFixture('bad-app');
    await execute(repo, { baselineWrite: true, offline: true });
    writeFileSync(
      path.join(repo, 'lib', 'new-danger.ts'),
      'export function run(script: string) {\n  return eval(script);\n}\n',
      'utf8',
    );

    const { output } = await execute(repo, { json: true, offline: true });
    const report = JSON.parse(output) as JsonReport;
    expect(report.baselinedCount).toBeGreaterThan(0);
    expect(report.newFindingsCount).toBeGreaterThan(0);
    expect(report.baselinedCount + report.newFindingsCount).toBe(report.findings.length + report.notes.length);
    const baselined = report.findings.filter((f) => f.baselined);
    const fresh = report.findings.filter((f) => !f.baselined);
    expect(baselined.length).toBeGreaterThan(0);
    expect(fresh.some((f) => f.file === 'lib/new-danger.ts')).toBe(true);
    expect(fresh.every((f) => f.file === 'lib/new-danger.ts')).toBe(true);
  });

  it('--json without a baseline reports zero baselined and flags nothing', async () => {
    const { output } = await execute(fixturePath('bad-app'), {
      json: true,
      scanOptions: { resolvePackage: stubResolver },
    });
    const report = JSON.parse(output) as JsonReport;
    expect(report.baselinedCount).toBe(0);
    expect(report.newFindingsCount).toBe(report.findings.length + report.notes.length);
    expect(report.findings.every((f) => f.baselined === false)).toBe(true);
    expect(report.notes.every((f) => f.baselined === false)).toBe(true);
  });
});
