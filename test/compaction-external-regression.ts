import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Regression: compaction performed by an EXTERNAL provider (e.g. OMO pins the
 * summarize to MiniMax-M3 via another HTTP provider) never sends the summary
 * request through this proxy. The old text-based summary detection therefore
 * never fires, the parked Claude bridge survives, and the next continuation
 * resumes the full pre-compaction CLI conversation (observed as ~780K cacheRead
 * that never shrinks — ses_f10e47816, 2026-09-30). The proxy must detect the
 * compaction boundary structurally: a normal-turn request whose message list is
 * SHORTER than the previous request for the same conversation means history was
 * rewritten (compacted by anyone) — reset the bridge and the foreign session.
 */

const dataHome = mkdtempSync(join(homedir(), "opencode-claude-data-"));
const claudeConfigDir = mkdtempSync(join(homedir(), "opencode-claude-config-"));
const oldSessionId = "old-claude-session";
const sessionKey = "external-compaction-regression";

mkdirSync(join(claudeConfigDir, "projects", "fixture"), { recursive: true });
writeFileSync(
  join(claudeConfigDir, "projects", "fixture", `${oldSessionId}.jsonl`),
  "",
  "utf8",
);

const previousDataHome = process.env.XDG_DATA_HOME;
const previousClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
process.env.XDG_DATA_HOME = dataHome;
process.env.CLAUDE_CONFIG_DIR = claudeConfigDir;

const { clearForeignSessionId, getForeignSessionId, setForeignSessionId } =
  await import("../src/session-store.ts");
const {
  getClaudeProxyBaseUrl,
  setClaudeQueryStarter,
  startProxy,
  stopProxy,
} = await import("../src/proxy.ts");

const resumes: Array<string | undefined> = [];
const prompts: Array<string | AsyncIterable<unknown>> = [];

setForeignSessionId(sessionKey, oldSessionId);
setClaudeQueryStarter(async (params) => {
  resumes.push(params.resume);
  prompts.push(params.prompt);
  return {
    stream: (async function* (): AsyncGenerator<unknown, void, unknown> {
      yield {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "ok" },
        },
      };
    })(),
    interrupt: async () => {},
    close: () => {},
    getPid: () => null,
  };
});

await startProxy();
try {
  const post = async (
    messages: Array<{ role: string; content: string }>,
  ): Promise<Response> =>
    fetch(`${getClaudeProxyBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-opencode-claude-session": sessionKey,
      },
      body: JSON.stringify({ model: "sonnet", stream: false, messages }),
    });

  // Turn 1: a normal grown conversation (3 messages).
  const grown = await post([
    { role: "user", content: "investigate the flashing terminals" },
    { role: "assistant", content: "found three flashing git spawns" },
    { role: "user", content: "pull the exact command lines" },
  ]);
  assert.equal(grown.status, 200);
  assert.deepEqual(resumes, [oldSessionId]);
  assert.equal(
    getForeignSessionId(sessionKey),
    oldSessionId,
    "pre-compaction turns keep the foreign session binding",
  );

  // External compaction happened (MiniMax-M3 via another provider): NO summary
  // request reaches this proxy. The next normal turn arrives with a SHORTER
  // message list (summary row + new user turn).
  const continuation = await post([
    { role: "assistant", content: "compacted work summary" },
    { role: "user", content: "continue after compaction" },
  ]);
  assert.equal(continuation.status, 200);

  assert.equal(
    getForeignSessionId(sessionKey),
    undefined,
    "a shrunken history must retire the old Claude session binding even when the summarize ran on another provider",
  );
  assert.deepEqual(
    resumes,
    [oldSessionId, undefined],
    "the post-compaction turn must start a fresh Claude session (no resume)",
  );

  const continuationPrompt = await firstPromptText(prompts[1]);
  assert.match(
    continuationPrompt,
    /<conversation_history>[\s\S]*compacted work summary[\s\S]*<\/conversation_history>/,
    "the fresh session must be seeded from the compacted message list",
  );

  // Equal-or-longer follow-ups must NOT reset again (stability).
  const followUp = await post([
    { role: "assistant", content: "compacted work summary" },
    { role: "user", content: "continue after compaction" },
    { role: "assistant", content: "ok" },
    { role: "user", content: "next step" },
  ]);
  assert.equal(followUp.status, 200);
} finally {
  setClaudeQueryStarter(null);
  await stopProxy();
  clearForeignSessionId(sessionKey);
  if (previousDataHome === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = previousDataHome;
  if (previousClaudeConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = previousClaudeConfigDir;
}

async function firstPromptText(prompt: string | AsyncIterable<unknown>): Promise<string> {
  if (typeof prompt === "string") return prompt;
  const next = await prompt[Symbol.asyncIterator]().next();
  return JSON.stringify(next.value);
}
