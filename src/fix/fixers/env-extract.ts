import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Finding } from '../../engine/types.js';
import { PATTERNS, JWT_RE } from '../../rules/safe/hardcoded-secrets.js';
import { CONNECTION_STRING_RE, PASSWORD_ASSIGN_RE } from '../../rules/safe/default-credentials.js';
import type { FixOutcome } from '../types.js';

export interface EnvExtractOptions {
  dryRun: boolean;
  /** Fallback env var name source when no assignment name can be derived. */
  nextFallbackName: () => string;
}

const ENV_EXEMPT = new Set(['.env.example', '.env.sample', '.env.template']);

/** Matches the committed-env class in safe/hardcoded-secrets. */
function isCommittedEnvPath(relPath: string): boolean {
  const base = path.basename(relPath);
  return base.startsWith('.env') && !ENV_EXEMPT.has(base) && !base.endsWith('.example');
}

const QUOTED_RE = /(['"])((?:\\.|(?!\1).)*?)\1/g;

interface QuotedLiteral {
  /** Full token including the quotes. */
  token: string;
  /** Contents between the quotes. */
  inner: string;
  /** Start offset of the token in the line. */
  index: number;
}

function quotedLiterals(line: string): QuotedLiteral[] {
  const out: QuotedLiteral[] = [];
  for (const m of line.matchAll(QUOTED_RE)) {
    out.push({ token: m[0], inner: m[2] ?? '', index: m.index });
  }
  return out;
}

/** camelCase / any identifier → UPPER_SNAKE env var name ('' when unusable). */
export function toEnvName(identifier: string): string {
  return identifier
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}

/** Derives the env var name from the assignment immediately before the literal. */
function deriveName(line: string, literalIndex: number, nextFallbackName: () => string): string {
  const prefix = line.slice(0, literalIndex);
  const m = /([A-Za-z_$][A-Za-z0-9_$]*)['"]?\s*[:=]\s*$/.exec(prefix);
  const name = m?.[1] !== undefined ? toEnvName(m[1]) : '';
  return name !== '' ? name : nextFallbackName();
}

const PRIVATE_KEY_RE = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;

/**
 * Locates the exact quoted literal a finding flagged, re-running the rule's
 * own patterns on the finding's line. Returns 'multiline' for private key
 * blocks (always manual) and null when no simple quoted literal matches
 * (also manual — splicing into a larger string is not provably safe).
 */
function locateLiteral(line: string, ruleId: string): QuotedLiteral | null | 'multiline' {
  if (PRIVATE_KEY_RE.test(line)) return 'multiline';
  const literals = quotedLiterals(line);

  if (ruleId === 'safe/default-credentials') {
    if (CONNECTION_STRING_RE.test(line)) {
      // Default user:pass inside a connection string: replace the whole string.
      return literals.find((l) => CONNECTION_STRING_RE.test(l.inner)) ?? null;
    }
    const m = PASSWORD_ASSIGN_RE.exec(line);
    if (m?.[1] !== undefined) {
      return literals.find((l) => l.inner === m[1]) ?? null;
    }
    return null;
  }

  // safe/hardcoded-secrets: the patterns capture the secret in group 1 (or 0).
  const secrets: string[] = [];
  for (const p of PATTERNS) {
    const m = p.re.exec(line);
    if (m !== null) secrets.push(m[1] ?? m[0]);
  }
  const jwt = JWT_RE.exec(line);
  if (jwt !== null) secrets.push(jwt[0]);
  for (const secret of secrets) {
    const hit = literals.find((l) => l.inner === secret);
    if (hit !== undefined) return hit;
  }
  return null;
}

const GITIGNORE_LINES = ['.env', '.env.*', '!.env.example'];

/**
 * Ensures .env and .env.* are gitignored, with an explicit exception so
 * .env.example stays committed. Returns true when the file was (or, in
 * dry-run, would be) changed.
 */
async function ensureGitignore(root: string, dryRun: boolean): Promise<boolean> {
  const giPath = path.join(root, '.gitignore');
  let existing = '';
  try {
    existing = await fs.readFile(giPath, 'utf8');
  } catch {
    // missing — will be created
  }
  const present = new Set(existing.split('\n').map((l) => l.trim()));
  const missing = GITIGNORE_LINES.filter((l) => !present.has(l));
  if (missing.length === 0) return false;
  if (!dryRun) {
    const sep = existing !== '' && !existing.endsWith('\n') ? '\n' : '';
    await fs.writeFile(giPath, `${existing}${sep}${missing.join('\n')}\n`, 'utf8');
  }
  return true;
}

/** Appends `NAME=<rotate-me>` to .env.example — creates it if missing, never clobbers existing keys. */
async function appendEnvExample(root: string, name: string): Promise<void> {
  const examplePath = path.join(root, '.env.example');
  let existing = '';
  try {
    existing = await fs.readFile(examplePath, 'utf8');
  } catch {
    // missing — will be created
  }
  const hasKey = existing.split('\n').some((l) => l.startsWith(`${name}=`));
  if (hasKey) return;
  const sep = existing !== '' && !existing.endsWith('\n') ? '\n' : '';
  await fs.writeFile(examplePath, `${existing}${sep}${name}=<rotate-me>\n`, 'utf8');
}

/**
 * The env-extraction transform shared by safe/hardcoded-secrets and
 * safe/default-credentials: replace a hardcoded credential literal with
 * process.env.<NAME>, record a placeholder in .env.example, and gitignore
 * real env files. A committed .env is never rewritten — it is gitignored
 * and reported manual (rotate + purge from history).
 */
export async function extractEnvVar(root: string, finding: Finding, opts: EnvExtractOptions): Promise<FixOutcome> {
  if (finding.file === undefined) {
    return { status: 'manual', description: 'finding has no file location — extract the credential by hand' };
  }
  const relPath = finding.file;

  if (isCommittedEnvPath(relPath)) {
    const changed = await ensureGitignore(root, opts.dryRun);
    const action = opts.dryRun
      ? 'would add it to .gitignore'
      : changed
        ? 'added it to .gitignore'
        : 'it is already gitignored';
    return {
      status: 'manual',
      description: `${relPath} is a committed env file — ${action}; manual: rotate the key and purge it from git history`,
    };
  }

  const absPath = path.join(root, relPath);
  let content: string;
  try {
    content = await fs.readFile(absPath, 'utf8');
  } catch {
    return { status: 'skipped', description: `${relPath} could not be read` };
  }
  const lines = content.split('\n');
  const lineNo = finding.line ?? 1;
  const line = lines[lineNo - 1];
  if (line === undefined) {
    return { status: 'skipped', description: `${relPath}:${lineNo} no longer exists` };
  }

  const located = locateLiteral(line, finding.ruleId);
  if (located === 'multiline') {
    return { status: 'manual', description: 'multi-line private key material — move it to a secrets manager by hand' };
  }
  if (located === null) {
    return { status: 'manual', description: 'credential is not a simple quoted string literal — extract it by hand' };
  }

  const name = deriveName(line, located.index, opts.nextFallbackName);
  const newLine = `${line.slice(0, located.index)}process.env.${name}${line.slice(located.index + located.token.length)}`;
  const newContent = [...lines.slice(0, lineNo - 1), newLine, ...lines.slice(lineNo)].join('\n');

  if (!opts.dryRun) {
    await fs.writeFile(absPath, newContent, 'utf8');
    await appendEnvExample(root, name);
    await ensureGitignore(root, false);
  }
  return {
    status: 'applied',
    description: `${relPath}:${lineNo} — replace the literal with process.env.${name} and add ${name}=<rotate-me> to .env.example`,
  };
}
