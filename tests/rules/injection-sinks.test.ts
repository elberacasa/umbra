import { describe, expect, it } from 'vitest';
import { injectionSinksRule } from '../../src/rules/safe/injection-sinks';
import { checkFixture } from '../helpers';

describe('safe/injection-sinks', () => {
  it('flags SQL template interpolation with high confidence', async () => {
    const findings = await checkFixture('bad-app', [injectionSinksRule]);
    const sql = findings.filter((f) => f.message.includes('template-string interpolation'));
    const db = sql.find((f) => f.file === 'lib/db.ts');
    expect(db).toBeDefined();
    expect(db?.confidence).toBe('high');
    // the route handler has its own raw DELETE interpolation — also caught
    expect(sql.some((f) => f.file === 'app/api/users/route.ts')).toBe(true);
  });

  it('flags eval()', async () => {
    const findings = await checkFixture('bad-app', [injectionSinksRule]);
    expect(findings.some((f) => f.message.startsWith('eval()'))).toBe(true);
  });

  it('flags dangerouslySetInnerHTML with a dynamic value', async () => {
    const findings = await checkFixture('bad-app', [injectionSinksRule]);
    const dhtml = findings.find((f) => f.message.includes('dangerouslySetInnerHTML'));
    expect(dhtml).toBeDefined();
    expect(dhtml?.file).toContain('UserList.tsx');
    expect(dhtml?.confidence).toBe('medium');
  });

  it('finds nothing in the clean fixture', async () => {
    const findings = await checkFixture('clean-app', [injectionSinksRule]);
    expect(findings).toEqual([]);
  });
});
