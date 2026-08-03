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

export const FAIL_THRESHOLD = 50;

export interface ExecuteOptions {
  json?: boolean;
  offline?: boolean;
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
  const score = computeScore(scan.findings);

  const output = options.json === true
    ? JSON.stringify(toJsonReport(scan, score), null, 2)
    : formatVerdict(scan, score);

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
    .action(async (target: string, opts: { json?: boolean; offline?: boolean }) => {
      try {
        const result = await execute(target, opts);
        console.log(result.output);
        process.exitCode = result.exitCode;
      } catch (error) {
        console.error(`umbra: scan failed — ${error instanceof Error ? error.message : String(error)}`);
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
