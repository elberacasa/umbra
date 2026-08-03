import { walkRepo } from './walker.js';
import type { Rule, ScanContext, ScanOptions, ScanResult } from './types.js';

export async function runScan(
  root: string,
  rules: Rule[],
  options: ScanOptions = {},
): Promise<ScanResult> {
  const files = await walkRepo(root);
  const ctx: ScanContext = { root, files, options };
  const findings = [];
  for (const rule of rules) {
    const ruleFindings = await rule.check(ctx);
    findings.push(...ruleFindings);
  }
  return { root, fileCount: files.length, findings };
}
