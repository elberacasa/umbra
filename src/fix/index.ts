import pc from 'picocolors';
import type { Finding } from '../engine/types.js';
import { removeUnusedDep } from './fixers/unused-deps.js';
import { extractEnvVar } from './fixers/env-extract.js';
import type { FixOutcome, FixReport } from './types.js';

export type { FixOutcome, FixReport, FixStatus, FindingFix } from './types.js';

export interface ApplyFixesOptions {
  /** Print what would change; write nothing. */
  dryRun?: boolean;
}

/**
 * Applies the only three provably-safe transforms in Umbra:
 *   clean/unused-deps         → drop the key from package.json
 *   safe/hardcoded-secrets    → extract the literal to process.env.<NAME>
 *   safe/default-credentials  → same env extraction
 * Every other finding reports as 'manual'. Never runs git, never runs
 * npm install, never deletes files. Idempotent: a second run over the
 * re-scanned findings applies nothing.
 */
export async function applyFixes(root: string, findings: Finding[], opts: ApplyFixesOptions = {}): Promise<FixReport> {
  const dryRun = opts.dryRun === true;
  const report: FixReport = { applied: [], manual: [], skipped: [] };
  let fallbackCounter = 0;
  const nextFallbackName = (): string => {
    fallbackCounter += 1;
    return `UMBRA_SECRET_${fallbackCounter}`;
  };

  for (const finding of findings) {
    // Low-confidence findings are notes, not tasks — never touch them.
    if (finding.confidence === 'low') continue;
    let outcome: FixOutcome;
    switch (finding.ruleId) {
      case 'clean/unused-deps':
        outcome = await removeUnusedDep(root, finding, dryRun);
        break;
      case 'safe/hardcoded-secrets':
      case 'safe/default-credentials':
        outcome = await extractEnvVar(root, finding, { dryRun, nextFallbackName });
        break;
      default:
        outcome = { status: 'manual', description: 'no provably-safe auto-fix for this rule — fix manually' };
    }
    if (dryRun && outcome.status === 'applied') {
      outcome = { ...outcome, description: `would ${outcome.description}` };
    }
    report[outcome.status].push({ ...outcome, finding });
  }
  return report;
}

function location(f: Finding): string {
  if (f.file === undefined) return 'repo';
  return f.line !== undefined ? `${f.file}:${f.line}` : f.file;
}

/** Renders the "Fixes" section appended to the verdict after a --fix run. */
export function formatFixSection(report: FixReport, before: number, after: number, dryRun: boolean): string {
  const lines: string[] = [];
  lines.push(dryRun ? pc.bold('Fixes (dry run — nothing written):') : pc.bold('Fixes:'));
  const verb = dryRun ? 'would apply' : 'applied';
  lines.push(`  ${verb} ${report.applied.length} fix${report.applied.length === 1 ? '' : 'es'} (score ${before} → ${after})`);
  for (const fix of report.applied) {
    lines.push(pc.green(`    ✓ ${fix.description}`));
  }
  for (const fix of report.skipped) {
    lines.push(pc.dim(`    – skipped: ${fix.description}`));
  }
  lines.push(
    `  ${report.manual.length} finding${report.manual.length === 1 ? '' : 's'} need${report.manual.length === 1 ? 's' : ''} manual fixes:`,
  );
  for (const fix of report.manual) {
    lines.push(`    - [${fix.finding.ruleId}] ${location(fix.finding)} — ${fix.description}`);
  }
  return lines.join('\n');
}
