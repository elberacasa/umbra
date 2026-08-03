import type { Finding, Rule } from '../../engine/types.js';

const ROUTE_FILE_RE = /(^|\/)app\/api\/(.+\/)?route\.(ts|tsx|js|jsx)$/;
const AUTH_FLOW_PATH_RE = /(login|signin|sign-in|signup|sign-up|register|forgot|reset|otp|verify)/i;
const POST_EXPORT_RE = /export\s+(?:async\s+)?function\s+POST\b/;
const RATE_LIMIT_SIGNAL = /rate.?limit|throttl|limiter|upstash\/ratelimit/i;

export const missingRateLimitRule: Rule = {
  id: 'safe/missing-rate-limit',
  axis: 'SAFE',
  description:
    'Low-confidence heuristic: auth-flow endpoints (login/signup/reset) with no rate-limiting signal anywhere in the repo.',
  check(ctx) {
    const findings: Finding[] = [];

    const repoHasRateLimiting = ctx.files.some((f) => RATE_LIMIT_SIGNAL.test(f.content));
    if (repoHasRateLimiting) return findings;

    for (const file of ctx.files) {
      if (!ROUTE_FILE_RE.test(file.relPath)) continue;
      if (!AUTH_FLOW_PATH_RE.test(file.relPath)) continue;
      if (!POST_EXPORT_RE.test(file.content)) continue;

      const postLine = file.lines.findIndex((l) => POST_EXPORT_RE.test(l));
      findings.push({
        ruleId: this.id,
        axis: this.axis,
        severity: 'low',
        confidence: 'low',
        message: 'Auth endpoint with no rate-limiting signal in the repo — brute-force / credential-stuffing exposure (heuristic)',
        file: file.relPath,
        line: postLine >= 0 ? postLine + 1 : 1,
      });
    }

    return findings;
  },
};
