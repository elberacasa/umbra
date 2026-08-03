import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createDockerExecutor,
  detectRunPlan,
  dockerAvailable,
  measureRuns,
  scoreOutcome,
  statusForScore,
} from '../../src/axes/runs/index';
import type { DockerExecutor, ExecResult } from '../../src/axes/runs/index';
import { fixturePath } from '../helpers';

const ok: ExecResult = { code: 0, stdout: '', stderr: '', timedOut: false };

/** Builds a fake docker CLI. `override` shapes per-command results. */
function mockDocker(
  override: (args: string[], calls: string[][]) => ExecResult | undefined,
): { exec: DockerExecutor; calls: string[][] } {
  const calls: string[][] = [];
  const exec: DockerExecutor = async (args) => {
    calls.push(args);
    const r = override(args, calls);
    if (r !== undefined) return r;
    if (args[0] === 'info') return { ...ok, stdout: '29.6.2\n' };
    return ok;
  };
  return { exec, calls };
}

const dockerDown = mockDocker((args) =>
  args[0] === 'info' ? { code: 1, stdout: '', stderr: 'Cannot connect to the Docker daemon', timedOut: false } : ok,
);

const buildFails = mockDocker((args) =>
  args[0] === 'build'
    ? { code: 1, stdout: '', stderr: '#5 ERROR: process "npm run build" did not complete successfully', timedOut: false }
    : undefined,
);

const respondsOk = mockDocker((args) => {
  if (args[0] === 'inspect') return { ...ok, stdout: 'true 0\n' };
  if (args[0] === 'logs') return { ...ok, stdout: 'runnable-app listening on port 3000\n' };
  if (args[0] === 'exec' && args.includes('wget')) return ok;
  return undefined;
});

const bootsSilent = mockDocker((args) => {
  if (args[0] === 'inspect') return { ...ok, stdout: 'true 0\n' };
  if (args[0] === 'logs') return { ...ok, stdout: '' };
  if (args[0] === 'exec') return { code: 1, stdout: '', stderr: 'wget: bad address', timedOut: false };
  return undefined;
});

const crashesOnBoot = mockDocker((args) => {
  if (args[0] === 'inspect') return { ...ok, stdout: 'false 1\n' };
  if (args[0] === 'logs') return { ...ok, stderr: 'SyntaxError: missing ) after argument list\n' };
  return undefined;
});

