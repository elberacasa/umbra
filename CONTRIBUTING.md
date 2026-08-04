# Contributing to Umbra

Issues and PRs welcome. The highest-value contributions right now:

- **New SAFE/CLEAN rules** with real evidence (file:line, no heuristics that
  can't point at code). Every rule needs a fixture under `fixtures/` and a
  test under `tests/`. Only high/medium confidence findings may move the
  score; low-confidence hunches go to notes.
- **False-positive reports.** A phantom finding in a viral screenshot is
  fatal, so these are treated as severity-one bugs.
- **Renders of Umbra against real AI-generated repos.** If it scored your
  repo wrong, that's a bug report we want.
- **Harness adapters** for `umbra protect` (new CLI agents with PreToolUse
  style hooks). The contract is one command: JSON payload on stdin, exit 0
  allow, exit 2 block with the reason on stderr, always fail open.

## Ground rules

- Zero false positives over everything. When in doubt, lower the confidence.
- The inline guard path (`guardContent`) must stay under 50ms and never do
  network I/O.
- Scoring changes require bumping `RUBRIC_VERSION` in `src/score/score.ts`
  and updating `RUBRIC.md`.
- No new runtime dependencies without a strong reason stated in the PR.

## Development

```bash
npm install
npm run build
npm test        # must stay green; Docker tests skip without a daemon
```

TypeScript runs strict (`noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`). Code must compile clean before a PR.
