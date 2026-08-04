import path from 'node:path';
import type { Confidence, Finding, Rule, Severity } from '../../engine/types.js';
import { isNonProductionPath } from '../context.js';

export interface SecretPattern {
  name: string;
  re: RegExp;
  severity: Severity;
  confidence: Confidence;
}

// Exported so the --fix env-extraction transform can re-locate the exact
// literal a finding flagged, instead of maintaining a parallel pattern list.
export const PATTERNS: SecretPattern[] = [
  {
    name: 'AWS access key ID',
    re: /\b(AKIA[0-9A-Z]{16})\b/,
    severity: 'critical',
    confidence: 'high',
  },
  {
    name: 'AWS secret access key',
    re: /aws_secret_access_key\s*[:=]\s*['"]?([A-Za-z0-9/+=]{40})['"]?/i,
    severity: 'critical',
    confidence: 'high',
  },
  {
    name: 'private key material',
    re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/,
    severity: 'critical',
    confidence: 'high',
  },
  {
    name: 'Stripe live secret key',
    re: /\b(sk_live_[0-9a-zA-Z]{16,})\b/,
    severity: 'critical',
    confidence: 'high',
  },
  {
    name: 'Stripe live restricted key',
    re: /\b(rk_live_[0-9a-zA-Z]{16,})\b/,
    severity: 'critical',
    confidence: 'high',
  },
  {
    name: 'GitHub personal access token',
    re: /\b(ghp_[0-9A-Za-z]{36,})\b/,
    severity: 'critical',
    confidence: 'high',
  },
  {
    name: 'GitHub OAuth token',
    re: /\b(gho_[0-9A-Za-z]{36,})\b/,
    severity: 'critical',
    confidence: 'high',
  },
  {
    name: 'Slack token',
    re: /\b(xox[baprs]-[0-9A-Za-z-]{10,})\b/,
    severity: 'critical',
    confidence: 'high',
  },
  {
    name: 'OpenAI API key',
    re: /\b(sk-proj-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{32,})\b/,
    severity: 'critical',
    confidence: 'high',
  },
  {
    name: 'generic hardcoded credential',
    re: /(?:api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)\s*[:=]\s*['"]([A-Za-z0-9_\-/.+=]{20,})['"]/i,
    severity: 'high',
    confidence: 'medium',
  },
];

export const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{5,}\b/;

interface DecodedJwt {
  role?: string;
  iss?: string;
}

function decodeJwtPayload(token: string): DecodedJwt | null {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[1] === undefined) return null;
  try {
    const json = Buffer.from(parts[1], 'base64url').toString('utf8');
    const payload: unknown = JSON.parse(json);
    if (typeof payload !== 'object' || payload === null) return null;
    const obj = payload as Record<string, unknown>;
    if (!('exp' in obj) && !('iat' in obj) && !('iss' in obj)) return null;
    return obj as DecodedJwt;
  } catch {
    return null;
  }
}

const ENV_EXEMPT = new Set(['.env.example', '.env.sample', '.env.template']);

/**
 * Obviously-real live keys. In non-production paths (tests, fixtures, docs)
 * placeholder credentials are suppressed entirely — but a leaked LIVE key in
 * a test file is a real breach class, so these still fire, at medium
 * confidence.
 */
const LIVE_KEY_PATTERNS = new Set(['AWS access key ID', 'Stripe live secret key', 'Stripe live restricted key']);

function isCommittedEnvFile(relPath: string): boolean {
  const base = path.basename(relPath);
  return base.startsWith('.env') && !ENV_EXEMPT.has(base) && !base.endsWith('.example');
}

export const hardcodedSecretsRule: Rule = {
  id: 'safe/hardcoded-secrets',
  axis: 'SAFE',
  description:
    'Detects hardcoded secrets (API keys, service_role JWTs, AWS keys, private keys) and committed .env files.',
  check(ctx) {
    const findings: Finding[] = [];

    for (const file of ctx.files) {
      const nonProduction = isNonProductionPath(file.relPath);

      if (!nonProduction && isCommittedEnvFile(file.relPath) && /^\s*[A-Z0-9_]+\s*=\s*\S+/m.test(file.content)) {
        findings.push({
          ruleId: this.id,
          axis: this.axis,
          severity: 'high',
          confidence: 'high',
          message: `Committed environment file with secret values: ${file.relPath}`,
          file: file.relPath,
          line: 1,
        });
      }

      for (const pattern of PATTERNS) {
        if (nonProduction && !LIVE_KEY_PATTERNS.has(pattern.name)) continue;
        for (let i = 0; i < file.lines.length; i++) {
          const line = file.lines[i];
          if (line === undefined) continue;
          if (pattern.re.test(line)) {
            findings.push({
              ruleId: this.id,
              axis: this.axis,
              severity: pattern.severity,
              confidence: nonProduction ? 'medium' : pattern.confidence,
              message: `Hardcoded ${pattern.name} in source`,
              file: file.relPath,
              line: i + 1,
            });
            break; // one finding per pattern per file
          }
        }
      }

      for (let i = 0; i < file.lines.length; i++) {
        const line = file.lines[i];
        if (line === undefined) continue;
        const match = JWT_RE.exec(line);
        if (!match) continue;
        const payload = decodeJwtPayload(match[0]);
        if (!payload) continue;
        const isServiceRole = payload.role === 'service_role';
        findings.push({
          ruleId: this.id,
          axis: this.axis,
          severity: isServiceRole ? 'critical' : 'high',
          confidence: nonProduction ? 'medium' : 'high',
          message: isServiceRole
            ? 'Hardcoded Supabase service_role JWT — bypasses all row level security'
            : 'Hardcoded JWT in source',
          file: file.relPath,
          line: i + 1,
        });
        break; // one JWT finding per file
      }
    }

    return findings;
  },
};
