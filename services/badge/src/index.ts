/**
 * umbra-badge — the hosted Umbra badge service.
 *
 * Umbra never scans repos here: repos self-report their score from their own
 * CI (`umbra --publish` or the GitHub Action), and every surface this worker
 * serves says so. Three surfaces: the ingest API, the SVG badge, and the
 * report page behind it.
 */

export interface Env {
  SCORES: KVNamespace;
}

const GITHUB_URL = 'https://github.com/elberacasa/umbra';
const REPO_RE = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;
const REPO_PART_RE = /^[a-zA-Z0-9_.-]+$/;
const MAX_BODY_BYTES = 4096;
const REPORT_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const RATE_LIMIT_PER_HOUR = 30;
const RATE_LIMIT_WINDOW_SECONDS = 3600;
const AXES = ['SAFE', 'CLEAN', 'RUNS', 'HONEST'] as const;
type AxisName = (typeof AXES)[number];
const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
type Severity = (typeof SEVERITIES)[number];

interface StoredReport {
  repo: string;
  score: number;
  axes: Partial<Record<AxisName, number>>;
  rubricVersion: number;
  findings: Record<Severity, number>;
  cliVersion: string;
  /** ISO-8601 timestamp of the last self-report. */
  lastSeen: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function isScore(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 100;
}

type Validation = { ok: true; report: Omit<StoredReport, 'lastSeen'> } | { ok: false; error: string };

function validateReport(body: unknown): Validation {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, error: 'body must be a JSON object' };
  }
  const b = body as Record<string, unknown>;

  if (typeof b.repo !== 'string' || !REPO_RE.test(b.repo)) {
    return { ok: false, error: 'repo must match owner/name' };
  }
  if (!isScore(b.score)) {
    return { ok: false, error: 'score must be an integer 0-100' };
  }
  if (typeof b.rubricVersion !== 'number' || !Number.isInteger(b.rubricVersion) || b.rubricVersion < 0) {
    return { ok: false, error: 'rubricVersion must be a non-negative integer' };
  }
  if (typeof b.cliVersion !== 'string' || b.cliVersion.trim() === '') {
    return { ok: false, error: 'cliVersion must be a non-empty string' };
  }

  const axes: Partial<Record<AxisName, number>> = {};
  if (b.axes !== undefined) {
    if (typeof b.axes !== 'object' || b.axes === null || Array.isArray(b.axes)) {
      return { ok: false, error: 'axes must be an object' };
    }
    for (const [key, value] of Object.entries(b.axes)) {
      if (!(AXES as readonly string[]).includes(key)) {
        return { ok: false, error: `unknown axis: ${key}` };
      }
      if (!isScore(value)) {
        return { ok: false, error: `axes.${key} must be an integer 0-100` };
      }
      axes[key as AxisName] = value;
    }
  }

  if (typeof b.findings !== 'object' || b.findings === null || Array.isArray(b.findings)) {
    return { ok: false, error: 'findings must be an object' };
  }
  const findings = {} as Record<Severity, number>;
  for (const severity of SEVERITIES) {
    const value = (b.findings as Record<string, unknown>)[severity];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      return { ok: false, error: `findings.${severity} must be a non-negative integer` };
    }
    findings[severity] = value;
  }

  return {
    ok: true,
    report: {
      repo: b.repo,
      score: b.score,
      axes,
      rubricVersion: b.rubricVersion,
      findings,
      cliVersion: b.cliVersion,
    },
  };
}

async function handleReport(request: Request, env: Env): Promise<Response> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) {
    return json({ ok: false, error: 'body too large' }, 400);
  }
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    return json({ ok: false, error: 'body too large' }, 400);
  }

  // Trivial per-IP rate limit: a KV counter on a one-hour window.
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const rateKey = `rl:${ip}`;
  const seen = Number((await env.SCORES.get(rateKey)) ?? '0');
  if (seen >= RATE_LIMIT_PER_HOUR) {
    return json({ ok: false, error: 'rate limit exceeded — 30 reports per hour' }, 429);
  }
  await env.SCORES.put(rateKey, String(seen + 1), { expirationTtl: RATE_LIMIT_WINDOW_SECONDS });

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ ok: false, error: 'body must be valid JSON' }, 400);
  }

  const validation = validateReport(body);
  if (!validation.ok) {
    return json({ ok: false, error: validation.error }, 400);
  }

  const stored: StoredReport = { ...validation.report, lastSeen: new Date().toISOString() };
  await env.SCORES.put(`repo:${stored.repo}`, JSON.stringify(stored), {
    expirationTtl: REPORT_TTL_SECONDS,
  });

  return json({
    ok: true,
    badge: `/badge/${stored.repo}.svg`,
    report: `/${stored.repo}`,
  });
}

