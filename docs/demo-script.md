# Demo script — the 25-second GIF

This narrates `demo/demo.tape` beat by beat, for whoever records or re-records
the launch GIF. Target: **under 25 seconds, 1200x600, dark terminal theme**.
The GIF loops, so it must end holding on the score — that frame is the
screenshot people share.

## Setup (before recording)

1. `npm run build` so the CLI is current.
2. Record from `demo/` inside the repo so the tape's relative paths resolve.
3. If `umbra` is not published to npm yet, swap the `npx @elberacasa/umbra .` line in the
   tape for `node $OLDPWD/dist/cli.js .` (noted in the tape itself).
4. Use the example app at `fixtures/bad-app` — a vibe-coded-looking Next.js
   app that scores 24/100. Do not "improve" it; the low score is the demo.
5. `cd demo && vhs demo.tape` produces `demo/demo.gif`. Verify it stays under
   ~2 MB; if not, re-encode with `--quality` or trim the final hold by 1s.

## Beats

| Time | On screen | Why |
|------|-----------|-----|
| 0:00–0:02 | Clean prompt, dark theme, nothing else. | Establishes "fresh terminal, no tricks." |
| 0:02–0:05 | `cd ../fixtures/bad-app`, then `ls` shows `app/ lib/ package.json`. | Looks like every AI-generated Next.js repo the viewer has ever received. No narration needed — recognition does the work. |
| 0:05–0:08 | `npx @elberacasa/umbra .` typed at human speed, brief pause before Enter. | The single command is the whole pitch. The pause reads as "watch this." |
| 0:08–0:20 | The verdict lands: **UMBRA TRUST SCORE: 24/100 🔴**, SAFE 0/100, CLEAN 81/100, then the top findings — Stripe live key at `.env:3`, Supabase service_role JWT at `.env:2` and `lib/supabase.ts:5`, service key reachable from client code. | This is the money shot: not a vague warning, specific findings with file:line evidence. Viewers should have time to read at least the first three findings. |
| 0:20–0:24 | Nothing moves. The score and the badge markdown line sit on screen. | The loop point. `Trust Score: 24/100 🔴` is the frame that ends up in tweets. |

## Voiceover / post copy (if used with sound or as a clip caption)

> "Everyone is vibecoding. Nobody is verifying. Umbra pointed at a repo an
> AI wrote in an afternoon: a live Stripe key committed to `.env`, a Supabase
> service_role key shipped to the browser — full database bypass for anyone
> who opens the bundle. One command, one score, every finding with file and
> line. `npx @elberacasa/umbra`."

## After recording

1. Drop `demo/demo.gif` into `demo/`.
2. In `README.md`, find the `DEMO GIF` comment block near the top, uncomment
   the `![Umbra scanning...](demo/demo.gif)` line, and delete nothing else —
   the specs stay for the next re-record.
3. Re-record whenever the verdict format changes; stale demo output in the
   README is a credibility bug.
