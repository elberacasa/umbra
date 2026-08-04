import { describe, expect, it } from 'vitest';
import { deadExportsRule } from '../../src/rules/clean/dead-exports';
import { computeScore } from '../../src/score/score';
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

  it('reports at low confidence only — a heuristic hunch goes to notes, never the score', async () => {
    const findings = await checkFixture('bad-app', [deadExportsRule]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((f) => f.confidence === 'low')).toBe(true);
    const result = computeScore(findings);
    expect(result.scoredFindings).toHaveLength(0);
    expect(result.notes).toHaveLength(findings.length);
    expect(result.total).toBe(100);
  });

  describe('entry points and public API (fixtures/rule-dead-exports)', () => {
    const flaggedNames = async (): Promise<string[]> => {
      const findings = await checkFixture('rule-dead-exports', [deadExportsRule]);
      return findings.map((f) => f.message);
    };

    it('never flags the library public API surface (package.json entries + barrel re-export graph)', async () => {
      const names = await flaggedNames();
      // package.json "exports" entry src/index.ts, its barrel targets
      // src/public.ts and src/greeter.ts, and the "bin" entry cli.js.
      expect(names.some((m) => m.includes('"publicHelper"'))).toBe(false);
      expect(names.some((m) => m.includes('"greet"'))).toBe(false);
      expect(names.some((m) => m.includes('"cliVersion"'))).toBe(false);
    });

    it('never flags config files, type declarations, scripts, or framework route files', async () => {
      const names = await flaggedNames();
      expect(names.some((m) => m.includes('"buildConfig"'))).toBe(false); // vite.config.ts
      expect(names.some((m) => m.includes('"WidgetConfig"'))).toBe(false); // src/types.d.ts
      expect(names.some((m) => m.includes('"seedData"'))).toBe(false); // scripts/seed.ts
      expect(names.some((m) => m.includes('"metadata"'))).toBe(false); // app/page.tsx
    });

    it('still flags a genuinely dead function in app code, but not a used one', async () => {
      const names = await flaggedNames();
      expect(names.some((m) => m.includes('"deadHelper"'))).toBe(true);
      expect(names.some((m) => m.includes('"usedHelper"'))).toBe(false);
    });
  });
});
