# The Immune Layer (v1.0)

Status: shipped. Where this doc disagrees with the implementation, the code
is the proof and the doc gets fixed.

Umbra started as a score you run after the agent finishes: scan the repo, get
0–100, fix what it finds. v1.0 moves Umbra from "scan on demand" to "guardrail
that runs between the agent and the codebase." Same engine, three surfaces.

## The hard architectural fact

Coding agents do not write files through MCP. Claude Code, Kimi Code, Cursor,
Windsurf, and the rest write with native tools (`Write`, `Edit`, `MultiEdit`)
that execute inside the harness, before any MCP server is consulted. An MCP
proxy therefore **cannot** intercept agent writes, and Umbra does not attempt
one. Any product claiming to "block bad agent writes over MCP" is either
proxying Bash (a different lane) or not blocking writes.

What *can* intercept writes is each harness's **hook layer**. Claude Code and
Kimi Code both fire a `PreToolUse` hook before a native tool runs: the hook
reads a JSON payload on stdin, and its exit code decides the outcome. That is
where Umbra sits.

## One engine, many adapters

The guard engine (`src/guard/`) is pure, deterministic, and harness-agnostic:

```ts
guardContent(filePath, content) -> GuardVerdict  // <50ms, zero network

interface GuardVerdict {
  decision: 'allow' | 'warn' | 'block';
  findings: Finding[];        // high/medium confidence only, ever
  pathViolation?: string;     // protected-path reason when applicable
}
```

Everything else is a thin adapter that speaks one harness's wire format into
the engine:

```
   proposed write (Write / Edit / MultiEdit)
        │
        ├── Claude Code PreToolUse hook ──┐
        ├── Kimi Code PreToolUse hook ────┤   per-CLI adapters:
        │                                 │   umbra guard --stdin
        │                                 ▼
        │                          guard engine (file-scope SAFE rules
        │                          + path guard, no network, no Docker)
        │                                 ▼
        │                          GuardVerdict: allow / warn / block
        │                                 ▼
        │                       exit 0 = allow   (warn prints a note)
        │                       exit 2 = block, stderr fed back to agent
        │
        └── MCP-native agents ── umbra-mcp tool: guard_content()
```

The stdin/exit-code contract is identical across CLI agents (verified against
Claude Code and Kimi Code docs, Aug 2026): JSON payload on stdin, exit 0
allows, exit 2 blocks with stderr fed back to the agent, anything else fails
open. `umbra guard --stdin` normalizes the small payload-shape differences
(`file_path` vs `path`, `content` vs `new_string` vs `edits[].new_string`) and
runs the same engine the MCP server exposes as `guard_content`.

The engine runs **file-scope** SAFE rules only. Repo-wide rules (dead
exports, duplication, RLS correlation) need the whole repo and stay out of
the hot path; they still run in scans. Guard verdicts are not scores; the
rubric is untouched and stays v2.

## Install: `umbra protect`

```bash
npx @elberacasa/umbra protect
```

`umbra protect` auto-detects installed CLI agents (binary on PATH and/or
config directory present) and idempotently installs a PreToolUse hook into
each one:

- **Claude Code**: `.claude/settings.json` in the project, or
  `~/.claude/settings.json` with `--global`. JSON merge with a
  `Write|Edit|MultiEdit` matcher; existing settings and hooks are preserved.
- **Kimi Code**: `~/.kimi-code/config.toml`. A marked `[[hooks]]` block
  (`event = "PreToolUse"`, matcher `^(Write|Edit|StrReplace.*|MultiEdit.*)$`,
  10s timeout) appended between marker comments so `--remove` deletes exactly
  our block and nothing else.

Flags: `--global` installs user-wide instead of per-project, `--agent <name>`
targets a single harness, `--remove` uninstalls. The hook command prefers an
installed `umbra` bin and falls back to
`npx --yes @elberacasa/umbra guard --stdin`. It never clobbers existing hooks
or config, and it prints exactly what it changed, per agent.

Not supported: Codex CLI (its PreToolUse intercepts Bash only, no file-write
tools, verified Aug 2026) and Cursor (hook schema unverified at design time).
The [skill](../skills/README.md) and the MCP server cover the agents hooks
cannot reach.

## The path guard

The path guard is always on, independent of content rules, because some
writes are dangerous no matter what they contain:

- Writes targeting `.git/hooks/**`, `.git/config`, or `**/.git/hooks/**` are
  **blocked outright**. Agents planting git hooks is a real sandbox escape
  (CVE-2026-26268): any hook the agent installs in `.git/hooks` later runs as
  the user, outside the harness's own guardrails.
- Writes to `.env*` that contain live-key patterns are blocked. The secrets
  rule already finds the key; the path guard makes a live credential landing
  in an env file unmissable rather than one finding in a list.

## Blocking policy

Only `critical`/`high` severity findings at `high` confidence can block a
write inline. Everything else is `warn`: a one-line stderr note, non-blocking.

This is deliberate and asymmetric. Umbra's zero-false-positive discipline
applies doubled in the inline path: a wrong score is a bug report, but a
wrong BLOCK interrupts someone's flow and gets Umbra uninstalled. When in
doubt, warn. Findings the guard emits are restricted to high/medium
confidence; low-confidence heuristics never reach the hook at all.

## Fail-open philosophy

`umbra guard` is designed to never break the agent's flow on its own account:

- Malformed payload, unknown tool, non-code file: exit 0, allow.
- Umbra's own errors (crash, timeout, unreadable config): fail OPEN with a
  one-line stderr note, exit 0, always.
- When the guard blocks, exit is 2 and stderr is a concise reason written for
  the agent: rule id, what matched, why it is dangerous, how to fix. Exit 2 +
  stderr is the most version-stable blocking contract; there is no stdout
  JSON schema dependency to drift.

The honest caveat: **hooks are a guardrail, not a sandbox.** A hook can
decline a write the agent asks for; it cannot confine the agent. An agent
determined to route around a guard (writing through Bash redirection,
splitting content to dodge a rule, asking you to uninstall the hook) is
outside what any hook layer can stop, which is exactly why the
[skill](../skills/umbra-trust-review/SKILL.md) instructs agents to treat an
`UMBRA BLOCKED` stderr as a hard stop and fix the root cause instead of
working around it. Belt and suspenders: the hook stops accidents, the skill
stops rationalization, and a post-hoc `umbra` scan plus the `--deep` sandbox
remain the final verdict on what actually shipped.

## The MCP server: `umbra-mcp`

For MCP-native agents that call tools voluntarily, Umbra ships a stdio MCP
server built on the official `@modelcontextprotocol/sdk`:

```json
{
  "mcpServers": {
    "umbra": {
      "command": "npx",
      "args": ["--yes", "-p", "@elberacasa/umbra", "umbra-mcp"]
    }
  }
}
```

Tools:

- `scan_repo(path, deep?)` — the full Trust Score report as JSON.
- `guard_content(file_path, content)` — the guard verdict for a proposed
  write, so an agent can self-check before writing.
- `get_score(path)` — the cached fast score only.

No daemon, no state; each call runs the same engine as the CLI. The MCP
server and the hooks are two adapters on one engine, which is the whole
point: however an agent reaches Umbra, it gets the same deterministic
verdict.

## What v1.0 is not

- Not an MCP proxy (impossible: agents do not write through MCP).
- Not a daemon, not Cursor hooks, not Bash-command guardrails (other tools
  own that lane).
- No scoring changes. Rubric stays v2; guard verdicts are not scores.
