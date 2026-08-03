# Publishing Umbra to npm

## Package name decision

The unscoped `umbra` name is taken on npm (v0.3.0, unrelated project), and
`umbra-cli` is also taken. `umbra-scan` and `umbracli` were available, but we
chose the scoped name **`@elberacasa/umbra`** instead:

- Keeps the exact brand (`umbra`) — the installed binary is still `umbra`.
- `npx @elberacasa/umbra <path>` works fine; npx fully supports scopes.
- Leaves room for sibling packages under the same scope
  (e.g. `@elberacasa/umbra-action` later).

Verified available 2026-08-03 via `npm view @elberacasa/umbra` → 404.

## One-time setup

1. Make sure you have an npm account and are logged in:

   ```bash
   npm whoami        # should print your npm username
   npm login         # if not
   ```

2. The scope `@elberacasa` must match your npm username (or an org you own).
   `publishConfig.access` is already set to `public` in `package.json`, which
   is required for scoped packages.

## Publishing

From the repo root:

```bash
npm publish
```

That is the only command needed. The `prepublishOnly` script runs
`npm run build && npm test` automatically, so a broken build or failing test
suite aborts the publish before anything reaches the registry.

To inspect exactly what will ship before publishing:

```bash
npm pack --dry-run
```

The tarball must contain only `dist/`, `README.md`, `RUBRIC.md`, `LICENSE`,
and `package.json` — no `src/`, `tests/`, `fixtures/`, or `node_modules/`.

## Verify the published package

On a clean machine (or any directory outside this repo), against a known-bad
fixture checkout:

```bash
# CLI via npx — the primary distribution surface
npx @elberacasa/umbra --version
npx @elberacasa/umbra <path-to-some-repo>
npx @elberacasa/umbra <path> --json
npx @elberacasa/umbra <path> --offline

# Binary name check: after a global install the command is just `umbra`
npm install -g @elberacasa/umbra
umbra <path-to-some-repo>
```

Expected: a Trust Score verdict prints with per-axis scores and file:line
findings; exit code is `1` when the score is below 50 (`echo $?` to check).

## Versioning

Follow semver and keep the rubric contract in mind: scoring is deterministic
and versioned, so any rule or weight change is at least a minor bump. Bump the
version in `package.json`, then publish:

```bash
npm version patch   # or minor / major
npm publish
```
