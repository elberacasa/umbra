import { execFile, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CommandResult, SandboxRequest, SandboxRunResult } from './types.js';

const IMAGE = 'node:20-alpine';

// Hardening flags applied to every sandboxed command. The repo being verified
// is untrusted code: no capabilities, no new privileges, capped pids/memory/cpu.
const HARDENING_ARGS = [
  '--memory', '512m',
  '--cpus', '1',
  '--rm',
  '--cap-drop', 'ALL',
  '--security-opt', 'no-new-privileges',
  '--pids-limit', '256',
  '--read-only',
  '--tmpfs', '/tmp:rw,nosuid,mode=1777',
  '-e', 'CI=true',
  '-e', 'npm_config_cache=/tmp/.npm',
  '-e', 'HOME=/tmp',
];

// Run the container as the host user. The workdir is a host temp dir (mode
// 0700, owned by this process) bind-mounted into the container: on rootful
// Linux docker, container root with --cap-drop ALL has no CAP_DAC_OVERRIDE,
// so it cannot even chdir into a directory owned by another uid — every
// command fails with EACCES. Matching the host uid keeps the mount writable.
// (Docker Desktop maps the container user onto the host user either way, and
// running untrusted code as non-root is strictly better for the sandbox.)
const uid = process.getuid?.();
const gid = process.getgid?.();
const USER_ARGS = uid === undefined || gid === undefined ? [] : ['-u', `${uid}:${gid}`];

function dockerAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('docker', ['version', '--format', '{{.Server.Version}}'], (error) => {
      resolve(!error);
    });
  });
}

function runDocker(args: string[], timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
      // Best-effort: kill the container itself so nothing outlives the CLI.
      const nameArg = args[args.indexOf('--name') + 1];
      if (nameArg) spawn('docker', ['rm', '-f', nameArg], { stdio: 'ignore' });
    }, timeoutMs);

    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ exitCode: null, stdout, stderr: stderr + String(error), timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code, stdout, stderr, timedOut });
    });
  });
}

async function runInSandbox(
  workDir: string,
  command: string,
  network: 'bridge' | 'none',
  timeoutMs: number,
): Promise<CommandResult> {
  const name = `umbra-honest-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  const args = [
    'run',
    '--name', name,
    ...HARDENING_ARGS,
    ...USER_ARGS,
    '--network', network,
    '-v', `${workDir}:/work`,
    '-w', '/work',
    IMAGE,
    'sh', '-c', command,
  ];
  return runDocker(args, timeoutMs);
}

const SKIP_COPY_DIRS = new Set(['node_modules', '.git', '.hg', '.svn', '.umbra']);

/** Last non-empty output lines of a failed sandbox command, for diagnostics. */
function describeFailure(command: string, result: CommandResult): string {
  const tail = `${result.stdout}\n${result.stderr}`
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== '')
    .slice(-12)
    .map((l) => (l.length > 200 ? `${l.slice(0, 200)}…` : l))
    .join('\n');
  const outcome = result.timedOut ? 'timed out' : `exit ${result.exitCode}`;
  return `sandbox command "${command}" ${outcome}${tail ? ` — output tail:\n${tail}` : ''}`;
}

/**
 * Copies the repo to a temp dir and runs `npm install` (network enabled),
 * then the requested scripts with the network disabled. Always cleans up the
 * temp dir; containers are created with --rm and named so a timeout can
 * force-remove them.
 */
export async function runDockerSandbox(
  root: string,
  req: SandboxRequest,
): Promise<SandboxRunResult> {
  if (!(await dockerAvailable())) {
    return { sandboxOk: false, reason: 'docker-unavailable' };
  }

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'umbra-honest-'));
  try {
    await fs.cp(root, workDir, {
      recursive: true,
      filter: (src) => !SKIP_COPY_DIRS.has(path.basename(src)),
    });

    const hasLockfile = await fs
      .stat(path.join(workDir, 'package-lock.json'))
      .then(() => true)
      .catch(() => false);
    const installCmd = hasLockfile
      ? 'npm ci --ignore-scripts --no-audit --no-fund'
      : 'npm install --ignore-scripts --no-audit --no-fund';

    const install = await runInSandbox(workDir, installCmd, 'bridge', req.timeoutMs);
    if (install.exitCode !== 0 || install.timedOut) {
      return { sandboxOk: false, reason: 'install-failed', detail: describeFailure(installCmd, install) };
    }

    const result: SandboxRunResult = { sandboxOk: true };
    if (req.runTest) {
      result.test = await runInSandbox(workDir, 'npm test', 'none', req.timeoutMs);
    }
    if (req.runBuild) {
      result.build = await runInSandbox(workDir, 'npm run build', 'none', req.timeoutMs);
    }
    return result;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
