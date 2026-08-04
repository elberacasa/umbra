import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runSetup } from '../../src/commands/setup';
import { nextSteps } from '../../src/suggest';
import { computeScore } from '../../src/score/score';
import type { Finding } from '../../src/engine/types';

function tempRepo(withAgents: { claude?: boolean; kimi?: boolean } = {}) {
  const home = mkdtempSync(path.join(tmpdir(), 'umbra-setup-home-'));
  const repo = mkdtempSync(path.join(tmpdir(), 'umbra-setup-repo-'));
  mkdirSync(path.join(repo, '.git', 'hooks'), { recursive: true });
  if (withAgents.claude === true) mkdirSync(path.join(home, '.claude'), { recursive: true });
  if (withAgents.kimi === true) mkdirSync(path.join(home, '.kimi-code'), { recursive: true });
  return { home, repo };
}

const safeFinding: Finding = {
  ruleId: 'safe/hardcoded-secrets',
  axis: 'SAFE',
  severity: 'critical',
  confidence: 'high',
  message: 'test',
  file: 'a.ts',
};

describe('setup', () => {
  it('installs hook + action + agent hooks in one pass, idempotently', async () => {
    const { home, repo } = tempRepo({ claude: true, kimi: true });
    const first = await runSetup(repo, { home } as never);
    expect(first.installed.some((p) => p.includes('pre-commit'))).toBe(true);
    expect(first.installed.some((p) => p.includes('umbra.yml'))).toBe(true);
    expect(first.installed.some((p) => p.includes('settings.json'))).toBe(true);
    expect(first.installed.some((p) => p.includes('config.toml'))).toBe(true);

    const second = await runSetup(repo, { home } as never);
    expect(second.installed).toEqual([]);
    expect(second.skipped.length).toBeGreaterThan(0);
  });

  it('skips agent hooks gracefully when no CLI agent is detected', async () => {
    const { home, repo } = tempRepo();
    const result = await runSetup(repo, { home, pathEnv: '' } as never);
    expect(result.installed.some((p) => p.includes('pre-commit'))).toBe(true);
    expect(existsSync(path.join(home, '.claude', 'settings.json'))).toBe(false);
  });

  it('removal is left to protect --remove; setup never deletes', async () => {
    const { home, repo } = tempRepo({ kimi: true });
    await runSetup(repo, { home } as never);
    const toml = path.join(home, '.kimi-code', 'config.toml');
    expect(readFileSync(toml, 'utf8')).toContain('umbra guard');
    writeFileSync(path.join(repo, 'README.md'), 'x');
    const second = await runSetup(repo, { home } as never);
    expect(second.installed).toEqual([]);
  });
});

describe('nextSteps', () => {
  it('suggests --report and --deep when findings exist', () => {
    const score = computeScore([safeFinding]);
    const steps = nextSteps(score, {});
    expect(steps.some((s) => s.includes('--report'))).toBe(true);
    expect(steps.some((s) => s.includes('--deep'))).toBe(true);
    expect(steps.length).toBeLessThanOrEqual(2);
  });

  it('does not suggest what already ran', () => {
    const score = computeScore([safeFinding]);
    const steps = nextSteps(score, { report: true, deep: true });
    expect(steps.some((s) => s.includes('--report'))).toBe(false);
    expect(steps.some((s) => s.includes('--deep'))).toBe(false);
  });

  it('passing repos get the keep-it-green path', () => {
    const score = computeScore([]);
    expect(nextSteps(score, {}).some((s) => s.includes('--setup'))).toBe(true);
  });
});
