import path from 'node:path';
import type { Finding, Rule } from '../../engine/types.js';
import { isNonProductionPath } from '../context.js';
import { PATTERNS } from './hardcoded-secrets.js';

/**
 * MCP config files, matched by basename: the well-known locations
 * (.cursor/mcp.json, .vscode/mcp.json, .kiro/settings/mcp.json,
 * .windsurf/mcp.json) all share one of these names.
 */
function isMcpConfigPath(relPath: string): boolean {
  const base = path.basename(relPath);
  return (
    base === 'mcp.json' ||
    base === '.mcp.json' ||
    base.endsWith('.mcp.json') ||
    base === 'claude_desktop_config.json'
  );
}

/** npx only auto-confirms with -y/--yes; uvx and bunx always run unattended. */
const AUTO_RUNNERS = new Set(['npx', 'uvx', 'bunx']);

const PIPE_TO_SHELL_RE = /(?:curl|wget)\b[^\n|]*\|\s*(?:sudo\s+)?(?:ba|z)?sh\b/;
const BASH_C_URL_RE = /(?:bash|sh)\s+-c\s+['"`][^\n]*https?:\/\//;

/** ${VAR} / $VAR indirection is the correct pattern — never a finding. */
function isEnvReference(value: string): boolean {
  return value.includes('${') || /^\$\w+$/.test(value);
}

/** Scoped packages start with '@'; a version pin is an '@' after position 0. */
function isPinned(pkg: string): boolean {
  return pkg.indexOf('@', 1) > 0;
}

function lineOfNeedle(lines: string[], needle: string): number | undefined {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]?.includes(needle)) return i + 1;
  }
  return undefined;
}

interface ServerEntry {
  name: string;
  command: string | undefined;
  args: string[];
  envValues: string[];
}

function collectServers(config: Record<string, unknown>): ServerEntry[] {
  const entries: ServerEntry[] = [];
  // 'mcpServers' (Claude, Cursor, Windsurf) and 'servers' (VS Code).
  for (const key of ['mcpServers', 'servers']) {
    const servers = config[key];
    if (typeof servers !== 'object' || servers === null || Array.isArray(servers)) continue;
    for (const [name, value] of Object.entries(servers)) {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;
      const entry = value as Record<string, unknown>;
      const args = Array.isArray(entry.args)
        ? entry.args.filter((a): a is string => typeof a === 'string')
        : [];
      const envValues: string[] = [];
      if (typeof entry.env === 'object' && entry.env !== null && !Array.isArray(entry.env)) {
        for (const v of Object.values(entry.env)) {
          if (typeof v === 'string') envValues.push(v);
        }
      }
      entries.push({
        name,
        command: typeof entry.command === 'string' ? entry.command : undefined,
        args,
        envValues,
      });
    }
  }
  return entries;
}

export const mcpConfigRule: Rule = {
  id: 'safe/mcp-config',
  axis: 'SAFE',
  description:
    'Detects dangerous MCP server configs: unpinned npx/uvx/bunx packages, downloads piped to a shell, and literal secrets in env blocks or args.',
  check(ctx) {
    const findings: Finding[] = [];

    for (const file of ctx.files) {
      if (!isMcpConfigPath(file.relPath)) continue;
      if (isNonProductionPath(file.relPath)) continue;

      // Fail closed: a config we cannot parse produces no findings.
      let config: unknown;
      try {
        config = JSON.parse(file.content);
      } catch {
        continue;
      }
      if (typeof config !== 'object' || config === null || Array.isArray(config)) continue;

      for (const server of collectServers(config as Record<string, unknown>)) {
        const commandLine = [server.command, ...server.args].filter(Boolean).join(' ');
        const push = (finding: Omit<Finding, 'line'>, needle: string): void => {
          const line = lineOfNeedle(file.lines, needle);
          findings.push(line === undefined ? finding : { ...finding, line });
        };

        if (PIPE_TO_SHELL_RE.test(commandLine) || BASH_C_URL_RE.test(commandLine)) {
          push(
            {
              ruleId: this.id,
              axis: this.axis,
              severity: 'high',
              confidence: 'high',
              message: `MCP server "${server.name}" pipes a remote download into a shell — arbitrary remote code execution on every agent start`,
              file: file.relPath,
            },
            server.name,
          );
        }

        if (server.command !== undefined) {
          const runner = path.basename(server.command);
          const autoYes =
            AUTO_RUNNERS.has(runner) &&
            (runner !== 'npx' || server.args.some((a) => a === '-y' || a === '--yes'));
          if (autoYes) {
            const pkg = server.args.find((a) => !a.startsWith('-'));
            if (pkg !== undefined && !isPinned(pkg)) {
              push(
                {
                  ruleId: this.id,
                  axis: this.axis,
                  severity: 'medium',
                  confidence: 'medium',
                  message: `MCP server "${server.name}" runs "${pkg}" via ${runner} without a pinned version — every agent start executes whatever the registry serves that day`,
                  file: file.relPath,
                },
                pkg,
              );
            }
          }
        }

        for (const value of [...server.envValues, ...server.args]) {
          if (isEnvReference(value)) continue;
          const pattern = PATTERNS.find((p) => p.re.test(value));
          if (pattern === undefined) continue;
          push(
            {
              ruleId: this.id,
              axis: this.axis,
              severity: 'critical',
              confidence: 'high',
              message: `Literal ${pattern.name} in MCP server "${server.name}" config — use \${VAR} env indirection instead of embedding the secret`,
              file: file.relPath,
            },
            value,
          );
          break; // one secret finding per server entry
        }
      }
    }

    return findings;
  },
};
