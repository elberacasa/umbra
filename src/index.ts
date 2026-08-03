export { runScan } from './engine/runner.js';
export { walkRepo } from './engine/walker.js';
export { allRules } from './rules/index.js';
export { computeScore, scoreAxis, RUBRIC_VERSION } from './score/score.js';
export { formatVerdict, toJsonReport, badgeMarkdown } from './report.js';
export type { Finding, Rule, ScanContext, ScanOptions, ScanResult } from './engine/types.js';
export type { ScoreResult, AxisScore } from './score/score.js';
