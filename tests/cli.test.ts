import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { execute } from '../src/cli';
import type { JsonReport } from '../src/report';
import { fixturePath, stubResolver } from './helpers';

const execFileAsync = promisify(execFile);

describe('CLI smoke', () => {
  it('prints a verdict block with score, axes, findings, and badge', async () => {
    const { output, exitCode } = await execute(fixturePath('bad-app'), {
      scanOptions: { resolvePackage: stubResolver },
    });
    expect(output).toMatch(/UMBRA TRUST SCORE: \d+\/100/);
    expect(output).toContain('SAFE');
    expect(output).toContain('CLEAN');
    expect(output).toContain('not measured — run with --deep');
    expect(output).toContain('Top findings:');
    expect(output).toContain('img.shields.io/badge/Umbra_Trust_Score');
    expect(exitCode).toBe(1); // bad fixture scores below 50
  });

  it('emits well-formed JSON with --json', async () => {
    const { output } = await execute(fixturePath('bad-app'), {
      json: true,
      scanOptions: { resolvePackage: stubResolver },
    });
    const report = JSON.parse(output) as JsonReport;
    expect(report.rubricVersion).toBe(2);
    expect(report.score).toBeGreaterThanOrEqual(0);
    expect(report.score).toBeLessThan(50);
    expect(report.measuredAxes).toEqual(['SAFE', 'CLEAN']);
    expect(report.unmeasuredAxes).toEqual(['RUNS', 'HONEST']);
    expect(report.findings.length).toBeGreaterThan(0);
    expect(report.findings.every((f) => f.confidence !== 'low')).toBe(true);
    expect(report.notes.every((f) => f.confidence === 'low')).toBe(true);
    expect(report.badge).toContain('shields.io');
  });

  it('scores the clean fixture high and exits 0', async () => {
    const { output, exitCode } = await execute(fixturePath('clean-app'), {
      scanOptions: { resolvePackage: stubResolver },
    });
    expect(output).toMatch(/UMBRA TRUST SCORE: 100\/100/);
    expect(exitCode).toBe(0);
  });

  it('offline mode never flags dependencies', async () => {
    const { output } = await execute(fixturePath('bad-app'), { json: true, offline: true });
    const report = JSON.parse(output) as JsonReport;
    expect(report.findings.some((f) => f.ruleId === 'safe/hallucinated-deps' && f.confidence === 'high')).toBe(false);
  });

  it('runs when invoked through a symlink (the npx contract)', async () => {
    // npx/bin installs invoke dist/cli.js via a symlink in node_modules/.bin.
    // The direct-invocation guard in cli.ts must resolve that symlink or the
    // CLI silently exits 0 with no output (regression: v0.2.0).
    const built = path.resolve(__dirname, '..', 'dist', 'cli.js');
    if (!existsSync(built)) {
      throw new Error('dist/cli.js missing — run `npm run build` before `npm test`');
    }
    const binDir = mkdtempSync(path.join(tmpdir(), 'umbra-bin-'));
    const link = path.join(binDir, 'umbra');
    symlinkSync(built, link);

    let stdout = '';
    let code = 0;
    try {
      const result = await execFileAsync('node', [link, fixturePath('bad-app'), '--offline']);
      stdout = result.stdout;
      code = 0;
    } catch (error) {
      const err = error as { stdout?: string; code?: number };
      stdout = err.stdout ?? '';
      code = typeof err.code === 'number' ? err.code : -1;
    }
    expect(stdout).toMatch(/UMBRA TRUST SCORE: \d+\/100/);
    expect(code).toBe(1);
  });
});
