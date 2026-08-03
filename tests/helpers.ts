import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { walkRepo } from '../src/engine/walker';
import type { Finding, PackageResolution, Rule, ScanOptions } from '../src/engine/types';

const here = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES_DIR = path.resolve(here, '..', 'fixtures');

export function fixturePath(name: string): string {
  return path.join(FIXTURES_DIR, name);
}

/** Deterministic offline resolver: only the two fake packages are "missing". */
export const stubResolver = async (name: string): Promise<PackageResolution> =>
  name === 'supafast-orm' || name === 'react-query-v9-pro' ? 'missing' : 'exists';

export async function checkFixture(
  fixture: string,
  rules: Rule[],
  options: ScanOptions = { resolvePackage: stubResolver },
): Promise<Finding[]> {
  const files = await walkRepo(fixturePath(fixture));
  const findings: Finding[] = [];
  for (const rule of rules) {
    findings.push(...(await rule.check({ root: fixturePath(fixture), files, options })));
  }
  return findings;
}
