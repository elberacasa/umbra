import { describe, expect, it } from 'vitest';
import { duplicationRule } from '../../src/rules/clean/duplication';
import { checkFixture } from '../helpers';

describe('clean/duplication', () => {
  it('detects the copy-pasted currency formatter across files', async () => {
    const findings = await checkFixture('bad-app', [duplicationRule]);
    const dup = findings.find((f) => f.message.includes('Duplicated block'));
    expect(dup).toBeDefined();
    expect(dup?.message).toContain('lib/helpers2.ts');
  });

  it('reports the duplicated block once, not per sliding window', async () => {
    const findings = await checkFixture('bad-app', [duplicationRule]);
    expect(findings).toHaveLength(1);
  });

  it('finds nothing in the clean fixture', async () => {
    const findings = await checkFixture('clean-app', [duplicationRule]);
    expect(findings).toEqual([]);
  });
});
