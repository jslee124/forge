import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { loadForgeConfig } from "@forge/config";
import { writePrivateJson } from "@forge/persistence";

export interface GatewayConfig {
  readonly schemaVersion: 1;
  readonly channel: "telegram";
  readonly accountId: string;
  readonly tokenEnv: "FORGE_TELEGRAM_BOT_TOKEN";
  readonly allowedUserIds: readonly [string];
  readonly workspaceAlias: string;
  readonly workspaceRoot: string;
  readonly permissionProfile: "safe" | "workspace-write";
}
export function gatewayHome(env: NodeJS.ProcessEnv): string {
  const { FORGE_HOME } = env;
  return resolve(FORGE_HOME?.trim() || join(homedir(), ".forge"));
}
export function parseGatewayConfig(value: unknown): GatewayConfig {
  if (!value || typeof value !== "object")
    throw new Error("invalid-gateway-config");
  const v = value as { [K in keyof GatewayConfig]: unknown };
  if (
    v.schemaVersion !== 1 ||
    v.channel !== "telegram" ||
    v.tokenEnv !== "FORGE_TELEGRAM_BOT_TOKEN" ||
    typeof v.accountId !== "string" ||
    !/^\d+$/u.test(v.accountId) ||
    !Array.isArray(v.allowedUserIds) ||
    v.allowedUserIds.length !== 1 ||
    typeof v.allowedUserIds[0] !== "string" ||
    !/^[1-9]\d*$/u.test(v.allowedUserIds[0]) ||
    typeof v.workspaceAlias !== "string" ||
    !/^[\p{L}\p{N}_-]{1,64}$/u.test(v.workspaceAlias) ||
    typeof v.workspaceRoot !== "string" ||
    !v.workspaceRoot ||
    (v.permissionProfile !== "safe" &&
      v.permissionProfile !== "workspace-write") ||
    Object.keys(v).some(
      (k) =>
        ![
          "schemaVersion",
          "channel",
          "accountId",
          "tokenEnv",
          "allowedUserIds",
          "workspaceAlias",
          "workspaceRoot",
          "permissionProfile",
        ].includes(k),
    )
  )
    throw new Error("invalid-gateway-config");
  return v as unknown as GatewayConfig;
}
export function gatewayToken(env: NodeJS.ProcessEnv): string {
  const { FORGE_TELEGRAM_BOT_TOKEN } = env;
  const token = FORGE_TELEGRAM_BOT_TOKEN?.trim();
  if (!token || !/^\d+:[A-Za-z0-9_-]+$/u.test(token))
    throw new Error(
      "Set FORGE_TELEGRAM_BOT_TOKEN locally; its value is never printed.",
    );
  return token;
}
export async function validateGatewayWorkspace(
  config: GatewayConfig,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const canonical = await realpath(config.workspaceRoot);
  const loaded = await loadForgeConfig({ cwd: canonical, env });
  if (canonical !== config.workspaceRoot || loaded.workspaceRoot !== canonical)
    throw new Error("gateway-workspace-changed");
  if (loaded.config.model.engine !== "forge")
    throw new Error("Gateway v1 requires the Forge native engine.");
}
export async function readGatewayConfig(
  env: NodeJS.ProcessEnv,
): Promise<GatewayConfig> {
  const text = await readFile(
    join(gatewayHome(env), "gateway", "config.json"),
    "utf8",
  );
  if (Buffer.byteLength(text) > 16384)
    throw new Error("gateway-config-too-large");
  return parseGatewayConfig(JSON.parse(text));
}
export async function setupGateway(
  options: {
    owner: string;
    workspace: string;
    alias: string;
    permissionProfile: string;
  },
  env: NodeJS.ProcessEnv,
): Promise<GatewayConfig> {
  const token = gatewayToken(env);
  const loaded = await loadForgeConfig({ cwd: options.workspace, env });
  const config = parseGatewayConfig({
    schemaVersion: 1,
    channel: "telegram",
    accountId: token.split(":")[0],
    tokenEnv: "FORGE_TELEGRAM_BOT_TOKEN",
    allowedUserIds: [options.owner],
    workspaceAlias: options.alias,
    workspaceRoot: loaded.workspaceRoot,
    permissionProfile: options.permissionProfile,
  });
  await validateGatewayWorkspace(config, env);
  const file = join(gatewayHome(env), "gateway", "config.json");
  try {
    await readFile(file);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
    await writePrivateJson(file, config);
    return config;
  }
  throw new Error(
    "Gateway already configured. Stop it before editing its local configuration.",
  );
}
export function gatewayBinding(config: GatewayConfig): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        config.schemaVersion,
        config.channel,
        config.accountId,
        config.tokenEnv,
        config.allowedUserIds,
        config.workspaceAlias,
        config.workspaceRoot,
        config.permissionProfile,
      ]),
    )
    .digest("hex");
}
