import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ForgeTool, ToolContext } from "@forge/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { loadPluginHost } from "./index.js";

const temporaryDirectories: string[] = [];
const webPluginDirectory = fileURLToPath(
  new URL("../../../examples/plugins/web-tools/", import.meta.url),
);

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("web-tools example plugin", () => {
  it("loads through the real plugin host with declared network tools", async () => {
    const root = await createFixture();
    const forgeHome = path.join(root, "forge-home");
    const target = path.join(forgeHome, "plugins", "web-tools");
    await mkdir(target, { recursive: true });
    await Promise.all(
      ["plugin.json", "index.mjs"].map((name) =>
        copyFile(path.join(webPluginDirectory, name), path.join(target, name)),
      ),
    );

    const host = await loadPluginHost({
      forgeHome,
      workspaceRoot: root,
      enabledUserPlugins: ["web-tools"],
    });

    expect(host.loadedPlugins[0]?.manifest.capabilities).toEqual([
      "tools:register",
      "network:access",
    ]);
    expect(host.tools.map(({ name, risk }) => ({ name, risk }))).toEqual([
      { name: "web_search", risk: "network" },
      { name: "web_fetch", risk: "network" },
    ]);
  });

  it("parses bounded DuckDuckGo HTML results without a live request", async () => {
    const module = await loadWebPluginModule();
    const fetchMock = vi.fn(
      async (..._arguments: Parameters<typeof fetch>): Promise<Response> =>
        htmlResponse(`
<div class="result results_links">
  <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs">Example &amp; Docs</a>
  <a class="result__snippet">A <b>bounded</b> result.</a>
</div>
<div class="result results_links">
  <a class="result__a" href="https://example.org/guide">Guide</a>
  <div class="result__snippet">Second result.</div>
</div>`),
    );
    const searchTool = requireTool(
      module.createWebTools(
        { z },
        {
          env: {},
          fetch: fetchMock,
          lookupAll: publicLookup,
        },
      ),
      0,
    );

    const result = await searchTool.execute(
      { query: "forge plugins", maxResults: 1 },
      toolContext(),
    );

    expect(result).toEqual({
      ok: true,
      output: {
        query: "forge plugins",
        provider: "duckduckgo",
        results: [
          {
            title: "Example & Docs",
            url: "https://example.com/docs",
            snippet: "A bounded result.",
          },
        ],
      },
      truncated: true,
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("q=forge+plugins");
  });

  it("uses Brave Search when its key is configured without returning the key", async () => {
    const module = await loadWebPluginModule();
    const fetchMock = vi.fn(
      async (..._arguments: Parameters<typeof fetch>): Promise<Response> =>
        jsonResponse({
          web: {
            results: [
              {
                title: "Forge",
                url: "https://example.com/forge",
                description: "Agent <strong>project</strong>",
              },
            ],
          },
        }),
    );
    const searchTool = requireTool(
      module.createWebTools(
        { z },
        {
          env: { BRAVE_SEARCH_API_KEY: "brave-test-secret" },
          fetch: fetchMock,
          lookupAll: publicLookup,
        },
      ),
      0,
    );

    const result = await searchTool.execute({ query: "forge" }, toolContext());

    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain("brave-test-secret");
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      "x-subscription-token": "brave-test-secret",
    });
  });

  it("revalidates redirects and extracts readable HTML text", async () => {
    const module = await loadWebPluginModule();
    const fetchMock = vi.fn(
      async (..._arguments: Parameters<typeof fetch>): Promise<Response> =>
        htmlResponse("fallback"),
    );
    fetchMock
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://example.org/article" },
        }),
      )
      .mockResolvedValueOnce(
        htmlResponse(
          "<html><head><title>Example</title><script>secret()</script></head><body><h1>Hello</h1><p>Readable page.</p></body></html>",
          "https://example.org/article",
        ),
      );
    const fetchTool = requireTool(
      module.createWebTools(
        { z },
        { env: {}, fetch: fetchMock, lookupAll: publicLookup },
      ),
      1,
    );

    const result = await fetchTool.execute(
      { url: "https://example.com/start", maxCharacters: 2_000 },
      toolContext(),
    );

    expect(result).toMatchObject({
      ok: true,
      output: {
        url: "https://example.com/start",
        finalUrl: "https://example.org/article",
        status: 200,
        contentType: "text/html",
        title: "Example",
        text: expect.stringContaining("Hello\nReadable page."),
      },
      truncated: false,
    });
    expect(JSON.stringify(result)).not.toContain("secret()");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("blocks loopback and private destinations before fetch", async () => {
    const module = await loadWebPluginModule();
    const fetchMock = vi.fn(
      async (..._arguments: Parameters<typeof fetch>): Promise<Response> =>
        htmlResponse("unexpected"),
    );
    const fetchTool = requireTool(
      module.createWebTools(
        { z },
        { env: {}, fetch: fetchMock, lookupAll: publicLookup },
      ),
      1,
    );

    const literal = await fetchTool.execute(
      { url: "http://127.0.0.1/private" },
      toolContext(),
    );
    const resolved = await fetchTool.execute(
      { url: "https://metadata.example/" },
      toolContext(),
    );

    expect(literal).toMatchObject({
      ok: false,
      error: { code: "invalid_input" },
    });
    expect(resolved).toMatchObject({
      ok: false,
      error: { code: "invalid_input" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("enforces MIME, cancellation, and serialized output limits", async () => {
    const module = await loadWebPluginModule();
    const fetchMock = vi.fn(
      async (..._arguments: Parameters<typeof fetch>): Promise<Response> => {
        const response = new Response("x".repeat(10_000), {
          status: 200,
          headers: { "content-type": "text/plain" },
        });
        Object.defineProperty(response, "url", {
          value: "https://example.com/large.txt",
        });
        return response;
      },
    );
    const fetchTool = requireTool(
      module.createWebTools(
        { z },
        { env: {}, fetch: fetchMock, lookupAll: publicLookup },
      ),
      1,
    );

    const bounded = await fetchTool.execute(
      { url: "https://example.com/large.txt", maxCharacters: 10_000 },
      toolContext(300),
    );
    expect(bounded).toMatchObject({ ok: true, truncated: true });
    expect(Buffer.byteLength(JSON.stringify(bounded), "utf8")).toBeLessThan(
      400,
    );

    const cancelledController = new AbortController();
    cancelledController.abort();
    const cancelledResult = await fetchTool.execute(
      { url: "https://example.com/cancelled" },
      toolContext(16_384, cancelledController.signal),
    );
    expect(cancelledResult).toMatchObject({
      ok: false,
      error: { code: "cancelled" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValueOnce(
      new Response(new Uint8Array([0, 1, 2]), {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      }),
    );
    const binary = await fetchTool.execute(
      { url: "https://example.com/archive.bin" },
      toolContext(),
    );
    expect(binary).toMatchObject({
      ok: false,
      error: { code: "invalid_input" },
    });
  });
});

async function loadWebPluginModule(): Promise<{
  readonly createWebTools: (
    api: { readonly z: typeof z },
    dependencies: {
      readonly env: NodeJS.ProcessEnv;
      readonly fetch: typeof fetch;
      readonly lookupAll: (
        hostname: string,
      ) => Promise<
        readonly { readonly address: string; readonly family: number }[]
      >;
    },
  ) => readonly ForgeTool[];
}> {
  const moduleUrl: string = new URL("index.mjs", webPluginDirectoryUrl()).href;
  return import(moduleUrl);
}

function requireTool(tools: readonly ForgeTool[], index: number): ForgeTool {
  const tool = tools[index];
  if (!tool) throw new Error(`Expected web tool at index ${index}.`);
  return tool;
}

function webPluginDirectoryUrl(): URL {
  return new URL("../../../examples/plugins/web-tools/", import.meta.url);
}

async function publicLookup(hostname: string) {
  return [
    {
      address:
        hostname === "metadata.example" ? "169.254.169.254" : "93.184.216.34",
      family: 4,
    },
  ];
}

function toolContext(
  maxOutputBytes = 16_384,
  signal: AbortSignal = new AbortController().signal,
): ToolContext {
  return {
    workspace: { root: "/tmp/forge-web-tools", cwd: "/tmp/forge-web-tools" },
    signal,
    limits: {
      maxEntries: 10,
      maxOutputBytes,
      commandTimeoutMs: 1_000,
    },
  };
}

function htmlResponse(body: string, url?: string): Response {
  const response = new Response(body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
  if (url) Object.defineProperty(response, "url", { value: url });
  return response;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function createFixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "forge-web-plugin-"));
  temporaryDirectories.push(root);
  await mkdir(path.join(root, ".git"), { recursive: true });
  return root;
}
