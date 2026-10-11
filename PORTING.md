# v2 bundle porting

Base: upstream **v1.3.8**, `d02d1fd`. Branch: `v2/bundle-all`.
The obsolete dryrun remains at `v2/dryrun-preserved` (`1a9a309`); do not modify it.

## Runtime delta (three commits)

1. Pump serialization: cherry-pick of `9db4544ff321080417426e771e44118abe4a8cfa`
   (`fix: serialize continuation pumps and close aborted turns`), upstream
   [PR #44](https://github.com/openchamber/opencode-claude/pull/44).
2. Always-on catalog: three family aliases and five bare 1M pins precede
   discovery (or fallback), deduplicated by ID with static entries winning.
   Discovery, caching, refresh and `[1m]` entries retain upstream behavior.

3. Provider-first setup (2026-10-11, incident "claude-code provider
   disconnected"): `setup` registers the provider and the `model.request`
   hook before it binds the proxy or probes the CLI, and one CLI presence
   answer (5 min, shared while pending) serves every location. OpenCode v2
   unloads every plugin ordered after a changed one and sets them up again
   while sessions keep stepping; the runner awaits plugin activation only when
   a drain starts, so a later step that resolved its model before this
   plugin's registration landed failed with
   `Model unavailable: claude-code/claude-opus-5-5`. Markers:
   `registeredBaseUrl`, `setSetupProbes`; fixture
   `test/setup-order-regression.ts`. This narrows the gap to the time the
   plugins ordered before this one need; the rest is OpenCode's
   (anomalyco/opencode, see the incident report) and the plugin order in
   `opencode.json`. Upstream candidate for openchamber/opencode-claude.

The verification commit contains regression coverage, build wiring and this doc.
PR #44 was **closed unmerged** (2026-10-06; maintainer: upstream's one-query-per-turn
architecture doesn't create concurrent pumps — but that rationale doesn't cover the
abort-signal handle leak, a single-lifecycle defect; issue #43 remains OPEN). The pump
cherry-pick is therefore a **permanent carry** alongside the catalog patch: keep it on
every rebase until upstream resolves #43. The catalog patch is an upstream issue
candidate, not yet filed. Carry the verification commit too.

## Native v2 model behavior

`Model.Info.variants` is an array of `{ id }` entries. Upstream exposes
`low`, `medium`, `high`, `xhigh`, `max`; its `model.request` hook encodes the
selected variant in the effort header. Keep this native mechanism, not the old
v1 variant object or `GENERATED_VARIANT_KEYS` suppression map.

Upstream `buildProviderModel` already maps every 1M context to a 900,000 input
limit and 128,000 output limit. No new input-limit field is needed in ClaudeModel.
The aliases resolve to `claude-fable-5-1`, `claude-opus-5-5`, and
`claude-sonnet-5-5` respectively. Unlike the historical fork's CLI-pass-through
family aliases, these explicit targets must be reviewed when the latest models
advance. Bare pins never drift.

## Updating

1. Fetch the new upstream tag; rebase/merge the two runtime delta commits onto
   it and carry the verification commit. Review conflicts; never discard a fix.
2. Run `bun install` if dependencies changed.
3. Run `bun run build`. It runs upstream TypeScript compilation/declaration
   generation, then bundles local modules into `dist/index.js` with external
   packages left external. `dist/` is ignored and must not be committed.
4. Run `node scripts/verify-bundle.mjs` (update the base check when porting).
5. Run each fixture, in Git Bash, with the host runtime flag cleared:

   ```bash
   OPENCHAMBER_RUNTIME= timeout 60 bun test/pump-gate-regression.ts
   OPENCHAMBER_RUNTIME= timeout 60 bun test/iterator-race-regression.ts
   OPENCHAMBER_RUNTIME= timeout 60 bun test/persistent-pump-concurrency-regression.ts
   OPENCHAMBER_RUNTIME= timeout 60 bun test/persistent-continuation-lifecycle-regression.ts
   OPENCHAMBER_RUNTIME= timeout 60 bun test/persistent-park-race-regression.ts
   OPENCHAMBER_RUNTIME= timeout 60 bun test/catalog-exposure-regression.ts
   OPENCHAMBER_RUNTIME= timeout 60 bun test/setup-order-regression.ts
   OPENCHAMBER_RUNTIME= timeout 85 bun test/run.ts
   ```

   Also run LSP diagnostics on changed TypeScript files. Only the documented
   Windows/POSIX fixture failures in `smoke.ts` and `cli-probes-regression.ts`
   are expected on this workstation; a catalog failure is never an exemption.
   **Never run `bun run build` while OpenChamber is running**: its prebuild
   deletes `dist/`, and OpenCode watches `dist/index.js`, so every open
   location unloads this plugin mid-build and running Claude sessions fail.
   Build a staged bundle instead (typecheck, bundle into
   `../opencode-claude-v2-staged/`, marker check, `lane.json` with commit and hash):

   ```bash
   node scripts/stage-bundle.mjs
   pwsh -NoProfile -File scripts/activate-staged.ps1 -Status   # exit 2 = staged, not active
   ```

   With OpenChamber fully closed, `pwsh -NoProfile -File scripts/activate-staged.ps1`
   backs up the live `dist/index.js` and swaps the staged one in; `-Rollback`
   restores the newest backup. It refuses to run while OpenChamber or opencode is up.
6. Only after those checks is the lane safe for a **user-controlled restart**.
   Then verify v2 `opencode models` exposes the bare pins. No restart, live
   Claude request, publish or push is part of this procedure's build phase.
