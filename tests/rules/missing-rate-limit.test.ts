import { describe, expect, it } from 'vitest';
import { missingRateLimitRule } from '../../src/rules/safe/missing-rate-limit';
import { checkFixture } from '../helpers';

describe('safe/missing-rate-limit', () => {
  it('flags the login endpoint as a low-confidence note', async () => {
    const findings = await checkFixture('bad-app', [missingRateLimitRule]);
    const login = findings.find((f) => f.file === 'app/api/login/route.ts');
    expect(login).toBeDefined();
    expect(login?.confidence).toBe('low');
  });

  it('finds nothing in the clean fixture (no auth-flow routes)', async () => {
    const findings = await checkFixture('clean-app', [missingRateLimitRule]);
    expect(findings).toEqual([]);
  });
});
