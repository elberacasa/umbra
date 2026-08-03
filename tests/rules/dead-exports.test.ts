import { describe, expect, it } from 'vitest';
import { deadExportsRule } from '../../src/rules/clean/dead-exports';
import { checkFixture } from '../helpers';

describe('clean/dead-exports', () => {
  it('flags exports never referenced anywhere else', async () => {
    const findings = await checkFixture('bad-app', [deadExportsRule]);
    const names = findings.map((f) => f.message);
    expect(names).toEqual(
      expect.arrayContaining([expect.stringContaining('"formatStuff"'), expect.stringContaining('"formatCurrencyAlt"')]),
    );
  });

  it('does not flag exports that are used', async () => {
    const findings = await checkFixture('bad-app', [deadExportsRule]);
    expect(findings.some((f) => f.message.includes('"slugify"'))).toBe(false);
    expect(findings.some((f) => f.message.includes('"formatCurrency" is'))).toBe(false);
  });

  it('skips framework-convention files (route handlers export GET/POST)', async () => {
    const findings = await checkFixture('bad-app', [deadExportsRule]);
    expect(findings.some((f) => f.message.includes('"GET"') || f.message.includes('"POST"'))).toBe(false);
  });

  it('finds nothing in the clean fixture', async () => {
    const findings = await checkFixture('clean-app', [deadExportsRule]);
    expect(findings).toEqual([]);
  });
});
