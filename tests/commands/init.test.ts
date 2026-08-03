import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HOOK_BLOCK_END, HOOK_BLOCK_START, runInit } from '../../src/commands/init';

function makeTempRepo(): string {
  return mkdtempSync(path.join(tmpdir(), 'umbra-init-'));
}

function makeGitRepo(): string {
  const root = makeTempRepo();
  mkdirSync(path.join(root, '.git', 'hooks'), { recursive: true });
  return root;
}

function makeHuskyRepo(): string {
  const root = makeGitRepo();
  mkdirSync(path.join(root, '.husky'), { recursive: true });
  return root;
}

function read(root: string, rel: string): string {
  return readFileSync(path.join(root, rel), 'utf8');
}

function isExecutable(p: string): boolean {
  // owner/group/other execute bits
  return (statSync(p).mode & 0o111) !== 0;
}

describe('commands/init — pre-commit hook', () => {
  it('installs an executable hook in a bare git repo', async () => {
    const root = makeGitRepo();
    const result = await runInit(root, { action: false });

    expect(result.installed).toContain('.git/hooks/pre-commit');
    const hookPath = path.join(root, '.git', 'hooks', 'pre-commit');
    const hook = read(root, '.git/hooks/pre-commit');
    expect(hook).toContain(HOOK_BLOCK_START);
    expect(hook).toContain(HOOK_BLOCK_END);
    expect(hook).toContain('npx --yes @elberacasa/umbra . --offline');
    expect(hook).toContain('exit 1');
    expect(hook.startsWith('#!/bin/sh')).toBe(true);
    expect(isExecutable(hookPath)).toBe(true);
  });

  it('installs into .husky/pre-commit when the repo uses husky', async () => {
    const root = makeHuskyRepo();
    const result = await runInit(root, { action: false });

    expect(result.installed).toContain('.husky/pre-commit');
    expect(existsSync(path.join(root, '.git', 'hooks', 'pre-commit'))).toBe(false);
    const hook = read(root, '.husky/pre-commit');
    expect(hook).toContain('npx --yes @elberacasa/umbra . --offline');
    expect(isExecutable(path.join(root, '.husky', 'pre-commit'))).toBe(true);
  });

  it('appends to an existing hook without clobbering it', async () => {
    const root = makeGitRepo();
    const hookPath = path.join(root, '.git', 'hooks', 'pre-commit');
    const custom = '#!/bin/sh\n# my own checks\necho "linting..."\n';
    writeFileSync(hookPath, custom);

    const result = await runInit(root, { action: false });

    expect(result.installed).toContain('.git/hooks/pre-commit');
    const hook = read(root, '.git/hooks/pre-commit');
    expect(hook.startsWith(custom)).toBe(true);
    expect(hook).toContain(HOOK_BLOCK_START);
    expect(isExecutable(hookPath)).toBe(true);
  });

  it('never overwrites the umbra block without --force, replaces only that block with --force', async () => {
    const root = makeGitRepo();
    const hookPath = path.join(root, '.git', 'hooks', 'pre-commit');
    writeFileSync(hookPath, '#!/bin/sh\necho "before"\n');

    await runInit(root, { action: false });
    const afterFirst = read(root, '.git/hooks/pre-commit');

    // Second run without force: nothing changes.
    const second = await runInit(root, { action: false });
    expect(second.installed).toEqual([]);
    expect(second.skipped).toContain('.git/hooks/pre-commit');
    expect(read(root, '.git/hooks/pre-commit')).toBe(afterFirst);

    // --force refreshes only the umbra block, preserving surrounding content.
    const result = await runInit(root, { action: false, force: true });
    expect(result.installed).toContain('.git/hooks/pre-commit');
    const hook = read(root, '.git/hooks/pre-commit');
    expect(hook).toContain('echo "before"');
    expect(hook.split(HOOK_BLOCK_START).length - 1).toBe(1);
    expect(hook.split(HOOK_BLOCK_END).length - 1).toBe(1);
    expect(isExecutable(hookPath)).toBe(true);
  });

  it('skips the hook with a note when the directory is not a git repo', async () => {
    const root = makeTempRepo();
    const result = await runInit(root, { action: false });

    expect(result.installed).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.notes.some((n) => n.includes('not installed'))).toBe(true);
  });
});

describe('commands/init — GitHub Action', () => {
  it('writes .github/workflows/umbra.yml using the published action', async () => {
    const root = makeGitRepo();
    const result = await runInit(root, { hook: false });

    expect(result.installed).toContain(path.join('.github', 'workflows', 'umbra.yml'));
    const workflow = read(root, path.join('.github', 'workflows', 'umbra.yml'));
    expect(workflow).toContain('uses: elberacasa/umbra@v1');
    expect(workflow).toContain('pull_request:');
    expect(workflow).toContain('min-score:');
  });

  it('refuses to overwrite an existing workflow unless --force', async () => {
    const root = makeGitRepo();
    const workflowPath = path.join(root, '.github', 'workflows');
    mkdirSync(workflowPath, { recursive: true });
    const mine = 'name: my custom umbra workflow\n';
    writeFileSync(path.join(workflowPath, 'umbra.yml'), mine);

    const first = await runInit(root, { hook: false });
    expect(first.installed).toEqual([]);
    expect(first.skipped).toContain(path.join('.github', 'workflows', 'umbra.yml'));
    expect(read(root, path.join('.github', 'workflows', 'umbra.yml'))).toBe(mine);

    const forced = await runInit(root, { hook: false, force: true });
    expect(forced.installed).toContain(path.join('.github', 'workflows', 'umbra.yml'));
    expect(read(root, path.join('.github', 'workflows', 'umbra.yml'))).toContain('uses: elberacasa/umbra@v1');
  });
});

describe('commands/init — defaults and idempotency', () => {
  it('installs both hook and workflow by default', async () => {
    const root = makeGitRepo();
    const result = await runInit(root);

    expect(result.installed).toContain('.git/hooks/pre-commit');
    expect(result.installed).toContain(path.join('.github', 'workflows', 'umbra.yml'));
  });

  it('running init twice changes nothing', async () => {
    const root = makeGitRepo();
    await runInit(root);
    const hookAfterFirst = read(root, '.git/hooks/pre-commit');
    const workflowAfterFirst = read(root, path.join('.github', 'workflows', 'umbra.yml'));

    const second = await runInit(root);
    expect(second.installed).toEqual([]);
    expect(second.skipped).toContain('.git/hooks/pre-commit');
    expect(second.skipped).toContain(path.join('.github', 'workflows', 'umbra.yml'));
    expect(read(root, '.git/hooks/pre-commit')).toBe(hookAfterFirst);
    expect(read(root, path.join('.github', 'workflows', 'umbra.yml'))).toBe(workflowAfterFirst);
  });

  it('still installs the workflow in a directory without git', async () => {
    const root = makeTempRepo();
    const result = await runInit(root);

    expect(result.installed).toEqual([path.join('.github', 'workflows', 'umbra.yml')]);
    expect(result.notes.some((n) => n.includes('pre-commit hook not installed'))).toBe(true);
  });
});
