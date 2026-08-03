import path from 'node:path';
import type { Finding, ScanContext, ScannedFile } from '../engine/types.js';
import { fileScopeRules } from '../rules/index.js';
import { checkPathViolation } from './paths.js';

export interface GuardVerdict {
  decision: 'allow' | 'warn' | 'block';
  /** High/medium confidence only — low confidence never surfaces inline. */
  findings: Finding[];
  /** Protected-path reason when the path guard blocked the write. */
  pathViolation?: string;
}

const BLOCKING_SEVERITIES = new Set(['critical', 'high']);

/**
 * The secrets rule flags any committed .env with values because, in a repo
 * scan, the file is by definition committed. In the guard hot path we see a
 * proposed write, not a commit — blocking every `.env` with `PORT=3000`
 * would be a false positive. Live-key material in .env files is blocked by
 * the path guard instead, so this generic finding is suppressed inline.
 */
function isGenericCommittedEnvFinding(finding: Finding): boolean {
  return (
    finding.ruleId === 'safe/hardcoded-secrets' &&
    finding.message.startsWith('Committed environment file')
  );
}

function normalizeRelPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/').replace(/^\.\//, '');
  return normalized === '' ? filePath : normalized;
}

/**
 * Guards one proposed file write: runs file-scope rules against a synthetic
 * single-file context plus the always-on path guard. Must stay fast (<50ms),
 * synchronous-looking, and network-free. A crashing rule is skipped rather
 * than allowed to break or block the user's write.
 *
 * Blocking policy: only critical/high severity at high confidence blocks;
 * anything else warns. When in doubt, warn — a wrong inline block gets the
 * tool uninstalled.
 */
export async function guardContent(filePath: string, content: string): Promise<GuardVerdict> {
  const pathViolation = checkPathViolation(filePath, content);

  const absPath = path.resolve(filePath);
  const file: ScannedFile = {
    relPath: normalizeRelPath(filePath),
    absPath,
    content,
    lines: content.split('\n'),
  };
  const ctx: ScanContext = {
    root: path.dirname(absPath),
    files: [file],
    options: { resolvePackage: async () => 'unknown' },
  };

  const findings: Finding[] = [];
  for (const rule of fileScopeRules) {
    try {
      for (const finding of await rule.check(ctx)) {
        if (finding.confidence === 'low') continue;
        if (isGenericCommittedEnvFinding(finding)) continue;
        findings.push(finding);
      }
    } catch {
      // A rule that throws must never block (or crash) a legitimate write.
    }
  }

  const blocking = findings.some(
    (finding) => finding.confidence === 'high' && BLOCKING_SEVERITIES.has(finding.severity),
  );
  const decision =
    pathViolation !== undefined || blocking ? 'block' : findings.length > 0 ? 'warn' : 'allow';

  if (pathViolation !== undefined) {
    return { decision, findings, pathViolation };
  }
  return { decision, findings };
}
