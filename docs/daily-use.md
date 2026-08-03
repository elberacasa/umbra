# Daily use — make Umbra a habit, not a one-time scan

`umbra init` installs Umbra into a repository so the Trust Score is checked
on every commit and every pull request, not just the day you remember to run
it.

```sh
npx @elberacasa/umbra init          # install both hook and GitHub Action
npx @elberacasa/umbra init --hook   # pre-commit hook only
npx @elberacasa/umbra init --action # GitHub Action only
npx @elberacasa/umbra init --force  # refresh umbra-managed blocks/files
```

## Why scanning daily compounds

A one-time scan tells you the repo is in trouble. It does not tell you *when*
it got into trouble — and vibe-coded repos decay per commit, not per month.
The agent that added a Supabase client without RLS did it in one specific
commit; three weeks and forty commits later, that finding is buried under
everything built on top of it.

Running Umbra at commit time changes the economics:

- **The finding lands on the commit that introduced it.** The diff is still
  small, the author still has the context, and the fix is a five-minute edit
  instead of an archaeology project.
- **The score becomes a trend, not a snapshot.** A repo drifting 92 → 88 → 81
  is a different conversation than discovering a 61 during a release audit.
- **Determinism makes it safe to gate.** The same tree always produces the
  same score (rubric v1), so a pre-commit gate cannot flake. A blocked commit
  always comes with file:line evidence, never a hunch — low-confidence
  findings never affect the score.

## The three surfaces, compared

| | Pre-commit hook | GitHub Action | Agent skill (`skills/umbra-trust-review`) |
|---|---|---|---|
| **When it runs** | On your machine, before each commit | On every pull request | Inside your AI coding tool, on demand |
| **What it gates** | Your local commit | The merge | Nothing — it advises the agent |
| **Catches** | Findings in the code you're about to commit | Anything that slipped past local hooks (or `--no-verify`) | Problems *before* they're written, while the agent can still change course |
| **Setup** | `umbra init` (automatic) | `umbra init` (automatic) | Drop the skill into your agent's skill directory |
| **Offline** | Yes (`--offline` by default in the hook) | Optional (`offline: 'true'` input) | Yes |
| **Best for** | Fast feedback at the moment of introduction | Team-wide enforcement, PR evidence trail | Steering the agent, not just auditing it |

They compose: the skill keeps the agent from writing the problem, the hook
stops you from committing it, and the Action is the backstop that keeps the
main branch honest even when someone commits with `--no-verify`.

## What gets installed

### Pre-commit hook

- Repos using **husky** (a `.husky/` directory exists) get `.husky/pre-commit`.
- Plain git repos get `.git/hooks/pre-commit`.
- The hook runs `npx --yes @elberacasa/umbra . --offline` and blocks the
  commit only when the score is below 50 (exit code 1). A scanner failure
  (exit code 2) never blocks your work.
- If a `pre-commit` hook already exists, Umbra **appends** a clearly-marked
  block between `# >>> umbra trust score >>>` and `# <<< umbra trust score <<<`.
  Your existing hook is never touched. `--force` replaces only Umbra's own
  marked block.
- The hook file is made executable automatically.

### GitHub Action

`.github/workflows/umbra.yml` runs the published composite action
(`uses: elberacasa/umbra@v1`) on every pull request. It posts the score as a
PR comment, uploads the JSON report as an artifact, and fails the check below
`min-score` (default 50 — edit the `with:` block to change it). An existing
`umbra.yml` is never overwritten unless you pass `--force`.

## Uninstalling

Nothing here is hidden; removal is deleting exactly what was installed:

1. **Hook:** open `.husky/pre-commit` (or `.git/hooks/pre-commit`) and delete
   the block between the `# >>> umbra trust score >>>` and
   `# <<< umbra trust score <<<` markers. If Umbra created the whole file,
   delete the file.
2. **Action:** delete `.github/workflows/umbra.yml`.

To bypass the hook for a single commit without uninstalling:
`git commit --no-verify`.
