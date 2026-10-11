// Builds the bundle beside the checkout instead of into dist/. OpenCode watches
// dist/index.js, and `bun run build` deletes dist/ first, so building in place
// unloads this plugin in every open location and fails running Claude sessions.
// Run: node scripts/stage-bundle.mjs   (then scripts/activate-staged.ps1 with OpenChamber closed)
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const staged = join(root, "..", "opencode-claude-v2-staged");
const outfile = join(staged, "dist", "index.js");
const windows = process.platform === "win32";

function run(label, command, args) {
  const result = spawnSync(command, args, {
    cwd: root, encoding: "utf8", timeout: 120_000, shell: windows,
    env: { ...process.env, GIT_MASTER: "1" },
  });
  const ok = result.status === 0;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (!ok) {
    process.stdout.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    process.exit(1);
  }
  return (result.stdout ?? "").trim();
}

mkdirSync(join(staged, "dist"), { recursive: true });
const dirty = run("git status", "git", ["status", "--porcelain"]);
if (dirty) {
  console.log("FAIL working tree is clean (commit first, so the staged bundle names a commit)");
  console.log(dirty);
  process.exit(1);
}
console.log("PASS working tree is clean");
run("typecheck", "bun", ["x", "tsc", "-p", "tsconfig.json", "--noEmit"]);
run("bundle", "bun", ["build", "src/index.ts", "--target=node", "--packages=external", `--outfile=${outfile}`]);
run("staged bundle markers", process.execPath, ["scripts/verify-bundle.mjs", outfile]);

const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const lane = {
  builtUtc: new Date().toISOString(),
  commit: run("git rev-parse", "git", ["rev-parse", "HEAD"]),
  branch: run("git branch", "git", ["branch", "--show-current"]),
  staged: outfile,
  stagedSha256: sha256(outfile),
  live: join(root, "dist", "index.js"),
  liveSha256AtBuild: sha256(join(root, "dist", "index.js")),
};
writeFileSync(join(staged, "lane.json"), `${JSON.stringify(lane, null, 2)}\n`);
console.log(`staged ${lane.stagedSha256.slice(0, 12)} from ${lane.commit.slice(0, 7)} -> ${outfile}`);
console.log(lane.stagedSha256 === lane.liveSha256AtBuild ? "live bundle already matches" : "NOT ACTIVE: run scripts/activate-staged.ps1 with OpenChamber closed");
