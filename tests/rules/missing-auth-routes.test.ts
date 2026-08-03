import { describe, expect, it } from 'vitest';
import { missingAuthRoutesRule } from '../../src/rules/safe/missing-auth-routes';
import { checkFixture } from '../helpers';

describe('safe/missing-auth-routes', () => {
  it('flags the unauthenticated users route as medium-confidence heuristic', async () => {
    const findings = await checkFixture('bad-app', [missingAuthRoutesRule]);
    const users = findings.find((f) => f.file === 'app/api/users/route.ts');
    expect(users).toBeDefined();
    expect(users?.confidence).toBe('medium');
    expect(users?.message).toContain('GET');
  });

  it('does not flag auth-flow endpoints (login is supposed to be unauthenticated)', async () => {
    const findings = await checkFixture('bad-app', [missingAuthRoutesRule]);
    expect(findings.some((f) => f.file?.includes('login'))).toBe(false);
  });

  it('does not flag the clean route that calls auth()', async () => {
    const findings = await checkFixture('clean-app', [missingAuthRoutesRule]);
    expect(findings).toEqual([]);
  });
});
