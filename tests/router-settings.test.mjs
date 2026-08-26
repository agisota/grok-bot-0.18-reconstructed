import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { transform } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const routerSourcePath = path.join(repoRoot, "frontend/src/recovered/features/settings/overlay/router.ts");

async function loadRouterModule() {
  const source = await readFile(routerSourcePath, "utf8");
  const { code: output } = await transform(source, { format: "esm", loader: "ts", target: "es2022" });
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

test("router provider preference defaults to ROX and round-trips every provider", async () => {
  const router = await loadRouterModule();
  assert.deepEqual(router.ROUTER_PROVIDERS.map(({ id }) => id), ["rox", "cursor", "claude-code", "codex", "openrouter"]);
  assert.equal(router.parseRouterProviderPreference(null), "rox");
  assert.equal(router.parseRouterProviderPreference("not-json"), "rox");
  assert.equal(router.parseRouterProviderPreference(JSON.stringify({ schemaVersion: 1, provider: "unknown" })), "rox");

  let stored = null;
  const persistence = {
    async read(key) {
      assert.equal(key, router.ROUTER_PROVIDER_PERSISTENCE_KEY);
      return stored;
    },
    async write(key, value) {
      assert.equal(key, router.ROUTER_PROVIDER_PERSISTENCE_KEY);
      stored = value;
    }
  };
  for (const provider of router.ROUTER_PROVIDERS) {
    await router.saveRouterProvider(persistence, provider.id);
    assert.equal(await router.loadRouterProvider(persistence), provider.id);
  }
});

test("ROX model selection defaults to gpt-5.6-luna with medium effort", async () => {
  const router = await loadRouterModule();
  assert.equal(router.DEFAULT_ROX_MODEL_ID, "gpt-5.6-luna");
  assert.equal(router.DEFAULT_ROX_REASONING_EFFORT, "medium");
  assert.deepEqual(router.ROX_REASONING_EFFORTS, ["none", "low", "medium", "high"]);
  assert.deepEqual(router.parseRoxModelSelection(null), { modelId: "gpt-5.6-luna", effort: "medium" });
  assert.deepEqual(router.parseRoxModelSelection({ modelId: "grok-4.6", effort: "high" }), { modelId: "grok-4.6", effort: "high" });
  assert.deepEqual(router.parseRoxModelSelection({ modelId: "  ", effort: "extreme" }), { modelId: "gpt-5.6-luna", effort: "medium" });
});

test("settings registry exposes Router with the native settings icon contract", async () => {
  const source = await readFile(path.join(repoRoot, "frontend/src/recovered/features/settings/overlay/view.tsx"), "utf8");
  assert.match(source, /\{ id: "router", label: "Router", icon: "git-branch" \}/);
});
