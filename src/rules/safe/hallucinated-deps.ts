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

function readDependencies(ctx: ScanContext): string[] {
  const pkgFile = ctx.files.find((f) => f.relPath === 'package.json');
  if (!pkgFile) return [];
  try {
    const pkg = JSON.parse(pkgFile.content) as { dependencies?: Record<string, string> };
    return Object.keys(pkg.dependencies ?? {});
  } catch {
    return [];
  }
}

export const hallucinatedDepsRule: Rule = {
  id: 'safe/hallucinated-deps',
  axis: 'SAFE',
  description:
    'Flags dependencies that do not resolve on the npm registry — hallucinated by the agent or typosquat bait. Resolver is injectable; default does a registry HEAD with 3s timeout and offline fallback.',
  async check(ctx) {
    const findings: Finding[] = [];
    const deps = readDependencies(ctx);
    if (deps.length === 0) return findings;

    const resolver = ctx.options.resolvePackage ?? npmRegistryResolver;

    let unknownCount = 0;
    for (const dep of deps) {
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
