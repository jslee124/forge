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
    expect(instance.lastFrame()).toContain(
      "Using gpt-5.6-luna · thinking effort: medium",
    );
    expect(instance.lastFrame()).toContain(
      "Completed · gpt-5.6-luna · thinking effort: medium",
    );
    expect(instance.lastFrame()).not.toContain(
      `${String.fromCharCode(96).repeat(3)}ts`,
    );
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
