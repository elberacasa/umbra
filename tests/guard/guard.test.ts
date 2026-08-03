import { describe, expect, it } from 'vitest';
import { performance } from 'node:perf_hooks';
import { guardContent } from '../../src/guard/guard';

describe('guardContent — content rules', () => {
  it('blocks a hardcoded live secret (critical/high at high confidence)', async () => {
    const verdict = await guardContent(
      'src/billing.ts',
      "const stripe = new Stripe('sk_live_4eC39HqLyjWDarjtT1zdp7dc');\n",
    );
    expect(verdict.decision).toBe('block');
    expect(verdict.findings.some((f) => f.ruleId === 'safe/hardcoded-secrets')).toBe(true);
  });

  it('blocks eval() in a proposed edit', async () => {
    const verdict = await guardContent('src/util.ts', 'const out = eval(userInput);\n');
    expect(verdict.decision).toBe('block');
    expect(verdict.findings.some((f) => f.ruleId === 'safe/injection-sinks')).toBe(true);
  });

  it('warns (never blocks) on medium-confidence findings', async () => {
    const verdict = await guardContent(
      'src/api.ts',
      "const api_key = 'AbcdEfghIjklMnopQrStUvWx1234';\nexport { api_key };\n",
    );
    expect(verdict.decision).toBe('warn');
    expect(verdict.findings.length).toBeGreaterThan(0);
    expect(verdict.findings.every((f) => f.confidence !== 'low')).toBe(true);
  });

  it('allows benign code with no findings', async () => {
    const verdict = await guardContent(
      'src/math.ts',
      'export function add(a: number, b: number): number {\n  return a + b;\n}\n',
    );
    expect(verdict.decision).toBe('allow');
    expect(verdict.findings).toEqual([]);
    expect(verdict.pathViolation).toBeUndefined();
  });

  it('never surfaces low-confidence findings', async () => {
    // jwt.decode without an authorization use is a low/low finding in the rule.
    const verdict = await guardContent(
      'src/profile.ts',
      "import jwt from 'jsonwebtoken';\nexport function displayName(t: string): string {\n  const claims = jwt.decode(t) as { name?: string };\n  return claims.name ?? 'anon';\n}\n",
    );
    expect(verdict.findings.every((f) => f.confidence !== 'low')).toBe(true);
    expect(verdict.decision).toBe('allow');
  });
});

describe('guardContent — path guard', () => {
  it('blocks writes to .git/hooks even with benign content', async () => {
    const verdict = await guardContent('.git/hooks/post-commit', '#!/bin/sh\necho hi\n');
    expect(verdict.decision).toBe('block');
    expect(verdict.pathViolation).toContain('.git/hooks');
    expect(verdict.pathViolation).toContain('CVE-2026-26268');
  });

  it('blocks writes to nested .git/hooks (submodule/worktree)', async () => {
    const verdict = await guardContent('packages/lib/.git/hooks/pre-push', '#!/bin/sh\nexit 0\n');
    expect(verdict.decision).toBe('block');
    expect(verdict.pathViolation).toBeDefined();
  });

  it('blocks writes to .git/config', async () => {
    const verdict = await guardContent('.git/config', '[core]\n\thooksPath = .githooks\n');
    expect(verdict.decision).toBe('block');
    expect(verdict.pathViolation).toContain('.git/config');
  });

  it('handles Windows-style separators for protected paths', async () => {
    const verdict = await guardContent('.git\\hooks\\pre-commit', '#!/bin/sh\nexit 0\n');
    expect(verdict.decision).toBe('block');
    expect(verdict.pathViolation).toBeDefined();
  });

  it('allows writes to .gitignore and other .git-adjacent files', async () => {
    const verdict = await guardContent('.gitignore', 'node_modules\ndist\n');
    expect(verdict.decision).toBe('allow');
    expect(verdict.pathViolation).toBeUndefined();
  });

  it('blocks .env writes containing a service_role JWT', async () => {
    const serviceRoleJwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
      Buffer.from(
        JSON.stringify({ iss: 'supabase', role: 'service_role', iat: 1700000000, exp: 1900000000 }),
      ).toString('base64url') +
      '.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5c';
    const verdict = await guardContent('.env', `SUPABASE_SERVICE_ROLE_KEY=${serviceRoleJwt}\n`);
    expect(verdict.decision).toBe('block');
    expect(verdict.pathViolation).toContain('.env');
  });

  it('blocks .env.production writes containing a Stripe live key', async () => {
    const verdict = await guardContent(
      '.env.production',
      'STRIPE_SECRET_KEY=sk_live_4eC39HqLyjWDarjtT1zdp7dc\n',
    );
    expect(verdict.decision).toBe('block');
    expect(verdict.pathViolation).toBeDefined();
  });

  it('allows .env writes without live-key material', async () => {
    const verdict = await guardContent(
      '.env',
      'PORT=3000\nDATABASE_URL=postgres://localhost:5432/dev\nLOG_LEVEL=debug\n',
    );
    expect(verdict.decision).toBe('allow');
    expect(verdict.pathViolation).toBeUndefined();
  });

  it('allows .env.example templates with placeholder values', async () => {
    const verdict = await guardContent(
      '.env.example',
      'STRIPE_SECRET_KEY=sk_live_your_key_here\nAPI_TOKEN=your-token-here-replace-me\n',
    );
    expect(verdict.decision).toBe('allow');
    expect(verdict.pathViolation).toBeUndefined();
  });
});

describe('guardContent — latency', () => {
  it('verdicts on a 500-line file stay under 50ms median', async () => {
    const lines: string[] = [];
    for (let i = 0; i < 500; i++) {
      lines.push(`export const value${i} = compute(${i}, 'label-${i}');`);
    }
    const content = lines.join('\n');

    // Warm up rule compilation outside the measurement.
    await guardContent('src/generated.ts', content);

    const samples: number[] = [];
    for (let i = 0; i < 100; i++) {
      const start = performance.now();
      await guardContent('src/generated.ts', content);
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)] ?? Number.POSITIVE_INFINITY;
    expect(median).toBeLessThan(50);
  });
});
