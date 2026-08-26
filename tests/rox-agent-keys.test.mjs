import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { transform } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modulePath = path.join(repoRoot, "source/electron-main/account/rox-agent-keys.ts");

async function loadKeysModule() {
  const source = await readFile(modulePath, "utf8");
  const { code } = await transform(source, { format: "esm", loader: "ts", target: "es2022" });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

test("mintAgentRoxKey writes a 0600 per-agent file and resolve prefers it", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "rox-agent-keys-"));
  const agentId = "agent-under-test";
  const agentDir = path.join(root, agentId);
  await mkdir(agentDir, { recursive: true });
  const secrets = new Map();
  let mintCalls = 0;
  const minted = "test-minted-key";
  const keys = await loadKeysModule();
  t.after(() => keys.resetRoxAgentKeyIo());
  keys.setRoxAgentKeyIo({
    getAgentDir: (id) => path.join(root, id),
    readSecret: (key) => secrets.get(key) ?? null,
    writeSecret: (key, value) => {
      secrets.set(key, value);
    },
    mint: async () => {
      mintCalls += 1;
      return minted;
    },
  });

  await keys.mintAgentRoxKey(agentId, "Grok");
  const keyPath = keys.getAgentRoxKeyPath(agentId);
  const info = await stat(keyPath);
  assert.equal(info.mode & 0o777, 0o600);
  assert.equal(await readFile(keyPath, "utf8"), minted);
  assert.equal(secrets.get(`rox:${agentId}`), minted);
  assert.equal(mintCalls, 1);

  secrets.set("OMNIROUTE_API_KEY", "global-fallback-key");
  assert.equal(keys.resolveAgentRoxKey(agentId), minted);

  await keys.ensureAgentRoxKey(agentId, "Grok");
  assert.equal(mintCalls, 1);
});

test("resolveAgentRoxKey falls back from missing file to per-agent then global secret", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "rox-agent-keys-"));
  const agentId = "existing-agent";
  await mkdir(path.join(root, agentId), { recursive: true });
  const secrets = new Map([
    ["OMNIROUTE_API_KEY", "global-fallback-key"],
    [`rox:${agentId}`, "per-agent-secret-key"],
  ]);
  const keys = await loadKeysModule();
  t.after(() => keys.resetRoxAgentKeyIo());
  keys.setRoxAgentKeyIo({
    getAgentDir: (id) => path.join(root, id),
    readSecret: (key) => secrets.get(key) ?? null,
    writeSecret: (key, value) => {
      secrets.set(key, value);
    },
    mint: async () => {
      throw new Error("live mint must not run in tests");
    },
  });

  assert.equal(keys.resolveAgentRoxKey(agentId), "per-agent-secret-key");
  secrets.delete(`rox:${agentId}`);
  assert.equal(keys.resolveAgentRoxKey(agentId), "global-fallback-key");
});

test("ensureAgentRoxKey lazy-mints when the agent file is missing", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "rox-agent-keys-"));
  const agentId = "legacy-agent";
  await mkdir(path.join(root, agentId), { recursive: true });
  const secrets = new Map();
  let mintCalls = 0;
  const keys = await loadKeysModule();
  t.after(() => keys.resetRoxAgentKeyIo());
  keys.setRoxAgentKeyIo({
    getAgentDir: (id) => path.join(root, id),
    readSecret: (key) => secrets.get(key) ?? null,
    writeSecret: (key, value) => {
      secrets.set(key, value);
    },
    mint: async () => {
      mintCalls += 1;
      return "lazy-minted-key";
    },
  });

  const resolved = await keys.ensureAgentRoxKey(agentId, "Legacy");
  assert.equal(resolved, "lazy-minted-key");
  assert.equal(mintCalls, 1);
  const info = await stat(keys.getAgentRoxKeyPath(agentId));
  assert.equal(info.mode & 0o777, 0o600);
});

test("createAgent and createSession hook ensureAgentRoxKey after the agent directory exists", async () => {
  const lifecycle = await readFile(path.join(repoRoot, "source/host/extensions/transcript/agent-lifecycle.ts"), "utf8");
  const session = await readFile(path.join(repoRoot, "source/host/extensions/session/agent-session.ts"), "utf8");
  const materialization = await readFile(path.join(repoRoot, "source/host/extensions/session/session-materialization.ts"), "utf8");
  const provider = await readFile(path.join(repoRoot, "source/host/extensions/inference/provider-session.ts"), "utf8");
  assert.match(lifecycle, /ensureAgentRoxKey\(/);
  assert.match(session, /ensureAgentRoxKey\(/);
  assert.match(materialization, /ensureAgentRoxKey\(/);
  assert.match(provider, /resolveAgentRoxKey\(/);
  assert.doesNotMatch(lifecycle, /sk-[A-Za-z0-9]{8,}|rox_[A-Za-z0-9]{8,}/);
  assert.doesNotMatch(session, /sk-[A-Za-z0-9]{8,}|rox_[A-Za-z0-9]{8,}/);
});

test("default mint is not used when a fake mint is injected", async () => {
  const source = await readFile(modulePath, "utf8");
  assert.match(source, /NODE_TEST_CONTEXT|SAND_DISABLE_ROX_KEY_MINT/);
  assert.match(source, /export async function mintAgentRoxKey/);
  assert.match(source, /export function resolveAgentRoxKey/);
  assert.doesNotMatch(source, /sk-[A-Za-z0-9]{8,}|rox_[A-Za-z0-9]{8,}|omni_[A-Za-z0-9]{8,}/);
});
