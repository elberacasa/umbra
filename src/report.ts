import pc from 'picocolors';
import type { Finding, ScanResult } from './engine/types.js';
import type { ScoreResult } from './score/score.js';
import type { AxisReport, ClaimReceipt } from './axes/types.js';
import { allRules } from './rules/index.js';
import { REMEDIATION } from './guard/hook.js';

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
  /** True when a verified-false claim capped the score below passing. */
  liarCapApplied: boolean;
  /** Sandboxed axis reports — present only when the scan ran with --deep. */
  axisReports?: AxisReport[];
}

export function toJsonReport(scan: ScanResult, score: ScoreResult, axisReports?: AxisReport[]): JsonReport {
  const report: JsonReport = {
    score: score.total,
    rubricVersion: score.rubricVersion,
    measuredAxes: score.axes.map((a) => a.axis),
    unmeasuredAxes: score.unmeasuredAxes,
    note:
      axisReports === undefined
        ? 'RUNS and HONEST were not measured (fast scan) — run with --deep to verify them in a Docker sandbox. Total is computed over measured axes only (see RUBRIC.md).'
        : 'RUNS and HONEST were verified in a Docker sandbox (--deep); axes that could not be verified are reported as skipped and excluded from the total (see RUBRIC.md).',
    fileCount: scan.fileCount,
    axes: score.axes,
    findings: sortFindings(score.scoredFindings),
    notes: score.notes,
    badge: badgeMarkdown(score.total),
    liarCapApplied: score.liarCapApplied,
  };
  if (axisReports !== undefined) report.axisReports = axisReports;
  return report;
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

function runsSummary(report: AxisReport): string {
  const seconds = (report.durationMs / 1000).toFixed(1);
  const suffix = `(verified in sandbox, ${seconds}s)`;
  const probe = report.evidence
    .map((e) => /GET http:\/\/[^/]+(\/\S*)/.exec(e.message)?.[1])
    .find((p) => p !== undefined);
  if (report.score >= 100) {
    return `builds, boots, ${probe ?? '/'} responds ${suffix}`;
  }
  if (report.score >= 50) return `builds and boots but no HTTP response ${suffix}`;
  if (report.score >= 25) return `builds but crashes on boot ${suffix}`;
  return `build failed ${suffix}`;
}

function honestSummary(report: AxisReport): string {
  const receipts = report.receipts ?? [];
  const verified = receipts.filter((r) => r.verdict === 'verified').length;
  const failed = receipts.filter((r) => r.verdict === 'failed').length;
  const unverifiable = receipts.length - verified - failed;
  const parts = [
    failed > 0 ? `${failed} claim${failed === 1 ? '' : 's'} failed` : undefined,
    verified > 0 ? `${verified} verified` : undefined,
    unverifiable > 0 ? `${unverifiable} unverifiable` : undefined,
  ].filter((p) => p !== undefined);
  return parts.length > 0 ? parts.join(', ') : 'no verifiable claims';
}

/** Short reason a sandboxed axis was skipped, drawn from its narration. */
function skipReason(report: AxisReport): string {
  const reason = [...report.details].reverse().find((d) => d.trim() !== '');
  return reason !== undefined ? ` — ${reason}` : '';
}

function formatClaimLine(receipt: ClaimReceipt): string {
  const where = `${receipt.claim.file}:${receipt.claim.line}`;
  if (receipt.verdict === 'failed') {
    const actual = receipt.actual !== undefined ? ` — actually ${receipt.actual}` : '';
    return pc.bold(pc.red(`  CLAIM FAILED: "${receipt.claim.text}" — ${where}${actual}`));
  }
  const actual = receipt.actual !== undefined ? ` — ${receipt.actual}` : '';
  return pc.dim(`  CLAIM VERIFIED: "${receipt.claim.text}" — ${where}${actual}`);
}

export function formatVerdict(scan: ScanResult, score: ScoreResult, axisReports?: AxisReport[]): string {
  const lines: string[] = [];
  const totalIcon = verdictIcon(score.total);

  const headline = `UMBRA TRUST SCORE: ${score.total}/100  ${totalIcon}`;
  lines.push(score.total >= 50 ? pc.bold(pc.green(headline)) : pc.bold(pc.red(headline)));
  lines.push('');

  // Static axes first, then the sandboxed axes with their evidence summaries.
  for (const axis of score.axes) {
    if (axis.axis === 'RUNS' || axis.axis === 'HONEST') continue;
    const icon = verdictIcon(axis.score);
    const name = axis.axis.padEnd(7);
    lines.push(`${name}${icon} ${axis.score}/100 — ${axis.findingCount} finding${axis.findingCount === 1 ? '' : 's'}`);
  }

  for (const axis of ['RUNS', 'HONEST'] as const) {
    const name = axis.padEnd(7);
    const report = axisReports?.find((r) => r.axis === axis);
    if (report === undefined) {
      lines.push(`${name}${pc.dim('— not measured — run with --deep')}`);
      continue;
    }
    if (report.status === 'skipped') {
      lines.push(`${name}${pc.dim(`— not measured${skipReason(report)}`)}`);
      continue;
    }
    const icon = verdictIcon(report.score);
    const summary = axis === 'RUNS' ? runsSummary(report) : honestSummary(report);
    lines.push(`${name}${icon} ${report.score}/100 — ${summary}`);
  }

  lines.push('');
  lines.push(
    pc.dim(
      `Score computed over measured axes only (full rubric: SAFE 35%, RUNS 25%, HONEST 25%, CLEAN 15%). Rubric v${score.rubricVersion}.`,
    ),
  );
  if (score.liarCapApplied) {
    lines.push(
      pc.bold(pc.red('Score capped below passing: a documented claim was verified false. Trust is the product.')),
    );
  }

  // The receipts: failed claims are the money line — render them unmissably.
  const honest = axisReports?.find((r) => r.axis === 'HONEST');
  const receiptLines = (honest?.receipts ?? [])
    .filter((r) => r.verdict !== 'unverifiable')
    .sort((a, b) => (a.verdict === b.verdict ? 0 : a.verdict === 'failed' ? -1 : 1))
    .map(formatClaimLine);
  if (receiptLines.length > 0) {
    lines.push('');
    lines.push(pc.bold('Claim receipts:'));
    lines.push(...receiptLines);
  }

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

function mdLocation(f: Finding): string {
  if (f.file === undefined) return 'repo-level';
  return f.line !== undefined ? `${f.file}:${f.line}` : f.file;
}

/** Fix guidance for one finding: authored remediation, else the rule's description. */
function fixFor(f: Finding): string | undefined {
  const direct = REMEDIATION[f.ruleId];
  const text = direct ?? allRules.find((r) => r.id === f.ruleId)?.description;
  if (text === undefined) return undefined;
  return text.endsWith('.') ? text.slice(0, -1) : text;
}

/**
 * Renders UMBRA.md: the agent-actionable markdown report written by
 * `--report`. Committed to a repo, it is both the task list an AI coding
 * agent works through and the re-verification loop (`npx umbra-scan`).
 */
export function toMarkdownReport(scan: ScanResult, score: ScoreResult, axisReports?: AxisReport[]): string {
  const lines: string[] = [];
  lines.push('# Umbra Trust Report', '');
  lines.push('> Generated by [Umbra](https://github.com/elberacasa/umbra), the trust score for AI-generated code.');
  lines.push(`> Rubric v${score.rubricVersion} · re-verify: \`npx umbra-scan\` · regenerate: \`npx umbra-scan --report\``, '');

  lines.push(`**Trust Score: ${score.total}/100** ${verdictIcon(score.total)}`, '');
  for (const axis of score.axes) {
    lines.push(`- **${axis.axis}** ${axis.score}/100 (${axis.findingCount} finding${axis.findingCount === 1 ? '' : 's'})`);
  }
  if (score.unmeasuredAxes.length > 0) {
    lines.push(`- _${score.unmeasuredAxes.join(', ')} not measured${axisReports === undefined ? ' — run `npx umbra-scan --deep --report`' : ''}_`);
  }
  if (score.liarCapApplied) {
    lines.push('', '**Score capped below 50: a documented claim was verified false.** Trust is the product.');
  }
  lines.push('');

  lines.push('## Instructions for AI coding agents', '');
  lines.push(
    'If you are an AI coding agent (Claude Code, Cursor, Copilot, Windsurf, Kimi Code) working in',
    'this repository: treat every unchecked finding below as your task list. Fix the root cause at',
    'the given file:line. Do not suppress, delete, or work around a check to raise the score. When',
    'the findings are resolved, re-run `npx umbra-scan` and regenerate this file with',
    '`npx umbra-scan --report`. The task is not done while the score is below 50.',
    '',
  );

  const scored = sortFindings(score.scoredFindings);
  if (scored.length > 0) {
    lines.push('## Findings', '');
    const byAxis = new Map<string, Finding[]>();
    for (const f of scored) {
      const list = byAxis.get(f.axis) ?? [];
      list.push(f);
      byAxis.set(f.axis, list);
    }
    for (const [axis, findings] of byAxis) {
      const axisScore = score.axes.find((a) => a.axis === axis);
      lines.push(`### ${axis}${axisScore !== undefined ? ` — ${axisScore.score}/100` : ''}`, '');
      for (const f of findings) {
        lines.push(`- [ ] **${f.severity}** (${f.confidence}) · ${f.message} — \`${mdLocation(f)}\``);
        const fix = fixFor(f);
        if (fix !== undefined) lines.push(`  - Fix: ${fix}.`);
      }
      lines.push('');
    }
  } else {
    lines.push('## Findings', '', 'No scored findings. Keep it that way.', '');
  }

  const honest = axisReports?.find((r) => r.axis === 'HONEST');
  const receipts = (honest?.receipts ?? []).filter((r) => r.verdict !== 'unverifiable');
  if (receipts.length > 0) {
    lines.push('## Claim receipts', '');
    for (const r of receipts) {
      const mark = r.verdict === 'failed' ? 'FAILED' : 'verified';
      const actual = r.actual !== undefined ? ` — actually ${r.actual}` : '';
      lines.push(`- **${mark}** · "${r.claim.text}" — \`${r.claim.file}:${r.claim.line}\`${actual}`);
    }
    lines.push('');
  }

  if (score.notes.length > 0) {
    lines.push('## Notes (low confidence, not scored)', '');
    for (const f of score.notes) {
      lines.push(`- [${f.ruleId}] ${f.message} — \`${mdLocation(f)}\``);
    }
    lines.push('');
  }

  lines.push('---', '');
  lines.push(badgeMarkdown(score.total), '');
  return lines.join('\n');
}
