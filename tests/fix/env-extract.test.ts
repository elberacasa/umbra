import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { applyFixes } from '../../src/fix/index';
import { hardcodedSecretsRule } from '../../src/rules/safe/hardcoded-secrets';
import { defaultCredentialsRule } from '../../src/rules/safe/default-credentials';
import type { Finding } from '../../src/engine/types';
import { copyFixture, scanWith } from './helpers';

const SECRET = 'sk_live_4eC39HqLyjWDarjtT1zdp7dc';

describe('fix: env extraction (hardcoded-secrets + default-credentials)', () => {
  it('extracts an assigned Stripe live key to process.env.STRIPE_KEY', async () => {
    const root = await copyFixture('fix/secrets');
    const findings = await scanWith(root, [hardcodedSecretsRule]);
    const report = await applyFixes(root, findings, {});

    const keys = await fs.readFile(path.join(root, 'src/keys.ts'), 'utf8');
    expect(keys).toContain('const STRIPE_KEY = process.env.STRIPE_KEY;');
    expect(keys).not.toContain(SECRET);

    const example = await fs.readFile(path.join(root, '.env.example'), 'utf8');
    expect(example).toContain('STRIPE_KEY=<rotate-me>');

    const gitignore = await fs.readFile(path.join(root, '.gitignore'), 'utf8');
    const giLines = gitignore.split('\n').map((l) => l.trim());
    expect(giLines).toContain('.env');
    expect(giLines).toContain('.env.*');
    expect(giLines).toContain('!.env.example');

    // The re-scan no longer flags the source file.
    const after = await scanWith(root, [hardcodedSecretsRule]);
    expect(after.some((f) => f.file === 'src/keys.ts')).toBe(false);
  });

  it('never rewrites a committed .env — gitignores it, reports manual rotate/purge', async () => {
    const root = await copyFixture('fix/secrets');
    const envBefore = await fs.readFile(path.join(root, '.env'), 'utf8');
    const findings = await scanWith(root, [hardcodedSecretsRule]);
    expect(findings.some((f) => f.file === '.env')).toBe(true);

    const report = await applyFixes(root, findings, {});
    const envOutcomes = [...report.applied, ...report.manual, ...report.skipped].filter(
      (o) => o.finding.file === '.env',
    );
    expect(envOutcomes.length).toBeGreaterThan(0);
    expect(envOutcomes.every((o) => o.status === 'manual')).toBe(true);
    expect(envOutcomes.some((o) => o.description.includes('rotate the key'))).toBe(true);
    expect(envOutcomes.some((o) => o.description.includes('purge'))).toBe(true);

    // Contents byte-identical; the file is now gitignored.
    expect(await fs.readFile(path.join(root, '.env'), 'utf8')).toBe(envBefore);
    const gitignore = await fs.readFile(path.join(root, '.gitignore'), 'utf8');
    expect(gitignore.split('\n').map((l) => l.trim())).toContain('.env');
  });

  it('merges .env.example instead of clobbering existing keys', async () => {
    const root = await copyFixture('fix/secrets');
    await fs.writeFile(path.join(root, '.env.example'), 'OTHER_KEY=abc123\n', 'utf8');

    const findings = await scanWith(root, [hardcodedSecretsRule]);
    await applyFixes(root, findings, {});

    const example = await fs.readFile(path.join(root, '.env.example'), 'utf8');
    expect(example).toContain('OTHER_KEY=abc123');
    expect(example.split('\n').filter((l) => l.startsWith('STRIPE_KEY='))).toEqual(['STRIPE_KEY=<rotate-me>']);
  });

  it('keeps an existing .env.example key verbatim — never overwrites it', async () => {
    const root = await copyFixture('fix/secrets');
    await fs.writeFile(path.join(root, '.env.example'), 'STRIPE_KEY=real-value-set-by-human\n', 'utf8');

    const findings = await scanWith(root, [hardcodedSecretsRule]);
    await applyFixes(root, findings, {});

    const example = await fs.readFile(path.join(root, '.env.example'), 'utf8');
    expect(example.split('\n').filter((l) => l.startsWith('STRIPE_KEY='))).toEqual([
      'STRIPE_KEY=real-value-set-by-human',
    ]);
  });

  it('appends missing .gitignore lines without duplicating or clobbering', async () => {
    const root = await copyFixture('fix/secrets');
    await fs.writeFile(path.join(root, '.gitignore'), 'node_modules\n.env\n', 'utf8');

    const findings = await scanWith(root, [hardcodedSecretsRule]);
    await applyFixes(root, findings, {});

    const lines = (await fs.readFile(path.join(root, '.gitignore'), 'utf8')).split('\n').map((l) => l.trim());
    expect(lines).toContain('node_modules');
    expect(lines.filter((l) => l === '.env')).toHaveLength(1);
    expect(lines).toContain('.env.*');
    expect(lines).toContain('!.env.example');
  });

  it('extracts default creds in a connection string to process.env.DATABASE_URL', async () => {
    const root = await copyFixture('fix/default-creds');
    const findings = await scanWith(root, [defaultCredentialsRule]);
    expect(findings).toHaveLength(1);

    const report = await applyFixes(root, findings, {});
    expect(report.applied).toHaveLength(1);

    const db = await fs.readFile(path.join(root, 'config/db.ts'), 'utf8');
    expect(db).toContain('export const DATABASE_URL = process.env.DATABASE_URL;');
    expect(db).not.toContain('admin:admin');

    const example = await fs.readFile(path.join(root, '.env.example'), 'utf8');
    expect(example).toContain('DATABASE_URL=<rotate-me>');

    const after = await scanWith(root, [defaultCredentialsRule]);
    expect(after).toHaveLength(0);
  });

  it('extracts a weak password literal using the assignment key name', async () => {
    const root = await copyFixture('fix/default-creds');
    await fs.mkdir(path.join(root, 'seed'), { recursive: true });
    await fs.writeFile(path.join(root, 'seed/admin.ts'), 'export const seedUser = { password: "admin" };\n', 'utf8');

    const findings = await scanWith(root, [defaultCredentialsRule]);
    const pwFinding = findings.find((f) => f.file === 'seed/admin.ts');
    expect(pwFinding).toBeDefined();

    const report = await applyFixes(root, findings, {});
    const outcome = [...report.applied, ...report.manual].find((o) => o.finding.file === 'seed/admin.ts');
    expect(outcome?.status).toBe('applied');

    const seed = await fs.readFile(path.join(root, 'seed/admin.ts'), 'utf8');
    expect(seed).toContain('password: process.env.PASSWORD');
    expect(seed).not.toContain('"admin"');
  });

  it('falls back to UMBRA_SECRET_<n> when no assignment name exists', async () => {
    const root = await copyFixture('fix/secrets');
    await fs.writeFile(path.join(root, 'src/inline.ts'), `export const client = stripe("${SECRET}");\n`, 'utf8');

    const findings = await scanWith(root, [hardcodedSecretsRule]);
    const inlineFinding = findings.find((f) => f.file === 'src/inline.ts');
    expect(inlineFinding).toBeDefined();

    const report = await applyFixes(root, findings, {});
    const outcome = report.applied.find((o) => o.finding.file === 'src/inline.ts');
    expect(outcome).toBeDefined();

    const inline = await fs.readFile(path.join(root, 'src/inline.ts'), 'utf8');
    expect(inline).toContain('stripe(process.env.UMBRA_SECRET_1)');
    const example = await fs.readFile(path.join(root, '.env.example'), 'utf8');
    expect(example).toContain('UMBRA_SECRET_1=<rotate-me>');
  });

  it('multi-line private key material is always manual', async () => {
    const root = await copyFixture('fix/secrets');
    await fs.writeFile(
      path.join(root, 'src/pem.ts'),
      'export const PEM = `-----BEGIN PRIVATE KEY-----\nABC123\n-----END PRIVATE KEY-----`;\n',
      'utf8',
    );
    const finding: Finding = {
      ruleId: 'safe/hardcoded-secrets',
      axis: 'SAFE',
      severity: 'critical',
      confidence: 'high',
      message: 'Hardcoded private key material in source',
      file: 'src/pem.ts',
      line: 1,
    };

    const before = await fs.readFile(path.join(root, 'src/pem.ts'), 'utf8');
    const report = await applyFixes(root, [finding], {});
    expect(report.manual).toHaveLength(1);
    expect(report.manual[0]?.description).toContain('multi-line');
    expect(await fs.readFile(path.join(root, 'src/pem.ts'), 'utf8')).toBe(before);
  });

  it('dry-run writes nothing: source, .env.example, and .gitignore untouched', async () => {
    const root = await copyFixture('fix/secrets');
    const keysBefore = await fs.readFile(path.join(root, 'src/keys.ts'), 'utf8');
    const envBefore = await fs.readFile(path.join(root, '.env'), 'utf8');

    const findings = await scanWith(root, [hardcodedSecretsRule]);
    const report = await applyFixes(root, findings, { dryRun: true });

    expect(report.applied.length).toBeGreaterThan(0);
    expect(report.applied.every((o) => o.description.startsWith('would '))).toBe(true);
    expect(await fs.readFile(path.join(root, 'src/keys.ts'), 'utf8')).toBe(keysBefore);
    expect(await fs.readFile(path.join(root, '.env'), 'utf8')).toBe(envBefore);
    await expect(fs.access(path.join(root, '.env.example'))).rejects.toThrow();
    await expect(fs.access(path.join(root, '.gitignore'))).rejects.toThrow();
  });
});
