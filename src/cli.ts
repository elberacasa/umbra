#!/usr/bin/env node
import path from 'node:path';
import { realpathSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Command } from 'commander';
import pc from 'picocolors';
import { runScan } from './engine/runner.js';
import type { ScanOptions } from './engine/types.js';
import { allRules } from './rules/index.js';
import { computeScore } from './score/score.js';
import { formatVerdict, toJsonReport, toMarkdownReport } from './report.js';
import { measureRuns } from './axes/runs/index.js';
import { measureHonest } from './axes/honest/index.js';
import type { AxisReport } from './axes/types.js';
import { runInit } from './commands/init.js';
import { runProtect } from './commands/protect.js';
import { runSetup } from './commands/setup.js';
import { nextSteps } from './suggest.js';
import { runGuardPayload } from './guard/hook.js';
import { applyFixes, formatFixSection } from './fix/index.js';
import type { FixReport } from './fix/index.js';

export const FAIL_THRESHOLD = 50;

export interface ExecuteOptions {
  json?: boolean;
  offline?: boolean;
  /** Also verify RUNS and HONEST in a Docker sandbox. */
  deep?: boolean;
  /** Also render the agent-actionable UMBRA.md markdown report. */
  report?: boolean;
  /** Apply the provably-safe fixes (unused deps, env extraction), then re-scan. */
  fix?: boolean;
  /** With --fix (or alone): print what would change, write nothing. */
  dryRun?: boolean;
  scanOptions?: ScanOptions;
}

export interface ExecuteResult {
  output: string;
  exitCode: number;
  /** UMBRA.md contents — present only when ExecuteOptions.report is true. */
  markdown?: string;
  /** Fix outcomes — present only when a fix run happened (--fix/--dry-run). */
  fixes?: FixReport;
  /** Total score before fixes were applied — present only on fix runs. */
  beforeScore?: number;
  /** Contextual next-step hints for interactive runs. */
  suggestions?: string[];
}

export async function execute(targetPath: string, options: ExecuteOptions = {}): Promise<ExecuteResult> {
  const root = path.resolve(targetPath);
  const scanOptions: ScanOptions = options.scanOptions ?? {};
  if (options.offline === true) {
    scanOptions.resolvePackage = async () => 'unknown';
  }

  let scan = await runScan(root, allRules, scanOptions);

  let axisReports: AxisReport[] | undefined;
  if (options.deep === true) {
    process.stderr.write(
      'umbra: --deep verifies RUNS and HONEST in a throwaway Docker sandbox ' +
        '(temp copy of the repo, hard limits: --network none, 512m memory, 1 cpu). ' +
        'This can take a few minutes.\n',
    );
    const [runs, honest] = await Promise.all([measureRuns(root), measureHonest(root)]);
    axisReports = [runs, honest];
    for (const report of axisReports) {
      if (report.status === 'skipped') {
        const reason = [...report.details].reverse().find((d) => d.trim() !== '');
        process.stderr.write(`umbra: ${report.axis} not measured${reason !== undefined ? ` — ${reason}` : ''}\n`);
      }
    }
  }

  let score = computeScore(scan.findings, axisReports);

  // --fix: apply the provably-safe transforms, re-scan, report before/after.
  // Sandboxed axes (RUNS/HONEST) are not re-measured — fixes only touch
  // static files, so the pre-fix axis reports still hold.
  let fixes: FixReport | undefined;
  let beforeScore: number | undefined;
  if (options.fix === true || options.dryRun === true) {
    const dryRun = options.dryRun === true;
    beforeScore = score.total;
    fixes = await applyFixes(root, scan.findings, { dryRun });
    scan = await runScan(root, allRules, scanOptions);
    score = computeScore(scan.findings, axisReports);
  }

  const output = options.json === true
    ? JSON.stringify(toJsonReport(scan, score, axisReports), null, 2)
    : formatVerdict(scan, score, axisReports) +
      (fixes !== undefined && beforeScore !== undefined
        ? `${formatFixSection(fixes, beforeScore, score.total, options.dryRun === true)}\n`
        : '');

  const result: ExecuteResult = { output, exitCode: score.total < FAIL_THRESHOLD ? 1 : 0 };
  if (fixes !== undefined) result.fixes = fixes;
  if (beforeScore !== undefined) result.beforeScore = beforeScore;
  if (options.report === true) {
    result.markdown = toMarkdownReport(scan, score, axisReports);
  }
  result.suggestions = nextSteps(score, options);
  return result;
}

