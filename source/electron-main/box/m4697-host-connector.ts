import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { RecreateResult } from "./box-recreate-commands.js";
import type { GatewayConnection } from "./gateway-descriptor-cache.js";

export const M4697_BOX_IMAGE = "public.ecr.aws/k0i0n2g5/cursorenvironments/universal:sand-box-latest";
export const M4697_BOX_CONTAINER = "grok-bot-m4697-vm";
export const M4697_GATEWAY_HOST = "100.89.19.82";
export const M4697_GATEWAY_URL = "http://100.89.19.82:1340";
export const M4697_OWNER_LABEL = "com.grok-bot.m4697-vm=1";
export const M4697_SCHEMA_VERSION = "6";
export const M4697_SSH_IDENTITY = join(homedir(), ".ssh", "rox");
export const M4697_SSH_TARGET = "root@100.89.19.82";
export const M4697_HOST_MAIN_PATH = "/opt/grok-bot-box/runtime/host-main.cjs";
export const M4697_BOX_EXEC_DAEMON_DIR = "/opt/grok-bot-box/runtime/box-exec-daemon";
const READY_TIMEOUT_MS = 180_000;
const TOKEN_FILE_NAME = "m4697-box.json";

export interface M4697Status {
  readonly available: boolean;
  readonly running: boolean;
  readonly ready: boolean;
  readonly containerName: string;
  readonly image: string;
  readonly detail: string;
}

interface CommandResult { readonly ok: boolean; readonly output: string }

function runRemoteDocker(args: readonly string[]): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn("ssh", [
      "-o", "BatchMode=yes",
      "-o", "IdentitiesOnly=yes",
      "-i", M4697_SSH_IDENTITY,
      M4697_SSH_TARGET,
      "docker",
      ...args,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const append = (chunk: Buffer): void => { output += chunk.toString(); if (output.length > 200_000) output = output.slice(-200_000); };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    child.once("error", (error) => resolve({ ok: false, output: `${output}\n${error.message}`.trim() }));
    child.once("close", (code) => resolve({ ok: code === 0, output: output.trim() }));
  });
}

function credentialPath(settingsPath: string): string {
  return join(dirname(settingsPath), TOKEN_FILE_NAME);
}

