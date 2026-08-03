# Umbra agent skills

Installable skills that make your AI coding agent verify its own work with
Umbra before shipping. Each skill is self-contained in its directory.

## umbra-trust-review

Run a Trust Score scan before committing, treat findings as blocking, fix
SAFE first, re-scan until clean.

**Install:**

- **Claude Code** — copy `umbra-trust-review/` into `~/.claude/skills/` (or
  `.claude/skills/` in the project for repo-scoped use).
- **Cursor** — copy `umbra-trust-review/SKILL.md` into `.cursor/rules/umbra-trust-review.mdc`
  and set its rule type to "Always" (or Agent Requested).
- **GitHub Copilot** — append the body of `umbra-trust-review/SKILL.md` to
  `.github/copilot-instructions.md`.
- **Windsurf** — append the body of `umbra-trust-review/SKILL.md` to
  `.windsurfrules` (or `.windsurf/rules/umbra.md`).
- **Any other agent** — paste the body of `SKILL.md` into its system prompt
  or context file. It is plain behavioral rules; no tool support required.

The skill invokes `npx @elberacasa/umbra .` (or a local build). Requires Node 20+.
