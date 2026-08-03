import type { Finding } from '../engine/types.js';

/**
 * The guard-engine contract (Component 1 of the v1.0 immune-layer design).
 *
 * The real implementation ships as `guardContent` in `src/guard/`; this module
 * types the seam so the MCP server compiles and is tested against the exact
 * documented shape. Kept field-for-field in sync with the design doc.
 */
export interface GuardVerdict {
  decision: 'allow' | 'warn' | 'block';
  /** High/medium confidence only, ever. */
  findings: Finding[];
  /** Protected-path reason when the path guard fired. */
  pathViolation?: string;
}

export type GuardEngine = (filePath: string, content: string) => GuardVerdict | Promise<GuardVerdict>;
