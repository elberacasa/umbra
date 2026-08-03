import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { KIMI_BLOCK_END, KIMI_BLOCK_START, runProtect } from '../../src/commands/protect';

interface Env {
  home: string;
  cwd: string;
  /** PATH that contains no agent binaries and no umbra bin. */
  pathEnv: string;
}

function makeEnv(): Env {
  const base = mkdtempSync(path.join(tmpdir(), 'umbra-protect-'));
  const home = path.join(base, 'home');
  const cwd = path.join(base, 'project');
  const emptyBin = path.join(base, 'bin');
  mkdirSync(home, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  mkdirSync(emptyBin, { recursive: true });
  return { home, cwd, pathEnv: emptyBin };
}

function read(p: string): string {
  return readFileSync(p, 'utf8');
}

function claudeProjectPath(env: Env): string {
  return path.join(env.cwd, '.claude', 'settings.json');
}

function claudeGlobalPath(env: Env): string {
  return path.join(env.home, '.claude', 'settings.json');
}

function kimiPath(env: Env): string {
  return path.join(env.home, '.kimi-code', 'config.toml');
}

describe('commands/protect — claude adapter', () => {
  it('installs a PreToolUse hook into a fresh project settings.json', async () => {
    const env = makeEnv();
    const result = await runProtect({ ...env, agent: 'claude' });

    expect(result.installed).toEqual([claudeProjectPath(env)]);
    const settings = JSON.parse(read(claudeProjectPath(env))) as {
      hooks: { PreToolUse: Array<{ matcher: string; hooks: Array<{ type: string; command: string }> }> };
    };
    expect(settings.hooks.PreToolUse).toHaveLength(1);
    expect(settings.hooks.PreToolUse[0]?.matcher).toBe('Write|Edit|MultiEdit');
    expect(settings.hooks.PreToolUse[0]?.hooks).toEqual([
      { type: 'command', command: 'npx --yes @elberacasa/umbra guard --stdin' },
    ]);
  });

  it('installs into ~/.claude/settings.json with --global', async () => {
    const env = makeEnv();
    const result = await runProtect({ ...env, agent: 'claude', global: true });

    expect(result.installed).toEqual([claudeGlobalPath(env)]);
    expect(existsSync(claudeProjectPath(env))).toBe(false);
    expect(read(claudeGlobalPath(env))).toContain('umbra guard --stdin');
  });

  it('prefers the umbra bin when one is on PATH', async () => {
    const env = makeEnv();
    const umbraBin = path.join(env.pathEnv, 'umbra');
    writeFileSync(umbraBin, '#!/bin/sh\n');
    chmodSync(umbraBin, 0o755);

    await runProtect({ ...env, agent: 'claude' });

    const settings = JSON.parse(read(claudeProjectPath(env))) as {
      hooks: { PreToolUse: Array<{ hooks: Array<{ command: string }> }> };
    };
    expect(settings.hooks.PreToolUse[0]?.hooks[0]?.command).toBe('umbra guard --stdin');
  });

  it('preserves foreign settings and hooks, and --remove restores the file byte-identical', async () => {
    const env = makeEnv();
    const original = `${JSON.stringify(
      {
        model: 'claude-opus-4-6',
        hooks: {
          PreToolUse: [
            { matcher: 'Bash', hooks: [{ type: 'command', command: 'my-linter --check' }] },
          ],
          SessionStart: [{ hooks: [{ type: 'command', command: 'echo hi' }] }],
        },
        env: { FOO: 'bar' },
      },
      null,
      2,
    )}\n`;
    mkdirSync(path.dirname(claudeProjectPath(env)), { recursive: true });
    writeFileSync(claudeProjectPath(env), original);

    const install = await runProtect({ ...env, agent: 'claude' });
    expect(install.installed).toEqual([claudeProjectPath(env)]);
    const merged = JSON.parse(read(claudeProjectPath(env))) as {
      model: string;
      env: { FOO: string };
      hooks: { PreToolUse: Array<{ matcher: string }>; SessionStart: unknown[] };
    };
    expect(merged.model).toBe('claude-opus-4-6');
    expect(merged.env.FOO).toBe('bar');
    expect(merged.hooks.SessionStart).toHaveLength(1);
    expect(merged.hooks.PreToolUse.map((g) => g.matcher)).toEqual(['Bash', 'Write|Edit|MultiEdit']);

    const remove = await runProtect({ ...env, agent: 'claude', remove: true });
    expect(remove.removed).toEqual([claudeProjectPath(env)]);
    expect(read(claudeProjectPath(env))).toBe(original);
  });

  it('keeps foreign hooks inside a shared matcher group when removing', async () => {
    const env = makeEnv();
    // Simulate a hand-merged group: umbra hook alongside a foreign one.
    const withForeign = `${JSON.stringify(
      {
        hooks: {
          PreToolUse: [
            {
              matcher: 'Write|Edit|MultiEdit',
              hooks: [
                { type: 'command', command: 'my-formatter' },
                { type: 'command', command: 'npx --yes @elberacasa/umbra guard --stdin' },
              ],
            },
          ],
        },
      },
      null,
      2,
    )}\n`;
    mkdirSync(path.dirname(claudeProjectPath(env)), { recursive: true });
    writeFileSync(claudeProjectPath(env), withForeign);

    // Install sees the existing umbra hook and is a no-op.
    const install = await runProtect({ ...env, agent: 'claude' });
    expect(install.installed).toEqual([]);
    expect(install.skipped).toEqual([claudeProjectPath(env)]);
    expect(read(claudeProjectPath(env))).toBe(withForeign);

    // Remove strips only the umbra hook, keeping the foreign one in place.
    const remove = await runProtect({ ...env, agent: 'claude', remove: true });
    expect(remove.removed).toEqual([claudeProjectPath(env)]);
    const after = JSON.parse(read(claudeProjectPath(env))) as {
      hooks: { PreToolUse: Array<{ hooks: Array<{ command: string }> }> };
    };
    expect(after.hooks.PreToolUse).toHaveLength(1);
    expect(after.hooks.PreToolUse[0]?.hooks).toEqual([{ type: 'command', command: 'my-formatter' }]);
  });

  it('never touches invalid JSON and reports it', async () => {
    const env = makeEnv();
    mkdirSync(path.dirname(claudeProjectPath(env)), { recursive: true });
    writeFileSync(claudeProjectPath(env), '{ "hooks": nope');

    const result = await runProtect({ ...env, agent: 'claude' });

    expect(result.installed).toEqual([]);
    expect(result.skipped).toEqual([claudeProjectPath(env)]);
    expect(result.notes.some((n) => n.includes('not valid JSON'))).toBe(true);
    expect(read(claudeProjectPath(env))).toBe('{ "hooks": nope');
  });

  it('remove on a file without umbra hooks is a no-op', async () => {
    const env = makeEnv();
    const original = '{ "hooks": { "PreToolUse": [] } }\n';
    mkdirSync(path.dirname(claudeProjectPath(env)), { recursive: true });
    writeFileSync(claudeProjectPath(env), original);

    const result = await runProtect({ ...env, agent: 'claude', remove: true });

    expect(result.removed).toEqual([]);
    expect(result.skipped).toEqual([claudeProjectPath(env)]);
    expect(read(claudeProjectPath(env))).toBe(original);
  });
});

describe('commands/protect — kimi adapter', () => {
  it('appends the marked hook block, creating config.toml when missing', async () => {
    const env = makeEnv();
    const result = await runProtect({ ...env, agent: 'kimi' });

    expect(result.installed).toEqual([kimiPath(env)]);
    const config = read(kimiPath(env));
    expect(config).toBe(
      `${KIMI_BLOCK_START}\n` +
        '[[hooks]]\n' +
        'event = "PreToolUse"\n' +
        'matcher = "^(Write|Edit|StrReplace.*|MultiEdit.*)$"\n' +
        'command = "npx --yes @elberacasa/umbra guard --stdin"\n' +
        'timeout = 10\n' +
        `${KIMI_BLOCK_END}\n`,
    );
  });

  it('appends below foreign config without clobbering it, and --remove restores byte-identical', async () => {
    const env = makeEnv();
    mkdirSync(path.dirname(kimiPath(env)), { recursive: true });
    const original =
      'model = "k2"\n' +
      '\n' +
      '[[hooks]]\n' +
      'event = "PostToolUse"\n' +
      'matcher = "^(Bash)$"\n' +
      'command = "my-audit-log"\n' +
      'timeout = 30\n';
    writeFileSync(kimiPath(env), original);

    const install = await runProtect({ ...env, agent: 'kimi' });
    expect(install.installed).toEqual([kimiPath(env)]);
    const config = read(kimiPath(env));
    expect(config.startsWith(original)).toBe(true);
    expect(config).toContain(KIMI_BLOCK_START);
    // The foreign hook block is untouched.
    expect(config).toContain('command = "my-audit-log"');

    const remove = await runProtect({ ...env, agent: 'kimi', remove: true });
    expect(remove.removed).toEqual([kimiPath(env)]);
    expect(read(kimiPath(env))).toBe(original);
  });

  it('keeps content the user appended after the umbra block on --remove', async () => {
    const env = makeEnv();
    await runProtect({ ...env, agent: 'kimi' });
    const afterInstall = read(kimiPath(env));
    writeFileSync(kimiPath(env), `${afterInstall}theme = "dark"\n`);

    const remove = await runProtect({ ...env, agent: 'kimi', remove: true });

    expect(remove.removed).toEqual([kimiPath(env)]);
    expect(read(kimiPath(env))).toBe('theme = "dark"\n');
  });

  it('--remove deletes the file when it only ever held the umbra block', async () => {
    const env = makeEnv();
    await runProtect({ ...env, agent: 'kimi' });
    expect(existsSync(kimiPath(env))).toBe(true);

    const remove = await runProtect({ ...env, agent: 'kimi', remove: true });

    expect(remove.removed).toEqual([kimiPath(env)]);
    expect(existsSync(kimiPath(env))).toBe(false);
  });

  it('refuses to touch a malformed block (missing end marker)', async () => {
    const env = makeEnv();
    mkdirSync(path.dirname(kimiPath(env)), { recursive: true });
    const broken = `${KIMI_BLOCK_START}\n[[hooks]]\nevent = "PreToolUse"\n`;
    writeFileSync(kimiPath(env), broken);

    const install = await runProtect({ ...env, agent: 'kimi' });
    // Start marker present → treated as already installed, no duplicate block.
    expect(install.skipped).toEqual([kimiPath(env)]);

    const remove = await runProtect({ ...env, agent: 'kimi', remove: true });
    expect(remove.removed).toEqual([]);
    expect(remove.skipped).toEqual([kimiPath(env)]);
    expect(remove.notes.some((n) => n.includes('missing end marker'))).toBe(true);
    expect(read(kimiPath(env))).toBe(broken);
  });
});

describe('commands/protect — detection, filtering, idempotency', () => {
  it('auto-detects both agents from config dirs and installs both', async () => {
    const env = makeEnv();
    mkdirSync(path.join(env.home, '.claude'), { recursive: true });
    mkdirSync(path.join(env.home, '.kimi-code'), { recursive: true });

    const result = await runProtect(env);

    expect(result.installed).toContain(claudeProjectPath(env));
    expect(result.installed).toContain(kimiPath(env));
  });

  it('auto-detects agents from PATH binaries', async () => {
    const env = makeEnv();
    const kimiBin = path.join(env.pathEnv, 'kimi');
    writeFileSync(kimiBin, '#!/bin/sh\n');
    chmodSync(kimiBin, 0o755);

    const result = await runProtect(env);

    expect(result.installed).toEqual([kimiPath(env)]);
  });

  it('does nothing but note when no agent is detected', async () => {
    const env = makeEnv();
    const result = await runProtect(env);

    expect(result.installed).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.notes.some((n) => n.includes('No supported agents detected'))).toBe(true);
  });

  it('--agent restricts the run to that agent only', async () => {
    const env = makeEnv();
    mkdirSync(path.join(env.home, '.claude'), { recursive: true });
    mkdirSync(path.join(env.home, '.kimi-code'), { recursive: true });

    const result = await runProtect({ ...env, agent: 'kimi' });

    expect(result.installed).toEqual([kimiPath(env)]);
    expect(existsSync(claudeProjectPath(env))).toBe(false);
  });

  it('rejects an unknown agent', async () => {
    const env = makeEnv();
    await expect(runProtect({ ...env, agent: 'cursor' })).rejects.toThrow('unknown agent "cursor"');
  });

  it('a second run is a no-op for both agents', async () => {
    const env = makeEnv();
    mkdirSync(path.join(env.home, '.claude'), { recursive: true });
    mkdirSync(path.join(env.home, '.kimi-code'), { recursive: true });

    await runProtect(env);
    const claudeAfterFirst = read(claudeProjectPath(env));
    const kimiAfterFirst = read(kimiPath(env));

    const second = await runProtect(env);
    expect(second.installed).toEqual([]);
    expect(second.skipped).toContain(claudeProjectPath(env));
    expect(second.skipped).toContain(kimiPath(env));
    expect(read(claudeProjectPath(env))).toBe(claudeAfterFirst);
    expect(read(kimiPath(env))).toBe(kimiAfterFirst);
  });

  it('install then remove leaves both configs as they were', async () => {
    const env = makeEnv();
    mkdirSync(path.join(env.home, '.claude'), { recursive: true });
    mkdirSync(path.join(env.home, '.kimi-code'), { recursive: true });

    await runProtect(env);
    const remove = await runProtect({ ...env, remove: true });

    expect(remove.removed).toContain(claudeProjectPath(env));
    expect(remove.removed).toContain(kimiPath(env));
    // claude settings.json returns to an empty object; kimi config.toml is gone.
    expect(read(claudeProjectPath(env))).toBe('{}\n');
    expect(existsSync(kimiPath(env))).toBe(false);
  });
});