describe('runs/detectRunPlan', () => {
  it('detects a node app with build + start scripts and a lockfile', async () => {
    const plan = await detectRunPlan(fixturePath('runnable-app'));
    expect(plan).toMatchObject({
      kind: 'node',
      buildScript: true,
      startScript: true,
      hasLockfile: true,
    });
  });

  it('detects a repo-shipped Dockerfile', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'umbra-detect-'));
    try {
      await fs.writeFile(path.join(tmp, 'Dockerfile'), 'FROM scratch\n', 'utf8');
      const plan = await detectRunPlan(tmp);
      expect(plan).toMatchObject({ kind: 'dockerfile', dockerfile: 'Dockerfile' });
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('returns null when there is no run path', async () => {
    // clean-app has a package.json but no scripts/main and no Dockerfile.
    expect(await detectRunPlan(fixturePath('clean-app'))).toBeNull();
  });

  it('returns null for an unparsable package.json', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'umbra-detect-'));
    try {
      await fs.writeFile(path.join(tmp, 'package.json'), '{not json', 'utf8');
      expect(await detectRunPlan(tmp)).toBeNull();
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

describe('runs/scoreOutcome', () => {
  it('maps outcomes to the documented bands', () => {
    expect(scoreOutcome({ kind: 'build-failed' })).toBe(10);
    expect(scoreOutcome({ kind: 'boot-failed' })).toBe(25);
    expect(scoreOutcome({ kind: 'booted-no-response' })).toBe(50);
    expect(scoreOutcome({ kind: 'responded' })).toBe(100);
  });

  it('derives pass/fail from the score', () => {
    expect(statusForScore(10)).toBe('fail');
    expect(statusForScore(25)).toBe('fail');
    expect(statusForScore(50)).toBe('pass');
    expect(statusForScore(100)).toBe('pass');
  });
});

describe('runs/measureRuns (mocked docker)', () => {
  const root = fixturePath('runnable-app');

  it('skips when the caller disables docker', async () => {
    const report = await measureRuns(root, { docker: false });
    expect(report.status).toBe('skipped');
    expect(report.details.join(' ')).toMatch(/disabled/i);
  });

  it('skips when the docker daemon is unavailable', async () => {
    const report = await measureRuns(root, { exec: dockerDown.exec });
    expect(report.status).toBe('skipped');
    expect(report.details.join(' ')).toMatch(/docker unavailable/i);
  });

  it('skips a repo with no detectable run path without touching docker', async () => {
    const report = await measureRuns(fixturePath('clean-app'), { exec: respondsOk.exec });
    expect(report.status).toBe('skipped');
    expect(report.details.join(' ')).toMatch(/no detectable run path/i);
    expect(respondsOk.calls.some((c) => c[0] === 'build')).toBe(false);
  });

  it('scores 10/fail when the image build fails', async () => {
    const report = await measureRuns(root, { exec: buildFails.exec, timeoutMs: 30_000 });
    expect(report.status).toBe('fail');
    expect(report.score).toBe(10);
    expect(report.evidence[0]?.message).toMatch(/docker build failed/i);
    // image was pruned, no container was created
    expect(buildFails.calls.some((c) => c[0] === 'rmi' && c.includes('-f'))).toBe(true);
    expect(buildFails.calls.some((c) => c[0] === 'run')).toBe(false);
  });

  it('scores 100/pass when the app responds over HTTP', async () => {
    const report = await measureRuns(root, { exec: respondsOk.exec, timeoutMs: 30_000 });
    expect(report.status).toBe('pass');
    expect(report.score).toBe(100);
    expect(report.details.join(' ')).toMatch(/responded over http/i);
    // container and image cleaned up
    expect(respondsOk.calls.some((c) => c[0] === 'rm' && c.includes('-f'))).toBe(true);
    expect(respondsOk.calls.some((c) => c[0] === 'rmi' && c.includes('-f'))).toBe(true);
    // container ran with hard limits and no network
    const runCall = respondsOk.calls.find((c) => c[0] === 'run');
    expect(runCall).toBeDefined();
    expect(runCall).toContain('--network');
    expect(runCall).toContain('none');
    expect(runCall).toContain('--memory');
    expect(runCall).toContain('512m');
  });

  it('scores 50 when the app stays up but never answers HTTP', async () => {
    const report = await measureRuns(root, { exec: bootsSilent.exec, timeoutMs: 2_500 });
    expect(report.status).toBe('pass');
    expect(report.score).toBe(50);
  }, 15_000);

  it('scores 25 when the app crashes during boot', async () => {
    const report = await measureRuns(root, { exec: crashesOnBoot.exec, timeoutMs: 30_000 });
    expect(report.status).toBe('fail');
    expect(report.score).toBe(25);
    expect(report.details.join(' ')).toMatch(/crashed on boot/i);
  });

  it('reports axis metadata', async () => {
    const report = await measureRuns(root, { exec: respondsOk.exec, timeoutMs: 30_000 });
    expect(report.axis).toBe('RUNS');
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(report.details)).toBe(true);
    expect(Array.isArray(report.evidence)).toBe(true);
  });
});

// Integration tests against the real Docker daemon. Docker is expected on
// dev/CI machines for this axis; skip loudly where it is not.
const realExec = createDockerExecutor();
const hasDocker = await dockerAvailable(realExec);
if (!hasDocker) {
  console.warn('[runs.test] Docker daemon unavailable — skipping RUNS integration tests');
}
const describeDocker = hasDocker ? describe : describe.skip;

describeDocker('runs/measureRuns (real docker)', () => {
  it('verifies fixtures/runnable-app end to end: builds, boots, /health responds', async () => {
    const report = await measureRuns(fixturePath('runnable-app'), { timeoutMs: 240_000 });
    expect(report.status).toBe('pass');
    expect(report.score).toBe(100);
    expect(report.details.join('\n')).toMatch(/build succeeded/i);
    expect(report.evidence.some((e) => /http probe succeeded/i.test(e.message))).toBe(true);
  }, 300_000);

  it('fails fixtures/broken-app at build time (syntax error)', async () => {
    const report = await measureRuns(fixturePath('broken-app'), { timeoutMs: 120_000 });
    expect(report.status).toBe('fail');
    expect(report.score).toBeLessThanOrEqual(20);
    expect(report.evidence.some((e) => /build failed/i.test(e.message))).toBe(true);
  }, 180_000);

  it('leaves no containers or images behind', async () => {
    const containers = await realExec(
      ['ps', '-aq', '--filter', 'name=umbra-runs-'],
      { timeoutMs: 15_000 },
    );
    expect(containers.stdout.trim()).toBe('');
    const images = await realExec(
      ['image', 'ls', '-q', '--filter', 'reference=umbra-runs-*'],
      { timeoutMs: 15_000 },
    );
    expect(images.stdout.trim()).toBe('');
  }, 30_000);
});
