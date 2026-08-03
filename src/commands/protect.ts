import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * `umbra protect` — installs the guard engine into supported CLI coding
 * agents as a PreToolUse hook, so every Write/Edit/MultiEdit the agent
 * attempts is checked by `umbra guard --stdin` before it lands on disk.
 *
 * Two adapters, both deliberately dependency-free:
 * - claude: JSON merge into `.claude/settings.json` (project) or
 *   `~/.claude/settings.json` (--global). Existing settings and foreign
 *   hooks are preserved; the umbra entry is detected by its command string
 *   for idempotency.
 * - kimi: append-only marked block in `~/.kimi-code/config.toml`, delimited
 *   by marker comments so `--remove` deletes exactly what we added.
 */

export interface ProtectOptions {
  /** Install into user-level config instead of project-level (claude). */
  global?: boolean;
  /** Restrict to one agent ('claude' | 'kimi'). Default: auto-detect. */
  agent?: string;
  /** Remove the umbra hooks instead of installing them. */
  remove?: boolean;
  /** Override the home directory (tests). Defaults to os.homedir(). */
  home?: string;
  /** Override the project directory (tests). Defaults to process.cwd(). */
  cwd?: string;
  /** Override the PATH used for binary detection (tests). */
  pathEnv?: string;
}

export interface ProtectResult {
  /** Absolute config paths that gained an umbra hook. */
  installed: string[];
  /** Absolute config paths the umbra hook was removed from. */
  removed: string[];
  /** Absolute config paths left untouched (already installed / nothing to remove / unsafe to touch). */
  skipped: string[];
  /** Human-readable explanations for skips and non-fatal conditions. */
  notes: string[];
}

export const SUPPORTED_AGENTS = ['claude', 'kimi'] as const;
export type ProtectAgent = (typeof SUPPORTED_AGENTS)[number];

export const KIMI_BLOCK_START = '# >>> umbra guard >>>';
export const KIMI_BLOCK_END = '# <<< umbra guard <<<';

/** Substring present in every umbra guard hook command, both bin and npx forms. */
const UMBRA_COMMAND_MARKER = 'umbra guard --stdin';
const CLAUDE_MATCHER = 'Write|Edit|MultiEdit';
const KIMI_MATCHER = '^(Write|Edit|StrReplace.*|MultiEdit.*)$';
const NPX_GUARD_COMMAND = 'npx --yes @elberacasa/umbra guard --stdin';

type JsonObject = Record<string, unknown>;

async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function readFileIfExists(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, 'utf8');
  } catch {
    return null;
  }
}

/** Locates a binary on the given PATH (POSIX-style lookup). */
async function findOnPath(bin: string, pathEnv: string): Promise<boolean> {
  for (const dir of pathEnv.split(path.delimiter)) {
    if (dir === '') continue;
    try {
      await fs.access(path.join(dir, bin), fs.constants.X_OK);
      return true;
    } catch {
      // not here — keep looking
    }
  }
  return false;
}

/**
 * The command the installed hooks will run. Prefers a global `umbra` bin
 * (fast, offline) and falls back to npx (works right after `npx` first use).
 */
async function resolveGuardCommand(pathEnv: string): Promise<string> {
  if (await findOnPath('umbra', pathEnv)) return `umbra guard --stdin`;
  return NPX_GUARD_COMMAND;
}

async function detectAgent(agent: ProtectAgent, home: string, pathEnv: string): Promise<boolean> {
  if (agent === 'claude') {
    return (await isDirectory(path.join(home, '.claude'))) || (await findOnPath('claude', pathEnv));
  }
  return (await isDirectory(path.join(home, '.kimi-code'))) || (await findOnPath('kimi', pathEnv));
}

// ---------------------------------------------------------------------------
// claude adapter — .claude/settings.json
// ---------------------------------------------------------------------------

function asObject(value: unknown): JsonObject | null {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as JsonObject;
  }
  return null;
}

/** True when a PreToolUse matcher group already contains an umbra guard hook. */
function isUmbraGroup(group: unknown): boolean {
  const obj = asObject(group);
  if (obj === null || !Array.isArray(obj.hooks)) return false;
  return obj.hooks.some((hook) => {
    const h = asObject(hook);
    return typeof h?.command === 'string' && h.command.includes(UMBRA_COMMAND_MARKER);
  });
}

/**
 * Best-effort preservation of the original file's formatting: JSON round-trip
 * keeps key order; we additionally match the detected indent and trailing
 * newline so install → remove returns the file byte-identical for
 * conventionally formatted settings.
 */
function detectIndent(raw: string): string {
  const match = /\n([ \t]+)\S/.exec(raw);
  return match?.[1] ?? '  ';
}

function serializeSettings(settings: JsonObject, raw: string | null): string {
  const indent = raw === null ? '  ' : detectIndent(raw);
  const trailingNewline = raw === null || raw.endsWith('\n');
  return JSON.stringify(settings, null, indent) + (trailingNewline ? '\n' : '');
}

