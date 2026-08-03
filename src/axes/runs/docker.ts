import { execFile } from 'node:child_process';
import type { RunPlan } from './detect.js';
import type { DockerExecutor, ExecResult } from './types.js';

/** Base image used when the repo does not ship its own Dockerfile. */
export const BASE_IMAGE = 'node:20-alpine';

/** Ports probed over the container loopback, in order. */
export const PROBE_PORTS = [3000, 8080, 8000];

/** Paths probed on each port; the first HTTP response of any status wins. */
export const PROBE_PATHS = ['/health', '/'];

/** Poll cadence while waiting for the app to boot. */
export const POLL_INTERVAL_MS = 500;

/** Hard resource limits for the sandboxed container. */
export const CONTAINER_LIMITS = ['--network', 'none', '--memory', '512m', '--cpus', '1'] as const;

/** Matches log lines that announce a listening server. */
export const LISTEN_RE = /\b(listening|ready|started|up and running|server running)\b/i;

/** Extracts a port number from a listening announcement line. */
export const PORT_RE = /(?:\bport\b\s*|:|\bon\s+)(\d{2,5})\b/i;

/** Matches an HTTP status line in wget -S output (any status = server responded). */
export const HTTP_STATUS_RE = /HTTP\/1\.[01] \d{3}/;

/** Real docker CLI executor. */
export function createDockerExecutor(): DockerExecutor {
  return (args, opts) =>
    new Promise<ExecResult>((resolve) => {
      execFile(
        'docker',
        args,
        { timeout: opts?.timeoutMs, maxBuffer: 16 * 1024 * 1024, killSignal: 'SIGKILL' },
        (error, stdout, stderr) => {
          const err = error as (NodeJS.ErrnoException & { killed?: boolean; signal?: string }) | null;
          // A killed docker CLI means our wall-clock timeout fired.
          const timedOut = Boolean(err && (err.killed || err.signal === 'SIGKILL'));
          if (timedOut) {
            resolve({ code: -1, stdout, stderr, timedOut: true });
            return;
          }
          // err.code is the exit code (number), 'ENOENT' when the binary is
          // missing, or null when the process died on a non-SIGKILL signal.
          const code = typeof err?.code === 'number' ? err.code : err ? 127 : 0;
          resolve({ code, stdout, stderr, timedOut: false });
        },
      );
    });
}

/** True when the docker binary exists AND the daemon answers. */
export async function dockerAvailable(exec: DockerExecutor): Promise<boolean> {
  try {
    const res = await exec(['info', '--format', '{{.ServerVersion}}'], { timeoutMs: 10_000 });
    return res.code === 0 && !res.timedOut;
  } catch {
    return false;
  }
}

/**
 * Renders a Dockerfile for a repo that has package.json but no Dockerfile.
 * Dependencies are installed at image-build time (network available), so the
 * container can later run with --network none.
 */
export function renderNodeDockerfile(plan: RunPlan): string {
  const lines = [
    `FROM ${BASE_IMAGE}`,
    'WORKDIR /app',
    'COPY package.json ./',
  ];
  if (plan.hasLockfile) {
    lines.push('COPY package-lock.json ./');
    lines.push('RUN npm ci --no-audit --no-fund');
  } else {
    lines.push('RUN npm install --no-audit --no-fund');
  }
  lines.push('COPY . .');
  if (plan.buildScript) lines.push('RUN npm run build');
  // Nudge conventional apps onto the first probed port.
  lines.push('ENV PORT=3000');
  if (plan.startScript) {
    lines.push('CMD ["npm", "start"]');
  } else if (plan.main !== undefined) {
    lines.push(`CMD ["node", ${JSON.stringify(plan.main)}]`);
  }
  return lines.join('\n') + '\n';
}

/** Last non-empty lines of a build/run log, for human-readable details. */
export function logTail(output: string, maxLines = 8): string[] {
  const lines = output
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== '');
  return lines.slice(-maxLines);
}
