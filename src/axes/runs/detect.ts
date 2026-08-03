import fs from 'node:fs/promises';
import path from 'node:path';

export interface RunPlan {
  kind: 'dockerfile' | 'node';
  /** Repo-relative Dockerfile path, when the repo ships its own. */
  dockerfile?: string;
  /** package.json has scripts.build. */
  buildScript: boolean;
  /** package.json has scripts.start. */
  startScript: boolean;
  /** package.json "main" entry, when declared. */
  main?: string;
  /** package-lock.json present (enables `npm ci`). */
  hasLockfile: boolean;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Decides how a repo could be built and booted.
 * Returns null when there is no detectable run path — the caller reports
 * the axis as 'skipped' rather than guessing (zero false positives).
 */
export async function detectRunPlan(root: string): Promise<RunPlan | null> {
  const dockerfilePath = path.join(root, 'Dockerfile');
  if (await exists(dockerfilePath)) {
    return { kind: 'dockerfile', dockerfile: 'Dockerfile', buildScript: false, startScript: false, hasLockfile: false };
  }

  const pkgPath = path.join(root, 'package.json');
  if (!(await exists(pkgPath))) return null;

  let pkg: { scripts?: Record<string, string>; main?: string };
  try {
    pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8')) as typeof pkg;
  } catch {
    return null;
  }

  const buildScript = typeof pkg.scripts?.build === 'string' && pkg.scripts.build.trim() !== '';
  const startScript = typeof pkg.scripts?.start === 'string' && pkg.scripts.start.trim() !== '';
  const main = typeof pkg.main === 'string' && pkg.main.trim() !== '' ? pkg.main.trim() : undefined;

  // A build script alone is not a run path: nothing to boot and probe.
  if (!startScript && !main) return null;

  const plan: RunPlan = {
    kind: 'node',
    buildScript,
    startScript,
    hasLockfile: await exists(path.join(root, 'package-lock.json')),
  };
  if (main !== undefined) plan.main = main;
  return plan;
}
