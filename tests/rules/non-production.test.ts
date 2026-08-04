import { describe, expect, it } from 'vitest';
import { isNonProductionPath } from '../../src/rules/context';
import { injectionSinksRule } from '../../src/rules/safe/injection-sinks';
import { hardcodedSecretsRule } from '../../src/rules/safe/hardcoded-secrets';
import { defaultCredentialsRule } from '../../src/rules/safe/default-credentials';
import { corsWildcardRule } from '../../src/rules/safe/cors-wildcard';
import { checkFixture } from '../helpers';

describe('isNonProductionPath', () => {
  it('matches test, e2e, benchmark, fixture, script, doc, prompt, example, and demo paths', () => {
    const paths = [
      'src/app.test.ts',
      'src/app.spec.tsx',
      'src/__tests__/util.ts',
      'test/helper.ts',
      'tests/helper.ts',
      'testing/fake-llm-server.ts',
      'src/testing/fake-server.ts',
      'e2e/flows.ts',
      'e2e-tests/flows.ts',
      'benchmarks/run.mjs',
      'fixtures/seed.ts',
      'scripts/setup.ts',
      'docs/guide.ts',
      'README.md',
      'prompts/sql.ts',
      'src/prompts/sql.ts',
      'examples/demo.ts',
      'demo/app.ts',
    ];
    for (const p of paths) expect(isNonProductionPath(p), p).toBe(true);
  });

  it('does not match production paths', () => {
    const paths = [
      'src/app.ts',
      'lib/db.ts',
      'app/api/users/route.ts',
      'src/components/Button.tsx',
      'src/latest/news.ts',
      'src/contest/winner.ts',
    ];
    for (const p of paths) expect(isNonProductionPath(p), p).toBe(false);
  });
});

describe('SAFE rules suppress non-production contexts (fixtures/rule-nonproduction)', () => {
  it('injection-sinks fires in src/ but not in tests, e2e specs, or prompt templates', async () => {
    const findings = await checkFixture('rule-nonproduction', [injectionSinksRule]);
    expect(findings.some((f) => f.file === 'src/app.ts')).toBe(true);
    expect(findings.some((f) => f.file === 'src/app.test.ts')).toBe(false);
    expect(findings.some((f) => f.file === 'e2e-tests/flows.spec.ts')).toBe(false);
    expect(findings.some((f) => f.file === 'prompts/query_prompt.ts')).toBe(false);
  });

  it('default-credentials fires in src/ but not in scripts/', async () => {
    const findings = await checkFixture('rule-nonproduction', [defaultCredentialsRule]);
    expect(findings.some((f) => f.file === 'src/db.ts')).toBe(true);
    expect(findings.some((f) => f.file === 'scripts/setup.ts')).toBe(false);
  });

  it('cors-wildcard fires in src/ but not in examples/', async () => {
    const findings = await checkFixture('rule-nonproduction', [corsWildcardRule]);
    expect(findings.some((f) => f.file === 'src/server.ts')).toBe(true);
    expect(findings.some((f) => f.file === 'examples/cors-demo.ts')).toBe(false);
  });

  it('hardcoded-secrets still fires on a real live key in a test file, at medium confidence', async () => {
    const findings = await checkFixture('rule-nonproduction', [hardcodedSecretsRule]);
    const leaked = findings.find((f) => f.file === 'tests/keys.ts');
    expect(leaked).toBeDefined();
    expect(leaked?.message).toContain('Stripe live secret key');
    expect(leaked?.confidence).toBe('medium');
  });

  it('hardcoded-secrets suppresses placeholder credentials in test files but flags them in src/', async () => {
    const findings = await checkFixture('rule-nonproduction', [hardcodedSecretsRule]);
    expect(findings.some((f) => f.file === 'tests/placeholder.ts')).toBe(false);
    expect(findings.some((f) => f.file === 'src/config.ts')).toBe(true);
  });
});
