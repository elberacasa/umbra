# Umbra

> Everyone is vibecoding. Nobody is verifying. Umbra scores it.

<!-- dogfood: [![Umbra Trust Score](https://img.shields.io/badge/Umbra_Trust_Score-XX-brightgreen)](https://github.com/elberacasa/umbra) -->

`npx umbra <path>` gives any AI-built repo a deterministic **Trust Score (0–100)**
with file:line evidence for every finding — plus a badge for your README.

## Quickstart

```bash
npx umbra ./your-repo
umbra ./your-repo --json     # machine-readable output
umbra ./your-repo --offline  # skip npm registry checks
```

Exit code is 1 when the score is below 50, so CI can gate on it.

## What it checks (v0.1)

- **SAFE** — hardcoded secrets (service_role JWTs, AWS keys, private keys),
  committed `.env` files, Supabase anti-patterns (client-side service keys,
  missing RLS), unauthenticated API routes, injection sinks (`eval`, SQL
  concatenation, `dangerouslySetInnerHTML`), missing rate limiting on auth
  endpoints, and hallucinated/typosquatted dependencies.
- **CLEAN** — dead exports, unused dependencies, 500+ line mega-files, and
  copy-pasted code blocks.
- **RUNS / HONEST** — reserved in the rubric, not yet measured in v0.1.

Scoring is deterministic and versioned — see [RUBRIC.md](./RUBRIC.md).
Every finding carries a confidence level; only high/medium confidence affects
the score. Low-confidence hunches go to the notes section. No phantom findings.

## Vision

AI wrote this. Can I trust it? Umbra is building the trust layer for
AI-generated software: today a static trust score, next a sandbox that verifies
the repo actually boots, claim-receipts that catch agents lying about their own
tests, and a badge that lives in every README it has ever scanned.

## Development

```bash
npm install
npm run build
npm test
node dist/cli.js fixtures/bad-app
```

MIT licensed.
