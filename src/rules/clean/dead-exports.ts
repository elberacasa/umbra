import path from 'node:path';
import type { Finding, Rule, ScannedFile } from '../../engine/types.js';

const SOURCE_RE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const TYPE_DECL_RE = /\.d\.[cm]?ts$/;
const EXPORT_RE = /^export\s+(?:async\s+)?(?:function|const|let|var|class|interface|type)\s+([A-Za-z_$][\w$]*)/;

// Files whose exports are consumed by the framework, the toolchain, or the
// outside world — never by internal imports. Flagging them is always wrong.
const TEST_FILE_RE =
  /\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)(__tests__|test|tests|benchmarks)(\/|$)/;
const CONFIG_FILE_RE = /(^|\/)[^/]*\.config\.[cm]?[jt]sx?$|(^|\/)\.?[^/]*rc\.[cm]?[jt]s$/;
// Next.js-style route/entry conventions: app/ and pages/ trees (also under
// src/), plus the root-level middleware file.
const FRAMEWORK_FILE_RE = /(^|\/)(src\/)?(app|pages)\/|(^|\/)(src\/)?middleware\.[jt]sx?$/;
const SCRIPT_FILE_RE = /(^|\/)(scripts?|seeds?)\/|(^|\/)seed\.[cm]?[jt]s$/;

function isEntryPointFile(relPath: string): boolean {
  return (
    TYPE_DECL_RE.test(relPath) ||
    CONFIG_FILE_RE.test(relPath) ||
    FRAMEWORK_FILE_RE.test(relPath) ||
    SCRIPT_FILE_RE.test(relPath)
  );
}

/** Recursively collects string targets (e.g. "./dist/index.js") from an exports field. */
function collectTargets(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    if (value.startsWith('.')) out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectTargets(item, out);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) collectTargets(item, out);
  }
}

const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

/** Resolves a package.json target or relative specifier to a scanned source file. */
function resolveSource(specifier: string, fromDir: string, byPath: Map<string, ScannedFile>): string | undefined {
  const base = path.posix.normalize(path.posix.join(fromDir, specifier));
  const candidates = [base, ...RESOLVE_EXTENSIONS.map((ext) => base + ext)];
  for (const ext of RESOLVE_EXTENSIONS) candidates.push(`${base}/index${ext}`);
  // TS sources are often referenced with their emitted .js extension.
  const jsExt = /\.(js|jsx|mjs|cjs)$/.exec(base);
  if (jsExt) {
    const stem = base.slice(0, -jsExt[0].length);
    for (const ext of ['.ts', '.tsx', '.mts', '.cts']) candidates.push(stem + ext);
  }
  for (const candidate of candidates) {
    const hit = byPath.get(candidate);
    if (hit !== undefined) return hit.relPath;
  }
  return undefined;
}

const REEXPORT_RE = /^\s*export\s+(?:type\s+)?(?:\*|\{[^}]*\})\s*(?:as\s+\w+\s*)?from\s*['"]([^'"]+)['"];?\s*$/;
const BARREL_LINE_RE = /^\s*(import\s.*from\s*['"][^'"]+['"];?|export\s.*from\s*['"][^'"]+['"];?|\/\/.*|\/\*.*)?\s*$/;

/**
 * Files reachable from a library's declared entry points (package.json
 * main/module/types/bin/exports) through pure re-export "barrel" files. A
 * library's exports are never imported internally BY DESIGN — they are the
 * public API, so the rule must not police them.
 */
function publicApiFiles(files: ScannedFile[], byPath: Map<string, ScannedFile>): Set<string> {
  const entryFiles = new Set<string>();

  for (const file of files) {
    if (path.posix.basename(file.relPath) !== 'package.json') continue;
    let pkg: Record<string, unknown>;
    try {
      pkg = JSON.parse(file.content) as Record<string, unknown>;
    } catch {
      continue;
    }
    const isLibrary = 'exports' in pkg || 'main' in pkg;
    if (!isLibrary) continue;

    const dir = path.posix.dirname(file.relPath);
    const fromDir = dir === '.' ? '' : dir;
    const targets: string[] = [];
    for (const field of ['main', 'module', 'types']) collectTargets(pkg[field], targets);
    collectTargets(pkg['bin'], targets);
    collectTargets(pkg['exports'], targets);
    for (const target of targets) {
      const resolved = resolveSource(target, fromDir, byPath);
      if (resolved !== undefined) entryFiles.add(resolved);
    }
  }

  // Follow the re-export graph out of the entry files: barrel files (files
  // that only re-export) pass their public-API status on to their targets.
  const publicApi = new Set(entryFiles);
  const queue = [...entryFiles];
  while (queue.length > 0) {
    const relPath = queue.pop();
    if (relPath === undefined) break;
    const file = byPath.get(relPath);
    if (file === undefined) continue;
    const meaningful = file.lines.filter((l) => l.trim() !== '');
    const isBarrel =
      meaningful.length > 0 &&
      meaningful.every((l) => BARREL_LINE_RE.test(l)) &&
      meaningful.some((l) => REEXPORT_RE.test(l));
    if (!isBarrel) continue;
    const fromDir = path.posix.dirname(relPath);
    for (const line of meaningful) {
      const match = REEXPORT_RE.exec(line);
      const specifier = match?.[1];
      if (specifier === undefined || !specifier.startsWith('.')) continue;
      const resolved = resolveSource(specifier, fromDir === '.' ? '' : fromDir, byPath);
      if (resolved !== undefined && !publicApi.has(resolved)) {
        publicApi.add(resolved);
        queue.push(resolved);
      }
    }
  }

  return publicApi;
}

export const deadExportsRule: Rule = {
  id: 'clean/dead-exports',
  axis: 'CLEAN',
  description:
    'Heuristic: named exports whose identifier never appears anywhere else in the repo.',
  check(ctx) {
    const findings: Finding[] = [];
    const sources = ctx.files.filter(
      (f) => SOURCE_RE.test(f.relPath) && !TEST_FILE_RE.test(f.relPath),
    );
    const byPath = new Map(sources.map((f) => [f.relPath, f]));
    const publicApi = publicApiFiles(ctx.files, byPath);

    for (const file of sources) {
      // Entry points, framework-convention files, and declared public API are
      // consumed from outside the import graph — never flag them.
      if (isEntryPointFile(file.relPath)) continue;
      if (publicApi.has(file.relPath)) continue;

      for (let i = 0; i < file.lines.length; i++) {
        const line = file.lines[i];
        if (line === undefined) continue;
        const match = EXPORT_RE.exec(line);
        if (!match || match[1] === undefined) continue;
        const name = match[1];
        const usage = new RegExp(`\\b${name.replace(/[$]/g, '\\$')}\\b`);

        const usedElsewhere = sources.some(
          (other) => other.relPath !== file.relPath && usage.test(other.content),
        );
        if (!usedElsewhere) {
          findings.push({
            ruleId: this.id,
            axis: this.axis,
            severity: 'low',
            // Textual import detection cannot see path aliases, dynamic
            // imports, or DI — a heuristic hunch goes to notes, never score.
            confidence: 'low',
            message: `Export "${name}" is never imported or referenced anywhere else in the repo`,
            file: file.relPath,
            line: i + 1,
          });
        }
      }
    }

    return findings;
  },
};
