import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { detectRunPlan } from './detect.js';
import {
  createDockerExecutor,
  dockerAvailable,
  renderNodeDockerfile,
  logTail,
  CONTAINER_LIMITS,
  HTTP_STATUS_RE,
  LISTEN_RE,
  POLL_INTERVAL_MS,
  PORT_RE,
  PROBE_PATHS,
  PROBE_PORTS,
} from './docker.js';
import { scoreOutcome, statusForScore, type RunOutcome } from './score.js';
import type { AxisEvidence, AxisReport, AxisStatus, DockerExecutor, MeasureRunsOptions } from './types.js';

export type { AxisEvidence, AxisReport, AxisStatus, DockerExecutor, MeasureRunsOptions } from './types.js';
export { detectRunPlan, type RunPlan } from './detect.js';
export { scoreOutcome, statusForScore, type RunOutcome } from './score.js';
export { createDockerExecutor, dockerAvailable } from './docker.js';

const DEFAULT_TIMEOUT_MS = 120_000;
/** Grace period for cleanup commands; never counted against the scan budget. */
const CLEANUP_TIMEOUT_MS = 15_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function remaining(deadline: number): number {
  return Math.max(0, deadline - Date.now());
}

/**
 * Copies the repo into a fresh temp dir. The original tree is NEVER mounted,
 * written to, or mutated — all Docker work happens against the copy.
 */
async function copyToTempDir(root: string): Promise<{ tmp: string; workdir: string }> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'umbra-runs-'));
  const workdir = path.join(tmp, 'repo');
  await fs.cp(root, workdir, {
    recursive: true,
    filter: (src) => {
      const base = path.basename(src);
      return base !== 'node_modules' && base !== '.git';
    },
  });
  return { tmp, workdir };
}

/**
 * Probes one URL inside the container over loopback (works with
 * --network none). Returns true when the server produced any HTTP response.
 */
async function probeUrl(
  exec: DockerExecutor,
  container: string,
  url: string,
  timeoutMs: number,
): Promise<'responded' | 'no-server' | 'no-client'> {
  // busybox wget (present in alpine-based images): -S prints the status line
  // to stderr even for 4xx/5xx, and any HTTP status proves the app answers.
  const wget = await exec(
    ['exec', container, 'wget', '-q', '-S', '-T', '3', '-O', '/dev/null', url],
    { timeoutMs: Math.min(timeoutMs, 8_000) },
  );
  if (wget.code === 0 || HTTP_STATUS_RE.test(wget.stderr) || HTTP_STATUS_RE.test(wget.stdout)) {
    return 'responded';
  }
  if (wget.code === 126 || wget.code === 127) {
    // No wget in this image — try node (present in every node-based image).
    const script = `fetch(${JSON.stringify(url)}).then(()=>process.exit(0)).catch(()=>process.exit(1))`;
    const node = await exec(['exec', container, 'node', '-e', script], {
      timeoutMs: Math.min(timeoutMs, 8_000),
    });
    if (node.code === 0) return 'responded';
    if (node.code === 126 || node.code === 127) return 'no-client';
  }
  return 'no-server';
}

interface ProbeResult {
  outcome: RunOutcome;
  respondedUrl?: string;
  listenLogLine?: string;
  exitCode?: number;
  crashLogTail: string[];
}

