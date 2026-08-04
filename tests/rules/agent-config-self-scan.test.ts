import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { walkRepo } from '../../src/engine/walker';
import { promptInjectionRule } from '../../src/rules/safe/prompt-injection';
import { mcpConfigRule } from '../../src/rules/safe/mcp-config';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('agent-config rules self-scan', () => {
  it('produces zero findings on the umbra repo itself', async () => {
    // Our own README/docs/skills discuss blocking and guarding; the rules
    // must require imperative override structure, not topic keywords, so
    // this repo never self-flags.
    const files = await walkRepo(repoRoot);
    const ctx = { root: repoRoot, files, options: {} };
    const findings = [
      ...(await promptInjectionRule.check(ctx)),
      ...(await mcpConfigRule.check(ctx)),
    ];
    expect(findings).toEqual([]);
  });
});
