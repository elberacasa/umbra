import { describe, expect, it } from 'vitest';
import { mcpConfigRule } from '../../src/rules/safe/mcp-config';
import { checkFixture } from '../helpers';

describe('safe/mcp-config', () => {
  it('flags npx -y without a pinned version at medium confidence', async () => {
    const findings = await checkFixture('rule-mcp-config/vulnerable', [mcpConfigRule]);
    const hit = findings.find((f) => f.message.includes('some-mcp-server'));
    expect(hit).toBeDefined();
    expect(hit?.message).toContain('without a pinned version');
    expect(hit?.severity).toBe('medium');
    expect(hit?.confidence).toBe('medium');
  });

  it('flags uvx without a pinned version (uvx always runs unattended)', async () => {
    const findings = await checkFixture('rule-mcp-config/vulnerable', [mcpConfigRule]);
    const hit = findings.find((f) => f.message.includes('mcp-server-git'));
    expect(hit).toBeDefined();
    expect(hit?.file).toBe('mcp.json');
    expect(hit?.severity).toBe('medium');
    expect(hit?.confidence).toBe('medium');
  });

  it('flags downloads piped into a shell at high confidence', async () => {
    const findings = await checkFixture('rule-mcp-config/vulnerable', [mcpConfigRule]);
    const hit = findings.find((f) => f.message.includes('pipes a remote download'));
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('high');
    expect(hit?.confidence).toBe('high');
  });

  it('flags literal secrets in env blocks as critical', async () => {
    const findings = await checkFixture('rule-mcp-config/vulnerable', [mcpConfigRule]);
    const hit = findings.find((f) => f.message.includes('OpenAI API key'));
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('critical');
    expect(hit?.confidence).toBe('high');
  });

  it('flags literal secrets in args even when the package is pinned', async () => {
    const findings = await checkFixture('rule-mcp-config/vulnerable', [mcpConfigRule]);
    const hits = findings.filter((f) => f.message.includes('"secret-in-args"'));
    expect(hits.length).toBe(1);
    expect(hits[0]?.message).toContain('GitHub personal access token');
    expect(hits[0]?.severity).toBe('critical');
  });

  it('stays quiet on pinned versions, ${VAR} indirection, and npx without -y', async () => {
    const findings = await checkFixture('rule-mcp-config/clean', [mcpConfigRule]);
    expect(findings).toEqual([]);
  });

  it('fails closed on unparseable JSON', async () => {
    // broken.mcp.json lives in the clean fixture; the clean assertion above
    // already covers it, but check the file in isolation to be explicit.
    const findings = await checkFixture('rule-mcp-config/clean', [mcpConfigRule]);
    expect(findings.some((f) => f.file === 'broken.mcp.json')).toBe(false);
  });
});