/** Polls the container until it responds, dies, or the deadline passes. */
async function probeContainer(
  exec: DockerExecutor,
  container: string,
  deadline: number,
): Promise<ProbeResult> {
  let listenLogLine: string | undefined;
  let sawRunning = false;
  const extraPorts: number[] = [];

  while (remaining(deadline) > 0) {
    const inspect = await exec(
      ['inspect', '--format', '{{.State.Running}} {{.State.ExitCode}}', container],
      { timeoutMs: 10_000 },
    );
    const [runningStr, exitStr] = inspect.stdout.trim().split(/\s+/);
    if (inspect.code === 0 && runningStr !== 'true') {
      // Container exited before answering: the app crashed on boot.
      const logs = await exec(['logs', container], { timeoutMs: 10_000 });
      return {
        outcome: { kind: 'boot-failed' },
        exitCode: Number(exitStr ?? '1') || 1,
        crashLogTail: logTail(`${logs.stdout}\n${logs.stderr}`),
      };
    }
    if (inspect.code === 0) sawRunning = true;

    const logs = await exec(['logs', container], { timeoutMs: 10_000 });
    const logText = `${logs.stdout}\n${logs.stderr}`;
    if (listenLogLine === undefined) {
      const line = logText.split('\n').find((l) => LISTEN_RE.test(l));
      if (line !== undefined) {
        listenLogLine = line.trim();
        const m = PORT_RE.exec(line);
        if (m?.[1] !== undefined) {
          const port = Number(m[1]);
          if (port >= 1 && port <= 65535 && !PROBE_PORTS.includes(port)) extraPorts.push(port);
        }
      }
    }

    const ports = [...extraPorts, ...PROBE_PORTS];
    for (const port of ports) {
      for (const p of PROBE_PATHS) {
        const url = `http://127.0.0.1:${port}${p}`;
        const r = await probeUrl(exec, container, url, remaining(deadline));
        if (r === 'responded') {
          const result: ProbeResult = { outcome: { kind: 'responded' }, respondedUrl: url, crashLogTail: [] };
          if (listenLogLine !== undefined) result.listenLogLine = listenLogLine;
          return result;
        }
      }
    }

    await sleep(Math.min(POLL_INTERVAL_MS, remaining(deadline)));
  }

  // Probe window exhausted without an HTTP response.
  const result: ProbeResult = {
    outcome: sawRunning || listenLogLine !== undefined ? { kind: 'booted-no-response' } : { kind: 'boot-failed' },
    crashLogTail: [],
  };
  if (listenLogLine !== undefined) result.listenLogLine = listenLogLine;
  return result;
}

/**
 * RUNS axis: does the repo actually build and boot? Verified for real in a
 * throwaway Docker sandbox (temp copy, --network none, 512m/1cpu limits),
 * never against the original tree.
 */
