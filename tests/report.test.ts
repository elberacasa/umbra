import { describe, expect, it } from 'vitest';
import { execute } from '../src/cli';
import { toMarkdownReport } from '../src/report';
import { fixturePath, stubResolver } from './helpers';

describe('markdown report (--report)', () => {
  it('renders an agent-actionable UMBRA.md for the bad fixture', async () => {
    const { markdown } = await execute(fixturePath('bad-app'), {
      report: true,
      scanOptions: { resolvePackage: stubResolver },
    });
    expect(markdown).toBeDefined();
    const md = markdown as string;
    expect(md).toContain('# Umbra Trust Report');
    expect(md).toContain('**Trust Score: 30/100**');
    expect(md).toContain('Rubric v3');
    expect(md).toContain('npx umbra-scan --report');
    // The agent loop: task-list instructions plus checkbox findings with fixes.
    expect(md).toContain('## Instructions for AI coding agents');
    expect(md).toContain('treat every unchecked finding below as your task list');
    expect(md).toMatch(/- \[ \] \*\*critical\*\* \(high\) · Hardcoded Stripe live secret key in source — `\.env:3`/);
    expect(md).toContain('Fix: Move the secret into an untracked .env');
    expect(md).toContain('## Notes (low confidence, not scored)');
    expect(md).toContain('img.shields.io/badge/Umbra_Trust_Score-30-red');
  });

  it('is omitted unless requested', async () => {
    const result = await execute(fixturePath('bad-app'), {
      scanOptions: { resolvePackage: stubResolver },
    });
    expect(result.markdown).toBeUndefined();
  });

  it('clean fixture renders a no-findings report at 100', async () => {
    const { markdown } = await execute(fixturePath('clean-app'), {
      report: true,
      scanOptions: { resolvePackage: stubResolver },
    });
    const md = markdown as string;
    expect(md).toContain('**Trust Score: 100/100**');
    expect(md).toContain('No scored findings.');
  });

  it('toMarkdownReport groups findings by axis with axis scores', async () => {
    const result = await execute(fixturePath('bad-app'), {
      report: true,
      scanOptions: { resolvePackage: stubResolver },
    });
    const md = result.markdown as string;
    expect(md).toContain('### SAFE — 5/100');
    expect(md).toContain('### CLEAN — 87/100');
    expect(md).toContain('_RUNS, HONEST not measured — run `npx umbra-scan --deep --report`_');
  });
});
