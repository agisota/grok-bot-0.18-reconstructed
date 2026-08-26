import { execFile } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const ROX_AGENT_KEY_FILENAME = "rox-api-key";
export const ROX_AGENT_SECRET_PREFIX = "rox:";
export const OMNIROUTE_FALLBACK_SECRET = "OMNIROUTE_API_KEY";
export const ROX_MINT_HOST = "100.89.19.82";
export const ROX_MINT_LOOPBACK = "http://127.0.0.1:20128/api/keys";
export const ROX_MINT_PUBLIC_URL = "https://api.rox.one/api/keys";


export type MintRoxKeyFn = (name: string) => Promise<string>;

export interface RoxAgentKeyIo {
  getAgentDir?(agentId: string): string;
  readSecret?(key: string): string | null;
  writeSecret?(key: string, value: string): void | Promise<void>;
  mint?: MintRoxKeyFn;
}

let io: RoxAgentKeyIo = {};

export function setRoxAgentKeyIo(next: RoxAgentKeyIo): void {
  io = { ...io, ...next };
}

export function resetRoxAgentKeyIo(): void {
  io = {};
}

function assertSafeAgentId(agentId: string): string {
  const id = agentId.trim();
  if (id.length === 0 || id.includes("/") || id.includes("\\") || id.includes("\0") || id === "." || id === "..") {
    throw new Error("Invalid agent id");
  }
  return id;
}

function defaultAgentDir(agentId: string): string {
  const root = process.env.SAND_DATA_ROOT?.trim();
  return join(root && root.length > 0 ? root : join(homedir(), ".grokbot"), "agents", agentId);
}

function resolveAgentDir(agentId: string): string {
  const id = assertSafeAgentId(agentId);
  return io.getAgentDir?.(id) ?? defaultAgentDir(id);
}

export function getAgentRoxKeyPath(agentId: string): string {
  return join(resolveAgentDir(agentId), ROX_AGENT_KEY_FILENAME);
}

function readTrimmedFile(path: string): string | null {
  try {
    const value = readFileSync(path, "utf8").trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function readKeyFile(agentId: string): string | null {
  return readTrimmedFile(getAgentRoxKeyPath(agentId));
}

function defaultBoxSecretsPath(): string {
  const root = process.env.SAND_DATA_ROOT?.trim();
  return join(root && root.length > 0 ? root : join(homedir(), ".grokbot"), "box-secrets.json");
}

function readBoxSecret(key: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(defaultBoxSecretsPath(), "utf8")) as { secrets?: Record<string, unknown> };
    const value = parsed.secrets?.[key];
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  } catch {
    return null;
  }
}

function readSecret(key: string): string | null {
  const injected = io.readSecret?.(key);
  if (typeof injected === "string" && injected.trim().length > 0) return injected.trim();
  if (key === OMNIROUTE_FALLBACK_SECRET || key === "ROX_API_KEY") {
    const env = process.env[key]?.trim();
    if (env != null && env.length > 0) return env;
    return readBoxSecret(key);
  }
  return null;
}

