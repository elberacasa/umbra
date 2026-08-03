import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Finding, Rule, Severity, Confidence } from '../../engine/types.js';

// The engine walker only surfaces text files, so committed artifacts such as
// *.pem, id_rsa, *.sqlite or a nested .git/config never reach ctx.files.
// This rule therefore walks the tree itself, mirroring the walker's skip list.
const SKIP_DIRS = new Set([
  'node_modules',
  '.hg',
  '.svn',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.vercel',
  '.turbo',
  'coverage',
  '.cache',
  '.umbra',
]);

const MAX_READ_BYTES = 64 * 1024;

const PRIVATE_KEY_MARKER_RE = /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/;
const SQL_DUMP_MARKER_RE = /pg_dump|mysqldump|mysql dump|dump completed|sqlite dump/i;
const SQL_DUMP_NAME_RE = /dump|backup|export/i;
const DB_FILE_NAME_RE = /^(database|data|app|prod|backup|dump)/i;

async function readHead(absPath: string): Promise<string> {
  try {
    const handle = await fs.open(absPath, 'r');
    try {
      const buffer = Buffer.alloc(MAX_READ_BYTES);
      const { bytesRead } = await handle.read(buffer, 0, MAX_READ_BYTES, 0);
      return buffer.toString('utf8', 0, bytesRead);
    } finally {
      await handle.close();
    }
  } catch {
    return '';
  }
}

export const exposedSensitiveFilesRule: Rule = {
  id: 'safe/exposed-sensitive-files',
  axis: 'SAFE',
  description:
    'Detects sensitive files committed to the repo tree: private keys, .htpasswd, database files, backups, SQL dumps and nested .git directories.',
  async check(ctx) {
    const findings: Finding[] = [];

    const report = (
      relPath: string,
      severity: Severity,
      confidence: Confidence,
      message: string,
    ): void => {
      findings.push({
        ruleId: this.id,
        axis: this.axis,
        severity,
        confidence,
        message,
        file: relPath,
        line: 1,
      });
    };

    const visit = async (dir: string, relDir: string, depth: number): Promise<void> => {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const abs = path.join(dir, entry.name);
        const rel = relDir === '' ? entry.name : `${relDir}/${entry.name}`;

        if (entry.isDirectory()) {
          if (entry.name === '.git') {
            // The scan root's own .git is expected; a .git directory deeper in
            // the tree means a repo (or deploy artifact) was committed wholesale.
            if (depth > 0) {
              try {
                await fs.stat(path.join(abs, 'config'));
                report(
                  `${rel}/config`,
                  'high',
                  'high',
                  'Nested .git directory present in the tree — exposes full git history, remotes and credentials in config',
                );
              } catch {
                // no config file inside — nothing to report
              }
            }
            continue;
          }
          if (SKIP_DIRS.has(entry.name)) continue;
          await visit(abs, rel, depth + 1);
          continue;
        }

        if (!entry.isFile()) continue;
        const lower = entry.name.toLowerCase();

        if (/^id_(?:rsa|dsa|ecdsa|ed25519)$/.test(lower)) {
          report(rel, 'critical', 'high', 'Private SSH key committed to the repository');
        } else if (lower === '.htpasswd') {
          report(rel, 'high', 'high', '.htpasswd credential file committed to the repository');
        } else if (/\.(?:pem|key)$/.test(lower)) {
          const head = await readHead(abs);
          if (PRIVATE_KEY_MARKER_RE.test(head)) {
            report(rel, 'critical', 'high', `Private key material in committed file ${entry.name}`);
          } else {
            report(
              rel,
              'high',
              'medium',
              `Key/certificate material committed (${entry.name}) — verify it contains no private keys`,
            );
          }
        } else if (/\.(?:sqlite|sqlite3)$/.test(lower)) {
          report(rel, 'medium', 'high', 'SQLite database file committed — may contain production data');
        } else if (/\.db$/.test(lower) && DB_FILE_NAME_RE.test(entry.name)) {
          report(rel, 'medium', 'medium', `Database file ${entry.name} committed — may contain production data`);
        } else if (/\.bak$/.test(lower)) {
          report(rel, 'medium', 'medium', 'Backup file committed — often contains outdated code or data with live secrets');
        } else if (/\.sql$/.test(lower)) {
          const head = await readHead(abs);
          if (SQL_DUMP_MARKER_RE.test(head)) {
            report(rel, 'high', 'high', 'SQL database dump committed — likely contains table data and credentials');
          } else if (SQL_DUMP_NAME_RE.test(entry.name)) {
            report(rel, 'medium', 'medium', `${entry.name} looks like a database backup/export — verify it holds no production data`);
          }
        }
      }
    };

    await visit(ctx.root, '', 0);
    return findings;
  },
};
