import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MCP_CONFIG_SNIPPET, MCP_CONFIG_SNIPPET_JSON } from '../../src/mcp/README-snippet';

describe('MCP config snippet', () => {
  it('serializes to the JSON block users paste into their MCP client config', () => {
    const parsed = JSON.parse(MCP_CONFIG_SNIPPET_JSON) as typeof MCP_CONFIG_SNIPPET;
    expect(parsed).toEqual(MCP_CONFIG_SNIPPET);
    const umbra = parsed.mcpServers.umbra;
    expect(umbra.command).toBe('npx');
    // umbra-mcp is a bin of @elberacasa/umbra, not a standalone package —
    // npx resolves it via `-p <package> <bin>`.
    expect(umbra.args).toEqual(['--yes', '-p', '@elberacasa/umbra', 'umbra-mcp']);
  });

  it('stays in sync with the real package name and bin entries', () => {
    const pkg = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', 'package.json'), 'utf8')) as {
      name: string;
      bin: Record<string, string>;
    };
    const { args } = MCP_CONFIG_SNIPPET.mcpServers.umbra;
    expect(args[2]).toBe(pkg.name);
    const binName = args[3];
    expect(pkg.bin[binName]).toBe('dist/mcp/server.js');
  });
});
