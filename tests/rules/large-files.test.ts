import { describe, expect, it } from 'vitest';
import { largeFilesRule } from '../../src/rules/clean/large-files';
import { checkFixture } from '../helpers';

describe('clean/large-files', () => {
  it('flags the 600-line generated file', async () => {
    const findings = await checkFixture('bad-app', [largeFilesRule]);
    const huge = findings.find((f) => f.file === 'lib/huge.ts');
    expect(huge).toBeDefined();
    expect(huge?.message).toMatch(/File has 60\d lines/);
  });

  it('finds nothing in the clean fixture', async () => {
    const findings = await checkFixture('clean-app', [largeFilesRule]);
    expect(findings).toEqual([]);
  });
});
