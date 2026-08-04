import pc from 'picocolors';
import type { Finding } from '../engine/types.js';
import { guardContent } from './guard.js';

export interface GuardHookResult {
  exitCode: number;
  stderr: string;
}

/** Tools whose writes we guard (aligned with the `protect` hook matchers). */
const WRITE_TOOL_RE = /^(Write|Edit|StrReplace.*|MultiEdit.*)$/;

/** One-line remediation per rule, written for the agent to act on. */
export const REMEDIATION: Record<string, string> = {
  'safe/hardcoded-secrets':
    'Move the secret into an untracked .env read via process.env, and rotate it if it was ever real',
  'safe/injection-sinks':
    'Use parameterized queries instead of string interpolation, and never eval() or new Function() input',
  'safe/jwt-misconfig':
    'Pass an explicit algorithms allowlist to jwt.verify, set expiresIn on jwt.sign, and never authorize from jwt.decode',
  'safe/cors-wildcard':
    'Replace the wildcard origin with an explicit allowlist of trusted origins',
  'safe/debug-flags':
    'Remove the bypass or gate it behind an explicit config that cannot ship to production',
  'safe/default-credentials':
    'Use a strong unique credential from the environment, not a default literal',
  'safe/supabase-antipatterns':
    'Use the anon key in client code, move privileged queries behind a server route, and enable RLS policies on every table',
  'safe/missing-auth-routes':
    'Add an auth check at the top of the route handler and return 401 before touching data',
  'safe/missing-rate-limit':
    'Add rate limiting to the auth endpoint (middleware or a library like limiter) to blunt brute force',
  'safe/hallucinated-deps':
    'Remove or replace dependencies that do not resolve on npm; a nonexistent package name can be squatted maliciously',
  'safe/exposed-sensitive-files':
    'Remove the file from the repo and from git history, rotate any credential it contains, and gitignore the pattern',
  'clean/dead-exports':
    'Delete the unused export or wire it in; dead surface area rots',
  'clean/unused-deps':
    'Remove the dependency from package.json; unused deps are supply-chain surface for zero value',
  'clean/large-files':
    'Split the file by responsibility; files this size are where agents hide mistakes',
  'clean/duplication':
    'Extract the duplicated block into one shared function and call it from both sites',
};

const ALLOW = 0;
const BLOCK = 2;

function allowNote(reason: string): GuardHookResult {
  return { exitCode: ALLOW, stderr: pc.dim(`umbra: guard skipped — ${reason}\n`) };
}

function locationOf(finding: Finding, filePath: string): string {
  const file = finding.file ?? filePath;
  return finding.line !== undefined ? `${file}:${finding.line}` : file;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface NormalizedWrite {
  filePath: string;
  content: string;
}

function normalizePayload(payload: Record<string, unknown>): NormalizedWrite | undefined {
  const toolName = payload.tool_name ?? payload.toolName;
  if (typeof toolName !== 'string' || !WRITE_TOOL_RE.test(toolName)) return undefined;

  const toolInput = payload.tool_input ?? payload.toolInput;
  if (!isRecord(toolInput)) return undefined;

  const filePath = toolInput.file_path ?? toolInput.path;
  if (typeof filePath !== 'string' || filePath.trim() === '') return undefined;

  if (typeof toolInput.content === 'string') return { filePath, content: toolInput.content };
  if (typeof toolInput.new_string === 'string') return { filePath, content: toolInput.new_string };
  if (Array.isArray(toolInput.edits)) {
    const parts: string[] = [];
    for (const edit of toolInput.edits) {
      if (isRecord(edit) && typeof edit.new_string === 'string') parts.push(edit.new_string);
    }
    if (parts.length > 0) return { filePath, content: parts.join('\n') };
  }
  return undefined;
}

function blockMessage(
  ruleId: string,
  what: string,
  location: string,
  extraBlocking: number,
): string {
  const fix = REMEDIATION[ruleId];
  const suffix = extraBlocking > 0 ? ` (+${extraBlocking} more blocking finding${extraBlocking === 1 ? '' : 's'})` : '';
  return (
    `UMBRA BLOCKED this write: ${ruleId} — ${what} at ${location}.` +
    (fix !== undefined ? ` ${fix}.` : '') +
    `${suffix}\n`
  );
}

/**
 * Handles one agent-hook payload (Claude Code / Kimi Code PreToolUse shape)
 * and maps the guard verdict onto the hook contract: exit 0 = allow
 * (warnings go to stderr, non-blocking), exit 2 = block with an actionable
 * stderr reason for the agent. Anything we cannot understand — malformed
 * JSON, unknown tools, writes without content — allows with a dim note.
 * This function must never throw: our own errors fail open.
 */
export async function runGuardPayload(stdinText: string): Promise<GuardHookResult> {
  try {
    let payload: unknown;
    try {
      payload = JSON.parse(stdinText);
    } catch {
      return allowNote('payload is not valid JSON');
    }
    if (!isRecord(payload)) return allowNote('payload is not a JSON object');

    const toolName = payload.tool_name ?? payload.toolName;
    if (typeof toolName !== 'string' || !WRITE_TOOL_RE.test(toolName)) {
      return allowNote(`tool '${typeof toolName === 'string' ? toolName : 'unknown'}' is not a guarded write tool`);
    }

    const write = normalizePayload(payload);
    if (write === undefined) return allowNote('no file path or content to guard');

    const verdict = await guardContent(write.filePath, write.content);

    if (verdict.decision === 'block') {
      if (verdict.pathViolation !== undefined) {
        return {
          exitCode: BLOCK,
          stderr: `UMBRA BLOCKED this write: guard/path-guard — ${verdict.pathViolation}\n`,
        };
      }
      const blocking = verdict.findings.filter(
        (f) => f.confidence === 'high' && (f.severity === 'critical' || f.severity === 'high'),
      );
      const first = blocking[0] ?? verdict.findings[0];
      if (first === undefined) return { exitCode: ALLOW, stderr: '' };
      return {
        exitCode: BLOCK,
        stderr: blockMessage(
          first.ruleId,
          first.message,
          locationOf(first, write.filePath),
          blocking.length - 1,
        ),
      };
    }

    if (verdict.decision === 'warn') {
      const first = verdict.findings[0];
      if (first === undefined) return { exitCode: ALLOW, stderr: '' };
      const extra = verdict.findings.length - 1;
      const suffix = extra > 0 ? ` (+${extra} more)` : '';
      return {
        exitCode: ALLOW,
        stderr: pc.yellow(
          `umbra: warning — ${first.ruleId}: ${first.message} at ${locationOf(first, write.filePath)}${suffix}\n`,
        ),
      };
    }

    return { exitCode: ALLOW, stderr: '' };
  } catch (error) {
    // Fail open, always: a guard bug must never break the agent's flow.
    const message = error instanceof Error ? error.message : String(error);
    return { exitCode: ALLOW, stderr: pc.dim(`umbra: guard failed open — ${message}\n`) };
  }
}
