import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fixturePath } from '../helpers';

const CLI = path.resolve(__dirname, '..', '..', 'dist', 'cli.js');

interface GuardRun {
  code: number;
  stdout: string;
  stderr: string;
}

function runGuard(payloadFile: string): Promise<GuardRun> {
  const payload = readFileSync(fixturePath(path.join('guard-payloads', payloadFile)));
  return new Promise((resolve, reject) => {
    const child = execFile(
      'node',
      [CLI, 'guard', '--stdin'],
      (error, stdout, stderr) => {
        if (error && typeof error.code !== 'number') {
          reject(error); // spawn-level failure, not an exit code
          return;
        }
        resolve({ code: error ? (error.code as number) : 0, stdout, stderr });
      },
    );
    child.stdin?.end(payload);
  });
}

describe('umbra guard --stdin (end-to-end hook contract)', () => {
  it('dist/cli.js must be built', () => {
    if (!existsSync(CLI)) {
      throw new Error('dist/cli.js missing — run `npm run build` before `npm test`');
    }
  });

  it('blocks a claude-style Write carrying a live secret (exit 2, actionable stderr)', async () => {
    const { code, stderr } = await runGuard('claude-write-secret.json');
    expect(code).toBe(2);
    expect(stderr).toContain('UMBRA BLOCKED this write');
    expect(stderr).toContain('safe/hardcoded-secrets');
    expect(stderr).toContain('src/billing.ts');
    expect(stderr).toMatch(/\.\s/); // remediation sentence, one compact paragraph
  });

  it('allows a kimi-style Write (path field) with a warn-level finding (exit 0, note on stderr)', async () => {
    const { code, stderr } = await runGuard('kimi-write-warn.json');
    expect(code).toBe(0);
    expect(stderr).toContain('umbra: warning');
    expect(stderr).toContain('safe/hardcoded-secrets');
  });

  it('blocks an Edit whose new_string introduces eval() (exit 2)', async () => {
    const { code, stderr } = await runGuard('edit-new-string.json');
    expect(code).toBe(2);
    expect(stderr).toContain('UMBRA BLOCKED this write');
    expect(stderr).toContain('safe/injection-sinks');
  });

  it('blocks a MultiEdit whose joined edits allow JWT alg "none" (exit 2)', async () => {
    const { code, stderr } = await runGuard('multiedit-jwt-none.json');
    expect(code).toBe(2);
    expect(stderr).toContain('UMBRA BLOCKED this write');
    expect(stderr).toContain('safe/jwt-misconfig');
  });

  it('blocks a git-hook plant attempt even with benign content (exit 2)', async () => {
    const { code, stderr } = await runGuard('git-hook-plant.json');
    expect(code).toBe(2);
    expect(stderr).toContain('UMBRA BLOCKED this write');
    expect(stderr).toContain('guard/path-guard');
    expect(stderr).toContain('.git/hooks');
  });

  it('blocks a .env write containing a live service_role key (exit 2)', async () => {
    const { code, stderr } = await runGuard('env-live-key.json');
    expect(code).toBe(2);
    expect(stderr).toContain('UMBRA BLOCKED this write');
    expect(stderr).toContain('.env');
  });

  it('allows a benign Write silently (exit 0, empty stderr)', async () => {
    const { code, stdout, stderr } = await runGuard('benign-write.json');
    expect(code).toBe(0);
    expect(stdout).toBe('');
    expect(stderr).toBe('');
  });

  it('fails open on malformed JSON (exit 0, dim note)', async () => {
    const { code, stderr } = await runGuard('malformed.json');
    expect(code).toBe(0);
    expect(stderr).toContain('guard skipped');
  });

  it('fails open on an unknown tool (exit 0, dim note)', async () => {
    const { code, stderr } = await runGuard('unknown-tool.json');
    expect(code).toBe(0);
    expect(stderr).toContain('guard skipped');
  });

  it('fails open on empty stdin (exit 0)', async () => {
    const result = await new Promise<GuardRun>((resolve, reject) => {
      const child = execFile('node', [CLI, 'guard', '--stdin'], (error, stdout, stderr) => {
        if (error && typeof error.code !== 'number') {
          reject(error);
          return;
        }
        resolve({ code: error ? (error.code as number) : 0, stdout, stderr });
      });
      child.stdin?.end('');
    });
    expect(result.code).toBe(0);
    expect(result.stderr).toContain('guard skipped');
  });
});
