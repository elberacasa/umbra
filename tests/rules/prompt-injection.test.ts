import { describe, expect, it } from 'vitest';
import { promptInjectionRule } from '../../src/rules/safe/prompt-injection';
import { checkFixture } from '../helpers';

describe('safe/prompt-injection', () => {
  it('flags zero-width Unicode in instruction files at high confidence', async () => {
    const findings = await checkFixture('rule-prompt-injection/vulnerable', [promptInjectionRule]);
    const hit = findings.find((f) => f.message.includes('Invisible Unicode'));
    expect(hit).toBeDefined();
    expect(hit?.file).toBe('.cursor/rules/hidden-chars.mdc');
    expect(hit?.severity).toBe('high');
    expect(hit?.confidence).toBe('high');
    expect(hit?.line).toBeGreaterThan(0);
  });

  it('flags instruction-override phrases hidden in HTML comments at high confidence', async () => {
    const findings = await checkFixture('rule-prompt-injection/vulnerable', [promptInjectionRule]);
    const hits = findings.filter((f) => f.message.includes('HTML comment'));
    expect(hits.length).toBeGreaterThanOrEqual(2);
    const files = hits.map((f) => f.file);
    expect(files).toContain('.cursor/rules/comment-override.mdc');
    // .github/copilot-instructions.md is always production config.
    expect(files).toContain('.github/copilot-instructions.md');
    for (const hit of hits) {
      expect(hit?.severity).toBe('high');
      expect(hit?.confidence).toBe('high');
    }
  });

  it('flags the same phrases in visible prose at medium severity only', async () => {
    const findings = await checkFixture('rule-prompt-injection/vulnerable', [promptInjectionRule]);
    const hit = findings.find((f) => f.file === 'AGENTS.md');
    expect(hit).toBeDefined();
    expect(hit?.message).toContain('in prose');
    expect(hit?.severity).toBe('medium');
    expect(hit?.confidence).toBe('medium');
  });

  it('reports long base64 blobs as low-confidence notes only', async () => {
    const findings = await checkFixture('rule-prompt-injection/vulnerable', [promptInjectionRule]);
    const hit = findings.find((f) => f.message.includes('base64'));
    expect(hit).toBeDefined();
    expect(hit?.file).toBe('prompt.txt');
    expect(hit?.confidence).toBe('low');
  });

  it('suppresses non-production directories even when shaped like agent config', async () => {
    const findings = await checkFixture('rule-prompt-injection/vulnerable', [promptInjectionRule]);
    expect(findings.some((f) => f.file === 'docs/threat-model.md')).toBe(false);
  });

  it('finds nothing in the clean fixture', async () => {
    const findings = await checkFixture('rule-prompt-injection/clean', [promptInjectionRule]);
    expect(findings).toEqual([]);
  });
});
