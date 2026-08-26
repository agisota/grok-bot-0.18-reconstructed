export const SAND_INFERENCE_PROVIDERS = ["rox", "cursor", "claude-code", "codex", "openrouter"] as const;
export type SandInferenceProvider = (typeof SAND_INFERENCE_PROVIDERS)[number];
export const DEFAULT_SAND_INFERENCE_PROVIDER: SandInferenceProvider = "rox";
export const DEFAULT_ROX_BASE_URL = "https://api.rox.one/v1";
export const DEFAULT_ROX_MODEL = "gpt-5.6-luna";
export const LOCAL_ROX_AUTH_ID = "rox-local";

export interface SandInferenceRouterUsageProvider {
  readonly requests: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly lastUsedAt: string | null;
}

export interface SandInferenceRouterUsage {
  readonly schemaVersion: 1;
  readonly providers: Record<SandInferenceProvider, SandInferenceRouterUsageProvider>;
}

export function isSandInferenceProvider(value: unknown): value is SandInferenceProvider {
  return typeof value === "string" && (SAND_INFERENCE_PROVIDERS as readonly string[]).includes(value);
}

export function emptySandInferenceRouterUsage(): SandInferenceRouterUsage {
  const empty = (): SandInferenceRouterUsageProvider => ({ requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, lastUsedAt: null });
  return { schemaVersion: 1, providers: { rox: empty(), cursor: empty(), "claude-code": empty(), codex: empty(), openrouter: empty() } };
}
