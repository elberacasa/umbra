# umbra protect — the guardrail between your agent and your codebase

`umbra protect` installs Umbra's guard engine as a **PreToolUse hook** in your
CLI coding agents. From then on, every `Write` / `Edit` / `MultiEdit` the agent
attempts is piped through `umbra guard --stdin` before it lands on disk:
secrets, injection sinks, and writes to protected paths (like `.git/hooks/`)
are blocked; everything else flows through.

```bash
npx @elberacasa/umbra protect              # auto-detect agents, install
npx @elberacasa/umbra protect --global     # claude: user-level settings
npx @elberacasa/umbra protect --agent kimi # one agent only
npx @elberacasa/umbra protect --remove     # uninstall
```

Supported agents: **Claude Code** (`claude`) and **Kimi Code** (`kimi`).
Auto-detection looks for the binary on `PATH` and for the config directory
(`~/.claude`, `~/.kimi-code`). If nothing is detected, nothing is written —
use `--agent` to install anyway.

## What gets installed where

### Claude Code

- Project (default): `.claude/settings.json`
- Global (`--global`): `~/.claude/settings.json`

The file is merged as JSON — existing settings and hooks are preserved
byte-for-byte where JSON allows, and the umbra entry is one added matcher
group:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [
          { "type": "command", "command": "umbra guard --stdin" }
        ]
      }
    ]
  }
}
```

### Kimi Code

- Always: `~/.kimi-code/config.toml`

TOML is append-only (no parser dependency). The block is delimited by marker
comments so `--remove` deletes exactly what was added and nothing else:

```toml
# >>> umbra guard >>>
[[hooks]]
event = "PreToolUse"
matcher = "^(Write|Edit|MultiEdit)$"
command = "umbra guard --stdin"
timeout = 10
# <<< umbra guard <<<
```

### The guard command

If a global `umbra` binary is on `PATH`, hooks call `umbra guard --stdin`.
Otherwise they fall back to:

```
npx --yes @elberacasa/umbra guard --stdin
```

Both forms are detected on re-run, so `protect` is idempotent: a second run
changes nothing, and mixing forms (bin at work, npx at home) never produces
duplicate hooks.

## Uninstall

```bash
npx @elberacasa/umbra protect --remove
```

Removes the umbra entry from every supported config. Foreign hooks — including
hooks that share a matcher group with umbra's — are left exactly as they were.
For a conventionally formatted `settings.json` and any `config.toml`, the file
after install → remove is byte-identical to the original. If `config.toml` only
ever held the umbra block, the file is deleted.

## The honest caveat

Hooks **fail open by design**. If the guard command crashes, times out, or the
payload is malformed, the write is allowed and a note goes to stderr — a
guardrail that breaks your flow would be uninstalled within the hour. That
means `umbra protect` is a **guardrail, not a sandbox**: it catches the common,
deterministic cases (hardcoded keys, `.git/hooks` plants, obvious injection
sinks) with zero false-positive blocking, but it is not a security boundary
against a determined or compromised agent. For that, run the agent itself
inside a sandbox.

## Safety guarantees

- **Never clobbers.** Existing settings, hooks, and config survive install and
  uninstall untouched. Invalid JSON is skipped with a note, never "fixed".
- **Idempotent.** Running `protect` twice is a no-op.
- **No duplicates.** An existing umbra hook (either command form) is detected
  and left alone.
- **Blocking is conservative.** Only `critical`/`high` severity findings at
  `high` confidence block a write; everything else is a non-blocking warning.
