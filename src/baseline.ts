import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Finding } from './engine/types.js';
import { fingerprintFinding, RUBRIC_VERSION } from './score/score.js';

export const BASELINE_FILENAME = '.umbra-baseline.json';
export const BASELINE_VERSION = 1;

export interface BaselineEntry {
  fingerprint: string;
  ruleId: string;
  file?: string;
}

/** On-disk shape of `.umbra-baseline.json`. */
export interface BaselineFile {
  version: typeof BASELINE_VERSION;
  createdAt: string;
  rubricVersion: number;
  findings: BaselineEntry[];
}

export interface WrittenBaseline {
  path: string;
  /** Distinct fingerprints recorded. */
  count: number;
  /** True when an existing baseline was replaced. */
  overwrote: boolean;
}

/**
 * Snapshots the current findings as the repo's baseline. Entries are deduped
 * by fingerprint and sorted, so the same repo state always writes the same
 * file (modulo createdAt).
 */
export function writeBaseline(root: string, findings: Finding[]): WrittenBaseline {
  const baselinePath = path.join(root, BASELINE_FILENAME);
  const overwrote = existsSync(baselinePath);
  const seen = new Set<string>();
  const entries: BaselineEntry[] = [];
  for (const f of findings) {
    const fingerprint = fingerprintFinding(f);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    entries.push({
      fingerprint,
      ruleId: f.ruleId,
      ...(f.file !== undefined ? { file: f.file } : {}),
    });
  }
  entries.sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));
  const file: BaselineFile = {
    version: BASELINE_VERSION,
    createdAt: new Date().toISOString(),
    rubricVersion: RUBRIC_VERSION,
    findings: entries,
  };
  writeFileSync(baselinePath, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
  return { path: baselinePath, count: entries.length, overwrote };
}

export type BaselineLoad =
  /** No baseline file present (auto-detect only) — scan unfiltered. */
  | { status: 'none' }
  /** Baseline loaded; `set` holds the grandfathered fingerprints. */
  | { status: 'ok'; path: string; set: Set<string> }
  /** Baseline present but unusable — warn and scan unfiltered. */
  | { status: 'ignored'; warning: string };

/**
 * Loads a baseline file. Anything suspicious — missing explicit path,
 * unreadable, invalid JSON, wrong shape, or written for a different rubric
 * version — is a warning plus an unfiltered scan, never a silent pass: a
 * stale baseline that quietly hides findings from newer rules is a footgun.
 */
export function loadBaseline(baselinePath: string, options: { explicit?: boolean } = {}): BaselineLoad {
  if (!existsSync(baselinePath)) {
    if (options.explicit === true) {
      return { status: 'ignored', warning: `baseline file not found: ${baselinePath} — scanning without a baseline` };
    }
    return { status: 'none' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(baselinePath, 'utf8'));
  } catch {
    return { status: 'ignored', warning: `ignoring ${baselinePath} — not valid JSON` };
  }

  const b = parsed as Partial<BaselineFile> | null;
  if (
    b === null ||
    typeof b !== 'object' ||
    b.version !== BASELINE_VERSION ||
    !Array.isArray(b.findings) ||
    b.findings.some((e) => typeof e?.fingerprint !== 'string')
  ) {
    return { status: 'ignored', warning: `ignoring ${baselinePath} — not a valid baseline file` };
  }

  if (b.rubricVersion !== RUBRIC_VERSION) {
    return {
      status: 'ignored',
      warning:
        `ignoring ${baselinePath} — written for rubric v${String(b.rubricVersion)}, ` +
        `current rubric is v${RUBRIC_VERSION}; re-run with --baseline-write`,
    };
  }

  return { status: 'ok', path: baselinePath, set: new Set(b.findings.map((e) => e.fingerprint)) };
}
