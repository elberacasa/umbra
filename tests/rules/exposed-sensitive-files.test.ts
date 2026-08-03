import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exposedSensitiveFilesRule } from '../../src/rules/safe/exposed-sensitive-files';
import { checkFixture } from '../helpers';

describe('safe/exposed-sensitive-files', () => {
  it('flags a committed private SSH key as critical/high', async () => {
    const findings = await checkFixture('rule-exposed-files/vulnerable', [exposedSensitiveFilesRule]);
    const hit = findings.find((f) => f.file === 'deploy/id_rsa');
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('critical');
    expect(hit?.confidence).toBe('high');
  });

  it('distinguishes private-key .pem files (critical) from plain certs (medium confidence)', async () => {
    const findings = await checkFixture('rule-exposed-files/vulnerable', [exposedSensitiveFilesRule]);
    const key = findings.find((f) => f.file === 'certs/server-key.pem');
    expect(key).toBeDefined();
    expect(key?.severity).toBe('critical');
    expect(key?.confidence).toBe('high');
    const cert = findings.find((f) => f.file === 'certs/server.pem');
    expect(cert).toBeDefined();
    expect(cert?.confidence).toBe('medium');
  });

  it('flags .htpasswd, committed SQLite databases, .bak files and SQL dumps', async () => {
    const findings = await checkFixture('rule-exposed-files/vulnerable', [exposedSensitiveFilesRule]);
    const byFile = new Map(findings.map((f) => [f.file, f]));
    expect(byFile.get('.htpasswd')?.confidence).toBe('high');
    expect(byFile.get('db/database.sqlite')?.severity).toBe('medium');
    expect(byFile.get('src/app.ts.bak')?.confidence).toBe('medium');
    const dump = byFile.get('backups/users.sql');
    expect(dump).toBeDefined();
    expect(dump?.severity).toBe('high');
    expect(dump?.confidence).toBe('high');
  });

  it('flags a nested .git/config directory (repo committed wholesale)', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'umbra-exposed-'));
    try {
      await fs.mkdir(path.join(root, 'public', '.git'), { recursive: true });
      await fs.writeFile(path.join(root, 'public', '.git', 'config'), '[remote "origin"]\n');
      const findings = await exposedSensitiveFilesRule.check({
        root,
        files: [],
        options: {},
      });
      const hit = findings.find((f) => f.file === 'public/.git/config');
      expect(hit).toBeDefined();
      expect(hit?.severity).toBe('high');
      expect(hit?.confidence).toBe('high');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('ignores the scan root\'s own .git directory', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'umbra-exposed-root-'));
    try {
      await fs.mkdir(path.join(root, '.git'), { recursive: true });
      await fs.writeFile(path.join(root, '.git', 'config'), '[remote "origin"]\n');
      await fs.writeFile(path.join(root, 'index.ts'), 'export {};\n');
      const findings = await exposedSensitiveFilesRule.check({
        root,
        files: [],
        options: {},
      });
      expect(findings).toEqual([]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('finds nothing in the clean fixture', async () => {
    const findings = await checkFixture('rule-exposed-files/clean', [exposedSensitiveFilesRule]);
    expect(findings).toEqual([]);
  });

  it('finds nothing in the shared clean-app fixture', async () => {
    const findings = await checkFixture('clean-app', [exposedSensitiveFilesRule]);
    expect(findings).toEqual([]);
  });
});
