import { access } from "node:fs/promises";
import { join } from "node:path";

export interface AgentRequest {
  readonly type: "ping" | "shutdown";
  readonly requestId: string;
}

export type AgentResponse =
  | { readonly type: "ready"; readonly pid: number }
  | {
      readonly type: "pong";
      readonly requestId: string;
      readonly pid: number;
      readonly resourcesAvailable: boolean;
    }
  | { readonly type: "shutdown-complete"; readonly requestId: string };

export function parseAgentRequest(value: unknown): AgentRequest | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as { type?: unknown; requestId?: unknown };
  if (
    (record.type !== "ping" && record.type !== "shutdown") ||
    typeof record.requestId !== "string"
  ) {
    return undefined;
  }
  return { type: record.type, requestId: record.requestId };
}

export async function resourcesAreAvailable(
  resourceRoot: string | undefined,
): Promise<boolean> {
  if (!resourceRoot) return false;
  try {
    await Promise.all([
      access(join(resourceRoot, "skills")),
      access(join(resourceRoot, "docs", "index.json")),
    ]);
    return true;
  } catch {
    return false;
  }
}

export function createAgentRequestHandler(options: {
  readonly resourceRoot: string | undefined;
  readonly send: (message: AgentResponse) => void;
  readonly exit: () => void;
}): (value: unknown) => Promise<void> {
  return async (value) => {
    const request = parseAgentRequest(value);
    if (!request) return;

    if (request.type === "ping") {
      options.send({
        type: "pong",
        requestId: request.requestId,
        pid: process.pid,
        resourcesAvailable: await resourcesAreAvailable(options.resourceRoot),
      });
      return;
    }

    options.send({ type: "shutdown-complete", requestId: request.requestId });
    options.exit();
  };
}
