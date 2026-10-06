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

let bundle = "";
try {
  bundle = readFileSync(new URL("../dist/index.js", import.meta.url), "utf8");
  check("dist/index.js is readable", true);
} catch (error) {
  check("dist/index.js is readable", false);
  console.error(error instanceof Error ? error.message : String(error));
}
for (const marker of ["ExclusivePumpGate", "SerializedAsyncIterator"]) {
  check(`bundle contains ${marker}`, bundle.includes(marker));
}
for (const id of [
  "claude-fable-5-1", "claude-opus-5-5", "claude-opus-4-8",
  "claude-sonnet-5-5", "claude-sonnet-4-6", "fable", "opus", "sonnet",
]) {
  check(`bundle contains exact model ID ${id}`, bundle.includes(JSON.stringify(id)));
}
process.exitCode = failures ? 1 : 0;
