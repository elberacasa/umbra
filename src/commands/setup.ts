import path from 'node:path';
import { runInit } from './init.js';
import { runProtect } from './protect.js';

export interface SetupResult {
  installed: string[];
  skipped: string[];
  notes: string[];
}

/**
 * `umbra setup`: the one-word installer. Installs every guardrail Umbra
 * offers, auto-detected — git pre-commit gate, GitHub Action, and agent
 * PreToolUse hooks (Claude Code / Kimi Code when present). Composes runInit
 * and runProtect; both are idempotent and never clobber, so setup is safe
 * to re-run any number of times.
 */
export async function runSetup(
  root: string,
  opts: { global?: boolean; agent?: string; home?: string; pathEnv?: string } = {},
): Promise<SetupResult> {
  const init = await runInit(root, {});
  const protectOpts: { global?: boolean; agent?: string; home?: string; pathEnv?: string; cwd?: string } = {
    cwd: path.resolve(root),
  };
  if (opts.global === true) protectOpts.global = true;
  if (opts.agent !== undefined) protectOpts.agent = opts.agent;
  if (opts.home !== undefined) protectOpts.home = opts.home;
  if (opts.pathEnv !== undefined) protectOpts.pathEnv = opts.pathEnv;
  const protect = await runProtect(protectOpts);

  return {
    installed: [...init.installed, ...protect.installed],
    skipped: [...init.skipped, ...protect.skipped],
    notes: [...init.notes, ...protect.notes],
  };
}
