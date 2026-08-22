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
import type {
  ContextStatus,
  InteractiveSessionPersistence,
} from "./persistent-session.js";

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

  it("renders the Forge wordmark and entry hints", () => {
    const root = "/tmp/forge-header-test";
    const frame = renderToString(
      <InteractiveApp options={{}} env={{}} cwd={root} />,
    );

    expect(frame).toContain(" _____ ___  ____   ____ _____");
    expect(frame).toContain("/ ___| ____|");
    expect(frame).not.toContain("████  ███  ███  ███  ████");
    expect(frame).toContain("/login provider");
    expect(frame).toContain("@ files");
  });

  it("left-aligns and pads startup content inside the header frame", () => {
    const frame = renderToString(
      <InteractiveApp options={{}} env={{}} cwd="/tmp/forge-header-left" />,
    );
    const lines = frame.split("\n");
    const wordmarkIndex = lines.findIndex((line) => line.includes("____"));
    const wordmarkLine = lines[wordmarkIndex];

    expect(wordmarkLine).toMatch(/│ {2} _____/u);
    expect(lines[wordmarkIndex - 1]).toMatch(/│\s+│$/u);
  });

  it("lists detected plugins and skills inside the blue startup frame", () => {
    const frame = renderToString(
      <InteractiveApp
        options={{}}
        env={{}}
        cwd="/tmp/forge-header-resources"
        detectedResources={{
          plugins: [
            {
              name: "web-tools",
              version: "1.0.0",
              scope: "project",
              state: "trusted",
              capabilities: ["tools:register", "network:access"],
            },
            {
              name: "local-preview",
              version: "0.1.0",
              scope: "project",
              state: "untrusted",
              capabilities: ["tools:register"],
            },
          ],
          skills: [{ name: "review", path: "/tmp/review/SKILL.md" }],
        }}
      />,
    );
    const compactFrame = frame.replace(/[│\s]+/gu, " ");

    expect(frame).toContain("Plugins");
    expect(frame).toContain("web-tools (project, trusted)");
    expect(compactFrame).toContain(
      "local-preview (project, untrusted, skipped)",
    );
    expect(frame).toContain("Skills");
    expect(frame).toContain("$review");
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

  it("reviews and trusts project plugins inside the TUI", async () => {
    const root = await createWorkspace();
    const untrustedResources = {
      plugins: [
        {
          name: "web-tools",
          version: "1.0.0",
          scope: "project" as const,
          state: "untrusted" as const,
          capabilities: ["tools:register", "network:access"] as const,
        },
      ],
      skills: [],
    };
    let requestedTrust: boolean | undefined;
    const instance = render(
      <InteractiveApp
        options={{}}
        env={{}}
        cwd={root}
        detectedResources={untrustedResources}
        updateProjectPluginTrust={async (trusted) => {
          requestedTrust = trusted;
          return {
            ...untrustedResources,
            plugins: untrustedResources.plugins.map((plugin) => ({
              ...plugin,
              state: "trusted" as const,
            })),
          };
        }}
      />,
    );

    await settle();
    instance.stdin.write("/plugins");
    await settle();
    instance.stdin.write("\r");
    await settle();

    expect(instance.lastFrame()).toContain("Plugins");
    expect(instance.lastFrame()).toContain(
      "Capabilities: tools:register, network:access",
    );
    expect(instance.lastFrame()).toContain(
      "t review and trust project plugins",
    );

    instance.stdin.write("t");
    await settle();
    expect(instance.lastFrame()).toContain("Trust project plugins?");
    expect(instance.lastFrame()).toContain("full local privileges of Forge");
    expect(requestedTrust).toBeUndefined();

    instance.stdin.write("y");
    await settle();
    expect(requestedTrust).toBe(true);
    expect(instance.lastFrame()).toContain("web-tools (project, trusted)");
    expect(instance.lastFrame()).toContain(
      "They will load on the next Forge task",
    );
    instance.unmount();
  });

  it("renders /context as a readable budget panel", async () => {
    const root = await createWorkspace();
    const contextStatus: ContextStatus = {
      provider: "deepseek",
      modelId: "deepseek-v4-flash",
      mode: "warn",
      contextWindowTokens: 32_768,
      reservedOutputTokens: 4_096,
      bufferTokens: 8_192,
      effectiveReserveTokens: 8_192,
      availableInputTokens: 24_576,
      recentTailTokens: 12_000,
      summaryTargetTokens: 1_200,
      canonicalMessageCount: 8,
      activeTailMessageCount: 3,
      activeTailStartIndex: 5,
      estimatedTranscriptTokens: 10_240,
      projectedCompactedTokens: 4_096,
      checkpoint: {
        status: "valid",
        strategy: "forge-summary",
        summarizedMessageCount: 5,
        estimatedTokens: 1_200,
      },
    };
    const sessionPersistence: InteractiveSessionPersistence = {
      messages: [],
      sessionId: undefined,
      prepareRun: async () => "session-id",
      recordRun: async () => undefined,
      clear: () => undefined,
      list: async () => [],
      resume: async () => [],
      contextDetails: () => contextStatus,
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
    instance.stdin.write("/context");
    await settle();
    instance.stdin.write("\r");
    await settle();

    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("Context window");
    expect(frame).toContain("42% history");
    expect(frame).toContain("deepseek/deepseek-v4-flash");
    expect(frame).toContain("Conversation");
    expect(frame).toContain("forge-summary ready");
    expect(frame).not.toContain("Configured categories:");
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
    expect(instance.lastFrame()).toContain("Choose model");
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

  it("selects MiMo models and exposes only MiMo-supported efforts", async () => {
    const root = await createWorkspace();
    let persisted: unknown;
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
      />,
    );

    await settle();
    instance.stdin.write("/model");
    await settle();
    instance.stdin.write("\r");
    await settle();
    instance.stdin.write("mimo-v2.5");
    await settle();
    expect(instance.lastFrame()).toContain("MiMo V2.5");
    instance.stdin.write("\r");
    await settle();
    expect(persisted).toEqual({
      engine: "forge",
      provider: "mimo",
      id: "mimo-v2.5",
      reasoningEffort: "medium",
    });

    instance.stdin.write("/effort");
    await settle();
    instance.stdin.write("\r");
    await settle();
    expect(instance.lastFrame()).toContain("none · No reasoning");
    expect(instance.lastFrame()).toContain("high · Deep");
    expect(instance.lastFrame()).not.toContain("minimal · Fastest");
    expect(instance.lastFrame()).not.toContain("xhigh · Deeper");
    expect(instance.lastFrame()).not.toContain("max · Maximum");
    instance.unmount();
  });

  it("changes thinking effort independently with /effort", async () => {
    const root = await createWorkspace();
    let persisted: unknown;
    const instance = render(
      <InteractiveApp
        options={{
          engine: "forge",
          provider: "openai",
          model: "gpt-5.4-mini",
          reasoningEffort: "low",
        }}
        env={{}}
        cwd={root}
        persistModelSelection={async (value) => {
          persisted = value.selection;
          return "/tmp/forge-config.json";
        }}
      />,
    );

    await settle();
    instance.stdin.write("/effort");
    await settle();
    instance.stdin.write("\r");
    await settle();
    expect(instance.lastFrame()).toContain("Choose thinking effort");
    expect(instance.lastFrame()).toContain("low · Fast · current");
    instance.stdin.write("\u001B[B");
    await settle();
    instance.stdin.write("\r");
    await settle();

    expect(persisted).toEqual({
      engine: "forge",
      provider: "openai",
      id: "gpt-5.4-mini",
      reasoningEffort: "medium",
    });
    expect(instance.lastFrame()).toContain("gpt-5.4-mini · medium");
    instance.unmount();
  });

  it("accepts /effort <level> and Shift+Tab cycles effort", async () => {
    const root = await createWorkspace();
    const persisted: unknown[] = [];
    const instance = render(
      <InteractiveApp
        options={{
          engine: "forge",
          provider: "openai",
          model: "gpt-5.4-mini",
          reasoningEffort: "low",
        }}
        env={{}}
        cwd={root}
        persistModelSelection={async (value) => {
          persisted.push(value.selection);
          return "/tmp/forge-config.json";
        }}
      />,
    );

    await settle();
    instance.stdin.write("/effort high");
    await settle();
    instance.stdin.write("\r");
    await settle();
    expect(persisted.at(-1)).toMatchObject({ reasoningEffort: "high" });

    instance.stdin.write("\u001B[Z");
    await settle();
    expect(persisted.at(-1)).toMatchObject({ reasoningEffort: "xhigh" });
    expect(instance.lastFrame()).toContain("gpt-5.4-mini · xhigh");
    instance.unmount();
  });

  it("uses the selected Codex model's advertised effort levels", async () => {
    const root = await createWorkspace();
    let persisted: unknown;
    const instance = render(
      <InteractiveApp
        options={{
          engine: "codex",
          provider: "openai",
          model: "gpt-subscription-test",
          reasoningEffort: "low",
        }}
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
              { reasoningEffort: "low", description: "fast" },
              { reasoningEffort: "high", description: "deep" },
            ],
            defaultReasoningEffort: "high",
            inputModalities: ["text"],
            isDefault: true,
          },
        ]}
        persistModelSelection={async (value) => {
          persisted = value.selection;
          return "/tmp/forge-config.json";
        }}
      />,
    );

    await settle();
    instance.stdin.write("/effort");
    await settle();
    instance.stdin.write("\r");
    await settle();
    expect(instance.lastFrame()).toContain("low · fast · current");
    expect(instance.lastFrame()).toContain("high · deep");
    expect(instance.lastFrame()).not.toContain("medium · Balanced");
    instance.stdin.write("\u001B[B");
    await settle();
    instance.stdin.write("\r");
    await settle();

    expect(persisted).toMatchObject({
      engine: "codex",
      id: "gpt-subscription-test",
      reasoningEffort: "high",
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
    expect(instance.lastFrame()).toContain("GPT Subscription Test");
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
          dependencies.onOutput?.({
            type: "reasoning",
            text: "Saved reasoning",
          });
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
    expect(recorded[0]?.result.events).toContainEqual({
      type: "model.reasoning",
      step: 1,
      text: "Saved reasoning",
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
    expect(instance.lastFrame()).toContain("GPT-5.6-Luna");
    expect(instance.lastFrame()).not.toContain("GPT-5.6-Sol");

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

  it("attaches an @ mentioned workspace image to the vision request", async () => {
    const root = await createWorkspace();
    await writeFile(
      path.join(root, "screenshot.png"),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    let receivedOptions: unknown;
    const instance = render(
      <InteractiveApp
        options={{
          provider: "deepseek",
          model: "deepseek-v4-flash-vision-exp",
        }}
        env={{}}
        cwd={root}
        executeTask={async (_prompt, options, dependencies) => {
          receivedOptions = options;
          dependencies.onResult?.(completed("done"));
          return 0;
        }}
      />,
    );

    await settle();
    instance.stdin.write("@screen");
    await settle();
    instance.stdin.write("\r");
    await settle();
    instance.stdin.write(" inspect this");
    await settle();
    instance.stdin.write("\r");
    await settle();

    expect(receivedOptions).toMatchObject({ image: ["screenshot.png"] });
    instance.unmount();
  });

  it("attaches a pasted screenshot path outside the workspace", async () => {
    const root = await createWorkspace();
    const screenshots = await mkdtemp(
      path.join(tmpdir(), "forge-pasted-screenshot-"),
    );
    temporaryDirectories.push(screenshots);
    const screenshot = path.join(screenshots, "image-1.png");
    await writeFile(
      screenshot,
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    let receivedPrompt = "";
    let receivedOptions: unknown;
    const instance = render(
      <InteractiveApp
        options={{
          provider: "deepseek",
          model: "deepseek-v4-flash-vision-exp",
        }}
        env={{}}
        cwd={root}
        executeTask={async (prompt, options, dependencies) => {
          receivedPrompt = prompt;
          receivedOptions = options;
          dependencies.onResult?.(completed("done"));
          return 0;
        }}
      />,
    );

    await settle();
    instance.stdin.write(`\u001B[200~${screenshot} 这是什么图\u001B[201~`);
    await settle();
    expect(instance.lastFrame()).toContain("[Image #1] image-1.png");
    expect(instance.lastFrame()).not.toContain("Unknown command");
    instance.stdin.write("\r");
    await settle();

    expect(receivedOptions).toMatchObject({ image: [screenshot] });
    expect(receivedPrompt).toContain("这是什么图");
    expect(receivedPrompt).toContain(
      "Attached images:\n- [Image #1] image-1.png",
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

  it("shows the network tool and destination before approval", async () => {
    const root = await createWorkspace();
    let approved: boolean | undefined;
    const networkTool = { name: "web_fetch", risk: "network" } as ForgeTool;
    const instance = render(
      <InteractiveApp
        options={{}}
        env={{}}
        cwd={root}
        executeTask={async (_prompt, _options, dependencies) => {
          approved = await dependencies.approvalChannel?.request(
            {
              call: {
                id: "network-1",
                name: "web_fetch",
                input: { url: "https://example.com/docs" },
              },
              tool: networkTool,
              input: { url: "https://example.com/docs" },
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
    instance.stdin.write("fetch docs");
    await settle();
    instance.stdin.write("\r");
    await settle();
    expect(instance.lastFrame()).toContain("Approval required");
    expect(instance.lastFrame()).toContain("Network web_fetch");
    expect(instance.lastFrame()).toContain("https://example.com/docs");
    instance.stdin.write("y");
    await settle();

    expect(approved).toBe(true);
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

  it("shows when the provider used hidden reasoning tokens", async () => {
    const root = await createWorkspace();
    const instance = render(
      <InteractiveApp
        options={{}}
        env={{}}
        cwd={root}
        executeTask={async (_prompt, _options, dependencies) => {
          await dependencies.onEvent?.({
            type: "model.reasoning-unavailable",
            step: 1,
            reasoningTokens: 42,
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

    expect(instance.lastFrame()).toContain("◆ Reasoning");
    expect(instance.lastFrame()).toContain(
      "Provider used 42 reasoning tokens but did not return reasoning text.",
    );
    instance.unmount();
  });

  it("renders at narrow and wide terminal widths", async () => {
    const root = await createWorkspace();
    const app = <InteractiveApp options={{}} env={{}} cwd={root} />;
    const narrow = renderToString(app, { columns: 60 });
    const wide = renderToString(app, { columns: 100 });

    expect(narrow).toContain(" _____ ___  ____   ____ _____");
    expect(wide).toContain(" _____ ___  ____   ____ _____");
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
      reasoning: [{ assistantMessageIndex: 1, content: "Previous reasoning" }],
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
    expect(instance.lastFrame()).toContain("Previous reasoning");
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
