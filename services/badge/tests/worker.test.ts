import { describe, expect, it } from 'vitest';
import worker, { type Env } from '../src/index';

/** In-memory KV double: stores raw strings, honors the 'json' get type. */
class MockKV {
  private readonly store = new Map<string, string>();

  async get(key: string, type?: 'text' | 'json'): Promise<unknown> {
    const value = this.store.get(key);
    if (value === undefined) return null;
    return type === 'json' ? JSON.parse(value) : value;
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

function makeEnv(): Env {
  return { SCORES: new MockKV() as unknown as KVNamespace };
}

function report(repo: string, body: unknown, ip = '203.0.113.7'): Promise<Response> {
  return worker.fetch(
    new Request(`https://badge.test/api/report`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    makeEnv(),
  );
}

const VALID = {
  repo: 'acme/widget',
  score: 87,
  axes: { SAFE: 92, CLEAN: 75 },
  rubricVersion: 4,
  findings: { critical: 0, high: 1, medium: 3, low: 2 },
  cliVersion: '1.7.0',
};

async function seed(env: Env, repo: string, score: number): Promise<void> {
  const res = await worker.fetch(
    new Request('https://badge.test/api/report', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.4' },
      body: JSON.stringify({ ...VALID, repo, score }),
    }),
    env,
  );
  if (res.status !== 200) throw new Error(`seed failed: ${res.status}`);
}

describe('POST /api/report validation', () => {
  it('accepts a valid report and returns badge + report paths', async () => {
    const res = await report('acme/widget', VALID);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ ok: true, badge: '/badge/acme/widget.svg', report: '/acme/widget' });
  });

  it('rejects a malformed repo name', async () => {
    for (const repo of ['noslash', 'a/b/c', '/leading', 'bad repo/x', '']) {
      const res = await report(repo, { ...VALID, repo });
      expect(res.status).toBe(400);
    }
  });

  it('rejects out-of-range and non-integer scores', async () => {
    for (const score of [-1, 101, 87.5, '87', null]) {
      const res = await report('acme/widget', { ...VALID, score });
      expect(res.status).toBe(400);
    }
  });

  it('rejects unknown axes and out-of-range axis scores', async () => {
    expect((await report('acme/widget', { ...VALID, axes: { VIBES: 50 } })).status).toBe(400);
    expect((await report('acme/widget', { ...VALID, axes: { SAFE: 120 } })).status).toBe(400);
  });

  it('rejects missing severity counts and non-string cliVersion', async () => {
    const { findings: _dropped, ...noFindings } = VALID;
    expect((await report('acme/widget', noFindings)).status).toBe(400);
    expect(
      (await report('acme/widget', { ...VALID, findings: { critical: 0, high: 0, medium: 0 } })).status,
    ).toBe(400);
    expect((await report('acme/widget', { ...VALID, cliVersion: 17 })).status).toBe(400);
  });

  it('rejects invalid JSON and oversized bodies', async () => {
    expect((await report('acme/widget', '{not json')).status).toBe(400);
    const big = JSON.stringify({ ...VALID, pad: 'x'.repeat(5000) });
    expect((await report('acme/widget', big)).status).toBe(400);
  });

  it('rejects GET on the report endpoint', async () => {
    const res = await worker.fetch(new Request('https://badge.test/api/report'), makeEnv());
    expect(res.status).toBe(405);
  });
});

describe('KV roundtrip', () => {
  it('stores lastSeen and serves the stored score on badge and page', async () => {
    const env = makeEnv();
    await seed(env, 'acme/widget', 87);

    const stored = (await env.SCORES.get('repo:acme/widget', 'json')) as Record<string, unknown>;
    expect(stored.score).toBe(87);
    expect(typeof stored.lastSeen).toBe('string');
    expect(Number.isNaN(Date.parse(stored.lastSeen as string))).toBe(false);

    const badge = await worker.fetch(new Request('https://badge.test/badge/acme/widget.svg'), env);
    expect(await badge.text()).toContain('>87</text>');
  });
});

describe('GET /badge/:owner/:repo.svg', () => {
  const bands: Array<[number, string]> = [
    [80, '#4c1'], // brightgreen
    [95, '#4c1'],
    [50, '#dfb317'], // yellow
    [79, '#dfb317'],
    [49, '#e05d44'], // red
    [0, '#e05d44'],
  ];

  for (const [score, color] of bands) {
    it(`scores ${score} → ${color}`, async () => {
      const env = makeEnv();
      await seed(env, 'acme/widget', score);
      const res = await worker.fetch(new Request('https://badge.test/badge/acme/widget.svg'), env);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('image/svg+xml');
      expect(res.headers.get('cache-control')).toBe('public, max-age=300');
      const svg = await res.text();
      expect(svg).toContain('umbra trust score');
      expect(svg).toContain(color);
      expect(svg).toContain(`>${score}</text>`);
    });
  }

  it('renders a gray "not scanned" badge for unknown repos', async () => {
    const res = await worker.fetch(
      new Request('https://badge.test/badge/ghost/nothing.svg'),
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const svg = await res.text();
    expect(svg).toContain('not scanned');
    expect(svg).toContain('#9f9f9f');
  });
});

describe('GET /:owner/:repo report page', () => {
  it('contains the score, repo, axes, and honesty line', async () => {
    const env = makeEnv();
    await seed(env, 'acme/widget', 87);
    const res = await worker.fetch(new Request('https://badge.test/acme/widget'), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('acme/widget');
    expect(html).toContain('87<small>/100</small>');
    expect(html).toContain('SAFE');
    expect(html).toContain('self-reported by the repo');
    expect(html).toContain('https://github.com/elberacasa/umbra');
    expect(html).toContain('[![Umbra Trust Score](https://badge.test/badge/acme/widget.svg)](https://badge.test/acme/widget)');
    expect(html).toContain('rubric v4');
    expect(html).not.toContain('<script');
  });

  it('404s for repos that never reported', async () => {
    const res = await worker.fetch(new Request('https://badge.test/ghost/nothing'), makeEnv());
    expect(res.status).toBe(404);
  });
});

describe('rate limit', () => {
  it('allows 30 reports per hour per IP, then 429s', async () => {
    const env = makeEnv();
    for (let i = 0; i < 30; i++) {
      const res = await worker.fetch(
        new Request('https://badge.test/api/report', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.1' },
          body: JSON.stringify(VALID),
        }),
        env,
      );
      expect(res.status).toBe(200);
    }
    const res = await worker.fetch(
      new Request('https://badge.test/api/report', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.1' },
        body: JSON.stringify(VALID),
      }),
      env,
    );
    expect(res.status).toBe(429);
  });

  it('tracks IPs independently', async () => {
    const env = makeEnv();
    const post = (ip: string) =>
      worker.fetch(
        new Request('https://badge.test/api/report', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
          body: JSON.stringify(VALID),
        }),
        env,
      );
    for (let i = 0; i < 30; i++) await post('192.0.2.1');
    expect((await post('192.0.2.1')).status).toBe(429);
    expect((await post('192.0.2.2')).status).toBe(200);
  });
});

describe('misc routes', () => {
  it('redirects / to the GitHub repo', async () => {
    const res = await worker.fetch(new Request('https://badge.test/'), makeEnv());
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://github.com/elberacasa/umbra');
  });

  it('answers /health', async () => {
    const res = await worker.fetch(new Request('https://badge.test/health'), makeEnv());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });
});
