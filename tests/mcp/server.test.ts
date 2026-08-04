import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createUmbraMcpServer } from '../../src/mcp/server';
import type { GuardEngine, GuardVerdict } from '../../src/mcp/types';
import type { JsonReport } from '../../src/report';
import { fixturePath } from '../helpers';

async function connectClient(options: Parameters<typeof createUmbraMcpServer>[0] = {}) {
  const server = createUmbraMcpServer({ version: '0.0.0-test', ...options });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'umbra-test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

function textOf(result: CallToolResult): string {
  const first = result.content[0];
  if (first === undefined || first.type !== 'text') {
    throw new Error(`expected a text content block, got: ${JSON.stringify(result.content)}`);
  }
  return first.text;
}

describe('umbra MCP server', () => {
  it('lists scan_repo, guard_content, and get_score', async () => {
    const { client, server } = await connectClient();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['get_score', 'guard_content', 'scan_repo']);
    for (const tool of tools) {
      expect(tool.description).toBeTruthy();
    }
    await Promise.all([client.close(), server.close()]);
  });

  it('scan_repo returns the full JSON report for a fixture repo', async () => {
    const { client, server } = await connectClient();
    const result = await client.callTool({
      name: 'scan_repo',
      arguments: { path: fixturePath('bad-app') },
    });
    expect(result.isError).toBeFalsy();
    const report = JSON.parse(textOf(result as CallToolResult)) as JsonReport;
    expect(report.rubricVersion).toBe(4);
    expect(report.score).toBeLessThan(50);
    expect(report.measuredAxes).toEqual(['SAFE', 'CLEAN']);
    expect(report.findings.length).toBeGreaterThan(0);
    expect(report.badge).toContain('shields.io');
    await Promise.all([client.close(), server.close()]);
  });

  it('scan_repo reports a tool error for a nonexistent repo', async () => {
    const { client, server } = await connectClient();
    const result = (await client.callTool({
      name: 'scan_repo',
      arguments: { path: fixturePath('no-such-repo') },
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('does not exist');
    await Promise.all([client.close(), server.close()]);
  });

  it('scan_repo reports a tool error when the path argument is missing', async () => {
    const { client, server } = await connectClient();
    const result = (await client.callTool({ name: 'scan_repo', arguments: {} })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('"path" is required');
    await Promise.all([client.close(), server.close()]);
  });

  it('scan_repo reports a tool error when path is a file, not a directory', async () => {
    const { client, server } = await connectClient();
    const result = (await client.callTool({
      name: 'scan_repo',
      arguments: { path: fixturePath('bad-app/package.json') },
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('not a directory');
    await Promise.all([client.close(), server.close()]);
  });

  it('get_score returns the fast static score only', async () => {
    const { client, server } = await connectClient();
    const result = (await client.callTool({
      name: 'get_score',
      arguments: { path: fixturePath('clean-app') },
    })) as CallToolResult;
    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(textOf(result)) as {
      score: number;
      rubricVersion: number;
      measuredAxes: string[];
      unmeasuredAxes: string[];
      findingCount: number;
    };
    expect(payload.score).toBe(100);
    expect(payload.rubricVersion).toBe(4);
    expect(payload.measuredAxes).toEqual(['SAFE', 'CLEAN']);
    expect(payload.unmeasuredAxes).toEqual(['RUNS', 'HONEST']);
    expect(payload.findingCount).toBe(0);
    await Promise.all([client.close(), server.close()]);
  });

  it('get_score scores the bad fixture below the pass threshold', async () => {
    const { client, server } = await connectClient();
    const result = (await client.callTool({
      name: 'get_score',
      arguments: { path: fixturePath('bad-app') },
    })) as CallToolResult;
    const payload = JSON.parse(textOf(result)) as { score: number; findingCount: number };
    expect(payload.score).toBeLessThan(50);
    expect(payload.findingCount).toBeGreaterThan(0);
    await Promise.all([client.close(), server.close()]);
  });

  it('guard_content returns the engine verdict as structured JSON', async () => {
    const calls: Array<{ filePath: string; content: string }> = [];
    const verdict: GuardVerdict = {
      decision: 'block',
      findings: [
        {
          ruleId: 'safe/hardcoded-secrets',
          axis: 'SAFE',
          severity: 'critical',
          confidence: 'high',
          message: 'AWS access key',
          file: 'src/config.ts',
          line: 3,
        },
      ],
      pathViolation: 'writes to .git/hooks are not allowed',
    };
    const guardEngine: GuardEngine = (filePath, content) => {
      calls.push({ filePath, content });
      return verdict;
    };
    const { client, server } = await connectClient({ guardEngine });
    const result = (await client.callTool({
      name: 'guard_content',
      arguments: { file_path: 'src/config.ts', content: 'const key = "AKIA..."' },
    })) as CallToolResult;
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(textOf(result))).toEqual(verdict);
    expect(calls).toEqual([{ filePath: 'src/config.ts', content: 'const key = "AKIA..."' }]);
    await Promise.all([client.close(), server.close()]);
  });

  it('guard_content reports a tool error when arguments are missing', async () => {
    const guardEngine: GuardEngine = () => ({ decision: 'allow', findings: [] });
    const { client, server } = await connectClient({ guardEngine });

    const noPath = (await client.callTool({
      name: 'guard_content',
      arguments: { content: 'x' },
    })) as CallToolResult;
    expect(noPath.isError).toBe(true);
    expect(textOf(noPath)).toContain('"file_path" is required');

    const noContent = (await client.callTool({
      name: 'guard_content',
      arguments: { file_path: 'a.ts' },
    })) as CallToolResult;
    expect(noContent.isError).toBe(true);
    expect(textOf(noContent)).toContain('"content" is required');
    await Promise.all([client.close(), server.close()]);
  });

  it('guard_content turns an engine exception into a tool error, never a crash', async () => {
    const guardEngine: GuardEngine = () => {
      throw new Error('engine exploded');
    };
    const { client, server } = await connectClient({ guardEngine });
    const result = (await client.callTool({
      name: 'guard_content',
      arguments: { file_path: 'a.ts', content: 'x' },
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('engine exploded');
    await Promise.all([client.close(), server.close()]);
  });

  it('guard_content degrades to a clear tool error when no guard engine is configured', async () => {
    const { client, server } = await connectClient();
    const result = (await client.callTool({
      name: 'guard_content',
      arguments: { file_path: 'a.ts', content: 'x' },
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('guard engine is unavailable');
    await Promise.all([client.close(), server.close()]);
  });

  it('unknown tools are rejected without taking the server down', async () => {
    const { client, server } = await connectClient();
    const unknown = (await client.callTool({ name: 'nope', arguments: {} })) as CallToolResult;
    expect(unknown.isError).toBe(true);
    expect(textOf(unknown)).toContain('not found');
    const result = (await client.callTool({
      name: 'get_score',
      arguments: { path: fixturePath('clean-app') },
    })) as CallToolResult;
    expect(result.isError).toBeFalsy();
    await Promise.all([client.close(), server.close()]);
  });
});
