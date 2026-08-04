# The Vibe-Coding Security Audit — August 2026

We ran [Umbra](https://github.com/elberacasa/umbra) (rubric v3) over **61 public, actively-maintained repositories built with AI coding tools** (Lovable, Bolt, v0, Cursor, and similar, found via GitHub keyword search; forks excluded). Every scan was fully automated and reproducible: `npx umbra-scan <repo> --json`.

> **The 60-second version:** one in four repos had a hardcoded-secret finding. One in four exposed API routes with no auth check. Half had injection sinks. 13% committed entire database files or SQL dumps. And 7 repos out of 61 were genuinely clean — proof the tooling generation can ship safe code when someone verifies it.

## Headline numbers

| Metric | Value |
|---|---|
| Repos scanned | 61 |
| Mean trust score | 74/100 |
| Median trust score | 80/100 |
| Repos below 50 (failing) | 12 (20%) |
| Repos at 80+ | 31 (51%) |
| Repos with at least one critical finding | 6 (10%) |
| Repos with a hardcoded-secret finding | 15 (25%) |
| Repos with API routes missing auth | 16 (26%) |
| Repos with injection sinks | 30 (49%) |
| Repos with zero scored findings | 7 |

## Most common finding classes

| Rule | Repos hit | % |
|---|---:|---:|
| `clean/large-files` | 46 | 75% |
| `clean/duplication` | 39 | 64% |
| `safe/injection-sinks` | 30 | 49% |
| `clean/unused-deps` | 24 | 39% |
| `safe/missing-auth-routes` | 16 | 26% |
| `safe/hardcoded-secrets` | 15 | 25% |
| `safe/cors-wildcard` | 13 | 21% |
| `safe/exposed-sensitive-files` | 8 | 13% |
| `safe/default-credentials` | 7 | 11% |
| `safe/supabase-antipatterns` | 4 | 7% |
| `safe/debug-flags` | 4 | 7% |
| `safe/jwt-misconfig` | 1 | 2% |

## The findings that matter, explained

Raw counts understate it. These are the six patterns doing the real damage, reconstructed from what the scans actually found. Snippets are representative rewrites of the observed patterns — we do not publish any repo's vulnerable code verbatim, and never the location of a real secret.

### 1. Committed `.env` files with live-format secrets — 25% of repos

```
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIs...   # committed to git
```
28 critical findings across 15 repos: private key material in source, committed `.env` / `.env.prod` files, Supabase `service_role` JWTs sitting in the repo tree. A service_role key bypasses row level security entirely — it is the database root password, and agents write it into whatever file the quickstart tutorial mentioned. This is the exact failure behind 2026's Moltbook exposure (millions of API keys in an open database). **Fix:** secrets live in untracked env files or a secret manager, never in git; anything already committed is rotated, not deleted.

### 2. API routes with no auth at all — 26% of repos

```ts
export async function POST(req: Request) {
  const { videoUrl } = await req.json();
  return Response.json(await transcribe(videoUrl)); // anyone on the internet
}
```
156 findings. The pattern we kept seeing: AI apps expose compute-expensive endpoints — transcribe, process, upload, generate — as open routes. No auth import, no session check, nothing. Two ways this hurts: strangers run up your AI-provider bill (a cost attack measured in dollars per hour), and endpoints touching user data become public read/write. This is the bug class that kept a critical hole open on a $6.6B vibe-coding platform for 48 days this spring. **Fix:** every route starts with an auth check that returns 401 before touching data.

### 3. Injection sinks — 49% of repos

```ts
db.query(`SELECT * FROM users WHERE id = ${userId}`);        // SQL injection
element.innerHTML = dangerouslySetInnerHTML(themeCode);      // stored XSS
```
246 findings across half the sample: SQL built by string interpolation and `dangerouslySetInnerHTML` rendering dynamic values. Agents reach for these because they are the shortest path to a working demo — the training data is full of tutorials that concatenate. **Fix:** parameterized queries everywhere; sanitize before any HTML injection.

### 4. Entire databases committed to git — 13% of repos

Committed `app.db` SQLite files, `.bak` backups, and SQL dumps with names like `023_add_2fa_backup_codes.sql`. 64 critical findings. A committed SQLite file is the whole production database in git history — users, sessions, everything — and deleting it from HEAD does not remove it from history. **Fix:** purge from history, rotate whatever it contained, gitignore the pattern.

### 5. CORS wildcard with credentials — 21% of repos

```ts
app.use(cors({ origin: "*", credentials: true }));
```
13 repos. With an auth surface present, this lets any website make authenticated requests as your users from their browsers. It is one line, it comes from a hundred Stack Overflow answers, and agents paste it the moment a preflight error appears during development. **Fix:** an explicit origin allowlist.

### 6. Default credentials in connection strings — 11% of repos

```ts
const db = connect("postgres://postgres:postgres@db:5432/app");
```
7 repos, plus literal passwords like `123456` assigned in config. Fine for a local container, fatal the day someone ships the compose file to a public host. **Fix:** credentials come from the environment, and the default is a startup failure, not `postgres:postgres`.

### Bonus: the slop layer

CLEAN findings are not vulnerabilities, but they tell the story of how this code gets written: duplicated blocks in 64% of repos (agents copy-paste rather than extract a shared function) and 500+-line files in 75% (agents append rather than restructure). 7 repos had zero scored findings at all — clean, safe, and honest. It is possible. It just requires someone — or something — to check.

## Full results

Severity counts are critical/high/medium/low. Exact secret locations are deliberately redacted from this report; maintainers of repos with critical secret findings are being contacted privately.

| # | Repo | Score | SAFE | CLEAN | Findings (c/h/m/l) |
|---:|---|---:|---:|---:|---|
| 1 | [NetaniaChetty/lovable](https://github.com/NetaniaChetty/lovable) | 100 | 100 | 100 | 0/0/0/0 |
| 2 | [YeeKal/leaked-system-prompts](https://github.com/YeeKal/leaked-system-prompts) | 100 | 100 | 99 | 0/0/0/1 |
| 3 | [chongdashu/phaserjs-oakwoods](https://github.com/chongdashu/phaserjs-oakwoods) | 100 | 100 | 100 | 0/0/0/0 |
| 4 | [deancourse/vibe-coding-testing-practice](https://github.com/deancourse/vibe-coding-testing-practice) | 100 | 100 | 100 | 0/0/0/0 |
| 5 | [nitinpatel20X/Check-out-what-I-just-built-with-Lovable-https-deft-inventory.lovable.app](https://github.com/nitinpatel20X/Check-out-what-I-just-built-with-Lovable-https-deft-inventory.lovable.app) | 100 | 100 | 100 | 0/0/0/0 |
| 6 | [ruslan-haribov/ai-generated](https://github.com/ruslan-haribov/ai-generated) | 100 | 100 | 100 | 0/0/0/0 |
| 7 | [sbdentertainment5-crypto/my-app](https://github.com/sbdentertainment5-crypto/my-app) | 100 | 100 | 100 | 0/0/0/0 |
| 8 | [sergioliberdade-del/Check-out-what-I-just-built-with-Lovable-https-sundown-skin-freedom.lovable.app](https://github.com/sergioliberdade-del/Check-out-what-I-just-built-with-Lovable-https-sundown-skin-freedom.lovable.app) | 100 | 100 | 100 | 0/0/0/0 |
| 9 | [ShenSeanChen/launch-react-nextjs-tips](https://github.com/ShenSeanChen/launch-react-nextjs-tips) | 99 | 100 | 97 | 0/0/0/1 |
| 10 | [cursor/agent-trace](https://github.com/cursor/agent-trace) | 99 | 100 | 97 | 0/0/0/1 |
| 11 | [majidmanzarpour/vibe-coding-starter-pack-3d-multiplayer](https://github.com/majidmanzarpour/vibe-coding-starter-pack-3d-multiplayer) | 99 | 100 | 97 | 0/0/0/1 |
| 12 | [CopilotKit/shadify](https://github.com/CopilotKit/shadify) | 96 | 96 | 97 | 0/0/1/1 |
| 13 | [Lostovayne/Complete-Clone-Lovable-AI](https://github.com/Lostovayne/Complete-Clone-Lovable-AI) | 96 | 100 | 88 | 0/0/0/7 |
| 14 | [davideast/stitch-mcp](https://github.com/davideast/stitch-mcp) | 96 | 100 | 87 | 0/0/1/3 |
| 15 | [mo-browser-apps/icons](https://github.com/mo-browser-apps/icons) | 96 | 100 | 88 | 0/0/0/8 |
| 16 | [shazzar00ni/cv-portfolio-hub](https://github.com/shazzar00ni/cv-portfolio-hub) | 96 | 100 | 85 | 0/0/0/9 |
| 17 | [emanueleielo/deepagents-open-lovable](https://github.com/emanueleielo/deepagents-open-lovable) | 95 | 100 | 83 | 0/0/2/3 |
| 18 | [hackice20/boltly](https://github.com/hackice20/boltly) | 95 | 93 | 100 | 0/1/0/0 |
| 19 | [koolkishan/lovable-clone-youtube-files](https://github.com/koolkishan/lovable-clone-youtube-files) | 95 | 100 | 84 | 0/0/4/0 |
| 20 | [shahsagarm/sagarshah.dev](https://github.com/shahsagarm/sagarshah.dev) | 95 | 93 | 100 | 0/1/0/0 |
| 21 | [Nutlope/twitterbio](https://github.com/Nutlope/twitterbio) | 94 | 93 | 97 | 0/1/0/2 |
| 22 | [chihebnabil/lovable-boilerplate](https://github.com/chihebnabil/lovable-boilerplate) | 93 | 93 | 93 | 0/1/0/4 |
| 23 | [nomaan5541/motionsites-prompt-collection](https://github.com/nomaan5541/motionsites-prompt-collection) | 93 | 100 | 76 | 0/0/17/0 |
| 24 | [DeadWaveWave/demo2apk](https://github.com/DeadWaveWave/demo2apk) | 91 | 100 | 69 | 0/0/4/5 |
| 25 | [paras-verma7454/bolt.new](https://github.com/paras-verma7454/bolt.new) | 88 | 85 | 95 | 0/2/1/1 |
| 26 | [przeprogramowani/ai-rules-builder](https://github.com/przeprogramowani/ai-rules-builder) | 88 | 100 | 61 | 0/0/7/6 |
| 27 | [antvis/GPT-Vis](https://github.com/antvis/GPT-Vis) | 87 | 100 | 55 | 0/0/13/7 |
| 28 | [sanidhyy/lovable-clone](https://github.com/sanidhyy/lovable-clone) | 84 | 85 | 83 | 0/2/2/5 |
| 29 | [Nutlope/ai-subtitles](https://github.com/Nutlope/ai-subtitles) | 81 | 78 | 87 | 0/5/0/5 |
| 30 | [khadgi-sujan/retune](https://github.com/khadgi-sujan/retune) | 81 | 93 | 52 | 0/1/7/10 |
| 31 | [nickqiaoo/chatcode](https://github.com/nickqiaoo/chatcode) | 80 | 81 | 79 | 0/1/1/10 |
| 32 | [gptme/gptme-webui](https://github.com/gptme/gptme-webui) | 78 | 78 | 77 | 0/3/2/6 |
| 33 | [lhz960904/code-artisan](https://github.com/lhz960904/code-artisan) | 78 | 78 | 78 | 0/2/4/2 |
| 34 | [PageAI-Pro/vibe-coding-starter](https://github.com/PageAI-Pro/vibe-coding-starter) | 77 | 93 | 40 | 0/1/8/29 |
| 35 | [Stijnus/bolt.diy_V2.0](https://github.com/Stijnus/bolt.diy_V2.0) | 77 | 78 | 74 | 0/3/2/11 |
| 36 | [freestyle-sh/Adorable](https://github.com/freestyle-sh/Adorable) | 77 | 78 | 76 | 0/9/3/4 |
| 37 | [e2b-dev/fragments](https://github.com/e2b-dev/fragments) | 73 | 63 | 97 | 0/5/0/1 |
| 38 | [dreamlit-ai/lovable-cloud-to-supabase-exporter](https://github.com/dreamlit-ai/lovable-cloud-to-supabase-exporter) | 70 | 77 | 52 | 0/1/24/9 |
| 39 | [lightningpixel/modly](https://github.com/lightningpixel/modly) | 70 | 78 | 52 | 0/2/6/14 |
| 40 | [tiann/hapi](https://github.com/tiann/hapi) | 70 | 78 | 52 | 0/10/83/121 |
| 41 | [vibe-stack/ggez](https://github.com/vibe-stack/ggez) | 70 | 78 | 52 | 0/5/122/79 |
| 42 | [TencentCloudBase/OpenVibeCoding](https://github.com/TencentCloudBase/OpenVibeCoding) | 68 | 75 | 52 | 1/1/49/41 |
| 43 | [opactorai/Claudable](https://github.com/opactorai/Claudable) | 64 | 70 | 51 | 0/43/9/14 |
| 44 | [allweonedev/presentation-ai](https://github.com/allweonedev/presentation-ai) | 63 | 78 | 28 | 0/2/96/77 |
| 45 | [cloudflare/vibesdk](https://github.com/cloudflare/vibesdk) | 59 | 70 | 34 | 0/6/17/74 |
| 46 | [dyad-sh/dyad](https://github.com/dyad-sh/dyad) | 55 | 63 | 36 | 0/10/56/207 |
| 47 | [cabloy/cabloy](https://github.com/cabloy/cabloy) | 54 | 55 | 52 | 0/27/490/54 |
| 48 | [fireproof-storage/fireproof](https://github.com/fireproof-storage/fireproof) | 54 | 55 | 52 | 0/7/12/23 |
| 49 | [lak7/devildev](https://github.com/lak7/devildev) | 52 | 63 | 28 | 0/8/29/43 |
| 50 | [zebbern/Devonz](https://github.com/zebbern/Devonz) | 47 | 55 | 28 | 0/10/26/77 |
| 51 | [we0-dev/we0](https://github.com/we0-dev/we0) | 46 | 40 | 61 | 0/8/3/12 |
| 52 | [halo-dev/upage](https://github.com/halo-dev/upage) | 44 | 48 | 34 | 0/14/10/30 |
| 53 | [scafoldr/scafoldr](https://github.com/scafoldr/scafoldr) | 44 | 33 | 69 | 0/21/4/5 |
| 54 | [wrtnlabs/autobe](https://github.com/wrtnlabs/autobe) | 44 | 40 | 52 | 0/16/75/32 |
| 55 | [kenlasko/monize](https://github.com/kenlasko/monize) | 40 | 35 | 52 | 0/24/328/392 |
| 56 | [react-native-vibe-code/react-native-vibe-code-sdk](https://github.com/react-native-vibe-code/react-native-vibe-code-sdk) | 34 | 37 | 28 | 1/9/105/54 |
| 57 | [fufankeji/VibeCodingCourse_v1](https://github.com/fufankeji/VibeCodingCourse_v1) | 31 | 22 | 52 | 8/57/9355/711 |
| 58 | [fufankeji/FuFan-VibeCodingCourse](https://github.com/fufankeji/FuFan-VibeCodingCourse) | 16 | 0 | 52 | 9/84/10059/736 |
| 59 | [refly-ai/refly](https://github.com/refly-ai/refly) | 16 | 0 | 52 | 0/11/114/141 |
| 60 | [sa4hnd/vibra-code](https://github.com/sa4hnd/vibra-code) | 16 | 0 | 52 | 34/115/864/286 |
| 61 | [ryantsai/KKTerm](https://github.com/ryantsai/KKTerm) | 12 | 5 | 28 | 40/30/44/206 |

## Methodology and honest limitations

- Sample: GitHub search for repos referencing AI app builders (lovable, bolt.new, v0.dev, "vibe coding", "ai-generated"), pushed after 2026-01-01, forks excluded. Self-selected sample; treat percentages as "of this sample", not "of all software".
- Scanner: Umbra v1.3.0, rubric v3 (static SAFE + CLEAN axes; RUNS/HONEST excluded because sandboxing 61 strangers' apps adds cost without changing the security picture).
- False positives happen. During this audit itself we found and fixed three of ours (SAFE rules firing inside test files and prompt templates; per-rule deduction caps; dead-exports over-reach) — that is why this report runs rubric v3. If your repo is listed and you believe a finding is wrong, open an issue; false positives are severity-one bugs for us, and we will re-run and correct publicly.
- A low score is not an accusation of malice. It means "worth a look", with the evidence one command away.

