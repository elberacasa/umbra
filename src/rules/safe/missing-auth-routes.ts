import type { Finding, Rule } from '../../engine/types.js';

const ROUTE_FILE_RE = /(^|\/)app\/api\/(.+\/)?route\.(ts|tsx|js|jsx)$/;
const HANDLER_EXPORT_RE = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/;
const HANDLER_EXPORT_GLOBAL_RE = new RegExp(HANDLER_EXPORT_RE.source, 'g');

const AUTH_SIGNALS = [
  'getServerSession',
  'getSession',
  'getToken',
  'getUser(',
  'auth(',
  'requireAuth',
  'withAuth',
  'verifyToken',
  'jwt.verify',
  'clerkClient',
  'currentUser',
  'getAuth',
  'next-auth',
  '@clerk',
  'auth0',
  'lucia',
  '@kinde',
  'workos',
];

// Auth-flow endpoints (login, signup, password reset) legitimately run unauthenticated.
const AUTH_FLOW_PATH_RE = /(login|signin|sign-in|signup|sign-up|register|logout|forgot|reset|callback|oauth|token)/i;

export const missingAuthRoutesRule: Rule = {
  id: 'safe/missing-auth-routes',
  axis: 'SAFE',
  description:
    'Heuristic: Next.js API route handlers exporting GET/POST/... without any recognizable auth check.',
  check(ctx) {
    const findings: Finding[] = [];

    for (const file of ctx.files) {
      if (!ROUTE_FILE_RE.test(file.relPath)) continue;
      if (AUTH_FLOW_PATH_RE.test(file.relPath)) continue;

      const handlers = [...file.content.matchAll(HANDLER_EXPORT_GLOBAL_RE)].map((m) => m[1]);
      if (handlers.length === 0) continue;

      const hasAuthSignal = AUTH_SIGNALS.some((signal) => file.content.includes(signal));
      if (hasAuthSignal) continue;

      const firstHandler = file.lines.findIndex((l) => HANDLER_EXPORT_RE.test(l));
      findings.push({
        ruleId: this.id,
        axis: this.axis,
        severity: 'high',
        confidence: 'medium',
        message: `API route exports ${handlers.join('/')} with no auth check detected (heuristic)`,
        file: file.relPath,
        line: firstHandler >= 0 ? firstHandler + 1 : 1,
      });
    }

    return findings;
  },
};
