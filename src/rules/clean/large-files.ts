import type { Finding, Rule } from '../../engine/types.js';

const LARGE_FILE_LINES = 500;

export const largeFilesRule: Rule = {
  id: 'clean/large-files',
  axis: 'CLEAN',
  description: `Flags source files over ${LARGE_FILE_LINES} lines — the classic vibe-coded mega-file smell.`,
  check(ctx) {
    const findings: Finding[] = [];

    for (const file of ctx.files) {
      if (!/\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java)$/.test(file.relPath)) continue;
      if (file.lines.length <= LARGE_FILE_LINES) continue;
      findings.push({
        ruleId: this.id,
        axis: this.axis,
        severity: 'low',
        confidence: 'high',
        message: `File has ${file.lines.length} lines (>${LARGE_FILE_LINES}) — split it up`,
        file: file.relPath,
        line: 1,
      });
    }

    return findings;
  },
};
