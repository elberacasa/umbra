import type { Finding, PackageResolution, Rule, ScanContext } from '../../engine/types.js';

const REGISTRY_TIMEOUT_MS = 3000;

function registryUrl(name: string): string {
  return `https://registry.npmjs.org/${name.replace('/', '%2f')}`;
}

/**
 * Default resolver: HEAD request against the npm registry with a 3s timeout.
 * Any network/registry failure resolves to 'unknown' so offline scans skip
 * this check instead of producing phantom findings.
 */
export async function npmRegistryResolver(name: string): Promise<PackageResolution> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REGISTRY_TIMEOUT_MS);
  try {
    const res = await fetch(registryUrl(name), { method: 'HEAD', signal: controller.signal });
    if (res.status === 404) return 'missing';
    if (res.ok) return 'exists';
    return 'unknown';
  } catch {
    return 'unknown';
  } finally {
    clearTimeout(timer);
  }
}

function readDependencies(ctx: ScanContext): Record<string, string> {
  const pkgFile = ctx.files.find((f) => f.relPath === 'package.json');
  if (!pkgFile) return {};
  try {
    const pkg = JSON.parse(pkgFile.content) as { dependencies?: Record<string, string> };
    return pkg.dependencies ?? {};
  } catch {
    return {};
  }
}

/** Version specs that never resolve through the public registry. */
const LOCAL_PROTOCOL_RE = /^(?:workspace|link|file):/;

/**
 * Package names declared by any package.json in the scanned tree. In a
 * monorepo, depending on a sibling workspace package by name is normal — the
 * name legitimately absent from the public registry.
 */
function localPackageNames(ctx: ScanContext): Set<string> {
  const names = new Set<string>();
  for (const file of ctx.files) {
    if (!file.relPath.endsWith('/package.json') && file.relPath !== 'package.json') continue;
    try {
      const pkg = JSON.parse(file.content) as { name?: unknown };
      if (typeof pkg.name === 'string' && pkg.name !== '') names.add(pkg.name);
    } catch {
      continue;
    }
  }
  return names;
}

export const hallucinatedDepsRule: Rule = {
  id: 'safe/hallucinated-deps',
  axis: 'SAFE',
  description:
    'Flags dependencies that do not resolve on the npm registry — hallucinated by the agent or typosquat bait. Resolver is injectable; default does a registry HEAD with 3s timeout and offline fallback.',
  async check(ctx) {
    const findings: Finding[] = [];
    const deps = readDependencies(ctx);
    const depNames = Object.keys(deps);
    if (depNames.length === 0) return findings;

    const localNames = localPackageNames(ctx);
    const resolver = ctx.options.resolvePackage ?? npmRegistryResolver;

    let unknownCount = 0;
    for (const dep of depNames) {
      // Workspace/link/file specs and sibling workspace packages never
      // resolve through the public registry — not a hallucination signal.
      const spec = deps[dep] ?? '';
      if (LOCAL_PROTOCOL_RE.test(spec) || localNames.has(dep)) continue;
      const resolution = await resolver(dep);
      if (resolution === 'missing') {
        findings.push({
          ruleId: this.id,
          axis: this.axis,
          severity: 'high',
          confidence: 'high',
          message: `Dependency "${dep}" does not exist on the npm registry — likely hallucinated by the agent, or the name was registered by an attacker after generation (slopsquatting)`,
          file: 'package.json',
          line: 1,
        });
      } else if (resolution === 'unknown') {
        unknownCount++;
      }
    }

    if (unknownCount > 0) {
      findings.push({
        ruleId: this.id,
        axis: this.axis,
        severity: 'low',
        confidence: 'low',
        message: `Could not verify ${unknownCount} dependenc${unknownCount === 1 ? 'y' : 'ies'} against the npm registry (offline or registry unreachable) — skipped`,
        file: 'package.json',
        line: 1,
      });
    }

    return findings;
  },
};
