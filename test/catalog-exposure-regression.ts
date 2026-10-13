import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataHome = mkdtempSync(join(tmpdir(), "claude-catalog-exposure-"));
const previousDataHome = process.env.XDG_DATA_HOME;
process.env.XDG_DATA_HOME = dataHome;

try {
  const { getClaudeModels, setDiscoveredModels, modelsFromSdk, resolveClaudeModelId } =
    await import("../src/models.ts");
  const { buildClaudeProviderModels } = await import("../src/index.ts");
  const aliases = {
    fable: "claude-fable-5-1",
    opus: "claude-opus-5-5",
    sonnet: "claude-sonnet-5-5",
  } as const;
  const pins = [
    "claude-fable-5-1", "claude-opus-5-5", "claude-opus-4-8",
    "claude-sonnet-5-5", "claude-sonnet-4-6",
  ];
  const required = [...Object.keys(aliases), ...pins];

  // Given an empty, isolated cache; when loading the catalog before discovery.
  const initial = getClaudeModels();
  // Then every always-on entry is selectable, alongside upstream fallbacks.
  for (const id of required) {
    const entry = initial.find((model) => model.id === id);
    assert.ok(entry, `missing always-on model: ${id}`);
    assert.equal(entry.contextWindow, 1_000_000);
    assert.equal(entry.maxTokens, 128_000);
  }
  for (const [alias, concrete] of Object.entries(aliases)) {
    assert.equal(initial.find((model) => model.id === alias)?.resolvedId, concrete);
    assert.equal(resolveClaudeModelId(alias), concrete);
  }
  for (const id of ["claude-opus-5-5[1m]", "claude-fable-5-1[1m]", "claude-sonnet-5-5", "claude-sonnet-5", "claude-haiku-5-5", "claude-haiku-4-5", "claude-opus-4-8"]) {
    assert.ok(initial.some((model) => model.id === id), `missing fallback: ${id}`);
  }

  // Given catalog entries; when converting them to native v2 provider models.
  const providerModels = buildClaudeProviderModels(initial);
  // Then pins carry no input cap (upstream #48) and keep thinking choices without request settings.
  for (const id of required) {
    const entry = providerModels.find((model) => model.id === id);
    assert.ok(entry);
    assert.deepEqual(entry.limit, { context: 1_000_000, output: 128_000 });
    assert.deepEqual(entry.variants, ["low", "medium", "high", "xhigh", "max"].map((id) => ({ id })));
  }

  // Given discovery with no pins; when refreshing the catalog.
  const discovered = modelsFromSdk([{ value: "claude-haiku-4-5", supportedEffortLevels: [] }]);
  assert.equal(setDiscoveredModels(discovered), true);
  const refreshed = getClaudeModels();
  // Then discovery augments, rather than replaces, the always-on entries.
  for (const id of required) assert.ok(refreshed.some((model) => model.id === id));
  assert.deepEqual(refreshed.find((model) => model.id === "claude-haiku-4-5"), discovered[0]);
  assert.equal(refreshed.some((model) => model.id === "claude-sonnet-5[1m]"), false);

  // Given conflicting pins, aliases and repeated discovered IDs; when refreshing.
  const conflicts = [...required, "discovered-only", "discovered-only"].map((id) => ({
    id, name: "discovered override", reasoning: false, contextWindow: 200_000, maxTokens: 64_000,
  }));
  setDiscoveredModels(conflicts);
  const merged = getClaudeModels();
  // Then IDs are unique, static entries win, and new discovery is retained.
  assert.equal(new Set(merged.map((model) => model.id)).size, merged.length);
  for (const id of required) {
    assert.deepEqual(merged.find((model) => model.id === id), initial.find((model) => model.id === id));
  }
  assert.equal(merged.find((model) => model.id === "discovered-only")?.name, "discovered override");
  console.log("catalog-exposure-regression: PASS");
} finally {
  if (previousDataHome === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = previousDataHome;
  rmSync(dataHome, { recursive: true, force: true });
}
