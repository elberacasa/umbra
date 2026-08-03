import type { Axis, Confidence, Finding, Severity } from '../engine/types.js';

export const RUBRIC_VERSION = 1;

/** Deduction points per finding, by severity, before the confidence multiplier. */
export const SEVERITY_POINTS: Record<Severity, number> = {
  critical: 25,
  high: 15,
  medium: 8,
  low: 3,
};

/** Multiplier applied to severity points. Low-confidence findings are never scored. */
export const CONFIDENCE_MULTIPLIER: Record<Exclude<Confidence, 'low'>, number> = {
  high: 1.0,
  medium: 0.5,
};

/** Full rubric weights. RUNS and HONEST are reserved but unmeasured in v0.1. */
export const AXIS_WEIGHTS: Record<Axis, number> = {
  SAFE: 0.5,
  CLEAN: 0.3,
  RUNS: 0.1,
  HONEST: 0.1,
};

/** Axes actually measured by this version of the scanner. */
export const MEASURED_AXES: Axis[] = ['SAFE', 'CLEAN'];

export interface AxisScore {
  axis: Axis;
  score: number;
  findingCount: number;
}

export interface ScoreResult {
  total: number;
  rubricVersion: number;
  axes: AxisScore[];
  /** Findings that affected the score (high/medium confidence). */
  scoredFindings: Finding[];
  /** Low-confidence findings — surfaced as notes, never scored. */
  notes: Finding[];
  unmeasuredAxes: Axis[];
}

function findingDeduction(f: Finding): number {
  if (f.confidence === 'low') return 0;
  return SEVERITY_POINTS[f.severity] * CONFIDENCE_MULTIPLIER[f.confidence];
}

export function scoreAxis(findings: Finding[]): number {
  const deduction = findings
    .filter((f) => f.confidence !== 'low')
    .reduce((sum, f) => sum + findingDeduction(f), 0);
  return Math.max(0, Math.round(100 - deduction));
}

export function computeScore(findings: Finding[]): ScoreResult {
  const scoredFindings = findings.filter((f) => f.confidence !== 'low');
  const notes = findings.filter((f) => f.confidence === 'low');

  const axes: AxisScore[] = MEASURED_AXES.map((axis) => {
    const axisFindings = findings.filter((f) => f.axis === axis);
    return {
      axis,
      score: scoreAxis(axisFindings),
      findingCount: axisFindings.length,
    };
  });

  const measuredWeight = MEASURED_AXES.reduce((sum, a) => sum + AXIS_WEIGHTS[a], 0);
  const weighted = axes.reduce((sum, a) => sum + AXIS_WEIGHTS[a.axis] * a.score, 0);
  const total = Math.round(weighted / measuredWeight);

  return {
    total,
    rubricVersion: RUBRIC_VERSION,
    axes,
    scoredFindings,
    notes,
    unmeasuredAxes: (Object.keys(AXIS_WEIGHTS) as Axis[]).filter(
      (a) => !MEASURED_AXES.includes(a),
    ),
  };
}
