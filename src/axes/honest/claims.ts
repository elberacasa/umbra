import type { ScannedFile } from '../../engine/types.js';
import type { Claim, ClaimKind } from './types.js';

/**
 * Claim extraction looks at prose written by humans or agents: markdown files
 * anywhere in the repo (README, CHANGELOG, docs/), Cursor rules/transcripts
 * (.cursor/**), Aider history (.aider*) and agent instruction files
 * (CLAUDE.md, AGENTS.md).
 */
function isClaimSource(relPath: string): boolean {
  const base = relPath.split('/').pop() ?? relPath;
  if (relPath.startsWith('.cursor/')) return true;
  if (base.startsWith('.aider')) return true;
  return /\.(md|mdx)$/i.test(base);
}

/**
 * Lines that instruct rather than assert ("make sure all tests pass before
 * merging") are not claims. Skipping them keeps the false-positive rate at
 * zero at the cost of missing a few real claims — the right trade-off.
 */
const IMPERATIVE_MARKERS = /\b(make sure|ensure|please|should|must|needs? to|before (merg|push|commit)|if (they|it|the)|run `|to run|run the|verify that)\b/i;

interface ClaimPattern {
  kind: ClaimKind;
  re: RegExp;
  expected?: (m: RegExpMatchArray) => number;
}

// Order matters: the first matching pattern wins, so more specific patterns
// (test-count) come before broader ones (all-tests).
const CLAIM_PATTERNS: ClaimPattern[] = [
  {
    kind: 'test-count',
    re: /\b(\d{1,5})\s+tests?\s+(?:are\s+|all\s+)?pass(?:ing|es|ed)?\b/i,
    expected: (m) => Number.parseInt(m[1] ?? '0', 10),
  },
  {
    kind: 'all-tests',
    re: /\ball\s+(?:the\s+)?tests?\s+(?:are\s+)?pass(?:ing|es|ed)?\b/i,
  },
  {
    kind: 'coverage',
    re: /\b(\d{1,3})\s*%\s*(?:statement\s+|line\s+|branch\s+|test\s+|code\s+)?coverage\b/i,
    expected: (m) => Number.parseInt(m[1] ?? '0', 10),
  },
  {
    kind: 'coverage',
    re: /\bcoverage\s+(?:of|is|at)\s+(?:about\s+|around\s+|over\s+)?(\d{1,3})\s*%/i,
    expected: (m) => Number.parseInt(m[1] ?? '0', 10),
  },
  {
    kind: 'build',
    re: /\bbuild(?:s|ing)?\s+(?:passes|passing|succeeds|succeeding)\b/i,
  },
  {
    kind: 'build',
    re: /\bbuilds?\s+successfully\b/i,
  },
  {
    kind: 'vague',
    re: /\bproduction[- ]ready\b/i,
  },
  {
    kind: 'vague',
    re: /\bfully[- ]tested\b/i,
  },
];

/** Extract verifiable claims from scanned repo files. Deterministic. */
export function extractClaims(files: ScannedFile[]): Claim[] {
  const claims: Claim[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    if (!isClaimSource(file.relPath)) continue;

    for (let i = 0; i < file.lines.length; i++) {
      const rawLine = file.lines[i];
      if (rawLine === undefined) continue;
      const lineText = rawLine.trim();
      if (lineText === '') continue;
      if (IMPERATIVE_MARKERS.test(lineText)) continue;

      for (const pattern of CLAIM_PATTERNS) {
        const match = lineText.match(pattern.re);
        if (!match) continue;

        const claim: Claim = {
          text: match[0],
          file: file.relPath,
          line: i + 1,
          kind: pattern.kind,
          ...(pattern.expected ? { expected: pattern.expected(match) } : {}),
        };
        const key = `${claim.file}:${claim.line}:${claim.kind}`;
        if (!seen.has(key)) {
          seen.add(key);
          claims.push(claim);
        }
        break; // first matching pattern wins
      }
    }
  }

  return claims;
}
