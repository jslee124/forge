import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ForgeTool, RunResult } from "@forge/core";
import type { SessionSummary } from "@forge/persistence";
import { renderToString } from "ink";
import { render } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  INK_INCREMENTAL_RENDERING,
  InteractiveApp,
  resolveInkKeyboardMode,
} from "./interactive-ui.js";
import type { InteractiveSessionPersistence } from "./persistent-session.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Ink interactive terminal", () => {
  it("directly enables enhanced keyboard protocols for known terminals", () => {
    expect(resolveInkKeyboardMode({ TERM_PROGRAM: "vscode" })).toBe("enabled");
    expect(resolveInkKeyboardMode({ TERM_PROGRAM: "ghostty" })).toBe("enabled");
    expect(resolveInkKeyboardMode({ TERM_PROGRAM: "unknown" })).toBe(
      "disabled",
    );
  });

  it("uses full-frame updates so terminal resize cannot leave stale rows", () => {
    expect(INK_INCREMENTAL_RENDERING).toBe(false);
  });

  it("shows the available multiline shortcuts in VS Code terminals", async () => {
    const root = await createWorkspace();
    const instance = render(
      <InteractiveApp
        options={{}}
        env={{ TERM_PROGRAM: "vscode" }}
        cwd={root}
      />,
    );

    expect(instance.lastFrame()).toContain(
      "Shift+Enter/Meta+Enter/Ctrl+J newline",
    );
    instance.unmount();
  });

  it("opens the slash command menu from keyboard input", async () => {
    const root = await createWorkspace();
    const instance = render(
      <InteractiveApp options={{}} env={{}} cwd={root} />,
    );

    await settle();
    instance.stdin.write("/");
    await settle();

    expect(instance.lastFrame()).toContain("/help  Show available commands");
    expect(instance.lastFrame()).toContain(
      "/clear  Clear conversation context",
    );
    expect(instance.lastFrame()).toContain(
      "/login  Configure a model provider",
    );
    instance.unmount();
  });

  it("stores an API key through /login without rendering the secret", async () => {
    const root = await createWorkspace();
    let saved: { provider: string; apiKey: string } | undefined;
    const instance = render(
      <InteractiveApp
        options={{}}
        env={{}}
        cwd={root}
        saveApiKey={async ({ provider, apiKey }) => {
          saved = { provider, apiKey };
          return "/tmp/forge-auth.json";
        }}
      />,
    );

    await settle();
    instance.stdin.write("/login");
    await settle();
    instance.stdin.write("\r");
    await settle();
    expect(instance.lastFrame()).toContain("Choose model provider");
    instance.stdin.write("\u001B[B");
    await settle();
    instance.stdin.write("\r");
    await settle();
    instance.stdin.write("deepseek-secret-value");
    await settle();

    expect(instance.lastFrame()).toContain("Enter DeepSeek API key");
    expect(instance.lastFrame()).not.toContain("deepseek-secret-value");
    expect(instance.lastFrame()).toContain("••••");

    instance.stdin.write("\r");
    await settle();
    expect(saved).toEqual({
      provider: "deepseek",
      apiKey: "deepseek-secret-value",
    });
    expect(instance.lastFrame()).toContain("Saved DeepSeek API credential");
    expect(instance.lastFrame()).not.toContain("deepseek-secret-value");
    instance.unmount();
  });

  it("adds a third-party provider route through the guided wizard", async () => {
    const root = await createWorkspace();
    let savedRoute: unknown;
    let savedKey: unknown;
    let savedSelection: unknown;
    let probed: unknown;
    const instance = render(
      <InteractiveApp
        options={{}}
        env={{}}
        cwd={root}
        discoverProviderModels={async (request) => {
          probed = { api: request.api, baseUrl: request.baseUrl };
          return [
            { id: "glm-4.6", name: "GLM 4.6", contextWindow: 200_000 },
            { id: "kimi-k2" },
          ];
        }}
        saveApiKey={async ({ provider, apiKey }) => {
          savedKey = { provider, apiKey };
          return "/tmp/auth.json";
        }}
        persistProviderRoute={async ({ route, profile }) => {
          savedRoute = { route, profile };
          return "/tmp/config.json";
        }}
        persistModelSelection={async ({ selection }) => {
          savedSelection = selection;
          return "/tmp/config.json";
        }}
      />,
    );

    await settle();
    instance.stdin.write("/login");
    await settle();
    instance.stdin.write("\r");
    await settle();
    // Move to the third-party entry, past the three built-in ones.
    instance.stdin.write("\u001B[B\u001B[B\u001B[B");
    await settle();
    instance.stdin.write("\r");
    await settle();
    expect(instance.lastFrame()).toContain("Add a provider");

    instance.stdin.write("my-gateway");
    await settle();
    instance.stdin.write("\r");
    await settle();
    instance.stdin.write("https://gateway.example/openai/v1/");
    await settle();
    instance.stdin.write("\r");
    await settle();
    // Protocol step: keep openai-completions.
    expect(instance.lastFrame()).toContain("openai-completions");
    instance.stdin.write("\r");
    await settle();
    instance.stdin.write("route-secret");
    await settle();
    // The key is masked while it is typed.
    expect(instance.lastFrame()).not.toContain("route-secret");
    instance.stdin.write("\r");
    await settle();

    // Discovery ran against the canonicalized endpoint.
    expect(probed).toEqual({
      api: "openai-completions",
      baseUrl: "https://gateway.example/openai/v1",
    });
    expect(instance.lastFrame()).toContain("GLM 4.6");
    instance.stdin.write("\r");
    await settle();

    // Gear step: select "high" and save.
    instance.stdin.write("\u001B[B\u001B[B\u001B[B\u001B[B");
    await settle();
    instance.stdin.write(" ");
    await settle();
    instance.stdin.write("\r");
    await settle();

    expect(savedKey).toEqual({
      provider: "my-gateway",
      apiKey: "route-secret",
    });
    expect(savedRoute).toEqual({
      route: "my-gateway",
      profile: {
        api: "openai-completions",
        baseUrl: "https://gateway.example/openai/v1",
        models: [
          {
            id: "glm-4.6",
            reasoningGears: { high: "high" },
            contextWindow: 200_000,
          },
        ],
      },
    });
    expect(savedSelection).toEqual({
      engine: "forge",
      provider: "my-gateway",
      id: "glm-4.6",
    });
    expect(instance.lastFrame()).toContain('Saved provider route "my-gateway"');
    instance.unmount();
  });

  it("falls back to hand entry when the endpoint cannot be interrogated", async () => {
    const root = await createWorkspace();
    let savedRoute: { profile?: { models?: { id: string }[] } } | undefined;
    const instance = render(
      <InteractiveApp
        options={{}}
        env={{}}
        cwd={root}
        discoverProviderModels={async () => {
          throw new Error("could not reach the endpoint");
        }}
        saveApiKey={async () => "/tmp/auth.json"}
        persistProviderRoute={async ({ route, profile }) => {
          savedRoute = { profile } as typeof savedRoute;
          void route;
          return "/tmp/config.json";
        }}
        persistModelSelection={async () => "/tmp/config.json"}
      />,
    );

    await settle();
    instance.stdin.write("/login");
    await settle();
    instance.stdin.write("\r");
    await settle();
    instance.stdin.write("\u001B[B\u001B[B\u001B[B");
    await settle();
    instance.stdin.write("\r");
    await settle();
    instance.stdin.write("local-llama");
    await settle();
    instance.stdin.write("\r");
    await settle();
    // A loopback endpoint may use plain http.
    instance.stdin.write("http://localhost:11434/v1");
    await settle();
    instance.stdin.write("\r");
    await settle();
    instance.stdin.write("\r");
    await settle();
    // No key: probe unauthenticated, which this endpoint refuses.
    instance.stdin.write("\r");
    await settle();

    expect(instance.lastFrame()).toContain("could not reach the endpoint");
    expect(instance.lastFrame()).toContain("Model id");
    instance.stdin.write("llama3.3");
    await settle();
    instance.stdin.write("\r");
    await settle();
    // Select no gears at all, which declares no reasoning support.
    instance.stdin.write("\r");
    await settle();

    expect(savedRoute?.profile?.models).toEqual([{ id: "llama3.3" }]);
    instance.unmount();
  });

  it("refuses a reserved or malformed route name", async () => {
    const root = await createWorkspace();
    const instance = render(
      <InteractiveApp options={{}} env={{}} cwd={root} />,
    );

    await settle();
    instance.stdin.write("/login");
    await settle();
    instance.stdin.write("\r");
    await settle();
    instance.stdin.write("\u001B[B\u001B[B\u001B[B");
    await settle();
    instance.stdin.write("\r");
    await settle();

    instance.stdin.write("openai");
    await settle();
    instance.stdin.write("\r");
    await settle();
    expect(instance.lastFrame()).toContain("reserved");

    instance.unmount();
  });

  it("routes ChatGPT subscription login through the Codex auth surface", async () => {
    const root = await createWorkspace();
    let invoked = false;
    const instance = render(
      <InteractiveApp
        options={{}}
        env={{}}
        cwd={root}
        executeAuthentication={async () => {
          invoked = true;
          return 0;
        }}
      />,
    );

    await settle();
    instance.stdin.write("/login");
    await settle();
    instance.stdin.write("\r");
    await settle();
    instance.stdin.write("\r");
    await settle();

    expect(invoked).toBe(true);
    expect(instance.lastFrame()).toContain(
      "ChatGPT subscription sign-in completed",
    );
    instance.unmount();
  });

  it("presents a pending sign-in URL as one clickable panel", async () => {
    const root = await createWorkspace();
    const url =
      "https://auth.openai.com/oauth/authorize?response_type=code&client_id=app_EMoamEEZ73f0CkXaXp7hrann&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback&state=imdzqm24Mh9";
    let release: (() => void) | undefined;
    const instance = render(
      <InteractiveApp
        options={{}}
        env={{ TERM_PROGRAM: "vscode" }}
        cwd={root}
        executeAuthentication={async (dependencies) => {
          dependencies.onOutput?.({ type: "login", text: url, url });
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          return 0;
        }}
      />,
    );

    await settle();
    instance.stdin.write("/login");
    await settle();
    instance.stdin.write("\r");
    await settle();
    instance.stdin.write("\r");
    await settle();

    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("Login");
    expect(frame).toContain("Browser didn't open?");
    // Every wrapped row reopens the same OSC 8 target, so the address stays
    // one clickable link instead of separate per-line fragments.
    const openings = frame.split(`\u001B]8;;${url}\u0007`).length - 1;
    expect(openings).toBeGreaterThan(0);
    // The visible label is the address itself, never a truncated form.
    expect(stripSequences(frame)).toContain(url.slice(0, 60));
    // Escape sequences must not be counted as display width, or the panel
    // border would be pushed out of alignment.
    const widths = new Set(
      stripSequences(frame)
        .split("\n")
        .filter((line) => line.includes("│"))
        .map((line) => line.length),
    );
    expect(widths.size).toBe(1);

    release?.();
    await settle();
    // The panel is torn down once the sign-in resolves.
    expect(instance.lastFrame()).not.toContain("Browser didn't open?");
    instance.unmount();
  });

  it("opens /model, persists selection, and uses it for the next task", async () => {
    const root = await createWorkspace();
    let persisted: unknown;
    let receivedOptions: unknown;
    const instance = render(
      <InteractiveApp
        options={{}}
        env={{}}
        cwd={root}
        persistModelSelection={async (value) => {
          persisted = value.selection;
          return "/tmp/forge-config.json";
        }}
        discoverSubscriptionModels={async () => []}
        executeTask={async (_prompt, options, dependencies) => {
          receivedOptions = options;
          dependencies.onResult?.(completed("done"));
          return 0;
        }}
      />,
    );

    await settle();
    instance.stdin.write("/model");
    await settle();
    instance.stdin.write("\r");
    await settle();
    expect(instance.lastFrame()).toContain("Choose model and reasoning effort");
    instance.stdin.write("\u001B[B");
    await settle();
    instance.stdin.write("\u001B[B");
    await settle();
    instance.stdin.write("\r");
    await settle();
    instance.stdin.write("test selection");
    await settle();
    instance.stdin.write("\r");
    await settle();

    expect(persisted).toEqual({
      engine: "forge",
      provider: "openai",
      id: "gpt-5.4-mini",
      reasoningEffort: "low",
    });
    expect(receivedOptions).toMatchObject({
      provider: "openai",
      model: "gpt-5.4-mini",
      reasoningEffort: "low",
    });
    instance.unmount();
  });

  it("discovers subscription models and routes the selection to Codex", async () => {
    const root = await createWorkspace();
    let persisted: unknown;
    let codexOptions: unknown;
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const instance = render(
      <InteractiveApp
        options={{}}
        env={{}}
        cwd={root}
        discoverSubscriptionModels={async () => [
          {
            id: "gpt-subscription-test",
            model: "gpt-subscription-test",
            displayName: "GPT Subscription Test",
            description: "fake model",
            hidden: false,
            supportedReasoningEfforts: [
              { reasoningEffort: "high", description: "deep" },
            ],
            defaultReasoningEffort: "high",
            inputModalities: ["text"],
            isDefault: true,
          },
          {
            id: "gpt-5.4-subscription",
            model: "gpt-5.4-subscription",
            displayName: "GPT-5.4",
            description: "same visible model name as API choice",
            hidden: false,
            supportedReasoningEfforts: [
              { reasoningEffort: "high", description: "deep" },
            ],
            defaultReasoningEffort: "high",
            inputModalities: ["text"],
            isDefault: false,
          },
        ]}
        persistModelSelection={async (value) => {
          persisted = value.selection;
          return "/tmp/forge-config.json";
        }}
        executeCodexTask={async (_prompt, options) => {
          codexOptions = options;
          return 0;
        }}
      />,
    );

    await settle();
    instance.stdin.write("/model");
    await settle();
    instance.stdin.write("\r");
    await settle();
    expect(instance.lastFrame()).toContain("GPT Subscription Test · high");
    instance.stdin.write("\r");
    await settle();
    instance.stdin.write("use subscription");
    await settle();
    instance.stdin.write("\r");
    await settle();

    expect(persisted).toMatchObject({
      engine: "codex",
      provider: "openai",
      id: "gpt-subscription-test",
      reasoningEffort: "high",
    });
    expect(codexOptions).toMatchObject({
      engine: "codex",
      model: "gpt-subscription-test",
      reasoningEffort: "high",
    });
    expect(
      consoleError.mock.calls.some(([message]) =>
        String(message).includes("same key"),
      ),
    ).toBe(false);
    instance.unmount();
  });

  it("renders Codex Engine Markdown output in the transcript", async () => {
    const root = await createWorkspace();
    const instance = render(
      <InteractiveApp
        options={{
          engine: "codex",
          provider: "openai",
          model: "gpt-5.6-luna",
          reasoningEffort: "medium",
        }}
        env={{}}
        cwd={root}
        executeCodexTask={async (_prompt, _options, dependencies) => {
          const fence = String.fromCharCode(96).repeat(3);
          dependencies.onOutput?.({ type: "answer", text: "" });
          dependencies.onOutput?.({
            type: "answer",
            text: [
              "# Project",
              "",
              "1. First step",
              "",
              `${fence}ts`,
              "const x = 1;",
              fence,
              "",
            ].join("\n"),
          });
          return 0;
        }}
      />,
    );

    await settle();
    instance.stdin.write("explain this project");
    await settle();
    instance.stdin.write("\r");
    await settle();

    expect(instance.lastFrame()).toContain("Project");
    expect(instance.lastFrame()).toContain("First step");
    expect(instance.lastFrame()).toContain("const x = 1;");
    expect(instance.lastFrame()).toContain("gpt-5.6-luna · medium");
    expect(instance.lastFrame()).toContain(
      "Completed · gpt-5.6-luna · thinking effort: medium",
    );
    expect(instance.lastFrame()).not.toContain(
      `${String.fromCharCode(96).repeat(3)}ts`,
    );
    instance.unmount();
  });

  it("records completed Codex turns in the persistent session", async () => {
    const root = await createWorkspace();
    const sessionId = "5ca1ab1e-87c6-4a23-bf61-e346bbaf95ed";
    const recorded: Array<{ prompt: string; result: RunResult }> = [];
    const sessionPersistence: InteractiveSessionPersistence = {
      messages: [],
      sessionId: undefined,
      prepareRun: async () => sessionId,
      recordRun: async (prompt, result) => {
        recorded.push({ prompt, result });
      },
      clear: () => undefined,
      list: async () => [],
      resume: async () => [],
    };
    const instance = render(
      <InteractiveApp
        options={{ engine: "codex" }}
        env={{}}
        cwd={root}
        sessionPersistence={sessionPersistence}
        executeCodexTask={async (_prompt, _options, dependencies) => {
          dependencies.onOutput?.({ type: "answer", text: "Saved answer" });
          return 0;
        }}
      />,
    );

    await settle();
    instance.stdin.write("remember this");
    await settle();
    instance.stdin.write("\r");
    await settle();

    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      prompt: "remember this",
      result: { status: "completed", finalText: "Saved answer" },
    });
    instance.unmount();
  });

  it("starts a fresh persistent session with /new", async () => {
    const root = await createWorkspace();
    let clearCount = 0;
    const sessionPersistence: InteractiveSessionPersistence = {
      messages: [{ role: "user", content: "old conversation" }],
      sessionId: "5ca1ab1e-87c6-4a23-bf61-e346bbaf95ed",
      prepareRun: async () => "ed3ea721-c869-4912-a3c1-5f4c281ef99d",
      recordRun: async () => undefined,
      clear: () => {
        clearCount += 1;
      },
      list: async () => [],
      resume: async () => [],
    };
    const instance = render(
      <InteractiveApp
        options={{}}
        env={{}}
        cwd={root}
        sessionPersistence={sessionPersistence}
      />,
    );

    await settle();
    expect(instance.lastFrame()).toContain("old conversation");
    instance.stdin.write("/new");
    await settle();
    instance.stdin.write("\r");
    await settle();

    expect(clearCount).toBe(1);
    expect(instance.lastFrame()).not.toContain("old conversation");
    expect(instance.lastFrame()).toContain("Started a new session.");
    instance.unmount();
  });

  it("fuzzy-filters subscription models before selection", async () => {
    const root = await createWorkspace();
    let persisted: unknown;
    const instance = render(
      <InteractiveApp
        options={{}}
        env={{}}
        cwd={root}
        discoverSubscriptionModels={async () => [
          {
            id: "gpt-5.6-sol",
            model: "gpt-5.6-sol",
            displayName: "GPT-5.6-Sol",
            description: "fake model",
            hidden: false,
            supportedReasoningEfforts: [
              { reasoningEffort: "high", description: "deep" },
            ],
            defaultReasoningEffort: "high",
            inputModalities: ["text"],
            isDefault: true,
          },
          {
            id: "gpt-5.6-luna",
            model: "gpt-5.6-luna",
            displayName: "GPT-5.6-Luna",
            description: "fake model",
            hidden: false,
            supportedReasoningEfforts: [
              { reasoningEffort: "low", description: "fast" },
            ],
            defaultReasoningEffort: "low",
            inputModalities: ["text"],
            isDefault: false,
          },
        ]}
        persistModelSelection={async (value) => {
          persisted = value.selection;
          return "/tmp/forge-config.json";
        }}
      />,
    );

    await settle();
    instance.stdin.write("/model");
    await settle();
    instance.stdin.write("\r");
    await settle();
    instance.stdin.write("luna");
    await settle();

    expect(instance.lastFrame()).toContain("Search models: luna");
    expect(instance.lastFrame()).toContain("GPT-5.6-Luna · low");
    expect(instance.lastFrame()).not.toContain("GPT-5.6-Sol · high");

    instance.stdin.write("\r");
    await settle();
    expect(persisted).toMatchObject({
      engine: "codex",
      provider: "openai",
      id: "gpt-5.6-luna",
      reasoningEffort: "low",
    });
    instance.unmount();
  });

  it("selects an @ file and sends its structured path to the model", async () => {
    const root = await createWorkspace();
    let receivedPrompt = "";
    const instance = render(
      <InteractiveApp
        options={{}}
        env={{}}
        cwd={root}
        executeTask={async (prompt, _options, dependencies) => {
          receivedPrompt = prompt;
          dependencies.onResult?.(completed("done"));
          return 0;
        }}
      />,
    );

    await settle();
    instance.stdin.write("@exa");
    await settle();
    instance.stdin.write("\r");
    await settle();
    instance.stdin.write(" explain this");
    await settle();
    instance.stdin.write("\r");
    await settle();

    expect(receivedPrompt).toContain("@src/example file.ts explain this");
    expect(receivedPrompt).toContain(
      "Referenced files:\n- src/example file.ts",
    );
    instance.unmount();
  });

  it("inserts a newline for Shift+Enter and Meta+Enter", async () => {
    const root = await createWorkspace();
    let receivedPrompt = "";
    const instance = render(
      <InteractiveApp
        options={{}}
        env={{}}
        cwd={root}
        executeTask={async (prompt, _options, dependencies) => {
          receivedPrompt = prompt;
          dependencies.onResult?.(completed("done"));
          return 0;
        }}
      />,
    );

    await settle();
    instance.stdin.write("first");
    await settle();
    instance.stdin.write("\u001B[13;2u");
    await settle();
    expect(receivedPrompt).toBe("");
    instance.stdin.write("second");
    await settle();
    instance.stdin.write("\u001B\r");
    await settle();
    expect(receivedPrompt).toBe("");
    instance.stdin.write("third");
    await settle();
    instance.stdin.write("\r");
    await settle();

    expect(receivedPrompt).toBe("first\nsecond\nthird");
    instance.unmount();
  });

  it("moves keyboard ownership to approval and resumes after a decision", async () => {
    const root = await createWorkspace();
    let approved: boolean | undefined;
    const processTool = { name: "run_command", risk: "process" } as ForgeTool;
    const instance = render(
      <InteractiveApp
        options={{}}
        env={{}}
        cwd={root}
        executeTask={async (_prompt, _options, dependencies) => {
          approved = await dependencies.approvalChannel?.request(
            {
              call: {
                id: "command-1",
                name: "run_command",
                input: {
                  program: "pnpm",
                  args: ["test"],
                  cwd: ".",
                  timeoutMs: 60_000,
                },
              },
              tool: processTool,
              input: {
                program: "pnpm",
                args: ["test"],
                cwd: ".",
                timeoutMs: 60_000,
              },
            },
            dependencies.signal,
            {
              workspace: { root, cwd: root },
              signal: dependencies.signal,
              limits: { maxOutputBytes: 65_536, maxEntries: 200 },
            },
          );
          dependencies.onResult?.(completed("done"));
          return 0;
        }}
      />,
    );

    await settle();
    instance.stdin.write("run tests");
    await settle();
    instance.stdin.write("\r");
    await settle();
    expect(instance.lastFrame()).toContain("Approval required");
    expect(instance.lastFrame()).toContain("$ pnpm test");
    expect(instance.lastFrame()).toContain("Working directory  .");
    expect(instance.lastFrame()).toContain("Timeout            60s");
    instance.stdin.write("y");
    await settle();

    expect(approved).toBe(true);
    expect(instance.lastFrame()).toContain("Enter submit");
    instance.unmount();
  });

  it("renders reasoning and answers as distinct structured blocks", async () => {
    const root = await createWorkspace();
    let usedStructuredEvents = false;
    const instance = render(
      <InteractiveApp
        options={{}}
        env={{}}
        cwd={root}
        executeTask={async (_prompt, _options, dependencies) => {
          usedStructuredEvents = dependencies.renderEventsToOutput === false;
          await dependencies.onEvent?.({
            type: "model.reasoning",
            step: 1,
            text: "Inspecting the request.",
          });
          await dependencies.onEvent?.({
            type: "model.text",
            step: 1,
            text: "Here is the result.",
          });
          dependencies.onResult?.(completed("Here is the result."));
          return 0;
        }}
      />,
    );

    await settle();
    instance.stdin.write("hello");
    await settle();
    instance.stdin.write("\r");
    await settle();

    expect(usedStructuredEvents).toBe(true);
    expect(instance.lastFrame()).toContain("◆ Reasoning");
    expect(instance.lastFrame()).toContain("Inspecting the request.");
    expect(instance.lastFrame()).toContain("● Answer");
    expect(instance.lastFrame()).toContain("Here is the result.");
    expect(instance.lastFrame()).not.toContain("[reasoning]");
    instance.unmount();
  });

  it("renders at narrow and wide terminal widths", async () => {
    const root = await createWorkspace();
    const app = <InteractiveApp options={{}} env={{}} cwd={root} />;
    const narrow = renderToString(app, { columns: 40 });
    const wide = renderToString(app, { columns: 100 });

    expect(narrow).toContain("Forge");
    expect(wide).toContain("Forge");
    expect(narrow).not.toBe(wide);
  });

  it("opens /resume picker and restores the selected conversation", async () => {
    const root = await createWorkspace();
    const sessionId = "5ca1ab1e-87c6-4a23-bf61-e346bbaf95ed";
    const summary: SessionSummary = {
      id: sessionId,
      updatedAt: "2026-08-18T10:00:00.000Z",
      workspaceRoot: root,
      workingDirectory: root,
      title: "Previous task",
      messageCount: 2,
      runCount: 1,
      lastRunStatus: "completed",
    };
    const sessionPersistence: InteractiveSessionPersistence = {
      messages: [],
      sessionId: undefined,
      prepareRun: async () => sessionId,
      recordRun: async () => undefined,
      clear: () => undefined,
      list: async () => [summary],
      resume: async () => [
        { role: "user", content: "Previous task" },
        { role: "assistant", content: "Previous answer" },
      ],
    };
    const instance = render(
      <InteractiveApp
        options={{}}
        env={{}}
        cwd={root}
        sessionPersistence={sessionPersistence}
      />,
    );

    await settle();
    instance.stdin.write("/resume");
    await settle();
    instance.stdin.write("\r");
    await settle();
    expect(instance.lastFrame()).toContain("Resume saved session");
    expect(instance.lastFrame()).toContain("Previous task");
    instance.stdin.write("\r");
    await settle();

    expect(instance.lastFrame()).toContain("Previous answer");
    expect(instance.lastFrame()).toContain(`Resumed session ${sessionId}`);
    instance.unmount();
  });
});

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "forge-ink-"));
  temporaryDirectories.push(root);
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "example file.ts"), "export {};\n");
  return root;
}

function completed(finalText: string): RunResult {
  return {
    status: "completed",
    exitCode: 0,
    finalText,
    modelSteps: 1,
    toolCalls: 0,
    events: [],
  };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 30));
}

/** Remove OSC 8 hyperlinks and SGR colors to leave the visible display text. */
function stripSequences(frame: string): string {
  return (
    frame
      // biome-ignore lint/suspicious/noControlCharactersInRegex: matching terminal escape sequences is the purpose of this helper.
      .replaceAll(/\u001B\]8;;[^\u0007]*\u0007/gu, "")
      // biome-ignore lint/suspicious/noControlCharactersInRegex: matching terminal escape sequences is the purpose of this helper.
      .replaceAll(/\u001B\[[0-9;]*m/gu, "")
  );
}
