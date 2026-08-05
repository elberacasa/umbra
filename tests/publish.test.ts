import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execute } from '../src/cli';
import {
  DEFAULT_BADGE_URL,
  buildPublishPayload,
  publishScore,
  repoFromGitConfig,
} from '../src/publish';
import type { PublishPayload } from '../src/publish';
import type { JsonReport } from '../src/report';
import { computeScore } from '../src/score/score';
import { fixturePath, stubResolver } from './helpers';
import { runScan } from '../src/engine/runner';
import { allRules } from '../src/rules/index';

/** Minimal scannable repo on disk, with a git remote so --publish can name it. */
function makeTempRepo(remoteUrl?: string): string {
  const root = mkdtempSync(path.join(tmpdir(), 'umbra-publish-'));
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0' }));
  writeFileSync(path.join(root, 'index.js'), 'export const answer = 42;\n');
  if (remoteUrl !== undefined) {
    mkdirSync(path.join(root, '.git'));
    writeFileSync(
      path.join(root, '.git', 'config'),
      `[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = ${remoteUrl}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`,
    );
  }
  return root;
}

interface CapturedCall {
  url: string;
  body: PublishPayload;
}

function fetchRecorder(status = 200): { calls: CapturedCall[]; fetchImpl: typeof fetch } {
  const calls: CapturedCall[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)) as PublishPayload });
    return new Response(JSON.stringify({ ok: true, badge: '/badge/acme/widget.svg', report: '/acme/widget' }), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe('repoFromGitConfig', () => {
  it('parses https, ssh, and .git-suffixed remotes', () => {
    expect(repoFromGitConfig(makeTempRepo('https://github.com/acme/widget'))).toBe('acme/widget');
    expect(repoFromGitConfig(makeTempRepo('https://github.com/acme/widget.git'))).toBe('acme/widget');
    expect(repoFromGitConfig(makeTempRepo('git@github.com:acme/widget.git'))).toBe('acme/widget');
  });

  it('returns undefined without a git remote', () => {
    expect(repoFromGitConfig(makeTempRepo())).toBeUndefined();
  });
});

describe('buildPublishPayload', () => {
  it('carries the score, measured axes, rubric version, and severity counts', async () => {
    const scan = await runScan(fixturePath('bad-app'), allRules, { resolvePackage: stubResolver });
    const score = computeScore(scan.findings);
    const payload = buildPublishPayload('acme/widget', score, scan.findings, '1.7.0');

    expect(payload.repo).toBe('acme/widget');
    expect(payload.score).toBe(score.total);
    expect(payload.rubricVersion).toBe(4);
    expect(payload.cliVersion).toBe('1.7.0');
    expect(payload.axes.SAFE).toBe(score.axes.find((a) => a.axis === 'SAFE')?.score);
    expect(payload.axes.CLEAN).toBe(score.axes.find((a) => a.axis === 'CLEAN')?.score);
    expect(payload.axes.RUNS).toBeUndefined();
    const total = Object.values(payload.findings).reduce((a, b) => a + b, 0);
    expect(total).toBe(scan.findings.length);
  });
});

describe('publishScore', () => {
  const payload: PublishPayload = {
    repo: 'acme/widget',
    score: 87,
    axes: { SAFE: 92, CLEAN: 75 },
    rubricVersion: 4,
    findings: { critical: 0, high: 1, medium: 3, low: 2 },
    cliVersion: '1.7.0',
  };

  it('POSTs to /api/report on the default host', async () => {
    const { calls, fetchImpl } = fetchRecorder();
    const outcome = await publishScore(payload, { fetchImpl, baseUrl: DEFAULT_BADGE_URL });
    expect(outcome.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${DEFAULT_BADGE_URL}/api/report`);
    expect(calls[0]?.body).toEqual(payload);
  });

  it('honors the UMBRA_BADGE_URL env override', async () => {
    const { calls, fetchImpl } = fetchRecorder();
    process.env.UMBRA_BADGE_URL = 'https://badge.example.com/';
    try {
      await publishScore(payload, { fetchImpl });
      expect(calls[0]?.url).toBe('https://badge.example.com/api/report');
    } finally {
      delete process.env.UMBRA_BADGE_URL;
    }
  });

  it('returns ok:false on HTTP errors and network failures — never throws', async () => {
    const { fetchImpl: failingHttp } = fetchRecorder(500);
    expect((await publishScore(payload, { fetchImpl: failingHttp })).ok).toBe(false);

    const throwing = (async () => {
      throw new Error('connection refused');
    }) as typeof fetch;
    const outcome = await publishScore(payload, { fetchImpl: throwing });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain('connection refused');
  });

  it('times out slow services instead of hanging the scan', async () => {
    const slow = ((input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('The operation was aborted')));
        setTimeout(() => resolve(new Response('{}')), 5000);
      })) as typeof fetch;
    const outcome = await publishScore(payload, { fetchImpl: slow, timeoutMs: 50 });
    expect(outcome.ok).toBe(false);
  });
});

describe('execute --publish', () => {
  it('POSTs the report to the injected endpoint and leaves output untouched', async () => {
    const root = makeTempRepo('https://github.com/acme/widget');
    const { calls, fetchImpl } = fetchRecorder();

    const published = await execute(root, {
      json: true,
      publish: true,
      publishFetch: fetchImpl,
      scanOptions: { resolvePackage: stubResolver },
    });
    const plain = await execute(root, {
      json: true,
      scanOptions: { resolvePackage: stubResolver },
    });

    // JSON report schema untouched: byte-identical with and without --publish.
    expect(published.output).toBe(plain.output);
    const report = JSON.parse(published.output) as JsonReport;
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${DEFAULT_BADGE_URL}/api/report`);
    expect(calls[0]?.body.repo).toBe('acme/widget');
    expect(calls[0]?.body.score).toBe(report.score);
    expect(calls[0]?.body.rubricVersion).toBe(report.rubricVersion);
    expect(published.exitCode).toBe(plain.exitCode);
  });

  it('--offline + --publish skips the POST with a stderr note', async () => {
    const root = makeTempRepo('https://github.com/acme/widget');
    const { calls, fetchImpl } = fetchRecorder();
    const stderr: string[] = [];
    const original = process.stderr.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderr.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      await execute(root, { offline: true, publish: true, publishFetch: fetchImpl });
    } finally {
      process.stderr.write = original;
    }
    expect(calls).toHaveLength(0);
    expect(stderr.join('')).toContain('--publish skipped');
  });

  it('skips cleanly when the repo has no git remote', async () => {
    const root = makeTempRepo();
    const { calls, fetchImpl } = fetchRecorder();
    const result = await execute(root, {
      publish: true,
      publishFetch: fetchImpl,
      scanOptions: { resolvePackage: stubResolver },
    });
    expect(calls).toHaveLength(0);
    expect(result.exitCode).toBe(0);
  });

  it('a failing service never fails the scan', async () => {
    const root = makeTempRepo('https://github.com/acme/widget');
    const throwing = (async () => {
      throw new Error('dns lookup failed');
    }) as typeof fetch;
    const result = await execute(root, {
      publish: true,
      publishFetch: throwing,
      scanOptions: { resolvePackage: stubResolver },
    });
    expect(result.exitCode).toBe(0);
    expect(result.output).toMatch(/UMBRA TRUST SCORE: \d+\/100/);
  });
});
