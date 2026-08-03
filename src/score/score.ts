import type { Axis, Confidence, Finding, Severity } from '../engine/types.js';
import type { AxisReport } from '../axes/types.js';

export const RUBRIC_VERSION = 2;

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

/** Full rubric v2 weights. RUNS and HONEST join the total only when measured (--deep). */
export const AXIS_WEIGHTS: Record<Axis, number> = {
  SAFE: 0.35,
  RUNS: 0.25,
  HONEST: 0.25,
  CLEAN: 0.15,
};

/**
 * The liar cap: a documented claim that is verified false ("14 tests pass" —
 * 3 do) caps the total below the pass threshold, no matter how clean the rest
 * of the repo is. Trust is the product; a caught lie forfeits it.
 */
export const LIAR_CAP = 49;

/** Axes measured by the static scan alone. RUNS/HONEST need a sandbox (--deep). */
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
  /** True when a verified-false claim capped the total at LIAR_CAP. */
  liarCapApplied: boolean;
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

/**
 * Deterministic total over the measured axes, renormalized to 0-100.
 * SAFE/CLEAN always come from static findings. RUNS/HONEST count as measured
 * only when an AxisReport is supplied AND its status is not 'skipped' — a
 * skipped axis (no Docker, no run path, no claims) never moves the total.
 */
export function computeScore(findings: Finding[], axisReports: AxisReport[] = []): ScoreResult {
  const scoredFindings = findings.filter((f) => f.confidence !== 'low');
  const notes = findings.filter((f) => f.confidence === 'low');

  const measuredReports = new Map<Axis, AxisReport>();
  for (const report of axisReports) {
    if (report.status !== 'skipped') measuredReports.set(report.axis, report);
  }

  const axes: AxisScore[] = [];
  for (const axis of MEASURED_AXES) {
    const axisFindings = findings.filter((f) => f.axis === axis);
    axes.push({ axis, score: scoreAxis(axisFindings), findingCount: axisFindings.length });
  }
  for (const axis of ['RUNS', 'HONEST'] as const) {
    const report = measuredReports.get(axis);
    if (report === undefined) continue;
    axes.push({
      axis,
      score: report.score,
      findingCount: findings.filter((f) => f.axis === axis).length,
    });
  }

  const measuredWeight = axes.reduce((sum, a) => sum + AXIS_WEIGHTS[a.axis], 0);
  const weighted = axes.reduce((sum, a) => sum + AXIS_WEIGHTS[a.axis] * a.score, 0);
  const raw = Math.round(weighted / measuredWeight);

  const liarCapApplied = axisReports.some(
    (r) =>
      r.axis === 'HONEST' &&
      r.status !== 'skipped' &&
      (r.receipts ?? []).some((receipt) => receipt.verdict === 'failed'),
  );
  const total = liarCapApplied ? Math.min(raw, LIAR_CAP) : raw;

  const measured = new Set(axes.map((a) => a.axis));
  return {
    total,
    rubricVersion: RUBRIC_VERSION,
    axes,
    scoredFindings,
    notes,
    unmeasuredAxes: (Object.keys(AXIS_WEIGHTS) as Axis[]).filter((a) => !measured.has(a)),
    liarCapApplied,
  };
}
