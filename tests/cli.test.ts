import { describe, expect, it } from 'vitest';
import { execute } from '../src/cli';
import type { JsonReport } from '../src/report';
import { fixturePath, stubResolver } from './helpers';

describe('CLI smoke', () => {
  it('prints a verdict block with score, axes, findings, and badge', async () => {
    const { output, exitCode } = await execute(fixturePath('bad-app'), {
      scanOptions: { resolvePackage: stubResolver },
    });
    expect(output).toMatch(/UMBRA TRUST SCORE: \d+\/100/);
    expect(output).toContain('SAFE');
    expect(output).toContain('CLEAN');
    expect(output).toContain('not yet measured');
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
    expect(report.rubricVersion).toBe(1);
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
});
