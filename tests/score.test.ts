import { describe, expect, it } from 'vitest';
import type { Finding } from '../src/engine/types';
import { computeScore, RUBRIC_VERSION, scoreAxis } from '../src/score/score';
import type { AxisReport } from '../src/axes/types';

function finding(overrides: Partial<Finding>): Finding {
  return {
    ruleId: 'test/rule',
    axis: 'SAFE',
    severity: 'medium',
    confidence: 'high',
    message: 'test finding',
    ...overrides,
  };
}

describe('score', () => {
  it('starts at 100 with no findings', () => {
    const result = computeScore([]);
    expect(result.total).toBe(100);
    expect(result.axes).toEqual([
      { axis: 'SAFE', score: 100, findingCount: 0 },
      { axis: 'CLEAN', score: 100, findingCount: 0 },
    ]);
    expect(result.unmeasuredAxes).toEqual(['RUNS', 'HONEST']);
    expect(result.rubricVersion).toBe(RUBRIC_VERSION);
  });

  it('deducts severity points times confidence multiplier', () => {
    expect(scoreAxis([finding({ severity: 'critical', confidence: 'high' })])).toBe(75);
    expect(scoreAxis([finding({ severity: 'high', confidence: 'medium' })])).toBe(93); // 15 * 0.5 = 7.5 → round(92.5) = 93
    expect(scoreAxis([finding({ severity: 'low', confidence: 'high' })])).toBe(97);
  });

  it('never scores low-confidence findings — they go to notes', () => {
    const result = computeScore([
      finding({ severity: 'critical', confidence: 'low' }),
      finding({ severity: 'medium', confidence: 'medium' }),
    ]);
    expect(result.notes).toHaveLength(1);
    expect(result.scoredFindings).toHaveLength(1);
    expect(result.axes[0]?.score).toBe(96); // 8 * 0.5 = 4
  });

  it('floors axis scores at 0', () => {
    // One rule can deduct at most 25 points, so flooring an axis takes
    // several distinct rules at their ceilings.
    const many = ['a', 'b', 'c', 'd'].flatMap((suffix) =>
      Array.from({ length: 3 }, () => finding({ ruleId: `test/${suffix}`, severity: 'critical', confidence: 'high' })),
    );
    expect(scoreAxis(many)).toBe(0);
  });

  it('caps each rule’s deduction at 25 points, highest deductions first', () => {
    const many = Array.from({ length: 15 }, () => finding({ severity: 'low', confidence: 'high' }));
    // 15 × 3 points without the cap; with it, 8 × 3 = 24 and the rest deduct nothing.
    expect(scoreAxis(many)).toBe(76);
    expect(scoreAxis(many.slice(0, 9))).toBe(76);
    expect(scoreAxis(many.slice(0, 8))).toBe(76);
  });

  it('fits smaller findings under the 25-point ceiling, order-independent', () => {
    const findings = [
      ...Array.from({ length: 2 }, () => finding({ severity: 'high', confidence: 'high' })), // 15 pts each
      ...Array.from({ length: 4 }, () => finding({ severity: 'low', confidence: 'high' })), // 3 pts each
    ];
    // Sorted: 15, 15, 3, 3, 3, 3 → 15 + 3 + 3 + 3 = 24; the second 15 and last 3 would exceed 25.
    expect(scoreAxis(findings)).toBe(76);
    expect(scoreAxis([...findings].reverse())).toBe(76);
    const shuffled = [...findings.slice(2), ...findings.slice(0, 2)];
    expect(scoreAxis(shuffled)).toBe(76);
  });

  it('counts capped findings while still reporting every finding', () => {
    const findings = Array.from({ length: 13 }, (_, i) =>
      finding({ axis: 'CLEAN', ruleId: 'clean/large-files', severity: 'low', confidence: 'high', message: `f${i}` }),
    );
    const result = computeScore(findings);
    expect(result.cappedFindings).toBe(5); // 8 × 3 = 24 points scored, 5 beyond the ceiling
    expect(result.scoredFindings).toHaveLength(13);
    expect(result.axes.find((a) => a.axis === 'CLEAN')?.score).toBe(76);
  });

  it('reports zero capped findings when every rule is under the cap', () => {
    const result = computeScore([finding({}), finding({ ruleId: 'test/other' })]);
    expect(result.cappedFindings).toBe(0);
  });

  it('weighs SAFE 35% and CLEAN 15%, renormalized over measured axes', () => {
    const result = computeScore([
      finding({ axis: 'SAFE', severity: 'high', confidence: 'high' }), // SAFE 85
      finding({ axis: 'CLEAN', severity: 'medium', confidence: 'high' }), // CLEAN 92
    ]);
    // (0.35*85 + 0.15*92) / 0.5 = (29.75 + 13.8) / 0.5 = 87.1 -> 87
    expect(result.total).toBe(87);
  });

  it('folds measured RUNS/HONEST reports into the weighted total', () => {
    const runs: AxisReport = { axis: 'RUNS', score: 100, status: 'pass', details: [], evidence: [], durationMs: 1 };
    const honest: AxisReport = { axis: 'HONEST', score: 50, status: 'fail', details: [], evidence: [], durationMs: 1 };
    const result = computeScore([], [runs, honest]);
    // 0.35*100 + 0.25*100 + 0.25*50 + 0.15*100 = 35 + 25 + 12.5 + 15 = 87.5 -> 88
    expect(result.total).toBe(88);
    expect(result.axes.map((a) => a.axis)).toEqual(['SAFE', 'CLEAN', 'RUNS', 'HONEST']);
    expect(result.unmeasuredAxes).toEqual([]);
  });

  it('excludes skipped axis reports from the total — unverifiable is never punished', () => {
    const skipped: AxisReport = { axis: 'RUNS', score: 0, status: 'skipped', details: [], evidence: [], durationMs: 0 };
    const withSkip = computeScore([], [skipped]);
    expect(withSkip.total).toBe(100);
    expect(withSkip.unmeasuredAxes).toEqual(['RUNS', 'HONEST']);
    expect(withSkip.axes.map((a) => a.axis)).toEqual(['SAFE', 'CLEAN']);
  });

  it('is deterministic with axis reports — same inputs, same score', () => {
    const runs: AxisReport = { axis: 'RUNS', score: 50, status: 'pass', details: [], evidence: [], durationMs: 5 };
    const findings = [finding({ axis: 'SAFE', severity: 'high', confidence: 'high' })];
    expect(computeScore(findings, [runs]).total).toBe(computeScore([...findings], [runs]).total);
  });

  it('caps the total at 49 when a documented claim is verified false (liar cap)', () => {
    const honest: AxisReport = {
      axis: 'HONEST',
      score: 50,
      status: 'fail',
      details: [],
      evidence: [],
      durationMs: 1,
      receipts: [
        {
          claim: { text: '14 tests pass', file: 'README.md', line: 7, kind: 'test-count', expected: 14 },
          verdict: 'failed',
          actual: '3 tests pass, 0 fail',
        },
      ],
    };
    const result = computeScore([], [honest]);
    // Without the cap: (0.35*100 + 0.25*50 + 0.15*100) / 0.75 = 83. Caught lying → capped.
    expect(result.total).toBe(49);
    expect(result.liarCapApplied).toBe(true);
  });

  it('does not cap when claims are verified or unverifiable', () => {
    const honest: AxisReport = {
      axis: 'HONEST',
      score: 100,
      status: 'pass',
      details: [],
      evidence: [],
      durationMs: 1,
      receipts: [
        { claim: { text: 'All tests pass', file: 'README.md', line: 3, kind: 'all-tests' }, verdict: 'verified' },
        { claim: { text: '90% coverage', file: 'README.md', line: 4, kind: 'coverage', expected: 90 }, verdict: 'unverifiable' },
      ],
    };
    const result = computeScore([], [honest]);
    expect(result.total).toBe(100);
    expect(result.liarCapApplied).toBe(false);
  });

  it('is deterministic — same findings, same score, twice', () => {
    const findings = [
      finding({ axis: 'SAFE', severity: 'critical', confidence: 'high', message: 'a' }),
      finding({ axis: 'SAFE', severity: 'high', confidence: 'medium', message: 'b' }),
      finding({ axis: 'CLEAN', severity: 'low', confidence: 'high', message: 'c' }),
      finding({ axis: 'CLEAN', severity: 'medium', confidence: 'low', message: 'd' }),
    ];
    const first = computeScore(findings);
    const second = computeScore([...findings].reverse());
    expect(second.total).toBe(first.total);
    expect(second.axes).toEqual(first.axes);
    expect(second.scoredFindings).toHaveLength(first.scoredFindings.length);
    expect(second.notes).toHaveLength(first.notes.length);
  });
});
