import { describe, expect, it } from 'vitest';
import { corsWildcardRule } from '../../src/rules/safe/cors-wildcard';
import { checkFixture } from '../helpers';

describe('safe/cors-wildcard', () => {
  it('flags wildcard origin combined with credentials at high confidence', async () => {
    const findings = await checkFixture('rule-cors/vulnerable', [corsWildcardRule]);
    const hit = findings.find((f) => f.message.includes('combined with credentials'));
    expect(hit).toBeDefined();
    expect(hit?.file).toBe('server.ts');
    expect(hit?.severity).toBe('high');
    expect(hit?.confidence).toBe('high');
    expect(hit?.line).toBeGreaterThan(0);
  });

  it('flags the manual wildcard + credentials headers on the admin middleware', async () => {
    const findings = await checkFixture('rule-cors/vulnerable', [corsWildcardRule]);
    const hits = findings.filter((f) => f.message.includes('combined with credentials'));
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits.some((f) => f.message.includes('credentials'))).toBe(true);
  });

  it('flags bare cors() with medium confidence when the app has auth routes', async () => {
    const findings = await checkFixture('rule-cors/vulnerable', [corsWildcardRule]);
    const hit = findings.find((f) => f.message.includes('cors() with no options'));
    expect(hit).toBeDefined();
    expect(hit?.file).toBe('profile.ts');
    expect(hit?.confidence).toBe('medium');
  });

  it('does not flag bare cors() when the app has no auth surface', async () => {
    const findings = await checkFixture('rule-cors/clean-public', [corsWildcardRule]);
    expect(findings).toEqual([]);
  });

  it('finds nothing in the clean fixture (explicit origin allowlist)', async () => {
    const findings = await checkFixture('rule-cors/clean', [corsWildcardRule]);
    expect(findings).toEqual([]);
  });

  it('finds nothing in the shared clean-app fixture', async () => {
    const findings = await checkFixture('clean-app', [corsWildcardRule]);
    expect(findings).toEqual([]);
  });
});