// ---------------------------------------------------------------------------
// Badge SVG — self-contained, shields-style flat. No shields.io round-trip.
// ---------------------------------------------------------------------------

const BAND_COLORS = { brightgreen: '#4c1', yellow: '#dfb317', red: '#e05d44', gray: '#9f9f9f' } as const;

function colorForScore(score: number): string {
  if (score >= 80) return BAND_COLORS.brightgreen;
  if (score >= 50) return BAND_COLORS.yellow;
  return BAND_COLORS.red;
}

function textWidth(text: string): number {
  return Math.round(text.length * 6.6 + 10);
}

function badgeSvg(label: string, value: string, color: string): string {
  const lw = textWidth(label);
  const vw = textWidth(value);
  const w = lw + vw;
  const lx = lw * 5;
  const vx = lw * 10 + vw * 5;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${label}: ${value}">` +
    `<title>${label}: ${value}</title>` +
    `<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>` +
    `<clipPath id="r"><rect width="${w}" height="20" rx="3" fill="#fff"/></clipPath>` +
    `<g clip-path="url(#r)">` +
    `<rect width="${lw}" height="20" fill="#555"/>` +
    `<rect x="${lw}" width="${vw}" height="20" fill="${color}"/>` +
    `<rect width="${w}" height="20" fill="url(#s)"/>` +
    `</g>` +
    `<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="110">` +
    `<text aria-hidden="true" x="${lx}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${(lw - 10) * 10}">${label}</text>` +
    `<text x="${lx}" y="140" transform="scale(.1)" textLength="${(lw - 10) * 10}">${label}</text>` +
    `<text aria-hidden="true" x="${vx}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${(vw - 10) * 10}">${value}</text>` +
    `<text x="${vx}" y="140" transform="scale(.1)" textLength="${(vw - 10) * 10}">${value}</text>` +
    `</g></svg>`;
}

