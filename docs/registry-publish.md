# Publishing umbra-mcp to MCP registries and directories

This doc is the runbook for publishing the Umbra MCP server (`umbra-mcp`)
to the official MCP Registry, plus the Smithery and Glama directories.
Every step that needs the owner (elberacasa) is marked **[owner]**.

Repo prep already in place (committed):

- `server.json` at the repo root — validated against
  `https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json`.
- `"mcpName": "io.github.elberacasa/umbra"` in `package.json` — the official
  registry's npm ownership-verification marker. It must match `name` in
  `server.json` exactly.
- `umbra mcp` CLI subcommand — starts the same MCP server as the
  `umbra-mcp` bin. This exists because `npx @elberacasa/umbra` always runs the
  bin matching the package name (`umbra`, the scanner CLI); registries and
  MCP clients cannot select a secondary bin, so `server.json` passes `mcp` as
  a positional `packageArgument` (the same pattern Snyk uses in the official
  docs). The `umbra-mcp` bin keeps working unchanged.

## 1. Official MCP Registry (registry.modelcontextprotocol.io)

Prerequisite: the npm package must be republished with the changes above —
the currently published `1.1.0` has neither `mcpName` nor the `mcp`
subcommand, so registry validation and one-click installs would both fail.

1. **[owner]** Publish the new version to npm. `package.json` is bumped to
   `1.2.0`; `server.json` carries `1.2.0` in both `version` fields. All three
   must match. If you choose a different version, update all three first.

   ```bash
   npm publish            # prepublishOnly runs build + tests
   ```

   Verify: https://www.npmjs.com/package/@elberacasa/umbra shows the new
   version, and `npm view @elberacasa/umbra mcpName` prints
   `io.github.elberacasa/umbra`.

2. **[owner]** Install `mcp-publisher` (macOS):

   ```bash
   brew install mcp-publisher
   # or: curl -L "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_$(uname -s | tr '[:upper:]' '[:lower:]')_$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/').tar.gz" | tar xz mcp-publisher && sudo mv mcp-publisher /usr/local/bin/
   mcp-publisher --help
   ```

3. **[owner]** Authenticate with GitHub (device flow — needs your browser):

   ```bash
   mcp-publisher login github
   ```

   It prints a code and asks you to open https://github.com/login/device,
   enter the code, and authorize. GitHub auth is what grants the
   `io.github.elberacasa/` namespace — the server name must start with
   exactly that prefix.

4. **[owner]** Publish from the repo root (where `server.json` lives):

   ```bash
   mcp-publisher publish
   ```

   Expected: `✓ Successfully published ✓ Server io.github.elberacasa/umbra version 1.2.0`

5. Verify:

   ```bash
   curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.elberacasa/umbra"
   ```

Troubleshooting:

- `Registry validation failed for package` → the published npm version's
  `package.json` lacks `mcpName`, or it doesn't match `name` in
  `server.json`. Republish npm, then retry.
- `You do not have permission to publish this server` → you logged in with a
  GitHub account other than `elberacasa`.
- On every future release: bump `package.json` version, bump both `version`
  fields in `server.json`, `npm publish`, then `mcp-publisher publish` again.

## 2. Smithery.ai

Recon (2026-08-04): umbra is **not** indexed — `registry.smithery.ai` search
for "umbra" returns only unrelated servers.

Smithery no longer lists plain npm/stdio packages. Its publish flow
(https://smithery.ai/docs/build/publish) accepts only:

- **URL** — a hosted Streamable HTTP server (umbra-mcp is stdio-only, so this
  does not apply), or
- **Local (MCPB bundle)** — a pre-built `.mcpb` desktop-extension bundle.

**[owner]** Options:

1. Skip Smithery for now (recommended until/unless an MCPB bundle is built).
2. Build an MCPB bundle (`npx @anthropic-ai/mcpb init` in a temp dir,
   manifest command `npx` with args `["-y", "@elberacasa/umbra@1.2.0", "mcp"]`,
   then `npx @anthropic-ai/mcpb pack`), then:
   - Sign in at https://smithery.ai with GitHub.
   - Go to https://smithery.ai/new and complete the publishing flow with the
     `.mcpb` bundle (or CLI: `smithery mcp publish ./server.mcpb -n @elberacasa/umbra`).
   - Afterwards, open the server's **Settings → Verification** page to get
     verified.

## 3. Glama.ai

Recon (2026-08-04): umbra is **not** indexed — the only "umbra" on Glama is
an unrelated stealth-browser server (`lxchx/umbra`); nothing references
github.com/elberacasa/umbra.

**[owner]** Steps (all web UI):

1. Sign in at https://glama.ai with the `elberacasa` GitHub account.
2. Click **Add Server** and paste `https://github.com/elberacasa/umbra`.
   Glama crawls the repo and indexes tools/schemas (can take up to ~24h).
   Glama also syncs from the official MCP registry, so completing section 1
   may list it automatically — check
   https://glama.ai/mcp/servers?query=umbra before adding manually.
3. Claim ownership: because the repo sits under the personal `elberacasa`
   account (not an org), the GitHub sign-in from step 1 already associates
   you — open the server page and use the **Claim** flow if prompted.
   Optionally also commit a `glama.json` at the repo root
   (`{"$schema": "https://glama.ai/mcp/schemas/server.json", "maintainers": ["elberacasa"]}`)
   and re-run Claim to make ownership explicit and durable.

## Owner action checklist

1. `npm publish` (version 1.2.0 with `mcpName` + `umbra mcp` subcommand).
2. `brew install mcp-publisher` → `mcp-publisher login github` (browser) →
   `mcp-publisher publish` from the repo root → verify with the curl above.
3. Glama: sign in with GitHub, Add Server / Claim (after registry publish).
4. Smithery: skip, or build an MCPB bundle and publish via smithery.ai/new.
