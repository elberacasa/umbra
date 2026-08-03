import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface InitOptions {
  /** Install the git pre-commit hook (default: true). */
  hook?: boolean;
  /** Install the GitHub Action workflow (default: true). */
  action?: boolean;
  /** Replace umbra-managed blocks/files that already exist (default: false). */
  force?: boolean;
}

export interface InitResult {
  /** Repo-relative paths that were written. */
  installed: string[];
  /** Repo-relative paths that already existed and were left untouched. */
  skipped: string[];
  /** Human-readable explanations for skips and non-fatal conditions. */
  notes: string[];
}

export const HOOK_BLOCK_START = '# >>> umbra trust score >>>';
export const HOOK_BLOCK_END = '# <<< umbra trust score <<<';

const SHEBANG = '#!/bin/sh';

const HOOK_BLOCK = `${HOOK_BLOCK_START}
# Umbra Trust Score gate — installed by \`umbra init\`.
# Blocks the commit when the score drops below 50 (CLI exit code 1).
# A scanner failure (exit code 2) never blocks your commit.
# Refresh this block with \`umbra init --force\`; delete it to uninstall.
echo "umbra: checking Trust Score before commit..."
npx --yes @elberacasa/umbra . --offline
umbra_status=$?
if [ "$umbra_status" -eq 1 ]; then
  echo "umbra: Trust Score below 50 — commit blocked." >&2
  echo "umbra: fix the findings above, or bypass once with \\\`git commit --no-verify\\\`." >&2
  exit 1
fi
if [ "$umbra_status" -ne 0 ]; then
  echo "umbra: scanner failed (exit $umbra_status) — allowing the commit anyway." >&2
fi
${HOOK_BLOCK_END}
`;

const WORKFLOW = `name: Umbra Trust Score

on:
  pull_request:

permissions:
  contents: read
  pull-requests: write

jobs:
  umbra:
    name: Trust Score
    runs-on: ubuntu-latest
    steps:
      - name: Check out repository
        uses: actions/checkout@v4

      - name: Score the repository
        uses: elberacasa/umbra@v1
        with:
          # The check fails when the Trust Score drops below this value.
          min-score: '50'
`;

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

/** Replaces the marked umbra block inside an existing hook script. */
function replaceHookBlock(existing: string): string | null {
  const start = existing.indexOf(HOOK_BLOCK_START);
  if (start === -1) return null;
  const end = existing.indexOf(HOOK_BLOCK_END, start);
  if (end === -1) return null;
  const afterEnd = end + HOOK_BLOCK_END.length;
  const tail = existing.slice(afterEnd).replace(/^\r?\n/, '');
  return existing.slice(0, start) + HOOK_BLOCK + tail;
}

async function installHook(root: string, force: boolean, result: InitResult): Promise<void> {
  // Husky repos manage hooks in .husky/; writing to .git/hooks there would
  // silently never run. Prefer .husky whenever it exists.
  const huskyDir = path.join(root, '.husky');
  const gitHooksDir = path.join(root, '.git', 'hooks');

  let hookPath: string | null = null;
  if (await isDirectory(huskyDir)) {
    hookPath = path.join(huskyDir, 'pre-commit');
  } else if (await isDirectory(gitHooksDir)) {
    hookPath = path.join(gitHooksDir, 'pre-commit');
  }

  if (hookPath === null) {
    result.notes.push(
      'No .git/hooks or .husky directory found — pre-commit hook not installed. Re-run `umbra init` after `git init`.',
    );
    return;
  }

  const rel = path.relative(root, hookPath);
  const existing = await readFileIfExists(hookPath);

  if (existing === null) {
    await fs.writeFile(hookPath, `${SHEBANG}\n\n${HOOK_BLOCK}`, 'utf8');
    await fs.chmod(hookPath, 0o755);
    result.installed.push(rel);
    return;
  }

  if (existing.includes(HOOK_BLOCK_START)) {
    if (!force) {
      result.skipped.push(rel);
      result.notes.push(`${rel} already contains an umbra block — left unchanged (use --force to refresh it).`);
      return;
    }
    const replaced = replaceHookBlock(existing);
    if (replaced === null) {
      result.skipped.push(rel);
      result.notes.push(`${rel} has a malformed umbra block (missing end marker) — left unchanged.`);
      return;
    }
    await fs.writeFile(hookPath, replaced, 'utf8');
    await fs.chmod(hookPath, 0o755);
    result.installed.push(rel);
    return;
  }

  // Someone else's hook: append, never clobber.
  const separator = existing.endsWith('\n') ? '\n' : '\n\n';
  await fs.writeFile(hookPath, `${existing}${separator}${HOOK_BLOCK}`, 'utf8');
  await fs.chmod(hookPath, 0o755);
  result.installed.push(rel);
}

async function installWorkflow(root: string, force: boolean, result: InitResult): Promise<void> {
  const workflowsDir = path.join(root, '.github', 'workflows');
  const workflowPath = path.join(workflowsDir, 'umbra.yml');
  const rel = path.relative(root, workflowPath);

  if ((await readFileIfExists(workflowPath)) !== null && !force) {
    result.skipped.push(rel);
    result.notes.push(`${rel} already exists — left unchanged (use --force to overwrite it).`);
    return;
  }

  await fs.mkdir(workflowsDir, { recursive: true });
  await fs.writeFile(workflowPath, WORKFLOW, 'utf8');
  result.installed.push(rel);
}

/**
 * Installs Umbra as a daily habit in the target repository: a pre-commit hook
 * and a GitHub Action. Never clobbers user content — existing hooks get an
 * appended, clearly-marked umbra block, and existing files are skipped unless
 * `force` is set.
 */
export async function runInit(root: string, opts: InitOptions = {}): Promise<InitResult> {
  const target = path.resolve(root);
  const result: InitResult = { installed: [], skipped: [], notes: [] };
  const force = opts.force === true;

  if (opts.hook !== false) {
    await installHook(target, force, result);
  }
  if (opts.action !== false) {
    await installWorkflow(target, force, result);
  }

  return result;
}
