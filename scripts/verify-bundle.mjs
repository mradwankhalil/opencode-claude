import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
let failures = 0;
function check(name, passed) {
  console.log(`${passed ? "PASS" : "FAIL"} ${name}`);
  if (!passed) failures++;
}
function git(args) {
  return spawnSync("git", args, {
    cwd: root, encoding: "utf8", timeout: 10_000,
    env: { ...process.env, GIT_MASTER: "1" },
  });
}

const branch = git(["branch", "--show-current"]);
check("branch is v2/bundle-all", branch.status === 0 && branch.stdout.trim() === "v2/bundle-all");
check("d02d1fd is an ancestor of HEAD", git(["merge-base", "--is-ancestor", "d02d1fd", "HEAD"]).status === 0);

// Pass a path to check a staged bundle before it replaces the live one.
const bundlePath = process.argv[2] ?? new URL("../dist/index.js", import.meta.url);
let bundle = "";
try {
  bundle = readFileSync(bundlePath, "utf8");
  check("dist/index.js is readable", true);
} catch (error) {
  check("dist/index.js is readable", false);
  console.error(error instanceof Error ? error.message : String(error));
}
for (const marker of ["ExclusivePumpGate", "SerializedAsyncIterator", "registeredBaseUrl", "setSetupProbes", "parked-history-boundary-changed"]) {
  check(`bundle contains ${marker}`, bundle.includes(marker));
}
// provider-first: the provider registers before setup binds the proxy or probes the CLI.
const setupStart = bundle.indexOf("async setup(ctx)");
const providerAt = bundle.indexOf("ctx.provider.transform(", setupStart);
const proxyAt = bundle.indexOf("await acquireProxy()", setupStart);
const probeAt = bundle.indexOf("await probeCliPresence()", setupStart);
check(
  "setup registers the provider before the proxy bind and the CLI probe",
  setupStart >= 0 && providerAt > setupStart && providerAt < proxyAt && providerAt < probeAt,
);
for (const id of [
  "claude-fable-5-1", "claude-opus-5-5", "claude-opus-4-8",
  "claude-sonnet-5-5", "claude-sonnet-4-6", "fable", "opus", "sonnet",
]) {
  check(`bundle contains exact model ID ${id}`, bundle.includes(JSON.stringify(id)));
}
process.exitCode = failures ? 1 : 0;
