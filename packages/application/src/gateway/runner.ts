import { randomUUID } from "node:crypto";
import type { ApprovalChannel, RunResult } from "@forge/core";
import { type ExecutionLease, FileSessionStore } from "@forge/persistence";
import { createPersistentInteractiveSession } from "../persistent-session.js";
import { type RunDependencies, type RunMetadata, runTask } from "../run.js";
import {
  type GatewayConfig,
  gatewayHome,
  validateGatewayWorkspace,
} from "./config.js";

export interface GatewayRunContext {
  readonly id: string;
  readonly sessionId: string;
  readonly prompt: string;
  readonly lease: ExecutionLease;
  readonly signal: AbortSignal;
  readonly approvalChannel: ApprovalChannel;
  readonly progress: (text: string) => Promise<void>;
}
export interface GatewayRunner {
  prepare(sessionId?: string): Promise<string>;
  run(
    context: GatewayRunContext,
  ): Promise<{ state: "completed" | "failed" | "cancelled"; text: string }>;
}
export class NativeGatewayRunner implements GatewayRunner {
  constructor(
    private readonly config: GatewayConfig,
    private readonly env: NodeJS.ProcessEnv,
    private readonly createAdapter?: RunDependencies["createAdapter"],
  ) {}
  async prepare(sessionId?: string): Promise<string> {
    await validateGatewayWorkspace(this.config, this.env);
    if (sessionId) {
      await new FileSessionStore(gatewayHome(this.env)).loadForWorkspace(
        sessionId,
        this.config.workspaceRoot,
      );
      return sessionId;
    }
    const store = new FileSessionStore(gatewayHome(this.env));
    const snapshot = store.create({
      root: this.config.workspaceRoot,
      cwd: this.config.workspaceRoot,
    });
    await store.save(snapshot);
    return snapshot.id;
  }
  async run(
    context: GatewayRunContext,
  ): Promise<{ state: "completed" | "failed" | "cancelled"; text: string }> {
    await validateGatewayWorkspace(this.config, this.env);
    const session = await createPersistentInteractiveSession({
      cwd: this.config.workspaceRoot,
      env: this.env,
      sessionId: context.sessionId,
    });
    await session.prepareRun(context.prompt);
    let result: RunResult | undefined;
    let metadata: RunMetadata | undefined;
    const code = await runTask(
      context.prompt,
      { engine: "forge", permissionProfile: this.config.permissionProfile },
      {
        env: this.env,
        cwd: this.config.workspaceRoot,
        signal: context.signal,
        workspaceLease: context.lease,
        perActionApproval: true,
        stderr: { write: () => {} },
        sessionId: context.sessionId,
        runId: context.id || randomUUID(),
        conversation: session.messages,
        ...(session.contextCheckpoint
          ? { contextCheckpoint: session.contextCheckpoint }
          : {}),
        ...(this.createAdapter ? { createAdapter: this.createAdapter } : {}),
        approvalChannel: context.approvalChannel,
        onEvent: async (event) => {
          if (event.type === "tool.started")
            await context.progress("Working on a tool action.");
        },
        onResult: (value, details) => {
          result = value;
          metadata = details;
        },
      },
    );
    if (result && metadata)
      await session.recordRun(context.prompt, result, metadata);
    return {
      state: code === 130 ? "cancelled" : code === 0 ? "completed" : "failed",
      text:
        result?.finalText ||
        result?.message ||
        (code === 130
          ? "Cancelled; previous effects are not rolled back."
          : "No final answer. Inspect the local session for details."),
    };
  }
}
