import {
  gatewayBinding,
  gatewayHome,
  readGatewayConfig,
  retryGatewayDelivery,
  runGateway,
  setupGateway,
} from "@forge/application";
import { ExecutionLease, GatewayStore } from "@forge/persistence";

export interface GatewayCommandOptions {
  readonly owner?: string;
  readonly workspace?: string;
  readonly alias?: string;
  readonly permissionProfile?: string;
  readonly acceptRemoteDisclosure?: boolean;
}
export async function runGatewayCommand(
  mode: "setup" | "run" | "status" | "retry-delivery",
  options: GatewayCommandOptions,
  env: NodeJS.ProcessEnv,
): Promise<number> {
  try {
    if (mode === "setup") {
      if (
        !options.owner ||
        !options.workspace ||
        !options.alias ||
        !options.permissionProfile ||
        !options.acceptRemoteDisclosure
      )
        throw new Error(
          "Setup requires --owner, --workspace, --alias, --permission-profile and --accept-remote-disclosure (task text and selected results pass through Telegram).",
        );
      const lease = await ExecutionLease.acquire(
        `gateway-setup:${gatewayHome(env)}`,
      );
      try {
        const config = await setupGateway(
          {
            owner: options.owner,
            workspace: options.workspace,
            alias: options.alias,
            permissionProfile: options.permissionProfile,
          },
          env,
        );
        process.stdout.write(
          `Telegram gateway configured for ${config.workspaceAlias}. Start with forge gateway run. Host must remain awake and online.\n`,
        );
      } finally {
        await lease.release();
      }
      return 0;
    }
    if (mode === "retry-delivery") {
      const count = await retryGatewayDelivery(env);
      process.stdout.write(
        `Requeued ${count} deliveries. Replies may be duplicated; tasks will not rerun. Start forge gateway run.\n`,
      );
      return 0;
    }
    if (mode === "status") {
      const config = await readGatewayConfig(env);
      const state = await new GatewayStore(gatewayHome(env)).load(
        gatewayBinding(config),
      );
      process.stdout.write(
        JSON.stringify(
          {
            workspace: config.workspaceAlias,
            connection: state.connection,
            task: state.task,
            pendingDeliveries: state.outbox.length,
            failedDeliveries: state.outbox.filter((item) => item.failed).length,
            recordedAt: state.updatedAt,
            note: "Last persisted observation; does not prove the gateway is currently running.",
          },
          null,
          2,
        ) + "\n",
      );
      return 0;
    }
    const controller = new AbortController();
    let forceExit: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      controller.abort();
      // CLI-only bounded shutdown. Durable nonterminal tasks recover as interrupted.
      forceExit ??= setTimeout(() => process.exit(130), 10000);
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    try {
      process.stdout.write(
        "Starting Telegram gateway. Task text and selected results pass through Telegram. Ctrl+C to stop.\n",
      );
      await runGateway(env, controller.signal);
      return controller.signal.aborted ? 130 : 0;
    } finally {
      if (forceExit) clearTimeout(forceExit);
      process.removeListener("SIGINT", stop);
      process.removeListener("SIGTERM", stop);
    }
  } catch (error) {
    // Local diagnostics still avoid provider/transport exception bodies and token-bearing URLs.
    const message = error instanceof Error ? error.message : "gateway failed";
    const safe =
      /^(?:Setup requires|Gateway already|Gateway v1|Set FORGE_TELEGRAM|workspace-busy|gateway-|invalid-gateway|telegram-account|Telegram webhook|channel-)/u.test(
        message,
      )
        ? message
        : "Gateway failed; check local configuration, workspace and credentials.";
    process.stderr.write(`${safe}\n`);
    return 1;
  }
}
