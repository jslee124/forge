/**
 * End-to-end coverage for third-party provider routes.
 *
 * A loopback OpenAI-compatible server stands in for a gateway, and the
 * compiled CLI is run against it, so the whole chain is exercised together:
 * configuration loading, credential resolution, endpoint validation, protocol
 * selection, baseURL propagation, and stream parsing. The unit tests use fake
 * transports and cannot show that these pieces agree.
 */
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

/** One streamed chat-completions chunk in the OpenAI SSE shape. */
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
      if (request.url?.endsWith("/models")) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            data: [{ id: "test-model", context_window: 8192 }],
          }),
        );
        return;
      }
      if (request.url?.includes("/chat/completions")) {
        calls.push({
          url: request.url,
          ...(request.headers.authorization === undefined
            ? {}
            : { authorization: request.headers.authorization }),
          body: JSON.parse(body || "{}"),
        });
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.write(chunk({ role: "assistant", content: "" }));
        response.write(chunk({ content: "ROUTE_ANSWER" }));
        response.write(chunk({}, "stop"));
        response.write("data: [DONE]\n\n");
        response.end();
        return;
      }
      response.writeHead(404).end("{}");
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/openai/v1`;
  forgeHome = await mkdtemp(path.join(tmpdir(), "forge-route-"));
  await writeFile(
    path.join(forgeHome, "config.json"),
    JSON.stringify({
      schemaVersion: 1,
      providers: {
        "local-test": {
          api: "openai-completions",
          baseUrl,
          models: [{ id: "test-model", reasoningGears: { high: "high" } }],
        },
      },
    }),
  );
});

afterEach(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
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

describe("third-party provider route, end to end", () => {
  it("reaches the configured endpoint and streams its answer", async () => {
    const result = await forge(
      ["ask", "hello", "--provider", "local-test", "--model", "test-model"],
      { FORGE_LOCAL_TEST_API_KEY: "route-secret" },
    );

    expect(result.stdout).toContain("ROUTE_ANSWER");
    // The deployment path prefix must survive; resolving "/chat/completions"
    // against the base as a URL would have discarded "/openai/v1".
    expect(calls[0]?.url).toBe("/openai/v1/chat/completions");
    expect(calls[0]?.authorization).toBe("Bearer route-secret");
    expect(calls[0]?.body.model).toBe("test-model");
    expect(Array.isArray(calls[0]?.body.messages)).toBe(true);
  });

  it("never downgrades a route to the built-in default provider", async () => {
    // Without DEEPSEEK_API_KEY, a downgrade would fail asking for that key.
    const result = await forge(
      ["ask", "hello", "--provider", "local-test", "--model", "test-model"],
      { FORGE_LOCAL_TEST_API_KEY: "route-secret", DEEPSEEK_API_KEY: "" },
    );

    expect(result.stderr).not.toMatch(/DEEPSEEK_API_KEY/u);
    expect(result.stdout).toContain("ROUTE_ANSWER");
  });

  it("reports a missing route credential without reaching the endpoint", async () => {
    const result = await forge([
      "ask",
      "hello",
      "--provider",
      "local-test",
      "--model",
      "test-model",
    ]);

    expect(result.code).not.toBe(0);
    expect(`${result.stderr}${result.stdout}`).toMatch(
      /FORGE_LOCAL_TEST_API_KEY/u,
    );
    expect(calls).toHaveLength(0);
  });

  it("refuses a provider that names no configured route", async () => {
    const result = await forge(["ask", "hello", "--provider", "absent"]);

    expect(result.code).not.toBe(0);
    expect(`${result.stderr}${result.stdout}`).toMatch(/absent/u);
    expect(calls).toHaveLength(0);
  });

  it("keeps the route credential out of configuration output", async () => {
    const result = await forge(["config", "show"], {
      FORGE_LOCAL_TEST_API_KEY: "route-secret",
    });

    expect(result.stdout).not.toContain("route-secret");
  });
});
