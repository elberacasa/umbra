import { describe, expect, it } from 'vitest';
import { supabaseAntipatternsRule } from '../../src/rules/safe/supabase-antipatterns';
import { checkFixture } from '../helpers';

describe('safe/supabase-antipatterns', () => {
  it('flags service_role key reachable from client code', async () => {
    const findings = await checkFixture('bad-app', [supabaseAntipatternsRule]);
    const clientKey = findings.filter((f) => f.message.includes('service_role key reachable from client-side code'));
    expect(clientKey.length).toBeGreaterThanOrEqual(1);
    expect(clientKey.every((f) => f.severity === 'critical')).toBe(true);
    expect(clientKey.some((f) => f.file?.includes('UserList.tsx'))).toBe(true);
    // the committed .env exposes the same key under a NEXT_PUBLIC_ name
    expect(clientKey.some((f) => f.file === '.env')).toBe(true);
  });

  it('flags client table queries when no RLS policy exists in the repo', async () => {
    const findings = await checkFixture('bad-app', [supabaseAntipatternsRule]);
    const rls = findings.find((f) => f.message.includes('no RLS policy'));
    expect(rls).toBeDefined();
    expect(rls?.confidence).toBe('medium');
  });

  it('finds nothing in the clean fixture (RLS migration present, no service_role)', async () => {
    const findings = await checkFixture('clean-app', [supabaseAntipatternsRule]);
    expect(findings).toEqual([]);
  });
});