async function readOrCreateToken(settingsPath: string): Promise<string> {
  const target = credentialPath(settingsPath);
  try {
    const parsed = JSON.parse(await readFile(target, "utf8")) as { token?: unknown };
    if (typeof parsed.token === "string" && parsed.token.length >= 32) return parsed.token;
  } catch {}
  const token = randomBytes(32).toString("hex");
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify({ schemaVersion: 1, token }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(target, 0o600);
  return token;
}

async function gatewayReady(token: string): Promise<boolean> {
  try {
    const response = await fetch(`${M4697_GATEWAY_URL}/health`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch { return false; }
}

async function inspectContainer(): Promise<{ exists: boolean; running: boolean; owned: boolean; image: string }> {
  const result = await runRemoteDocker(["inspect", "--format", "{{json .}}", M4697_BOX_CONTAINER]);
  if (!result.ok) return { exists: false, running: false, owned: false, image: "" };
  try {
    const value = JSON.parse(result.output) as { State?: { Running?: unknown }; Config?: { Image?: unknown; Labels?: Record<string, unknown> } };
    return {
      exists: true,
      running: value.State?.Running === true,
      owned: value.Config?.Labels?.["com.grok-bot.m4697-vm"] === "1",
      image: typeof value.Config?.Image === "string" ? value.Config.Image : "",
    };
  } catch { throw new Error("m4697 Docker returned malformed container inspection data."); }
}

export async function getM4697Status(settingsPath: string): Promise<M4697Status> {
  const token = await readOrCreateToken(settingsPath);
  if (await gatewayReady(token)) {
    return { available: true, running: true, ready: true, containerName: M4697_BOX_CONTAINER, image: M4697_BOX_IMAGE, detail: "m4697 VM is ready." };
  }
  const daemon = await runRemoteDocker(["info", "--format", "{{.ServerVersion}}"]).catch(() => ({ ok: false, output: "m4697 SSH/Docker is unavailable." }));
  if (!daemon.ok) return { available: false, running: false, ready: false, containerName: M4697_BOX_CONTAINER, image: M4697_BOX_IMAGE, detail: daemon.output || "m4697 SSH/Docker is unavailable." };
  const inspected = await inspectContainer();
  if (!inspected.exists) return { available: true, running: false, ready: false, containerName: M4697_BOX_CONTAINER, image: M4697_BOX_IMAGE, detail: "Ready to create the m4697 VM." };
  if (!inspected.owned) return { available: true, running: inspected.running, ready: false, containerName: M4697_BOX_CONTAINER, image: inspected.image, detail: `Container ${M4697_BOX_CONTAINER} exists but is not owned by Grok Bot.` };
  return { available: true, running: inspected.running, ready: false, containerName: M4697_BOX_CONTAINER, image: inspected.image, detail: inspected.running ? "Container is starting." : "m4697 VM is stopped." };
}


let ensureInFlight: Promise<GatewayConnection> | undefined;

async function ensureM4697Box(settingsPath: string): Promise<GatewayConnection> {
  const token = await readOrCreateToken(settingsPath);
  if (await gatewayReady(token)) return { baseUrl: M4697_GATEWAY_URL, token };
  const daemon = await runRemoteDocker(["info", "--format", "{{.ServerVersion}}"]).catch(() => ({ ok: false, output: "m4697 SSH/Docker is unavailable." }));
  if (!daemon.ok) throw new Error(`m4697 is selected, but the gateway is down and SSH/Docker is unavailable: ${daemon.output || "reach 100.89.19.82 and try again"}`);

  const inspected = await inspectContainer();
  if (inspected.exists && !inspected.owned) throw new Error(`m4697 cannot use ${M4697_BOX_CONTAINER}: an unowned container already has that name.`);
  if (inspected.exists && inspected.image !== M4697_BOX_IMAGE) throw new Error(`m4697 container uses unexpected image ${inspected.image}. Remove it explicitly before changing images.`);
  if (inspected.exists && !inspected.running) {
    const started = await runRemoteDocker(["start", M4697_BOX_CONTAINER]);
    if (!started.ok) throw new Error(`Could not start the m4697 VM: ${started.output}`);
  } else if (!inspected.exists) {
    const created = await runRemoteDocker([
      "run", "--detach", "--name", M4697_BOX_CONTAINER,
      "--label", M4697_OWNER_LABEL,
      "--label", `com.grok-bot.m4697-vm.schema-version=${M4697_SCHEMA_VERSION}`,
      "--platform", "linux/amd64", "--restart", "unless-stopped",
      "--env", "SAND_SUPERVISOR_ENABLED=1", "--env", "SAND_BOX_AUTO_UPDATE=0", "--env", "SAND_USE_EXISTING_BOX_EXEC_DAEMON=1", "--env", "SAND_TREE_SITTER_NODE_DEPS=/home/box/deps", "--env", "NODE_PATH=/home/box/deps", "--env", "SAND_GATEWAY_BIND_HOST=0.0.0.0", "--env", "SAND_HOST_PORT=1340", "--env", `SAND_GATEWAY_TOKEN=${token}`,
      "--publish", "100.89.19.82:1337:1337", "--publish", "100.89.19.82:1339:1339", "--publish", "100.89.19.82:1340:1340",
      "--publish", "100.89.19.82:6080:6080", "--publish", "100.89.19.82:6081:6081", "--publish", "100.89.19.82:8790:8790",
      "--volume", "grok-bot-m4697-vm-workspace:/workspace", "--volume", "grok-bot-m4697-vm-data:/home/box/sand-data",
      "--mount", "type=bind,src=/opt/grok-bot-box/runtime/host-main.cjs,dst=/home/box/sand-host/host-main.cjs,readonly",
      "--mount", "type=bind,src=/opt/grok-bot-box/runtime/box-exec-daemon,dst=/home/box/box-exec-daemon,readonly",
      M4697_BOX_IMAGE,
    ]);
    if (!created.ok) throw new Error(`Could not create the m4697 VM: ${created.output}`);
  }
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await gatewayReady(token)) return { baseUrl: M4697_GATEWAY_URL, token };
    const state = await inspectContainer();
    if (!state.running) {
      const logs = await runRemoteDocker(["logs", "--tail", "80", M4697_BOX_CONTAINER]);
      throw new Error(`m4697 VM stopped before its gateway became ready.\n${logs.output}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("m4697 VM did not expose its gateway within three minutes.");
}

export async function startM4697Box(settingsPath: string): Promise<GatewayConnection> {
  if (ensureInFlight == null) ensureInFlight = ensureM4697Box(settingsPath).finally(() => { ensureInFlight = undefined; });
  return await ensureInFlight;
}

export async function stopM4697Box(): Promise<void> {
  const inspected = await inspectContainer();
  if (!inspected.exists || !inspected.running) return;
  if (!inspected.owned) throw new Error(`Refusing to stop unowned container ${M4697_BOX_CONTAINER}.`);
  const stopped = await runRemoteDocker(["stop", M4697_BOX_CONTAINER]);
  if (!stopped.ok) throw new Error(`Could not stop the m4697 VM: ${stopped.output}`);
}

export async function recreateM4697Box(settingsPath: string): Promise<RecreateResult> {
  const restarted = await runRemoteDocker(["restart", M4697_BOX_CONTAINER]);
  if (!restarted.ok) throw new Error(`Could not restart the m4697 VM: ${restarted.output}`);
  await startM4697Box(settingsPath);
  return { status: "started-untrackable" };
}

export async function forceRecreateM4697Box(settingsPath: string): Promise<RecreateResult> {
  const removed = await runRemoteDocker(["rm", "--force", M4697_BOX_CONTAINER]);
  if (!removed.ok && !/no such container/i.test(removed.output)) return { status: "rejected", reason: removed.output };
  await startM4697Box(settingsPath);
  return { status: "started-untrackable" };
}
