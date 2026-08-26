import { spawn } from "node:child_process";

const PROTOCOL_VERSION = "2025-11-25";

export default function activate(api) {
  api.registerTool({
    name: "mcp_list_tools",
    description:
      "List tools exposed by the stdio MCP server configured in FORGE_MCP_COMMAND.",
    risk: "process",
    inputSchema: api.z.object({}).strict(),
    execute: async (_input, context) =>
      runMcpOperation(context, async (client) =>
        client.request("tools/list", {}),
      ),
  });

  api.registerTool({
    name: "mcp_call_tool",
    description:
      "Call a named tool on the stdio MCP server configured in FORGE_MCP_COMMAND. Use mcp_list_tools first to inspect its schema.",
    risk: "process",
    inputSchema: api.z
      .object({
        name: api.z.string().min(1).max(128),
        arguments: api.z.record(api.z.string(), api.z.unknown()).default({}),
      })
      .strict(),
    execute: async ({ name, arguments: toolArguments }, context) =>
      runMcpOperation(context, async (client) =>
        client.request("tools/call", { name, arguments: toolArguments }),
      ),
  });
}

async function runMcpOperation(context, operation) {
  let command;
  try {
    command = configuredCommand();
  } catch (error) {
    return failure("invalid_input", message(error));
  }

  let client;
  try {
    client = createClient(command, context);
    await client.initialize();
    const output = await operation(client);
    const serialized = JSON.stringify(output);
    if (Buffer.byteLength(serialized) > context.limits.maxOutputBytes) {
      return failure(
        "output_limit",
        `MCP result exceeds the ${context.limits.maxOutputBytes}-byte tool output limit.`,
      );
    }
    return { ok: true, output, truncated: false };
  } catch (error) {
    if (context.signal.aborted)
      return failure("cancelled", "MCP call cancelled.");
    if (error?.code === "MCP_TIMEOUT")
      return failure("timed_out", "MCP server timed out.");
    return failure("process_error", message(error));
  } finally {
    client?.close();
  }
}

function configuredCommand() {
  const raw = process.env.FORGE_MCP_COMMAND;
  if (!raw) {
    throw new Error(
      'Set FORGE_MCP_COMMAND to a JSON array such as ["node","server.mjs"].',
    );
  }
  const value = JSON.parse(raw);
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((entry) => typeof entry !== "string" || entry.length === 0)
  ) {
    throw new Error("FORGE_MCP_COMMAND must be a non-empty JSON string array.");
  }
  return value;
}

function createClient([file, ...args], context) {
  const child = spawn(file, args, {
    cwd: context.workspace.cwd,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let nextId = 1;
  let stdout = "";
  let stderrBytes = 0;
  const pending = new Map();
  const timeoutMs = context.limits.commandTimeoutMs ?? 60_000;

  const rejectAll = (error) => {
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    pending.clear();
  };

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    if (Buffer.byteLength(stdout) > context.limits.maxOutputBytes * 2) {
      rejectAll(new Error("MCP server stdout exceeded the transport limit."));
      child.kill();
      return;
    }
    while (true) {
      const newline = stdout.indexOf("\n");
      if (newline < 0) break;
      const line = stdout.slice(0, newline).trim();
      stdout = stdout.slice(newline + 1);
      if (!line) continue;
      let messageValue;
      try {
        messageValue = JSON.parse(line);
      } catch {
        rejectAll(new Error("MCP server emitted invalid JSON on stdout."));
        child.kill();
        return;
      }
      if (!("id" in messageValue)) continue;
      const waiting = pending.get(messageValue.id);
      if (!waiting) continue;
      pending.delete(messageValue.id);
      clearTimeout(waiting.timer);
      if (messageValue.error)
        waiting.reject(new Error(messageValue.error.message));
      else waiting.resolve(messageValue.result);
    }
  });
  child.stderr.on("data", (chunk) => {
    stderrBytes += Buffer.byteLength(chunk);
    if (stderrBytes > context.limits.maxOutputBytes) child.stderr.pause();
  });
  child.once("error", rejectAll);
  child.once("exit", (code, signal) => {
    rejectAll(
      new Error(
        `MCP server exited before replying (${signal ? `signal ${signal}` : `code ${code ?? "unknown"}`}).`,
      ),
    );
  });
  const onAbort = () => {
    rejectAll(new Error("MCP call cancelled."));
    child.kill();
  };
  context.signal.addEventListener("abort", onAbort, { once: true });

  const send = (value) => child.stdin.write(`${JSON.stringify(value)}\n`);
  const request = (method, params) => {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        const error = new Error(`MCP request ${method} timed out.`);
        error.code = "MCP_TIMEOUT";
        reject(error);
        child.kill();
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      send({ jsonrpc: "2.0", id, method, params });
    });
  };

  return {
    request,
    initialize: async () => {
      await request("initialize", {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "forge-mcp-stdio-example", version: "1.0.0" },
      });
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
    },
    close: () => {
      context.signal.removeEventListener("abort", onAbort);
      rejectAll(new Error("MCP client closed."));
      child.stdin.end();
      child.kill();
    },
  };
}

function failure(code, errorMessage) {
  return {
    ok: false,
    error: { code, message: errorMessage, retryable: false },
  };
}

function message(error) {
  return error instanceof Error ? error.message : "Unknown MCP client error.";
}