interface ClaudeSettings {
  settings: JsonObject;
  raw: string | null;
}

/** Reads and parses settings.json; returns null (after noting) when unsafe to touch. */
async function readClaudeSettings(
  settingsPath: string,
  result: ProtectResult,
): Promise<ClaudeSettings | null> {
  const raw = await readFileIfExists(settingsPath);
  if (raw === null || raw.trim() === '') {
    return { settings: {}, raw };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    result.skipped.push(settingsPath);
    result.notes.push(
      `${settingsPath} is not valid JSON (${error instanceof Error ? error.message : String(error)}) — left unchanged. Fix it or remove it and re-run.`,
    );
    return null;
  }
  const settings = asObject(parsed);
  if (settings === null) {
    result.skipped.push(settingsPath);
    result.notes.push(`${settingsPath} must contain a JSON object — left unchanged.`);
    return null;
  }
  return { settings, raw };
}

async function installClaude(settingsPath: string, guardCmd: string, result: ProtectResult): Promise<void> {
  const loaded = await readClaudeSettings(settingsPath, result);
  if (loaded === null) return;
  const { settings, raw } = loaded;

  const hooksValue = settings.hooks;
  if (hooksValue !== undefined && asObject(hooksValue) === null) {
    result.skipped.push(settingsPath);
    result.notes.push(`${settingsPath}: "hooks" is not an object — left unchanged.`);
    return;
  }
  const hooks = (asObject(hooksValue) ?? {}) as JsonObject;

  const preValue = hooks.PreToolUse;
  if (preValue !== undefined && !Array.isArray(preValue)) {
    result.skipped.push(settingsPath);
    result.notes.push(`${settingsPath}: "hooks.PreToolUse" is not an array — left unchanged.`);
    return;
  }
  const preToolUse = (Array.isArray(preValue) ? preValue : []) as unknown[];

  if (preToolUse.some(isUmbraGroup)) {
    result.skipped.push(settingsPath);
    result.notes.push(`${settingsPath} already has an umbra guard hook — left unchanged.`);
    return;
  }

  preToolUse.push({
    matcher: CLAUDE_MATCHER,
    hooks: [{ type: 'command', command: guardCmd }],
  });
  hooks.PreToolUse = preToolUse;
  settings.hooks = hooks;

  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, serializeSettings(settings, raw), 'utf8');
  result.installed.push(settingsPath);
}

async function removeClaude(settingsPath: string, result: ProtectResult): Promise<void> {
  const loaded = await readClaudeSettings(settingsPath, result);
  if (loaded === null) return;
  const { settings, raw } = loaded;

  const hooks = asObject(settings.hooks);
  const preToolUse = hooks !== null && Array.isArray(hooks.PreToolUse) ? (hooks.PreToolUse as unknown[]) : null;
  if (hooks === null || preToolUse === null || !preToolUse.some(isUmbraGroup)) {
    result.skipped.push(settingsPath);
    result.notes.push(`${settingsPath} has no umbra guard hook — nothing to remove.`);
    return;
  }

  // Strip umbra hooks from every matcher group; drop groups we emptied.
  const kept = preToolUse
    .map((group) => {
      const obj = asObject(group);
      if (obj === null || !Array.isArray(obj.hooks)) return group;
      const foreign = obj.hooks.filter((hook) => {
        const h = asObject(hook);
        return !(typeof h?.command === 'string' && h.command.includes(UMBRA_COMMAND_MARKER));
      });
      if (foreign.length === obj.hooks.length) return group;
      if (foreign.length === 0) return null;
      return { ...obj, hooks: foreign };
    })
    .filter((group): group is unknown => group !== null);

  // Only delete keys we may have created: an empty PreToolUse array and an
  // empty hooks object. Foreign content is never removed.
  if (kept.length === 0) {
    delete hooks.PreToolUse;
  } else {
    hooks.PreToolUse = kept;
  }
  if (Object.keys(hooks).length === 0) {
    delete settings.hooks;
  } else {
    settings.hooks = hooks;
  }

  await fs.writeFile(settingsPath, serializeSettings(settings, raw), 'utf8');
  result.removed.push(settingsPath);
}

// ---------------------------------------------------------------------------
// kimi adapter — ~/.kimi-code/config.toml (append-only, marker-delimited)
// ---------------------------------------------------------------------------

function kimiBlock(guardCmd: string): string {
  // JSON.stringify produces a quoting that is also a valid TOML basic string
  // for the character sets our commands use.
  return [
    KIMI_BLOCK_START,
    '[[hooks]]',
    'event = "PreToolUse"',
    `matcher = ${JSON.stringify(KIMI_MATCHER)}`,
    `command = ${JSON.stringify(guardCmd)}`,
    'timeout = 10',
    KIMI_BLOCK_END,
    '',
  ].join('\n');
}

