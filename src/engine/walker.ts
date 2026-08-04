import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ScannedFile } from './types.js';

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
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

const SKIP_FILES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  // Umbra's own metadata: machine-generated, and its ruleId strings would
  // otherwise read as repo content (e.g. a "rate-limit" keyword signal).
  '.umbra-baseline.json',
  'UMBRA.md',
]);

const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.json', '.jsonc',
  '.sql',
  '.md', '.mdx', '.mdc', '.txt',
  '.yml', '.yaml', '.toml', '.ini',
  '.css', '.scss', '.html', '.htm',
  '.env', '.sh', '.py', '.rb', '.go', '.rs',
]);

const MAX_FILE_BYTES = 512 * 1024;

function isTextCandidate(name: string): boolean {
  const base = path.basename(name);
  if (base.startsWith('.env')) return true;
  const dotfiles = ['.npmrc', '.nvmrc', '.eslintrc', '.prettierrc', '.gitconfig', '.cursorrules'];
  if (dotfiles.includes(base)) return true;
  return TEXT_EXTENSIONS.has(path.extname(base).toLowerCase());
}

async function looksBinary(absPath: string): Promise<boolean> {
  const handle = await fs.open(absPath, 'r');
  try {
    const buffer = Buffer.alloc(1024);
    const { bytesRead } = await handle.read(buffer, 0, 1024, 0);
    for (let i = 0; i < bytesRead; i++) {
      if (buffer[i] === 0) return true;
    }
    return false;
  } finally {
    await handle.close();
  }
}

export async function walkRepo(root: string): Promise<ScannedFile[]> {
  const files: ScannedFile[] = [];

  async function visit(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await visit(absPath);
      } else if (entry.isFile()) {
        if (SKIP_FILES.has(entry.name)) continue;
        if (!isTextCandidate(entry.name)) continue;
        let stat;
        try {
          stat = await fs.stat(absPath);
        } catch {
          continue;
        }
        if (stat.size === 0 || stat.size > MAX_FILE_BYTES) continue;
        if (await looksBinary(absPath)) continue;
        let content: string;
        try {
          content = await fs.readFile(absPath, 'utf8');
        } catch {
          continue;
        }
        const relPath = path.relative(root, absPath).split(path.sep).join('/');
        files.push({ relPath, absPath, content, lines: content.split('\n') });
      }
    }
  }

  await visit(root);
  files.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return files;
}
