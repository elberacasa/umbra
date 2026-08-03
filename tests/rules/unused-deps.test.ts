import { describe, expect, it } from 'vitest';
import { unusedDepsRule } from '../../src/rules/clean/unused-deps';
import { checkFixture } from '../helpers';

describe('clean/unused-deps', () => {
  it('flags axios and lodash as unused', async () => {
    const findings = await checkFixture('bad-app', [unusedDepsRule]);
    const messages = findings.map((f) => f.message);
    expect(messages).toEqual(
      expect.arrayContaining([expect.stringContaining('"axios"'), expect.stringContaining('"lodash"')]),
    );
  });

  it('does not flag imported deps or implicit framework deps', async () => {
    const findings = await checkFixture('bad-app', [unusedDepsRule]);
    expect(findings.some((f) => f.message.includes('@supabase/supabase-js'))).toBe(false);
    expect(findings.some((f) => f.message.includes('"next"'))).toBe(false);
    expect(findings.some((f) => f.message.includes('"react"'))).toBe(false);
  });

  it('finds nothing in the clean fixture', async () => {
    const findings = await checkFixture('clean-app', [unusedDepsRule]);
    expect(findings).toEqual([]);
  });
});
