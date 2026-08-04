import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execute } from '../../src/cli';
import { copyFixture } from './helpers';

const SECRET = 'sk_live_4eC39HqLyjWDarjtT1zdp7dc';

describe('--fix end to end', () => {
  it('applies the safe fixes and the after-score is strictly higher', async () => {
    const root = await copyFixture('fix/e2e-app');
    const envBefore = await fs.readFile(path.join(root, '.env'), 'utf8');

    const result = await execute(root, { offline: true, fix: true });
    expect(result.fixes).toBeDefined();
    expect(result.beforeScore).toBeDefined();

    const m = /applied (\d+) fixes? \(score (\d+) → (\d+)\)/.exec(result.output);
    expect(m, `output was:\n${result.output}`).not.toBeNull();
    const applied = Number(m?.[1]);
    const before = Number(m?.[2]);
    const after = Number(m?.[3]);
    expect(applied).toBeGreaterThanOrEqual(3); // unused dep + stripe key + conn string
    expect(after).toBeGreaterThan(before);
    expect(result.output).toContain('Fixes:');
    expect(result.output).toContain('manual fixes'); // the committed .env stays manual

    // The transforms actually landed.
    const keys = await fs.readFile(path.join(root, 'src/keys.ts'), 'utf8');
    expect(keys).toContain('process.env.STRIPE_KEY');
    expect(keys).not.toContain(SECRET);
    const db = await fs.readFile(path.join(root, 'config/db.ts'), 'utf8');
    expect(db).toContain('process.env.DATABASE_URL');
    const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies).not.toHaveProperty('left-pad');

    // Side files created; the real .env untouched.
    const example = await fs.readFile(path.join(root, '.env.example'), 'utf8');
    expect(example).toContain('STRIPE_KEY=<rotate-me>');
    expect(example).toContain('DATABASE_URL=<rotate-me>');
    const gitignore = await fs.readFile(path.join(root, '.gitignore'), 'utf8');
    expect(gitignore).toContain('.env');
    expect(await fs.readFile(path.join(root, '.env'), 'utf8')).toBe(envBefore);
  });

  it('is idempotent: a second --fix run applies nothing', async () => {
    const root = await copyFixture('fix/e2e-app');
    await execute(root, { offline: true, fix: true });

    const second = await execute(root, { offline: true, fix: true });
    expect(second.fixes?.applied).toHaveLength(0);
    expect(second.output).toContain('applied 0 fixes');
  });

  it('--dry-run prints what would change and writes nothing', async () => {
    const root = await copyFixture('fix/e2e-app');
    const pkgBefore = await fs.readFile(path.join(root, 'package.json'), 'utf8');
    const keysBefore = await fs.readFile(path.join(root, 'src/keys.ts'), 'utf8');

    const result = await execute(root, { offline: true, dryRun: true });
    expect(result.output).toContain('Fixes (dry run — nothing written):');
    expect(result.output).toContain('would apply');
    expect(result.fixes?.applied.every((o) => o.description.startsWith('would '))).toBe(true);

    expect(await fs.readFile(path.join(root, 'package.json'), 'utf8')).toBe(pkgBefore);
    expect(await fs.readFile(path.join(root, 'src/keys.ts'), 'utf8')).toBe(keysBefore);
    await expect(fs.access(path.join(root, '.env.example'))).rejects.toThrow();
    await expect(fs.access(path.join(root, '.gitignore'))).rejects.toThrow();
  });
});
