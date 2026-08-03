#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { execute } from '../cli.js';
import { runScan } from '../engine/runner.js';
import { allRules } from '../rules/index.js';
import { computeScore } from '../score/score.js';
import type { GuardEngine } from './types.js';

const SERVER_INSTRUCTIONS = [
  'Umbra is the trust layer for AI-generated code: it guards file writes and scores repos (0-100).',
  'Call guard_content BEFORE writing or editing any file. It returns allow/warn/block with file:line evidence; on block, do not write — fix the content and re-check.',
  'Call scan_repo BEFORE declaring a task done. A Trust Score below 50 means the work is not done — fix SAFE findings first, then CLEAN. Pass deep=true (needs Docker) to also verify the app builds, boots, and its documented claims are true.',
  'Use get_score for a quick static score without the full report.',
].join(' ');

export interface UmbraMcpServerOptions {
  /**
   * The guard engine backing `guard_content`. Optional so the server degrades
   * to a clear tool error — never a crash — when src/guard is unavailable.
   */
  guardEngine?: GuardEngine;
  /** Server version reported to clients. Defaults to the package version. */
  version?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Tool failures are returned as content with isError — the server never throws at a client. */
function toolError(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

function textResult(payload: unknown): CallToolResult {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  return { content: [{ type: 'text', text }] };
}

async function ensureDirectory(tool: string, targetPath: string): Promise<CallToolResult | undefined> {
  try {
    const stats = await stat(targetPath);
    if (!stats.isDirectory()) {
      return toolError(`${tool}: path is not a directory: ${targetPath}`);
    }
    return undefined;
  } catch {
    return toolError(`${tool}: path does not exist or is not readable: ${targetPath}`);
  }
}

export function createUmbraMcpServer(options: UmbraMcpServerOptions = {}): McpServer {
  const server = new McpServer(
    { name: 'umbra', version: options.version ?? '0.0.0-dev' },
    { instructions: SERVER_INSTRUCTIONS },
  );

  server.registerTool(
    'scan_repo',
    {
      description:
        'Scan a repository and return the full Umbra Trust Score report as JSON (SAFE/CLEAN static findings; deep=true also verifies RUNS and HONEST in a Docker sandbox). Call before declaring a task done — a score below 50 means the work is not done.',
      inputSchema: {
        path: z.string().optional().catch(undefined).describe('(required) Path to the repository to scan'),
        deep: z
          .boolean()
          .optional()
          .catch(undefined)
          .describe('Also verify RUNS and HONEST in a Docker sandbox (slower, needs Docker)'),
      },
    },
    async ({ path: targetPath, deep }) => {
      if (targetPath === undefined || targetPath.trim() === '') {
        return toolError('scan_repo: "path" is required and must be a non-empty string');
      }
      const missing = await ensureDirectory('scan_repo', targetPath);
      if (missing !== undefined) return missing;
      try {
        const result = await execute(targetPath, { json: true, ...(deep === true ? { deep: true } : {}) });
        return textResult(result.output);
      } catch (error) {
        return toolError(`scan_repo failed: ${errorMessage(error)}`);
      }
    },
  );

  server.registerTool(
    'guard_content',
    {
      description:
        'Check a proposed file write against the Umbra guard engine BEFORE writing. Returns the guard verdict as JSON: decision (allow/warn/block), findings with file:line evidence, and pathViolation when a protected path (e.g. .git/hooks) is targeted. On block, do not write — fix the content and re-check.',
      inputSchema: {
        file_path: z.string().optional().catch(undefined).describe('(required) Path of the file about to be written'),
        content: z
          .string()
          .optional()
          .catch(undefined)
          .describe('(required) Full proposed content — the new file content, or the replacement string for an edit'),
      },
    },
    async ({ file_path: filePath, content }) => {
      if (filePath === undefined || filePath.trim() === '') {
        return toolError('guard_content: "file_path" is required and must be a non-empty string');
      }
      if (content === undefined) {
        return toolError('guard_content: "content" is required (pass an empty string for an empty file)');
      }
      const engine = options.guardEngine;
      if (engine === undefined) {
        return toolError(
          'guard_content: the guard engine is unavailable in this build — use scan_repo for a full-repo check instead',
        );
      }
      try {
        return textResult(await engine(filePath, content));
      } catch (error) {
        return toolError(`guard_content failed: ${errorMessage(error)}`);
      }
    },
  );

  server.registerTool(
    'get_score',
    {
      description:
        'Fast static Umbra Trust Score (0-100) for a repository — SAFE and CLEAN axes only, no network, no sandbox. Use scan_repo for the full report with findings.',
      inputSchema: {
        path: z.string().optional().catch(undefined).describe('(required) Path to the repository to score'),
      },
    },
    async ({ path: targetPath }) => {
      if (targetPath === undefined || targetPath.trim() === '') {
        return toolError('get_score: "path" is required and must be a non-empty string');
      }
      const missing = await ensureDirectory('get_score', targetPath);
      if (missing !== undefined) return missing;
      try {
        const root = path.resolve(targetPath);
        // 'unknown' keeps this network-free: dependency existence is not verified here.
        const scan = await runScan(root, allRules, { resolvePackage: async () => 'unknown' });
        const score = computeScore(scan.findings);
        return textResult({
          path: root,
          score: score.total,
          rubricVersion: score.rubricVersion,
          measuredAxes: score.axes.map((a) => a.axis),
          unmeasuredAxes: score.unmeasuredAxes,
          findingCount: score.scoredFindings.length,
          note: 'Static score only — RUNS and HONEST are not measured. Use scan_repo (deep=true to verify them in a sandbox) for the full report.',
        });
      } catch (error) {
        return toolError(`get_score failed: ${errorMessage(error)}`);
      }
    },
  );

  return server;
}

async function readPackageVersion(): Promise<string> {
  try {
    const pkgPath = fileURLToPath(new URL('../../package.json', import.meta.url));
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0-dev';
  } catch {
    return '0.0.0-dev';
  }
}

/**
 * v1.0 integration seam: the guard engine ships as `guardContent` in
 * src/guard/guard.ts and is loaded dynamically so the server reports a clear
 * tool error instead of crashing when the module is absent or fails to load.
 * Resolved relative to this file, so dist/mcp/server.js finds
 * dist/guard/guard.js after build.
 */
export async function loadGuardEngine(): Promise<GuardEngine | undefined> {
  try {
    const guardModuleUrl = new URL('../guard/guard.js', import.meta.url).href;
    const mod = (await import(guardModuleUrl)) as { guardContent?: unknown };
    return typeof mod.guardContent === 'function' ? (mod.guardContent as GuardEngine) : undefined;
  } catch {
    return undefined;
  }
}

export async function runUmbraMcpServer(): Promise<void> {
  const [version, guardEngine] = await Promise.all([readPackageVersion(), loadGuardEngine()]);
  const server = createUmbraMcpServer({
    version,
    ...(guardEngine !== undefined ? { guardEngine } : {}),
  });
  await server.connect(new StdioServerTransport());
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
if (invokedDirectly) {
  runUmbraMcpServer().catch((error: unknown) => {
    process.stderr.write(`umbra-mcp: fatal — ${errorMessage(error)}\n`);
    process.exitCode = 1;
  });
}