function svgResponse(svg: string): Response {
  return new Response(svg, {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
}

async function handleBadge(pathname: string, env: Env): Promise<Response> {
  const segments = pathname.split('/').filter((s) => s !== '');
  // /badge/<owner>/<repo>.svg
  const owner = segments[1];
  const repoFile = segments[2];
  if (segments.length !== 3 || owner === undefined || repoFile === undefined || !repoFile.endsWith('.svg')) {
    return new Response('not found', { status: 404 });
  }
  const repo = repoFile.slice(0, -'.svg'.length);
  if (!REPO_PART_RE.test(owner) || !REPO_PART_RE.test(repo) || repo === '') {
    return new Response('not found', { status: 404 });
  }

  const stored = await env.SCORES.get<StoredReport>(`repo:${owner}/${repo}`, 'json');
  if (stored === null) {
    return svgResponse(badgeSvg('umbra trust score', 'not scanned', BAND_COLORS.gray));
  }
  return svgResponse(badgeSvg('umbra trust score', String(stored.score), colorForScore(stored.score)));
}

// ---------------------------------------------------------------------------
// Report page — dark, minimal, no JS. The honesty line is the product.
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 'recently';
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? '' : 's'} ago`;
}

function axisBar(name: string, score: number): string {
  const color = score >= 80 ? '#00f0ff' : score >= 50 ? '#dfb317' : '#e05d44';
  return (
    `<div class="axis">` +
    `<span class="axis-name">${name}</span>` +
    `<span class="bar"><span class="fill" style="width:${score}%;background:${color}"></span></span>` +
    `<span class="axis-score">${score}</span>` +
    `</div>`
  );
}

function reportPage(stored: StoredReport, origin: string): string {
  const repo = escapeHtml(stored.repo);
  const badgeUrl = `${origin}/badge/${stored.repo}.svg`;
  const reportUrl = `${origin}/${stored.repo}`;
  const snippet = escapeHtml(`[![Umbra Trust Score](${badgeUrl})](${reportUrl})`);

  const axes = AXES.filter((a) => stored.axes[a] !== undefined)
    .map((a) => axisBar(a, stored.axes[a] as number))
    .join('');
  const axesSection =
    axes !== ''
      ? `<section class="axes">${axes}</section>`
      : '<section class="axes"><p class="dim">no per-axis breakdown reported</p></section>';

  const chips = SEVERITIES.map(
    (s) => `<span class="chip sev-${s}">${s} <b>${stored.findings[s]}</b></span>`,
  ).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${repo} — Umbra Trust Score</title>
<style>
  :root { color-scheme: dark; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #0a0a0f; color: #e8e8f0; min-height: 100vh;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    display: flex; align-items: center; justify-content: center; padding: 2rem 1rem;
  }
  main { width: 100%; max-width: 34rem; }
  .brand { font-size: .8rem; letter-spacing: .25em; text-transform: uppercase; color: #8a8a9a; }
  .repo { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 1.05rem; margin-top: .4rem; }
  .repo a { color: #e8e8f0; text-decoration: none; border-bottom: 1px solid #3a3a4a; }
  .score { font-size: 5rem; font-weight: 800; line-height: 1; margin: 1.5rem 0 .25rem;
    background: linear-gradient(90deg, #00f0ff, #b829f7); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .score small { font-size: 1.4rem; font-weight: 500; color: #8a8a9a; -webkit-text-fill-color: #8a8a9a; }
  .axes { margin: 1.75rem 0; display: grid; gap: .55rem; }
  .axis { display: grid; grid-template-columns: 4.5rem 1fr 2.5rem; align-items: center; gap: .75rem; font-size: .85rem; }
  .axis-name { color: #8a8a9a; letter-spacing: .08em; }
  .axis-score { text-align: right; font-variant-numeric: tabular-nums; }
  .bar { height: .45rem; background: #1c1c26; border-radius: 999px; overflow: hidden; }
  .fill { display: block; height: 100%; border-radius: 999px; }
  .findings { display: flex; gap: .5rem; flex-wrap: wrap; margin-bottom: 1.75rem; }
  .chip { font-size: .78rem; padding: .3rem .65rem; border-radius: 999px; background: #14141d; border: 1px solid #262633; color: #b9b9c9; }
  .chip b { color: #e8e8f0; }
  .sev-critical b { color: #ff5c5c; } .sev-high b { color: #ff9f5c; }
  .meta { font-size: .82rem; color: #8a8a9a; }
  .honesty { font-size: .82rem; color: #00f0ff; margin-top: .35rem; }
  .star { display: inline-block; margin: 1.5rem 0; padding: .6rem 1.1rem; border-radius: .5rem;
    border: 1px solid #b829f7; color: #e8e8f0; text-decoration: none; font-size: .9rem;
    background: linear-gradient(90deg, rgba(0,240,255,.08), rgba(184,41,247,.12)); }
  .star:hover { border-color: #00f0ff; }
  .label { font-size: .78rem; color: #8a8a9a; margin-bottom: .4rem; }
  pre { background: #14141d; border: 1px solid #262633; border-radius: .5rem; padding: .8rem 1rem;
    overflow-x: auto; font-size: .8rem; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #b9b9c9; }
  .dim { color: #8a8a9a; }
  footer { margin-top: 2rem; font-size: .75rem; color: #55555f; }
  footer a { color: #8a8a9a; }
</style>
</head>
<body>
<main>
  <div class="brand">Umbra Trust Score</div>
  <div class="repo"><a href="https://github.com/${repo}">${repo}</a></div>
  <div class="score">${stored.score}<small>/100</small></div>
  ${axesSection}
  <div class="findings">${chips}</div>
  <p class="meta">rubric v${stored.rubricVersion} · reported by umbra ${escapeHtml(stored.cliVersion)}</p>
  <p class="honesty">self-reported by the repo's CI, ${relativeTime(stored.lastSeen)}</p>
  <a class="star" href="${GITHUB_URL}">★ Star Umbra on GitHub</a>
  <p class="label">Badge markdown for this repo:</p>
  <pre><code>${snippet}</code></pre>
  <footer>Scored by <a href="${GITHUB_URL}">Umbra</a> — the trust score for AI-built software.</footer>
</main>
</body>
</html>`;
}

async function handleReportPage(owner: string, repo: string, env: Env, origin: string): Promise<Response> {
  if (!REPO_PART_RE.test(owner) || !REPO_PART_RE.test(repo)) {
    return new Response('not found', { status: 404 });
  }
  const stored = await env.SCORES.get<StoredReport>(`repo:${owner}/${repo}`, 'json');
  if (stored === null) {
    return new Response(`no self-reported Umbra score for ${owner}/${repo} yet`, {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
  return new Response(reportPage(stored, origin), {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (pathname === '/health') {
      return new Response('ok', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
    if (pathname === '/') {
      return Response.redirect(GITHUB_URL, 302);
    }
    if (pathname === '/api/report') {
      if (request.method !== 'POST') {
        return json({ ok: false, error: 'method not allowed' }, 405);
      }
      return handleReport(request, env);
    }
    if (pathname.startsWith('/badge/')) {
      return handleBadge(pathname, env);
    }

    const segments = pathname.split('/').filter((s) => s !== '');
    if (segments.length === 2 && request.method === 'GET') {
      return handleReportPage(segments[0] as string, segments[1] as string, env, url.origin);
    }
    return new Response('not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