async function main(argv: string[]): Promise<number> {
  const program = new Command();
  program
    .name('umbra')
    .description('Trust Score for AI-built software — one command, one score, one badge.')
    .argument('[path]', 'path to the repository to scan (default: current directory)', '.')
    .option('--json', 'machine-readable JSON output')
    .option('--offline', 'skip npm registry checks (dependency verification is skipped with a note)')
    .option('--deep', 'also verify RUNS and HONEST in a Docker sandbox (slower, needs Docker)')
    .option('--report', 'write UMBRA.md, an agent-actionable markdown report, into the scanned repo')
    .option('--fix', 'apply provably-safe fixes (unused deps, hardcoded secrets, default creds), then re-scan')
    .option('--dry-run', 'with --fix: print what would change without writing anything')
    .action(async (target: string, opts: { json?: boolean; offline?: boolean; deep?: boolean; report?: boolean; fix?: boolean; dryRun?: boolean }) => {
      try {
        const result = await execute(target, opts);
        console.log(result.output);
        if (result.markdown !== undefined) {
          const reportPath = path.join(path.resolve(target), 'UMBRA.md');
          writeFileSync(reportPath, result.markdown, 'utf8');
          console.log(pc.dim(`wrote ${reportPath}`));
        }
        // The star line: one dim line, interactive terminals only. Never in
        // CI logs, pipes, or --json output — a guardrail tool earns its ask.
        if (opts.json !== true && process.stdout.isTTY === true) {
          for (const step of result.suggestions ?? []) {
            console.log(pc.dim(`next: ${step}`));
          }
          console.log(pc.dim('Useful? Star Umbra: https://github.com/elberacasa/umbra'));
        }
        process.exitCode = result.exitCode;
      } catch (error) {
        console.error(`umbra: scan failed — ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 2;
      }
    });

  program
    .command('setup')
    .description('One-word installer: pre-commit gate, GitHub Action, and agent guard hooks (auto-detected)')
    .argument('[path]', 'repository to install into', '.')
    .option('--global', 'install agent hooks into global CLI config instead of project config')
    .option('--agent <name>', 'install agent hooks for one agent only (claude, kimi)')
    .action(async (target: string, opts: { global?: boolean; agent?: string }) => {
      try {
        const result = await runSetup(target, {
          global: opts.global === true,
          ...(opts.agent !== undefined ? { agent: opts.agent } : {}),
        });
        for (const p of result.installed) console.log(`installed  ${p}`);
        for (const p of result.skipped) console.log(`skipped    ${p}`);
        for (const n of result.notes) console.log(`note       ${n}`);
        if (result.installed.length === 0 && result.skipped.length === 0 && result.notes.length === 0) {
          console.log('nothing to do');
        }
      } catch (error) {
        console.error(`umbra: setup failed — ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 2;
      }
    });

  program
    .command('init')
    .description('Install Umbra into a repository: pre-commit hook and GitHub Action')
    .argument('[path]', 'repository to install into', '.')
    .option('--force', 'replace umbra-managed blocks/files that already exist')
    .option('--no-hook', 'do not install the git pre-commit hook')
    .option('--no-action', 'do not install the GitHub Action workflow')
    .action(async (target: string, opts: { force?: boolean; hook?: boolean; action?: boolean }) => {
      try {
        const result = await runInit(target, {
          force: opts.force === true,
          ...(opts.hook !== undefined ? { hook: opts.hook } : {}),
          ...(opts.action !== undefined ? { action: opts.action } : {}),
        });
        for (const p of result.installed) console.log(`installed  ${p}`);
        for (const p of result.skipped) console.log(`skipped    ${p}`);
        for (const n of result.notes) console.log(`note       ${n}`);
        if (result.installed.length === 0 && result.skipped.length === 0 && result.notes.length === 0) {
          console.log('nothing to do');
        }
      } catch (error) {
        console.error(`umbra: init failed — ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 2;
      }
    });

  program
    .command('guard')
    .description('Guard a proposed agent write: reads one PreToolUse hook JSON payload from stdin')
    .option('--stdin', 'read the hook payload from stdin (exit 0 = allow, exit 2 = block)')
    .action(async (opts: { stdin?: boolean }) => {
      // The hook contract fails open: any usage or runtime error exits 0.
      try {
        if (opts.stdin !== true) {
          console.error('umbra: guard reads one hook JSON payload — pipe it via `umbra guard --stdin`');
          return;
        }
        if (process.stdin.isTTY === true) {
          console.error('umbra: guard skipped — stdin is a terminal, expected a piped hook payload');
          return;
        }
        const input = await readStdin();
        const result = await runGuardPayload(input);
        if (result.stderr !== '') process.stderr.write(result.stderr);
        process.exitCode = result.exitCode;
      } catch (error) {
        console.error(
          `umbra: guard failed open — ${error instanceof Error ? error.message : String(error)}`,
        );
        process.exitCode = 0;
      }
    });

  program
    .command('protect')
    .description('Install the immune layer: PreToolUse hooks that guard agent writes (Claude Code, Kimi Code)')
    .option('--global', 'install into global CLI config instead of project config')
    .option('--agent <name>', 'install for one agent only (claude, kimi); default: auto-detect')
    .option('--remove', 'uninstall umbra hooks, restoring the original config')
    .action(async (opts: { global?: boolean; agent?: string; remove?: boolean }) => {
      try {
        const result = await runProtect({
          global: opts.global === true,
          ...(opts.agent !== undefined ? { agent: opts.agent } : {}),
          remove: opts.remove === true,
        });
        for (const p of result.installed) console.log(`installed  ${p}`);
        for (const p of result.removed) console.log(`removed    ${p}`);
        for (const p of result.skipped) console.log(`skipped    ${p}`);
        for (const n of result.notes) console.log(`note       ${n}`);
        if (
          result.installed.length === 0 &&
          result.removed.length === 0 &&
          result.skipped.length === 0 &&
          result.notes.length === 0
        ) {
          console.log('nothing to do');
        }
      } catch (error) {
        console.error(`umbra: protect failed — ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 2;
      }
    });

  program
    .command('mcp')
    .description('Start the Umbra MCP server on stdio (tools: scan_repo, guard_content, get_score)')
    .action(async () => {
      try {
        // Dynamic import: scanning stays free of the MCP SDK startup cost, and
        // the module's invokedDirectly guard prevents a double server start.
        const { runUmbraMcpServer } = await import('./mcp/server.js');
        await runUmbraMcpServer();
      } catch (error) {
        console.error(`umbra: mcp failed — ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 2;
      }
    });

  await program.parseAsync(argv);
  return typeof process.exitCode === 'number' ? process.exitCode : 0;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks).toString('utf8');
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
if (invokedDirectly) {
  void main(process.argv);
}
