import { describe, expect, it } from 'vitest';
import { defaultCredentialsRule } from '../../src/rules/safe/default-credentials';
import { checkFixture } from '../helpers';

describe('safe/default-credentials', () => {
  it('flags weak password literals in seed files at high confidence', async () => {
    const findings = await checkFixture('rule-default-creds/vulnerable', [defaultCredentialsRule]);
    const hit = findings.find((f) => f.file === 'seed.ts' && f.message.includes('credential literal'));
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('high');
    expect(hit?.confidence).toBe('high');
    expect(hit?.line).toBeGreaterThan(0);
  });

  it('flags connection strings with default credentials', async () => {
    const findings = await checkFixture('rule-default-creds/vulnerable', [defaultCredentialsRule]);
    const hit = findings.find((f) => f.message.includes('Connection string uses default credentials'));
    expect(hit).toBeDefined();
    expect(hit?.file).toBe('config.ts');
    expect(hit?.severity).toBe('high');
    expect(hit?.confidence).toBe('high');
    expect(hit?.message).toContain('postgres:postgres');
  });

  it('finds nothing in the clean fixture (credentials come from env)', async () => {
    const findings = await checkFixture('rule-default-creds/clean', [defaultCredentialsRule]);
    expect(findings).toEqual([]);
  });

  it('finds nothing in the shared clean-app fixture', async () => {
    const findings = await checkFixture('clean-app', [defaultCredentialsRule]);
    expect(findings).toEqual([]);
  });
});
