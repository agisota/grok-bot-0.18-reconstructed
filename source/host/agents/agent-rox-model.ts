import { readFileSync } from "node:fs";
import { join } from "node:path";

import { SAND_DEFAULT_MODEL_SELECTION } from "../../shared/agents/agent-model.js";
import { isSandAgentModelSelection, type SandAgentModelSelection } from "../../shared/agents/sand-agent-model.js";
import { DEFAULT_ROX_BASE_URL, DEFAULT_ROX_MODEL } from "../../shared/inference-router.js";
import { SandSettingsStore } from "../../shared/node/settings/sand-settings-store.js";
import { getSandRootDir } from "../host-paths.js";
import { getSandAgentsRootDir, resolveSandAgentDir } from "../storage/agent-paths.js";
import { getSandProfilePath, readSandProfileFile, writeSandProfileFile } from "./agent-profile.js";

export const ROX_REASONING_EFFORTS = ["none", "low", "medium", "high"] as const;
export type RoxReasoningEffort = (typeof ROX_REASONING_EFFORTS)[number];
export const DEFAULT_ROX_REASONING_EFFORT: RoxReasoningEffort = "medium";

export function isRoxReasoningEffort(value: unknown): value is RoxReasoningEffort {
  return typeof value === "string" && (ROX_REASONING_EFFORTS as readonly string[]).includes(value);
}

export function effortFromSelection(selection: SandAgentModelSelection | undefined): RoxReasoningEffort {
  const value = selection?.parameters.find((parameter) => parameter.id === "effort")?.value;
  return isRoxReasoningEffort(value) ? value : DEFAULT_ROX_REASONING_EFFORT;
}

export function selectionFromRoxModel(modelId: string, effort: RoxReasoningEffort = DEFAULT_ROX_REASONING_EFFORT): SandAgentModelSelection {
  return {
    modelId,
    maxMode: true,
    parameters: effort === "none" ? [] : [{ id: "effort", value: effort }],
  };
}

export function defaultRoxModelSelection(): SandAgentModelSelection {
  return {
    modelId: DEFAULT_ROX_MODEL,
    maxMode: SAND_DEFAULT_MODEL_SELECTION.maxMode,
    parameters: [{ id: "effort", value: DEFAULT_ROX_REASONING_EFFORT }],
  };
}

export function readActiveAgentId(rootDir = getSandAgentsRootDir()): string | null {
  try {
    const parsed = JSON.parse(readFileSync(join(rootDir, "active-agent.json"), "utf8")) as { activeAgentId?: unknown };
    return typeof parsed.activeAgentId === "string" && parsed.activeAgentId.length > 0 ? parsed.activeAgentId : null;
  } catch {
    return null;
  }
}

export function resolveRoxModelSelection(agentId?: string | null): SandAgentModelSelection {
  const id = typeof agentId === "string" && agentId.trim().length > 0 ? agentId.trim() : readActiveAgentId();
  if (id != null) {
    try {
      const profile = readSandProfileFile(getSandProfilePath(resolveSandAgentDir(id)));
      if (isSandAgentModelSelection(profile?.model)) return profile.model;
    } catch {
      // Invalid or missing agent ids fall through to settings / default.
    }
  }
  const stored = new SandSettingsStore(join(getSandRootDir(), "settings.json")).getAgentDefaultModel();
  return stored ?? defaultRoxModelSelection();
}

export function getAgentRoxModel(agentId?: string | null): { agentId: string | null; modelId: string; effort: RoxReasoningEffort } {
  const id = typeof agentId === "string" && agentId.trim().length > 0 ? agentId.trim() : readActiveAgentId();
  const selection = resolveRoxModelSelection(id);
  return { agentId: id, modelId: selection.modelId, effort: effortFromSelection(selection) };
}

export function setAgentRoxModel(args: { agentId?: string | null; modelId: string; effort?: RoxReasoningEffort }): { agentId: string; modelId: string; effort: RoxReasoningEffort } {
  const id = typeof args.agentId === "string" && args.agentId.trim().length > 0 ? args.agentId.trim() : readActiveAgentId();
  if (id == null) throw new Error("No agent is selected.");
  const modelId = args.modelId.trim();
  if (modelId.length === 0) throw new Error("A model id is required.");
  const effort = args.effort ?? DEFAULT_ROX_REASONING_EFFORT;
  if (!isRoxReasoningEffort(effort)) throw new Error("Unknown reasoning effort.");
  const path = getSandProfilePath(resolveSandAgentDir(id));
  const current = readSandProfileFile(path);
  if (current == null) throw new Error("Agent profile is missing.");
  const model = selectionFromRoxModel(modelId, effort);
  writeSandProfileFile(path, { ...current, model });
  return { agentId: id, modelId, effort };
}

function catalogIds(payload: unknown): { id: string }[] {
  const record = typeof payload === "object" && payload != null && !Array.isArray(payload) ? payload as Record<string, unknown> : null;
  const rows = Array.isArray(payload) ? payload : Array.isArray(record?.data) ? record.data : Array.isArray(record?.models) ? record.models : [];
  const ids: { id: string }[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    let id = "";
    if (typeof row === "string") id = row.trim();
    else if (typeof row === "object" && row != null && "id" in row && typeof row.id === "string") id = row.id.trim();
    if (id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    ids.push({ id });
  }
  return ids;
}

export async function listRoxModels(options?: { fetch?: typeof fetch; apiKey?: string; signal?: AbortSignal }): Promise<{ id: string }[]> {
  const apiKey = options?.apiKey?.trim() || process.env.OMNIROUTE_API_KEY?.trim() || process.env.ROX_API_KEY?.trim() || "";
  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey.length > 0) headers.Authorization = `Bearer ${apiKey}`;
  const response = await (options?.fetch ?? fetch)(`${DEFAULT_ROX_BASE_URL}/models`, { headers, ...(options?.signal == null ? {} : { signal: options.signal }) });
  if (!response.ok) throw new Error(`ROX models catalog returned ${response.status}.`);
  const ids = catalogIds(await response.json());
  if (ids.some((model) => model.id === DEFAULT_ROX_MODEL)) return ids;
  return [{ id: DEFAULT_ROX_MODEL }, ...ids];
}
