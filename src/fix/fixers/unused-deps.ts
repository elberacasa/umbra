import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Finding } from '../../engine/types.js';
import type { FixOutcome } from '../types.js';

/**
 * clean/unused-deps transform: remove the dependency key from package.json
 * (dependencies or devDependencies). Output is normalized to 2-space JSON
 * with a trailing newline. npm install is NEVER run here — the description
 * tells the user to.
 */
export async function removeUnusedDep(root: string, finding: Finding, dryRun: boolean): Promise<FixOutcome> {
  const match = /Dependency "([^"]+)"/.exec(finding.message);
  const name = match?.[1];
  if (name === undefined) {
    return { status: 'manual', description: 'could not identify the dependency from the finding message' };
  }

  const pkgPath = path.join(root, 'package.json');
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8')) as typeof pkg;
  } catch {
    return { status: 'manual', description: 'package.json is missing or is not valid JSON' };
  }

  const inDeps = pkg.dependencies !== undefined && name in pkg.dependencies;
  const inDevDeps = pkg.devDependencies !== undefined && name in pkg.devDependencies;
  if (!inDeps && !inDevDeps) {
    return { status: 'skipped', description: `"${name}" is no longer declared in package.json` };
  }

  if (!dryRun) {
    if (inDeps) {
      // inDeps guarantees pkg.dependencies is defined.
      const deps = pkg.dependencies as Record<string, string>;
      delete deps[name];
    }
    if (inDevDeps) {
      const devDeps = pkg.devDependencies as Record<string, string>;
      delete devDeps[name];
    }
    await fs.writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
  }

  const section = inDeps ? 'dependencies' : 'devDependencies';
  return {
    status: 'applied',
    description:
      `remove unused dependency "${name}" from package.json ${section} — ` +
      'run npm install to update node_modules and the lockfile',
  };
}
