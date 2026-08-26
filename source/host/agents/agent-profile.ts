import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { SAND_DEFAULT_MODEL_SELECTION } from "../../shared/agents/agent-model.js";
import { isSandAgentModelSelection, type SandAgentModelSelection } from "../../shared/agents/sand-agent-model.js";

export const SAND_PROFILE_FILENAME = "profile.json";

export interface SandAgentProfile {
  name: string;
  description: string;
  title: string;
  avatarShape: string;
  avatarColor: string;
  model?: SandAgentModelSelection;
}

export function getSandProfilePath(agentDir: string): string { return join(agentDir, SAND_PROFILE_FILENAME); }

function parseProfileJson(path: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch { return null; }
}

function cloneModel(value: unknown): SandAgentModelSelection | undefined {
  if (!isSandAgentModelSelection(value)) return undefined;
  return {
    modelId: value.modelId,
    maxMode: value.maxMode,
    parameters: value.parameters.map((parameter) => ({ id: parameter.id, value: parameter.value })),
  };
}

function defaultModel(): SandAgentModelSelection {
  return {
    modelId: SAND_DEFAULT_MODEL_SELECTION.modelId,
    maxMode: SAND_DEFAULT_MODEL_SELECTION.maxMode,
    parameters: SAND_DEFAULT_MODEL_SELECTION.parameters.map((parameter) => ({ id: parameter.id, value: parameter.value })),
  };
}

export function readSandProfileFile(path: string): SandAgentProfile | null {
  const parsed = parseProfileJson(path);
  if (parsed == null) return null;
  const model = cloneModel(parsed.model);
  return {
    name: typeof parsed.name === "string" ? parsed.name : "",
    description: typeof parsed.description === "string" ? parsed.description : "",
    title: typeof parsed.title === "string" ? parsed.title.trim() : "",
    avatarShape: typeof parsed.avatarShape === "string" ? parsed.avatarShape.trim() : "",
    avatarColor: typeof parsed.avatarColor === "string" ? parsed.avatarColor.trim() : "",
    ...(model == null ? {} : { model }),
  };
}

export function readLegacyProfileAvatarField(path: string): string | null {
  const avatar = parseProfileJson(path)?.avatar;
  if (typeof avatar !== "string") return null;
  const trimmed = avatar.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function writeSandProfileFile(path: string, profile: SandAgentProfile): void {
  mkdirSync(dirname(path), { recursive: true });
  const existing = parseProfileJson(path) ?? {};
  const incoming = profile as SandAgentProfile & Record<string, unknown>;
  const model = cloneModel(profile.model) ?? cloneModel(existing.model) ?? defaultModel();
  const known: Record<string, unknown> = {
    name: profile.name,
    description: profile.description,
    title: profile.title.trim(),
    avatarShape: profile.avatarShape.trim(),
    avatarColor: profile.avatarColor.trim(),
    model,
  };
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(existing)) {
    if (key in known) continue;
    extra[key] = value;
  }
  for (const [key, value] of Object.entries(incoming)) {
    if (key in known) continue;
    extra[key] = value;
  }
  const serialized = `${JSON.stringify({ ...extra, ...known }, null, 2)}\n`;
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, serialized, "utf8");
  renameSync(temporary, path);
}
