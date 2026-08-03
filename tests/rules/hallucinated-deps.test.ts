import { describe, expect, it } from 'vitest';
import { hallucinatedDepsRule } from '../../src/rules/safe/hallucinated-deps';
import { checkFixture, stubResolver } from '../helpers';

describe('safe/hallucinated-deps', () => {
  it('flags registry-missing dependencies using the injected resolver', async () => {
    const findings = await checkFixture('bad-app', [hallucinatedDepsRule]);
    const missing = findings.filter((f) => f.message.includes('does not exist on the npm registry'));
    expect(missing.map((f) => f.message)).toEqual(
      expect.arrayContaining([expect.stringContaining('supafast-orm'), expect.stringContaining('react-query-v9-pro')]),
    );
    expect(missing.every((f) => f.confidence === 'high')).toBe(true);
  });

  it('skips with a low-confidence note when the resolver is unknown (offline)', async () => {
    const offline = async () => 'unknown' as const;
    const findings = await checkFixture('bad-app', [hallucinatedDepsRule], { resolvePackage: offline });
    expect(findings.some((f) => f.message.includes('does not exist'))).toBe(false);
    expect(findings.some((f) => f.confidence === 'low' && f.message.includes('Could not verify'))).toBe(true);
  });

  it('finds nothing in the clean fixture', async () => {
    const findings = await checkFixture('clean-app', [hallucinatedDepsRule], { resolvePackage: stubResolver });
    expect(findings).toEqual([]);
  });
});
