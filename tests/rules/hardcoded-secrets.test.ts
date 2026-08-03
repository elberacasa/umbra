import { describe, expect, it } from 'vitest';
import { hardcodedSecretsRule } from '../../src/rules/safe/hardcoded-secrets';
import { checkFixture } from '../helpers';

describe('safe/hardcoded-secrets', () => {
  it('flags the committed .env file with evidence', async () => {
    const findings = await checkFixture('bad-app', [hardcodedSecretsRule]);
    const envFinding = findings.find((f) => f.file === '.env' && f.message.includes('Committed environment file'));
    expect(envFinding).toBeDefined();
    expect(envFinding?.confidence).toBe('high');
  });

  it('detects the hardcoded service_role JWT and decodes its role', async () => {
    const findings = await checkFixture('bad-app', [hardcodedSecretsRule]);
    const jwtFindings = findings.filter((f) => f.message.includes('service_role JWT'));
    expect(jwtFindings.length).toBeGreaterThanOrEqual(1);
    expect(jwtFindings[0]?.severity).toBe('critical');
    expect(jwtFindings[0]?.file).toBeDefined();
    expect(jwtFindings[0]?.line).toBeGreaterThan(0);
  });

  it('detects the Stripe live key', async () => {
    const findings = await checkFixture('bad-app', [hardcodedSecretsRule]);
    expect(findings.some((f) => f.message.includes('Stripe live secret key'))).toBe(true);
  });

  it('finds nothing in the clean fixture', async () => {
    const findings = await checkFixture('clean-app', [hardcodedSecretsRule]);
    expect(findings).toEqual([]);
  });
});
