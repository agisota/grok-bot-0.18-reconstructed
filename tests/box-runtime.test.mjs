import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { transform } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadBoxRuntime() {
  const source = await readFile(path.join(repoRoot, "source/shared/box-runtime.ts"), "utf8");
  const { code: output } = await transform(source, { format: "esm", loader: "ts", target: "es2022" });
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

test("default sandbox runtime is m4697 and the type guard accepts it", async () => {
  const runtime = await loadBoxRuntime();
  assert.equal(runtime.DEFAULT_SAND_BOX_RUNTIME, "m4697");
  assert.equal(runtime.isSandBoxRuntime("m4697"), true);
  assert.equal(runtime.isSandBoxRuntime("remote"), true);
  assert.equal(runtime.isSandBoxRuntime("local-docker"), true);
  assert.equal(runtime.isSandBoxRuntime("cursor"), false);
});

test("m4697 host connector publishes the tailnet gateway and remote runtime mounts", async () => {
  const connector = await readFile(path.join(repoRoot, "source/electron-main/box/m4697-host-connector.ts"), "utf8");
  const routed = await readFile(path.join(repoRoot, "source/electron-main/box/local-docker-host-connector.ts"), "utf8");
  const mainEdge = await readFile(path.join(repoRoot, "source/electron-main/main-edge.ts"), "utf8");
  assert.match(connector, /export const M4697_BOX_CONTAINER = "grok-bot-m4697-vm"/);
  assert.match(connector, /export const M4697_GATEWAY_URL = "http:\/\/100\.89\.19\.82:1340"/);
  assert.match(connector, /com\.grok-bot\.m4697-vm=1/);
  assert.match(connector, /m4697-box\.json/);
  assert.match(connector, /schemaVersion: 1, token/);
  assert.match(connector, /SAND_GATEWAY_TOKEN=\$\{token\}/);
  assert.match(connector, /"100\.89\.19\.82:1340:1340"/);
  assert.match(connector, /src=\/opt\/grok-bot-box\/runtime\/host-main\.cjs,dst=\/home\/box\/sand-host\/host-main\.cjs,readonly/);
  assert.match(connector, /src=\/opt\/grok-bot-box\/runtime\/box-exec-daemon,dst=\/home\/box\/box-exec-daemon,readonly/);
  assert.match(connector, /BatchMode=yes/);
  assert.match(connector, /IdentitiesOnly=yes/);
  assert.match(connector, /root@100\.89\.19\.82/);
  assert.match(connector, /\.ssh", "rox"/);
  assert.doesNotMatch(connector, /173\.212\.222\.197/);
  assert.doesNotMatch(connector, /0\.0\.0\.0:\d+:\d+/);
  assert.doesNotMatch(connector, /homedir\(\).*\/\.codex/);
  assert.match(routed, /getBoxRuntime\(\) === "m4697" \? await startM4697Box/);
  assert.match(mainEdge, /mode === "m4697"\) await startM4697Box\(settingsPath\)/);
  assert.match(mainEdge, /mode !== "m4697"\) await stopM4697Box\(\)/);
});
