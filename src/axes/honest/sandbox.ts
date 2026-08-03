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
  '--tmpfs', '/tmp:rw,nosuid',
  '-e', 'CI=true',
  '-e', 'npm_config_cache=/tmp/.npm',
  '-e', 'HOME=/tmp',
];

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
    '--network', network,
    '-v', `${workDir}:/work`,
    '-w', '/work',
    IMAGE,
    'sh', '-c', command,
  ];
  return runDocker(args, timeoutMs);
}

const SKIP_COPY_DIRS = new Set(['node_modules', '.git', '.hg', '.svn', '.umbra']);

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
      return { sandboxOk: false, reason: 'install-failed' };
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
