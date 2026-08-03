import type { Finding, Rule } from '../../engine/types.js';

const SOURCE_RE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const EXPORT_RE = /^export\s+(?:async\s+)?(?:function|const|let|var|class|interface|type)\s+([A-Za-z_$][\w$]*)/;

// Framework-convention files whose named exports are consumed by the framework, not by imports.
const FRAMEWORK_FILE_RE = /(^|\/)(app|pages)\/.+\/(route|page|layout|loading|error|template|default|middleware)\.(ts|tsx|js|jsx)$/;
const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx|js|jsx)$|(^|\/)__tests__\//;

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

    for (const file of sources) {
      if (FRAMEWORK_FILE_RE.test(file.relPath)) continue;

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
            confidence: 'medium',
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
