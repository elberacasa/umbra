import { describe, expect, it } from 'vitest';
import { debugFlagsRule } from '../../src/rules/safe/debug-flags';
import { checkFixture } from '../helpers';

describe('safe/debug-flags', () => {
  it('flags debug: true at medium confidence', async () => {
    const findings = await checkFixture('rule-debug/vulnerable', [debugFlagsRule]);
    const hit = findings.find((f) => f.message.includes('debug: true'));
    expect(hit).toBeDefined();
    expect(hit?.file).toBe('app.ts');
    expect(hit?.severity).toBe('medium');
    expect(hit?.confidence).toBe('medium');
  });

  it('flags a NODE_ENV check that bypasses auth at high confidence', async () => {
    const findings = await checkFixture('rule-debug/vulnerable', [debugFlagsRule]);
    const hit = findings.find((f) => f.message.includes('bypasses the auth path'));
    expect(hit).toBeDefined();
    expect(hit?.file).toBe('app.ts');
    expect(hit?.severity).toBe('high');
    expect(hit?.confidence).toBe('high');
    expect(hit?.line).toBeGreaterThan(0);
  });

  it('flags an error handler that sends err.stack to the client', async () => {
    const findings = await checkFixture('rule-debug/vulnerable', [debugFlagsRule]);
    const hit = findings.find((f) => f.message.includes('err.stack'));
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('high');
    expect(hit?.confidence).toBe('high');
  });

  it('finds nothing in the clean fixture (env-driven debug, logging-only NODE_ENV check, sanitized errors)', async () => {
    const findings = await checkFixture('rule-debug/clean', [debugFlagsRule]);
    expect(findings).toEqual([]);
  });

  it('finds nothing in the shared clean-app fixture', async () => {
    const findings = await checkFixture('clean-app', [debugFlagsRule]);
    expect(findings).toEqual([]);
  });
});
