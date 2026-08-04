import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { applyFixes } from '../../src/fix/index';
import { unusedDepsRule } from '../../src/rules/clean/unused-deps';
import { copyFixture, scanWith } from './helpers';

describe('fix: clean/unused-deps', () => {
  it('removes the unused dep with 2-space JSON and a trailing newline', async () => {
    const root = await copyFixture('fix/unused-deps');
    const findings = await scanWith(root, [unusedDepsRule]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('left-pad');

    const report = await applyFixes(root, findings, {});
    expect(report.applied).toHaveLength(1);
    // We never run npm install — the note tells the user to.
    expect(report.applied[0]?.description).toContain('npm install');

    const raw = await fs.readFile(path.join(root, 'package.json'), 'utf8');
    expect(raw.endsWith('}\n')).toBe(true);
    expect(raw).toContain('  "dependencies"');
    const pkg = JSON.parse(raw) as { dependencies: Record<string, string> };
    expect(pkg.dependencies).not.toHaveProperty('left-pad');
    expect(pkg.dependencies).toHaveProperty('picocolors');

    // Idempotent: the re-scan is clean, so a second run applies nothing.
    const after = await scanWith(root, [unusedDepsRule]);
    expect(after).toHaveLength(0);
    const second = await applyFixes(root, after, {});
    expect(second.applied).toHaveLength(0);
  });

  it('dry-run writes nothing but reports what would change', async () => {
    const root = await copyFixture('fix/unused-deps');
    const before = await fs.readFile(path.join(root, 'package.json'), 'utf8');
    const findings = await scanWith(root, [unusedDepsRule]);

    const report = await applyFixes(root, findings, { dryRun: true });
    expect(report.applied).toHaveLength(1);
    expect(report.applied[0]?.description.startsWith('would ')).toBe(true);
    expect(await fs.readFile(path.join(root, 'package.json'), 'utf8')).toBe(before);
  });

  it('a stale finding for an already-removed dep is skipped, not re-applied', async () => {
    const root = await copyFixture('fix/unused-deps');
    const findings = await scanWith(root, [unusedDepsRule]);
    await applyFixes(root, findings, {});

    const again = await applyFixes(root, findings, {});
    expect(again.applied).toHaveLength(0);
    expect(again.skipped).toHaveLength(1);
  });
});
