import { describe, expect, it } from 'vitest';
import { jwtMisconfigRule } from '../../src/rules/safe/jwt-misconfig';
import { checkFixture } from '../helpers';

describe('safe/jwt-misconfig', () => {
  it('flags alg "none" in jwt.verify as critical/high', async () => {
    const findings = await checkFixture('rule-jwt/vulnerable', [jwtMisconfigRule]);
    const hit = findings.find((f) => f.message.includes('alg "none"'));
    expect(hit).toBeDefined();
    expect(hit?.file).toBe('auth.ts');
    expect(hit?.severity).toBe('critical');
    expect(hit?.confidence).toBe('high');
  });

  it('flags jwt.verify without an algorithms allowlist at medium confidence', async () => {
    const findings = await checkFixture('rule-jwt/vulnerable', [jwtMisconfigRule]);
    const hit = findings.find((f) => f.message.includes('algorithms allowlist'));
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('high');
    expect(hit?.confidence).toBe('medium');
  });

  it('flags jwt.sign without expiresIn', async () => {
    const findings = await checkFixture('rule-jwt/vulnerable', [jwtMisconfigRule]);
    const hit = findings.find((f) => f.message.includes('expiresIn'));
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('medium');
    expect(hit?.confidence).toBe('medium');
  });

  it('flags jwt.decode() driving an authorization decision at high confidence', async () => {
    const findings = await checkFixture('rule-jwt/vulnerable', [jwtMisconfigRule]);
    const hit = findings.find((f) => f.message.includes('authorization decision'));
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('high');
    expect(hit?.confidence).toBe('high');
  });

  it('finds nothing in the clean fixture', async () => {
    const findings = await checkFixture('rule-jwt/clean', [jwtMisconfigRule]);
    expect(findings).toEqual([]);
  });

  it('finds nothing in the shared clean-app fixture', async () => {
    const findings = await checkFixture('clean-app', [jwtMisconfigRule]);
    expect(findings).toEqual([]);
  });
});