function writeKeyFile(agentId: string, value: string): void {
  const dir = resolveAgentDir(agentId);
  mkdirSync(dir, { recursive: true });
  const path = getAgentRoxKeyPath(agentId);
  writeFileSync(path, value, { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
}

function upsertBoxFallback(value: string): void {
  if (readBoxSecret(OMNIROUTE_FALLBACK_SECRET) != null) return;
  const path = defaultBoxSecretsPath();
  let secrets: Record<string, string> = {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { secrets?: Record<string, unknown> };
    if (parsed.secrets != null && typeof parsed.secrets === "object" && !Array.isArray(parsed.secrets)) {
      for (const [key, item] of Object.entries(parsed.secrets)) {
        if (typeof item === "string") secrets[key] = item;
      }
    }
  } catch {
    secrets = {};
  }
  if ((secrets[OMNIROUTE_FALLBACK_SECRET] ?? "").trim().length > 0) return;
  secrets[OMNIROUTE_FALLBACK_SECRET] = value;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ version: 1, secrets }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  try { chmodSync(path, 0o600); } catch { /* ignore */ }
}

async function persistSecrets(agentId: string, value: string): Promise<void> {
  const write = io.writeSecret ?? writeDefaultSecret;
  await write(`${ROX_AGENT_SECRET_PREFIX}${agentId}`, value);
  if (readSecret(OMNIROUTE_FALLBACK_SECRET) == null) {
    await write(OMNIROUTE_FALLBACK_SECRET, value);
    upsertBoxFallback(value);
  }
}

async function writeDefaultSecret(key: string, value: string): Promise<void> {
  try {
    // Electron secure storage is unavailable in host-only/node test loads.
    const store = await import("../secrets/secret-store.js");
    await store.writeSecret(key, value);
  } catch {
    /* desktop secret store is optional outside Electron */
  }
}

export function resolveAgentRoxKey(agentId?: string): string | null {
  const id = agentId?.trim() || readActiveAgentId();
  if (id != null && id.length > 0) {
    const fromFile = readKeyFile(id);
    if (fromFile != null) return fromFile;
    const fromAgentSecret = readSecret(`${ROX_AGENT_SECRET_PREFIX}${id}`);
    if (fromAgentSecret != null) return fromAgentSecret;
  }
  return readSecret(OMNIROUTE_FALLBACK_SECRET) ?? readSecret("ROX_API_KEY");
}

function readActiveAgentId(): string | null {
  const root = process.env.SAND_DATA_ROOT?.trim();
  const agentsRoot = join(root && root.length > 0 ? root : join(homedir(), ".grokbot"), "agents");
  try {
    const parsed = JSON.parse(readFileSync(join(agentsRoot, "active-agent.json"), "utf8")) as { activeAgentId?: unknown };
    return typeof parsed.activeAgentId === "string" && parsed.activeAgentId.trim().length > 0 ? parsed.activeAgentId.trim() : null;
  } catch {
    return null;
  }
}

function liveMintDisabled(): boolean {
  return process.env.SAND_DISABLE_ROX_KEY_MINT === "1"
    || process.env.NODE_ENV === "test"
    || process.env.NODE_TEST_CONTEXT != null;
}

function extractMintedKey(payload: unknown): string | null {
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (payload == null || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  for (const key of ["key", "token", "apiKey", "api_key", "secret", "value"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  if (record.data != null) return extractMintedKey(record.data);
  return null;
}

async function managementAuth(): Promise<string | null> {
  const fromStore = readSecret(OMNIROUTE_FALLBACK_SECRET) ?? process.env.OMNIROUTE_API_KEY?.trim() ?? process.env.ROX_API_KEY?.trim() ?? null;
  if (fromStore != null && fromStore.length > 0) return fromStore;
  try {
    const { stdout } = await execFileAsync(join(homedir(), ".local", "bin", "hermes-rox-api-key"), [], { timeout: 15_000, encoding: "utf8" });
    const value = stdout.trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

async function mintViaPublicApi(name: string): Promise<string> {
  const auth = await managementAuth();
  if (auth == null) throw new Error("ROX management auth is unavailable");
  const response = await fetch(ROX_MINT_PUBLIC_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) throw new Error(`ROX key mint returned ${response.status}`);
  const minted = extractMintedKey(await response.json());
  if (minted == null) throw new Error("ROX key mint returned no key");
  return minted;
}

async function mintViaOmnirouteAdmin(name: string): Promise<string> {
  const remote = [
    "set -eu",
    "name=$1",
    "auth_file=",
    "for f in /root/hermes-rox-api-key /srv/omniroute/hermes-rox-api-key /srv/omniroute/.management-token /srv/omniroute/admin.token /srv/omniroute/data/management.token; do",
    "  if [ -s \"$f\" ]; then auth_file=$f; break; fi",
    "done",
    "if [ -z \"$auth_file\" ] && [ -x /srv/omniroute/bin/omniroute ]; then",
    "  /srv/omniroute/bin/omniroute keys create --name \"$name\" --json",
    "  exit 0",
    "fi",
    "if [ -z \"$auth_file\" ]; then echo '{\"error\":\"management-auth-missing\"}' >&2; exit 32; fi",
    "body=$(python3 -c 'import json,sys; print(json.dumps({\"name\": sys.argv[1]}))' \"$name\")",
    "auth=$(tr -d '\\n\\r' < \"$auth_file\")",
    "curl -sS --fail -X POST http://127.0.0.1:20128/api/keys -H 'Content-Type: application/json' -H \"Authorization: Bearer $auth\" --data-binary \"$body\"",
  ].join("\n");
  const { stdout } = await execFileAsync("ssh", [
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=8",
    "-o", "IdentitiesOnly=yes",
    "-i", join(homedir(), ".ssh", "rox"),
    `root@${ROX_MINT_HOST}`,
    "sh", "-s", "--", name,
  ], { input: remote, timeout: 20_000, encoding: "utf8", maxBuffer: 64 * 1024 });
  let parsed: unknown = stdout;
  try { parsed = JSON.parse(stdout); } catch { /* raw token */ }
  const minted = extractMintedKey(parsed);
  if (minted == null) throw new Error("ROX key mint returned no key");
  return minted;
}


async function defaultMint(name: string): Promise<string> {
  if (liveMintDisabled()) throw new Error("ROX key mint is disabled");
  try {
    return await mintViaPublicApi(name);
  } catch {
    return mintViaOmnirouteAdmin(name);
  }
}


export async function mintAgentRoxKey(agentId: string, name: string): Promise<string> {
  const id = assertSafeAgentId(agentId);
  const mint = io.mint ?? defaultMint;
  const value = (await mint(name.trim() || "Grok")).trim();
  if (value.length === 0) throw new Error("ROX key mint returned an empty key");
  writeKeyFile(id, value);
  await persistSecrets(id, value);
  return value;
}

export async function ensureAgentRoxKey(agentId: string, name = "Grok"): Promise<string | null> {
  const existing = readKeyFile(agentId);
  if (existing != null) return existing;
  try {
    return await mintAgentRoxKey(agentId, name);
  } catch {
    return resolveAgentRoxKey(agentId);
  }
}
