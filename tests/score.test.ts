import { describe, expect, it } from 'vitest';
import type { Finding } from '../src/engine/types';
import { computeScore, RUBRIC_VERSION, scoreAxis } from '../src/score/score';

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
    const many = Array.from({ length: 10 }, () => finding({ severity: 'critical', confidence: 'high' }));
    expect(scoreAxis(many)).toBe(0);
  });

  it('weighs SAFE 50% and CLEAN 30%, renormalized over measured axes', () => {
    const result = computeScore([
      finding({ axis: 'SAFE', severity: 'high', confidence: 'high' }), // SAFE 85
      finding({ axis: 'CLEAN', severity: 'medium', confidence: 'high' }), // CLEAN 92
    ]);
    // (0.5*85 + 0.3*92) / 0.8 = (42.5 + 27.6) / 0.8 = 87.625 -> 88
    expect(result.total).toBe(88);
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
