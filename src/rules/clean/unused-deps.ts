import type { Finding, Rule, ScanContext } from '../../engine/types.js';

// Packages consumed implicitly by the framework/toolchain rather than by import statements.
const IMPLICIT_DEPS = new Set(['next', 'react', 'react-dom', 'nuxt', 'svelte', 'typescript']);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function importUsageRe(name: string): RegExp {
  const escaped = escapeRegExp(name);
  return new RegExp(
    `(?:from\\s+|import\\s+|require\\(\\s*)['"]${escaped}(?:/[^'"]*)?['"]`,
  );
}

export const unusedDepsRule: Rule = {
  id: 'clean/unused-deps',
  axis: 'CLEAN',
  description:
    'Flags package.json dependencies that are never imported or required by any source file.',
  check(ctx: ScanContext) {
    const findings: Finding[] = [];
    const pkgFile = ctx.files.find((f) => f.relPath === 'package.json');
    if (!pkgFile) return findings;

    let dependencies: Record<string, string>;
    try {
      const pkg = JSON.parse(pkgFile.content) as { dependencies?: Record<string, string> };
      dependencies = pkg.dependencies ?? {};
    } catch {
      return findings;
    }

    const sources = ctx.files.filter((f) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f.relPath));

    for (const name of Object.keys(dependencies)) {
      if (IMPLICIT_DEPS.has(name) || name.startsWith('@types/')) continue;
      const usage = importUsageRe(name);
      const used = sources.some((f) => usage.test(f.content));
      if (!used) {
        findings.push({
          ruleId: this.id,
          axis: this.axis,
          severity: 'low',
          confidence: 'medium',
          message: `Dependency "${name}" is declared in package.json but never imported`,
          file: 'package.json',
          line: 1,
        });
      }
    }

    return findings;
  },
};
