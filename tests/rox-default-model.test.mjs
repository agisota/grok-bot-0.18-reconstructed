import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadTs(entry) {
  const result = await build({
    absWorkingDir: repoRoot,
    bundle: true,
    entryPoints: [entry],
    format: "esm",
    outfile: "out.js",
    platform: "node",
    target: "es2022",
    write: false,
    packages: "external",
  });
  const code = result.outputFiles[0]?.text;
  assert.ok(code);
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

test("DEFAULT_ROX_MODEL and SAND_DEFAULT_MODEL_ID are gpt-5.6-luna with medium effort", async () => {
  const [router, model] = await Promise.all([
    readFile(path.join(repoRoot, "source/shared/inference-router.ts"), "utf8"),
    readFile(path.join(repoRoot, "source/shared/agents/agent-model.ts"), "utf8"),
  ]);
  assert.match(router, /export const DEFAULT_ROX_MODEL = "gpt-5.6-luna"/);
  assert.match(model, /export const SAND_DEFAULT_MODEL_ID = "gpt-5.6-luna"/);
  assert.match(model, /id: "effort", value: "medium"/);
  assert.doesNotMatch(model, /id: "fast"/);
});

test("new profiles persist default Luna model and keep unknown keys", async () => {
  const profile = await loadTs(path.join(repoRoot, "source/host/agents/agent-profile.ts"));
  const dir = await mkdtemp(path.join(tmpdir(), "sand-profile-"));
  const file = path.join(dir, "profile.json");
  try {
    profile.writeSandProfileFile(file, {
      name: "Grok",
      description: "",
      title: "",
      avatarShape: "",
      avatarColor: "",
    });
    const written = JSON.parse(await readFile(file, "utf8"));
    assert.equal(written.model.modelId, "gpt-5.6-luna");
    assert.equal(written.model.maxMode, true);
    assert.deepEqual(written.model.parameters, [{ id: "effort", value: "medium" }]);

    written.futureKey = "keep-me";
    await (await import("node:fs/promises")).writeFile(file, `${JSON.stringify(written, null, 2)}\n`);
    profile.writeSandProfileFile(file, {
      name: "Renamed",
      description: "ok",
      title: "",
      avatarShape: "",
      avatarColor: "",
    });
    const reread = profile.readSandProfileFile(file);
    const persisted = JSON.parse(await readFile(file, "utf8"));
    assert.equal(reread.name, "Renamed");
    assert.equal(reread.model.modelId, "gpt-5.6-luna");
    assert.equal(persisted.futureKey, "keep-me");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("listRoxModels and per-agent set/get honor Luna defaults", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "sand-data-"));
  process.env.SAND_DATA_ROOT = root;
  const mod = await loadTs(path.join(repoRoot, "source/host/agents/agent-rox-model.ts"));
  const profile = await loadTs(path.join(repoRoot, "source/host/agents/agent-profile.ts"));
  try {
    const catalog = await mod.listRoxModels({
      fetch: async (url) => {
        assert.equal(String(url), "https://api.rox.one/v1/models");
        return {
          ok: true,
          json: async () => ({ data: [{ id: "grok-4.6" }, { id: "gpt-5.6-terra" }] }),
        };
      },
    });
    assert.deepEqual(catalog.map((row) => row.id), ["gpt-5.6-luna", "grok-4.6", "gpt-5.6-terra"]);

    const agentId = "agent-luna-1";
    const agentDir = path.join(root, "agents", agentId);
    profile.writeSandProfileFile(path.join(agentDir, "profile.json"), {
      name: "Grok",
      description: "",
      title: "",
      avatarShape: "",
      avatarColor: "",
    });
    const unset = mod.getAgentRoxModel(agentId);
    assert.equal(unset.modelId, "gpt-5.6-luna");
    assert.equal(unset.effort, "medium");
    const saved = mod.setAgentRoxModel({ agentId, modelId: "gpt-5.6-terra", effort: "high" });
    assert.deepEqual(saved, { agentId, modelId: "gpt-5.6-terra", effort: "high" });
    assert.deepEqual(mod.getAgentRoxModel(agentId), saved);
    assert.equal(mod.resolveRoxModelSelection(agentId).modelId, "gpt-5.6-terra");
  } finally {
    delete process.env.SAND_DATA_ROOT;
    await rm(root, { recursive: true, force: true });
  }
});

test("ROX executor uses chat completions for Luna with medium reasoning", async () => {
  const providers = await readFile(path.join(repoRoot, "source/host/extensions/inference/provider-session.ts"), "utf8");
  assert.match(providers, /const model: LanguageModelV1 = client\.chat\(id\)/);
  assert.doesNotMatch(providers, /client\.responses\(id\)/);
  assert.match(providers, /providerOptions: \{ openai: \{ reasoning \} \}/);
  assert.match(providers, /resolveRoxModelSelection\(options\?\.agentId\)/);

  const patch = await readFile(path.join(repoRoot, "scripts/lib/router-renderer-patch.mjs"), "utf8");
  assert.match(patch, /title:"Model"/);
  assert.match(patch, /desktop\.agent\.listRoxModels\(\)/);
  assert.match(patch, /desktop\.agent\.setAgentRoxModel/);
  assert.match(patch, /aria-label":"ROX model"/);
  assert.match(patch, /aria-label":"Reasoning effort"/);
});
