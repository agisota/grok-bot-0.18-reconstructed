export type SandBoxRuntime = "remote" | "local-docker" | "m4697";

export const DEFAULT_SAND_BOX_RUNTIME: SandBoxRuntime = "m4697";

export function isSandBoxRuntime(value: unknown): value is SandBoxRuntime {
  return value === "remote" || value === "local-docker" || value === "m4697";
}
