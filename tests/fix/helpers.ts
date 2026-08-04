import { promises as fs, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { walkRepo } from '../../src/engine/walker';
import type { Finding, Rule } from '../../src/engine/types';
import { fixturePath, stubResolver } from '../helpers';

/**
 * Copies a fixture into a temp dir. Two reasons: fixers write files, and the
 * temp path is outside any non-production directory (fixtures/, tests/) so
 * SAFE rules evaluate the files as production code.
 */
export async function copyFixture(name: string): Promise<string> {
  const dest = mkdtempSync(path.join(tmpdir(), 'umbra-fix-'));
  await fs.cp(fixturePath(name), dest, { recursive: true });
  return dest;
}

export async function scanWith(root: string, rules: Rule[]): Promise<Finding[]> {
  const files = await walkRepo(root);
  const findings: Finding[] = [];
  for (const rule of rules) {
    findings.push(...(await rule.check({ root, files, options: { resolvePackage: stubResolver } })));
  }
  return findings;
}