export async function measureRuns(root: string, opts: MeasureRunsOptions = {}): Promise<AxisReport> {
  const startedAt = Date.now();
  const details: string[] = [];
  const evidence: AxisEvidence[] = [];

  const finish = (score: number, status: AxisStatus): AxisReport => ({
    axis: 'RUNS',
    score,
    status,
    details,
    evidence,
    durationMs: Date.now() - startedAt,
  });
  const skip = (reason: string): AxisReport => {
    details.push(reason);
    return finish(0, 'skipped');
  };
  const conclude = (outcome: RunOutcome, narration: string[]): AxisReport => {
    details.push(...narration);
    const score = scoreOutcome(outcome);
    return finish(score, statusForScore(score));
  };

  if (opts.docker === false) {
    return skip('Docker verification disabled by caller (docker: false)');
  }
  const exec = opts.exec ?? createDockerExecutor();
  const deadline = startedAt + (opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  const absRoot = path.resolve(root);
  try {
    const stat = await fs.stat(absRoot);
    if (!stat.isDirectory()) return skip(`Not a directory: ${absRoot}`);
  } catch {
    return skip(`Path does not exist: ${absRoot}`);
  }

  const plan = await detectRunPlan(absRoot);
  if (plan === null) {
    return skip('No detectable run path (no Dockerfile, no package.json start script or main entry)');
  }
  details.push(
    plan.kind === 'dockerfile'
      ? 'Detected run path: repo Dockerfile'
      : `Detected run path: package.json (${[
          plan.buildScript ? 'build script' : undefined,
          plan.startScript ? 'start script' : undefined,
          !plan.startScript && plan.main !== undefined ? `main "${plan.main}"` : undefined,
        ]
          .filter(Boolean)
          .join(', ')})`,
  );

  if (!(await dockerAvailable(exec))) {
    return skip('Docker unavailable: binary missing or daemon not running — RUNS axis not verified');
  }

  const id = crypto.randomUUID().slice(0, 12);
  const imageTag = `umbra-runs-${id}`;
  const containerName = `umbra-runs-${id}`;

  const { tmp, workdir } = await copyToTempDir(absRoot);
  let containerCreated = false;
  let buildAttempted = false;

  try {
    // Stage 1 — build the image WITH network (dependency install needs it).
    let dockerfileArg: string;
    if (plan.kind === 'dockerfile' && plan.dockerfile !== undefined) {
      dockerfileArg = plan.dockerfile;
    } else {
      const rendered = renderNodeDockerfile(plan);
      dockerfileArg = 'Dockerfile.umbra';
      await fs.writeFile(path.join(workdir, dockerfileArg), rendered, 'utf8');
    }

    buildAttempted = true;
    details.push(`Building sandbox image (${imageTag}) with network for dependency install`);
    const build = await exec(
      ['build', '--rm', '-t', imageTag, '-f', path.join(workdir, dockerfileArg), workdir],
      { timeoutMs: remaining(deadline) },
    );
    const buildLog = `${build.stdout}\n${build.stderr}`;
    if (build.timedOut) {
      evidence.push({ message: `docker build exceeded the ${Math.round((deadline - startedAt) / 1000)}s wall-clock budget` });
      return conclude({ kind: 'build-failed' }, ['Build timed out', ...logTail(buildLog)]);
    }
    if (build.code !== 0) {
      evidence.push({ message: `docker build failed (exit ${build.code}): ${logTail(buildLog, 1)[0] ?? 'no output'}` });
      return conclude({ kind: 'build-failed' }, [`Build failed (docker build exit ${build.code})`, ...logTail(buildLog)]);
    }
    details.push('Build succeeded');

    // Stage 2 — run with hard limits and NO network.
    const run = await exec(
      ['run', '-d', '--name', containerName, ...CONTAINER_LIMITS, imageTag],
      { timeoutMs: 20_000 },
    );
    if (run.code !== 0) {
      evidence.push({ message: `docker run failed: ${logTail(run.stderr, 1)[0] ?? 'no output'}` });
      return conclude({ kind: 'boot-failed' }, ['Container failed to start', ...logTail(run.stderr)]);
    }
    containerCreated = true;
    details.push('Container started with --network none --memory 512m --cpus 1');

    const probe = await probeContainer(exec, containerName, deadline);
    if (probe.listenLogLine !== undefined) {
      details.push(`Boot log: "${probe.listenLogLine}"`);
    }

    switch (probe.outcome.kind) {
      case 'responded': {
        evidence.push({ message: `HTTP probe succeeded inside sandbox: GET ${probe.respondedUrl ?? ''}` });
        return conclude(probe.outcome, [
          `Verified: app responded over HTTP (GET ${probe.respondedUrl ?? ''} from inside the sandbox)`,
        ]);
      }
      case 'booted-no-response': {
        evidence.push({ message: 'App booted but produced no HTTP response before the deadline' });
        return conclude(probe.outcome, [
          'App boots (container stayed up) but no HTTP response on probed ports ' +
            `${[...PROBE_PORTS].join('/')} — scored as partially verified`,
        ]);
      }
      case 'boot-failed': {
        evidence.push({
          message: `App process exited during boot (exit ${probe.exitCode ?? 1})`,
        });
        return conclude(probe.outcome, [
          `App crashed on boot (exit ${probe.exitCode ?? 1})`,
          ...probe.crashLogTail,
        ]);
      }
      default: {
        // Unreachable in practice (RunOutcome is exhaustive); fail safe.
        return conclude({ kind: 'boot-failed' }, ['Sandbox probe ended in an unexpected state']);
      }
    }
  } finally {
    // Never leave containers, images, or temp dirs behind.
    if (containerCreated) {
      await exec(['rm', '-f', containerName], { timeoutMs: CLEANUP_TIMEOUT_MS }).catch(() => undefined);
    }
    if (buildAttempted) {
      await exec(['rmi', '-f', imageTag], { timeoutMs: CLEANUP_TIMEOUT_MS }).catch(() => undefined);
    }
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}
