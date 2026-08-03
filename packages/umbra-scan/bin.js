#!/usr/bin/env node
// umbra-scan is a thin alias for @elberacasa/umbra. It resolves the real CLI
// from the dependency and spawns it as a child process (argv[1] = the real
// cli.js), so Umbra's direct-invocation guard fires exactly as if the user
// had run `npx @elberacasa/umbra` — same output, same exit codes.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

function resolveCli() {
  // Registry installs: sibling package in the same node_modules.
  // Fallback: resolve from the user's working directory (file:/link installs
  // and monorepos where the dependency tree is rooted elsewhere).
  for (const base of [import.meta.url, path.join(process.cwd(), 'package.json')]) {
    try {
      return createRequire(base).resolve('@elberacasa/umbra/dist/cli.js');
    } catch {
      // try the next base
    }
  }
  throw new Error('could not resolve @elberacasa/umbra — is it installed?');
}

let cli;
try {
  cli = resolveCli();
} catch (error) {
  console.error(`umbra-scan: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}

const { status, error } = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], {
  stdio: 'inherit',
});

if (error) {
  console.error(`umbra-scan: failed to launch @elberacasa/umbra — ${error.message}`);
  process.exit(2);
}
process.exit(status ?? 0);
