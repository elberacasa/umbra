import pc from 'picocolors';
import type { Finding, ScanResult } from './engine/types.js';
import type { ScoreResult } from './score/score.js';

const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 } as const;
const CONFIDENCE_RANK = { high: 0, medium: 1, low: 2 } as const;

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (bySeverity !== 0) return bySeverity;
    return CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence];
  });
}

export function verdictIcon(score: number): string {
  if (score >= 80) return '✅';
  if (score >= 50) return '⚠️';
  return '🔴';
}

export function badgeColor(score: number): string {
  if (score >= 80) return 'brightgreen';
  if (score >= 50) return 'yellow';
  return 'red';
}

export function badgeMarkdown(score: number): string {
  const img = `https://img.shields.io/badge/Umbra_Trust_Score-${score}-${badgeColor(score)}`;
  return `[![Umbra Trust Score](${img})](https://github.com/elberacasa/umbra)`;
}

export interface JsonReport {
  score: number;
  rubricVersion: number;
  measuredAxes: string[];
  unmeasuredAxes: string[];
  note: string;
  fileCount: number;
  axes: ScoreResult['axes'];
  findings: Finding[];
  notes: Finding[];
  badge: string;
}

export function toJsonReport(scan: ScanResult, score: ScoreResult): JsonReport {
  return {
    score: score.total,
    rubricVersion: score.rubricVersion,
    measuredAxes: score.axes.map((a) => a.axis),
    unmeasuredAxes: score.unmeasuredAxes,
    note: 'RUNS and HONEST axes are not yet measured in v0.1; total is computed over measured axes only (see RUBRIC.md).',
    fileCount: scan.fileCount,
    axes: score.axes,
    findings: sortFindings(score.scoredFindings),
    notes: score.notes,
    badge: badgeMarkdown(score.total),
  };
}

function colorizeSeverity(f: Finding, text: string): string {
  switch (f.severity) {
    case 'critical':
    case 'high':
      return pc.red(text);
    case 'medium':
      return pc.yellow(text);
    default:
      return pc.dim(text);
  }
}

function formatFindingLine(f: Finding): string {
  const location = f.file !== undefined ? `${f.file}${f.line !== undefined ? `:${f.line}` : ''}` : '';
  const prefix = `  [${f.ruleId}] ${f.message}`;
  return colorizeSeverity(f, location !== '' ? `${prefix} — ${location}` : `  ${prefix.trim()}`);
}

export function formatVerdict(scan: ScanResult, score: ScoreResult): string {
  const lines: string[] = [];
  const totalIcon = verdictIcon(score.total);

  const headline = `UMBRA TRUST SCORE: ${score.total}/100  ${totalIcon}`;
  lines.push(score.total >= 50 ? pc.bold(pc.green(headline)) : pc.bold(pc.red(headline)));
  lines.push('');

  for (const axis of score.axes) {
    const icon = verdictIcon(axis.score);
    const name = axis.axis.padEnd(7);
    lines.push(`${name}${icon} ${axis.score}/100 — ${axis.findingCount} finding${axis.findingCount === 1 ? '' : 's'}`);
  }
  for (const axis of score.unmeasuredAxes) {
    lines.push(`${axis.padEnd(7)}${pc.dim('— not yet measured in v0.1')}`);
  }
  lines.push('');
  lines.push(
    pc.dim(
      `Score computed over measured axes only (SAFE 50%, CLEAN 30% of the full rubric). Rubric v${score.rubricVersion}.`,
    ),
  );

  const top = sortFindings(score.scoredFindings).slice(0, 5);
  if (top.length > 0) {
    lines.push('');
    lines.push(pc.bold('Top findings:'));
    for (const f of top) lines.push(formatFindingLine(f));
  }

  if (score.notes.length > 0) {
    lines.push('');
    lines.push(pc.bold('Notes (low confidence — not scored):'));
    for (const f of score.notes) lines.push(pc.dim(formatFindingLine(f)));
  }

  lines.push('');
  lines.push(`Badge: ${badgeMarkdown(score.total)}`);
  lines.push('');
  return lines.join('\n');
}
