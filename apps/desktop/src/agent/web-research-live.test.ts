import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureHttpDispatcher } from "@forge/application";
import type { ForgeTool } from "@forge/core";
import { expect, it } from "vitest";
import { z } from "zod";
import { DesktopApplication } from "./application.js";

const { FORGE_D11_LIVE_WEB, FORGE_D11_LIVE_CODEX } = process.env;
it.skipIf(FORGE_D11_LIVE_WEB !== "1")(
  "records public service connectivity separately from extraction fixtures",
  async () => {
    configureHttpDispatcher(process.env);
    const url: string = new URL(
      "../../../../examples/plugins/web-tools/index.mjs",
      import.meta.url,
    ).href;
    const module = (await import(url)) as {
      createWebTools(api: { z: typeof z }): ForgeTool[];
    };
    const tools = module.createWebTools({ z });
    const context = {
      signal: AbortSignal.timeout(45_000),
      workspace: { root: "/tmp", cwd: "/tmp" },
      limits: { maxEntries: 3, maxOutputBytes: 16384, commandTimeoutMs: 1000 },
    };
    const observations = [];
    for (const [index, input] of [
      [
        0,
        {
          query: "Mozilla Readability jsdom",
          provider: "duckduckgo",
          maxResults: 3,
        },
      ],
      [
        0,
        {
          query: "Mozilla Readability jsdom",
          provider: "brave",
          maxResults: 3,
        },
      ],
      [1, { url: "https://example.com/", timeoutMs: 10_000 }],
    ] as const) {
      const result = await tools[index]?.execute(input, context);
      expect(result).toBeDefined();
      observations.push({ input, result });
    }
    await writeFile(
      join(tmpdir(), "forge-d11-services.json"),
      JSON.stringify(observations, null, 2),
    );
  },
  55_000,
);

it.skipIf(FORGE_D11_LIVE_CODEX !== "1")(
  "observes Codex research independently without inventing native source metadata",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "forge-d11-codex-"));
    const app = new DesktopApplication(
      { ...process.env, FORGE_HOME: join(root, "home") },
      root,
    );
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      app.close();
    }, 110_000);
    try {
      const auth = await app.manage({ type: "auth-status" });
      if (auth.auth !== "authenticated") {
        await writeFile(
          join(tmpdir(), "forge-d11-codex.json"),
          JSON.stringify({ auth: auth.auth, verified: false }),
        );
        return;
      }
      const prompt =
        "Use your own web search tool, if available, to search for Mozilla Readability. Read https://example.com/ with an available web tool. Write a brief Markdown report (under 150 words) to d11-report.md in this task directory, linking only sources you actually consulted. Distinguish search snippets, page bodies, failed reads, and unverified details. Do not use shell network commands or install anything. If web tools are unavailable, say so and write only that limitation. Do not access files outside this task directory.";
      const state = await app.manage({ type: "create", prompt });
      let answer = "";
      const detailKinds: string[] = [];
      const outcome = await app.execute(
        {
          type: "start",
          sessionId: state.sessionId,
          requestId: randomUUID(),
          runId: randomUUID(),
          engine: "codex",
          prompt,
        },
        {
          signal: controller.signal,
          text: (text) => {
            answer += text;
          },
          detail: (kind) => {
            detailKinds.push(kind);
          },
          approve: async () => false,
        },
      );
      const report = await readFile(
        join(state.cwd, "d11-report.md"),
        "utf8",
      ).catch(() => "");
      await writeFile(
        join(tmpdir(), "forge-d11-codex.json"),
        JSON.stringify({
          outcome,
          answer,
          report,
          detailKinds: [...new Set(detailKinds)],
          nativeSourceMetadata: false,
        }),
      );
      expect(outcome).toBe("completed");
      expect(report.length).toBeGreaterThan(0);
    } finally {
      clearTimeout(timer);
      controller.abort();
      app.close();
      await rm(root, { recursive: true, force: true });
    }
  },
  120_000,
);
