/**
 * Path guard — always on, independent of rules. Blocks writes to locations
 * where the write itself is the attack, before any content rule runs.
 */

const ENV_EXEMPT = new Set(['.env.example', '.env.sample', '.env.template']);

/**
 * Live-key material: recognizable credential formats only. The inline path
 * has a zero-false-positive bar, so this list deliberately excludes generic
 * heuristics (entropy, word lists) that fire on placeholders and examples.
 */
const LIVE_KEY_PATTERNS: RegExp[] = [
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key ID
  /aws_secret_access_key\s*[:=]\s*['"]?[A-Za-z0-9/+=]{40}['"]?/i, // AWS secret
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/,
  /\b[sr]k_live_[0-9a-zA-Z]{16,}\b/, // Stripe live keys
  /\bgh[op]_[0-9A-Za-z]{36,}\b/, // GitHub tokens
  /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/, // Slack tokens
  /\b(sk-proj-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{32,})\b/, // OpenAI keys
];

const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{5,}\b/;

/** Long value assigned to a secret-looking env var, excluding obvious placeholders. */
const ENV_SECRET_ASSIGN_RE =
  /^[A-Z0-9_]*(?:SECRET|TOKEN|API[_-]?KEY|PRIVATE[_-]?KEY|ACCESS[_-]?KEY)[A-Z0-9_]*\s*=\s*['"]?([A-Za-z0-9_\-/.+=]{20,})['"]?\s*$/;
const PLACEHOLDER_RE =
  /^(?:your[-_ ]|change[-_ ]?me|changeme|xxx+|\*+|redacted|placeholder|example|dummy|fake|test|none|null|todo|insert[-_ ]|put[-_ ]|replace[-_ ])/i;

function isServiceRoleJwt(content: string): boolean {
  const match = JWT_RE.exec(content);
  if (!match) return false;
  const parts = match[0].split('.');
  if (parts.length !== 3 || parts[1] === undefined) return false;
  try {
    const payload: unknown = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return (
      typeof payload === 'object' &&
      payload !== null &&
      (payload as Record<string, unknown>).role === 'service_role'
    );
  } catch {
    return false;
  }
}

function isEnvTarget(base: string): boolean {
  if (!base.startsWith('.env')) return false;
  if (base === '.env') return true;
  if (!base.startsWith('.env.')) return false; // e.g. ".environment" is not an env file
  return !ENV_EXEMPT.has(base) && !base.endsWith('.example');
}

function containsLiveKeyMaterial(content: string): boolean {
  if (LIVE_KEY_PATTERNS.some((re) => re.test(content))) return true;
  if (isServiceRoleJwt(content)) return true;
  for (const line of content.split('\n')) {
    const match = ENV_SECRET_ASSIGN_RE.exec(line.trim());
    if (match && match[1] !== undefined && !PLACEHOLDER_RE.test(match[1])) return true;
  }
  return false;
}

function normalizeSegments(filePath: string): string[] {
  return filePath
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.');
}

/**
 * Returns a human-readable block reason when the target path is protected,
 * or undefined when the path is fair game for content rules.
 */
export function checkPathViolation(filePath: string, content: string): string | undefined {
  const segments = normalizeSegments(filePath);

  const gitIndex = segments.indexOf('.git');
  if (gitIndex !== -1) {
    const next = segments[gitIndex + 1];
    if (next === 'hooks') {
      return (
        `Refusing to write into .git/hooks (${filePath}): an agent-planted git hook executes on the ` +
        `user's next git command — a known sandbox escape (CVE-2026-26268). ` +
        `Print the hook contents and ask the user to install it manually instead.`
      );
    }
    if (next === 'config' && gitIndex + 2 === segments.length) {
      return (
        `Refusing to write .git/config (${filePath}): hook paths and remotes configured there execute ` +
        `or exfiltrate on the user's next git command. Show the user the change and let them apply it.`
      );
    }
  }

  const base = segments[segments.length - 1] ?? filePath;
  if (isEnvTarget(base) && containsLiveKeyMaterial(content)) {
    return (
      `Refusing to write live credentials into ${base}: environment files with real keys must be ` +
      `created by the user, never by an agent. Write ${base}.example with placeholder values and ` +
      `tell the user which variables to fill in.`
    );
  }

  return undefined;
}
