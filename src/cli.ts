#!/usr/bin/env node
import path from 'node:path';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Command } from 'commander';
import { runScan } from './engine/runner.js';
import type { ScanOptions } from './engine/types.js';
import { allRules } from './rules/index.js';
import { computeScore } from './score/score.js';
import { formatVerdict, toJsonReport } from './report.js';
import { measureRuns } from './axes/runs/index.js';
import { measureHonest } from './axes/honest/index.js';
import type { AxisReport } from './axes/types.js';
import { runInit } from './commands/init.js';

export const FAIL_THRESHOLD = 50;

export interface ExecuteOptions {
  json?: boolean;
  offline?: boolean;
  /** Also verify RUNS and HONEST in a Docker sandbox. */
  deep?: boolean;
  scanOptions?: ScanOptions;
}

export interface ExecuteResult {
  output: string;
  exitCode: number;
}

export async function execute(targetPath: string, options: ExecuteOptions = {}): Promise<ExecuteResult> {
  const root = path.resolve(targetPath);
  const scanOptions: ScanOptions = options.scanOptions ?? {};
  if (options.offline === true) {
    scanOptions.resolvePackage = async () => 'unknown';
  }

  const scan = await runScan(root, allRules, scanOptions);

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

  const score = computeScore(scan.findings, axisReports);

  const output = options.json === true
    ? JSON.stringify(toJsonReport(scan, score, axisReports), null, 2)
    : formatVerdict(scan, score, axisReports);

  return { output, exitCode: score.total < FAIL_THRESHOLD ? 1 : 0 };
}

async function main(argv: string[]): Promise<number> {
  const program = new Command();
  program
    .name('umbra')
    .description('Trust Score for AI-built software — one command, one score, one badge.')
    .argument('<path>', 'path to the repository to scan')
    .option('--json', 'machine-readable JSON output')
    .option('--offline', 'skip npm registry checks (dependency verification is skipped with a note)')
    .option('--deep', 'also verify RUNS and HONEST in a Docker sandbox (slower, needs Docker)')
    .action(async (target: string, opts: { json?: boolean; offline?: boolean; deep?: boolean }) => {
      try {
        const result = await execute(target, opts);
        console.log(result.output);
        process.exitCode = result.exitCode;
      } catch (error) {
        console.error(`umbra: scan failed — ${error instanceof Error ? error.message : String(error)}`);
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

  await program.parseAsync(argv);
  return typeof process.exitCode === 'number' ? process.exitCode : 0;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
if (invokedDirectly) {
  void main(process.argv);
}
