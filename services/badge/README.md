# umbra-badge — the hosted Umbra badge service

A self-contained Cloudflare Worker that turns a repo's self-reported Umbra
Trust Score into a live README badge and a minimal report page. **The service
never scans repos** — repos report their own score from their own CI
(`umbra --publish`, or the GitHub Action with `publish: true`), and every
page it serves says so.

No runtime dependencies. State lives in one KV namespace (`SCORES`).

## Deploy runbook

One-time setup (needs a Cloudflare account; Workers + KV are on the free
plan):

```bash
cd services/badge
npm install
npx wrangler login                      # opens the browser, once per machine
npx wrangler kv namespace create SCORES # prints a namespace id
```

Paste the printed id into `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "SCORES"
id = "<the id from the previous command>"
```

Deploy:

```bash
npm run deploy    # wrangler deploy
```

Wrangler prints the URL: `https://umbra-badge.<your-subdomain>.workers.dev`.
That subdomain is account-scoped — once it exists, finalize it in:

- `src/publish.ts` in the main package (`DEFAULT_BADGE_URL`)
- `action.yml` (the `UMBRA_BADGE_URL` fallback in the publish step)

Both honor overrides (`UMBRA_BADGE_URL` env var / Action variable), so the
service works before the constants are updated.

### Custom domain (optional)

Workers → umbra-badge → Settings → Domains & Routes → Add, e.g.
`badge.<your-domain>`. No worker changes needed — the report page builds its
badge snippet from the request origin, so both the workers.dev URL and the
custom domain serve correct markdown.

### Local development

```bash
npm test          # vitest, handler-level with an in-memory KV double
npm run dev       # wrangler dev — local server with a local KV emulator
npm run build     # tsc --noEmit typecheck
```

## API reference

### `POST /api/report`

Self-report a scan result. Max body 4 KB, 30 reports per hour per IP
(`429` past that). Anything invalid → `400` with `{ "ok": false, "error": … }`.

```json
{
  "repo": "owner/name",
  "score": 87,
  "axes": { "SAFE": 92, "CLEAN": 75, "RUNS": 100, "HONEST": 60 },
  "rubricVersion": 4,
  "findings": { "critical": 0, "high": 1, "medium": 3, "low": 2 },
  "cliVersion": "1.7.0"
}
```

- `repo` — must match `^[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+$`
- `score` — integer 0–100
- `axes` — optional; only `SAFE`, `CLEAN`, `RUNS`, `HONEST`, each an integer 0–100
- `rubricVersion` — non-negative integer
- `findings` — all four severities required, non-negative integers
- `cliVersion` — non-empty string

Response `200`:

```json
{ "ok": true, "badge": "/badge/owner/name.svg", "report": "/owner/name" }
```

Stored under `repo:<owner/name>` in KV with a 30-day TTL, plus a `lastSeen`
timestamp rendered on the report page.

### `GET /badge/:owner/:repo.svg`

Self-contained shields-style SVG (no shields.io call). Label `umbra trust
score`; color brightgreen ≥ 80, yellow ≥ 50, red below, gray `not scanned`
when the repo never reported. `Cache-Control: public, max-age=300`.

### `GET /:owner/:repo`

Dark report page (inline CSS, no JS): big score, per-axis bars, findings by
severity, rubric version, an honesty line (`self-reported by the repo's CI,
<relative time>`), a Star-Umbra button, and the copyable badge markdown for
that repo. `404` when the repo never reported.

### `GET /` and `GET /health`

`/` → 302 to https://github.com/elberacasa/umbra · `/health` → `200 ok`.

## Landing page

`src/landing.html` is the source of truth for the page served at `/`. After editing it, regenerate the embedded module:

```bash
node -e 'const fs=require("fs");fs.writeFileSync("src/landing.ts","// GENERATED from landing.html\nexport const LANDING_HTML = "+JSON.stringify(fs.readFileSync("src/landing.html","utf8"))+";\n")'
```

Then `npm run deploy`.
