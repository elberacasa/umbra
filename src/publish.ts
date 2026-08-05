/**
 * --publish: self-report a scan's score to the hosted badge service
 * (services/badge). The service never scans repos — it stores what the
 * repo's own CI reports. Publishing must never fail a scan: every failure
 * mode returns { ok: false } and the caller warns on stderr.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Axis, Finding, Severity } from './engine/types.js';
import type { ScoreResult } from './score/score.js';

/**
 * Default badge service host. The worker is named `umbra-badge`; the
 * workers.dev subdomain is account-scoped and finalizes when the service is
 * deployed — override with the UMBRA_BADGE_URL env var until then.
 */
export const DEFAULT_BADGE_URL = 'https://umbra-badge.TBD.workers.dev';

export interface PublishPayload {
  repo: string;
  score: number;
  axes: Partial<Record<Axis, number>>;
  rubricVersion: number;
  findings: Record<Severity, number>;
  cliVersion: string;
}

export type PublishOutcome =
  | { ok: true; badge: string; report: string }
  | { ok: false; error: string };

export interface PublishOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const PUBLISH_TIMEOUT_MS = 3000;

/** The CLI's own version, read from the package manifest next to dist/. */
export function cliVersion(): string {
  const manifest = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
  const parsed: unknown = JSON.parse(manifest);
  if (typeof parsed === 'object' && parsed !== null && 'version' in parsed) {
    const version = (parsed as { version: unknown }).version;
    if (typeof version === 'string') return version;
  }
  return 'unknown';
}

/**
 * Derives owner/name from the scanned repo's git remote "origin".
 * Handles https and ssh GitHub URLs, with or without the .git suffix.
 */
export function repoFromGitConfig(root: string): string | undefined {
  let config: string;
  try {
    config = readFileSync(path.join(root, '.git', 'config'), 'utf8');
  } catch {
    return undefined;
  }
  const url = /\[remote "origin"\][^\[]*?^\s*url\s*=\s*(\S+)\s*$/m.exec(config)?.[1];
  if (url === undefined) return undefined;
  const match = /github\.com[:/]([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+?)(?:\.git)?$/.exec(url);
  return match?.[1];
}

export function buildPublishPayload(
  repo: string,
  score: ScoreResult,
  findings: Finding[],
  version: string,
): PublishPayload {
  const axes: PublishPayload['axes'] = {};
  for (const axis of score.axes) {
    axes[axis.axis] = axis.score;
  }
  const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const finding of findings) {
    counts[finding.severity] += 1;
  }
  return {
    repo,
    score: score.total,
    axes,
    rubricVersion: score.rubricVersion,
    findings: counts,
    cliVersion: version,
  };
}

/** POSTs the payload to the badge service. Never throws. */
export async function publishScore(
  payload: PublishPayload,
  options: PublishOptions = {},
): Promise<PublishOutcome> {
  const base = (options.baseUrl ?? process.env.UMBRA_BADGE_URL ?? DEFAULT_BADGE_URL).replace(
    /\/+$/,
    '',
  );
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(`${base}/api/report`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(options.timeoutMs ?? PUBLISH_TIMEOUT_MS),
    });
    if (!res.ok) {
      return { ok: false, error: `badge service returned HTTP ${res.status}` };
    }
    const body: unknown = await res.json();
    if (typeof body === 'object' && body !== null && 'badge' in body && 'report' in body) {
      const { badge, report } = body as { badge: unknown; report: unknown };
      if (typeof badge === 'string' && typeof report === 'string') {
        return { ok: true, badge: `${base}${badge}`, report: `${base}${report}` };
      }
    }
    return { ok: false, error: 'badge service returned an unexpected response' };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
