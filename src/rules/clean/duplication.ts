import type { Finding, Rule, ScannedFile } from '../../engine/types.js';

const BLOCK_SIZE = 8;
const MIN_LINE_LENGTH = 10;

interface BlockLocation {
  file: ScannedFile;
  startLine: number; // 1-based
}

function normalizedLines(file: ScannedFile): (string | null)[] {
  return file.lines.map((line) => {
    const trimmed = line.trim();
    return trimmed.length >= MIN_LINE_LENGTH ? trimmed : null;
  });
}

export const duplicationRule: Rule = {
  id: 'clean/duplication',
  axis: 'CLEAN',
  description: `Detects copy-pasted blocks of >= ${BLOCK_SIZE} normalized lines appearing in more than one file.`,
  check(ctx) {
    const findings: Finding[] = [];
    const sources = ctx.files.filter((f) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f.relPath));

    // hash of normalized block -> locations
    const blocks = new Map<string, BlockLocation[]>();

    for (const file of sources) {
      const lines = normalizedLines(file);
      for (let i = 0; i + BLOCK_SIZE <= lines.length; i++) {
        const window = lines.slice(i, i + BLOCK_SIZE);
        if (window.some((l) => l === null)) continue;
        const hash = (window as string[]).join('\n');
        const existing = blocks.get(hash);
        const location: BlockLocation = { file, startLine: i + 1 };
        if (existing) {
          existing.push(location);
        } else {
          blocks.set(hash, [location]);
        }
      }
    }

    // Ranges already covered by a reported finding, per file.
    const covered = new Map<string, [number, number][]>();
    const isCovered = (relPath: string, start: number): boolean =>
      (covered.get(relPath) ?? []).some(([a, b]) => start >= a && start <= b);
    const markCovered = (relPath: string, start: number): void => {
      const ranges = covered.get(relPath) ?? [];
      ranges.push([start, start + BLOCK_SIZE - 1]);
      covered.set(relPath, ranges);
    };

    for (const locations of blocks.values()) {
      const distinctFiles = new Set(locations.map((l) => l.file.relPath));
      if (distinctFiles.size < 2) continue;
      if (locations.some((l) => isCovered(l.file.relPath, l.startLine))) continue;

      for (const l of locations) markCovered(l.file.relPath, l.startLine);

      const first = locations[0];
      if (!first) continue;
      const others = locations
        .slice(1)
        .map((l) => `${l.file.relPath}:${l.startLine}`)
        .join(', ');
      findings.push({
        ruleId: this.id,
        axis: this.axis,
        severity: 'medium',
        confidence: 'medium',
        message: `Duplicated block of >= ${BLOCK_SIZE} lines also found at ${others} — copy-paste instead of a shared function`,
        file: first.file.relPath,
        line: first.startLine,
      });
    }

    return findings;
  },
};
