import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const runFile = promisify(execFile);
const cliPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));

interface CompletionCall {
  readonly url: string;
  readonly authorization?: string;
  readonly body: { model?: string; messages?: unknown[] };
}

let server: Server;
let baseUrl: string;
let forgeHome: string;
let calls: CompletionCall[];

function chunk(delta: Record<string, unknown>, finish?: string): string {
  return `data: ${JSON.stringify({
    id: "1",
    object: "chat.completion.chunk",
    created: 0,
    model: "test-model",
    choices: [{ index: 0, delta, finish_reason: finish ?? null }],
  })}\n\n`;
}

beforeEach(async () => {
  calls = [];
  server = createServer((request, response) => {
    let body = "";
    request.on("data", (part) => {
      body += part;
    });
    request.on("end", () => {
      if (request.url?.includes("/chat/completions")) {
        calls.push({
          url: request.url,
          ...(request.headers.authorization
            ? { authorization: request.headers.authorization }
            : {}),
          body: JSON.parse(body || "{}"),
        });
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.write(chunk({ role: "assistant", content: "" }));
        response.write(chunk({ content: "ROUTE_ANSWER" }));
        response.write(chunk({}, "stop"));
        response.end("data: [DONE]\n\n");
        return;
      }
      response.writeHead(404).end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/openai/v1`;
  forgeHome = await mkdtemp(path.join(tmpdir(), "forge-route-"));
  await writeFile(
    path.join(forgeHome, "config.json"),
    JSON.stringify({
      schemaVersion: 1,
      providers: {
        "local-key": {
          api: "openai-completions",
          baseUrl,
          auth: { type: "bearer" },
          models: [{ id: "test-model", reasoningGears: false }],
        },
        "local-none": {
          api: "openai-completions",
          baseUrl,
          auth: { type: "none" },
          models: [{ id: "test-model", reasoningGears: false }],
        },
      },
    }),
  );
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(forgeHome, { recursive: true, force: true });
});

async function forge(
  args: readonly string[],
  env: NodeJS.ProcessEnv = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const result = await runFile(process.execPath, [cliPath, ...args], {
      env: { ...process.env, FORGE_HOME: forgeHome, ...env },
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failure = error as {
      code?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      code: failure.code ?? 1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
    };
  }
}

describe("provider route end to end", () => {
  it("dispatches a bearer route without downgrading it to DeepSeek", async () => {
    const result = await forge(
      ["ask", "hello", "--provider", "local-key", "--model", "test-model"],
      { FORGE_LOCAL_KEY_API_KEY: "route-secret", DEEPSEEK_API_KEY: "" },
    );
    expect(result.stdout).toContain("ROUTE_ANSWER");
    expect(result.stderr).not.toContain("DEEPSEEK_API_KEY");
    expect(calls[0]).toMatchObject({
      url: "/openai/v1/chat/completions",
      authorization: "Bearer route-secret",
      body: { model: "test-model" },
    });
  });

  it("runs an auth-none local route without sending Authorization", async () => {
    const result = await forge([
      "ask",
      "hello",
      "--provider",
      "local-none",
      "--model",
      "test-model",
    ]);
    expect(result.stdout).toContain("ROUTE_ANSWER");
    expect(calls[0]?.authorization).toBeUndefined();
  });

  it("reports a missing bearer credential before reaching the endpoint", async () => {
    const result = await forge([
      "ask",
      "hello",
      "--provider",
      "local-key",
      "--model",
      "test-model",
    ]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("FORGE_LOCAL_KEY_API_KEY");
    expect(calls).toHaveLength(0);
  });
});