async function installKimi(configPath: string, guardCmd: string, result: ProtectResult): Promise<void> {
  const raw = await readFileIfExists(configPath);

  if (raw !== null && raw.includes(KIMI_BLOCK_START)) {
    result.skipped.push(configPath);
    result.notes.push(`${configPath} already has an umbra guard block — left unchanged.`);
    return;
  }

  let next: string;
  if (raw === null || raw === '') {
    next = kimiBlock(guardCmd);
  } else if (raw.endsWith('\n')) {
    next = raw + kimiBlock(guardCmd);
  } else {
    // File lacks a trailing newline; add one so our block starts on its own
    // line. `--remove` cannot undo this single added newline — every other
    // byte is restored exactly.
    next = `${raw}\n${kimiBlock(guardCmd)}`;
  }

  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, next, 'utf8');
  result.installed.push(configPath);
}

async function removeKimi(configPath: string, result: ProtectResult): Promise<void> {
  const raw = await readFileIfExists(configPath);
  if (raw === null || !raw.includes(KIMI_BLOCK_START)) {
    result.skipped.push(configPath);
    result.notes.push(`${configPath} has no umbra guard block — nothing to remove.`);
    return;
  }

  const startMarker = raw.indexOf(KIMI_BLOCK_START);
  const endMarker = raw.indexOf(KIMI_BLOCK_END, startMarker);
  if (endMarker === -1) {
    result.skipped.push(configPath);
    result.notes.push(
      `${configPath} has a malformed umbra guard block (missing end marker) — left unchanged. Remove it manually.`,
    );
    return;
  }

  // Delete from the start of the start-marker line through the end of the
  // end-marker line, including the block's own trailing newline. Bytes
  // before and after the block are preserved exactly.
  const blockStart = raw.lastIndexOf('\n', startMarker) + 1;
  let blockEnd = endMarker + KIMI_BLOCK_END.length;
  if (raw[blockEnd] === '\r') blockEnd += 1;
  if (raw[blockEnd] === '\n') blockEnd += 1;
  const next = raw.slice(0, blockStart) + raw.slice(blockEnd);

  if (next.trim() === '') {
    // The file only ever held our block (we created it) — remove it entirely.
    await fs.unlink(configPath);
  } else {
    await fs.writeFile(configPath, next, 'utf8');
  }
  result.removed.push(configPath);
}

// ---------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------

/**
 * Installs (or, with `remove`, uninstalls) the umbra guard PreToolUse hook
 * for each target agent. Never clobbers existing configuration: foreign
 * hooks are preserved, malformed files are skipped with a note, and a second
 * run is a no-op.
 */
export async function runProtect(opts: ProtectOptions = {}): Promise<ProtectResult> {
  const home = opts.home ?? os.homedir();
  const cwd = opts.cwd ?? process.cwd();
  const pathEnv = opts.pathEnv ?? process.env.PATH ?? '';
  const result: ProtectResult = { installed: [], removed: [], skipped: [], notes: [] };

  let agents: ProtectAgent[];
  if (opts.agent !== undefined) {
    if (!(SUPPORTED_AGENTS as readonly string[]).includes(opts.agent)) {
      throw new Error(
        `unknown agent "${opts.agent}" — supported agents: ${SUPPORTED_AGENTS.join(', ')}.`,
      );
    }
    agents = [opts.agent as ProtectAgent];
  } else {
    agents = [];
    for (const agent of SUPPORTED_AGENTS) {
      if (await detectAgent(agent, home, pathEnv)) agents.push(agent);
    }
    if (agents.length === 0) {
      result.notes.push(
        'No supported agents detected (looked for `claude` and `kimi` on PATH and for ~/.claude and ~/.kimi-code). Re-run with --agent <name> to install anyway.',
      );
      return result;
    }
  }

  const guardCmd = await resolveGuardCommand(pathEnv);

  for (const agent of agents) {
    if (agent === 'claude') {
      const settingsPath = opts.global === true
        ? path.join(home, '.claude', 'settings.json')
        : path.join(cwd, '.claude', 'settings.json');
      if (opts.remove === true) {
        await removeClaude(settingsPath, result);
      } else {
        await installClaude(settingsPath, guardCmd, result);
      }
    } else {
      const configPath = path.join(home, '.kimi-code', 'config.toml');
      if (opts.remove === true) {
        await removeKimi(configPath, result);
      } else {
        await installKimi(configPath, guardCmd, result);
      }
    }
  }

  if (opts.remove !== true && result.installed.length > 0) {
    result.notes.push(
      `Guard command: \`${guardCmd}\`. Hooks ask the agent to check every Write/Edit/MultiEdit before it lands; they fail open by design — a guardrail, not a sandbox.`,
    );
  }
  if (opts.remove === true && result.removed.length > 0) {
    result.notes.push('Umbra guard hooks removed. Other hooks and settings were left untouched.');
  }

  return result;
}
