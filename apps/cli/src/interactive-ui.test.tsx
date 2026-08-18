import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ForgeTool, RunResult } from "@forge/core";
import { renderToString } from "ink";
import { render } from "ink-testing-library";
import { afterEach, describe, expect, it } from "vitest";

import {
  INK_INCREMENTAL_RENDERING,
  INK_KEYBOARD_MODE,
  InteractiveApp,
} from "./interactive-ui.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Ink interactive terminal", () => {
  it("disables keyboard capability probing that leaks into VS Code input", () => {
    expect(INK_KEYBOARD_MODE).toBe("disabled");
  });

  it("uses full-frame updates so terminal resize cannot leave stale rows", () => {
    expect(INK_INCREMENTAL_RENDERING).toBe(false);
  });

  it("shows an honest Shift+Enter hint in VS Code terminals", async () => {
    const root = await createWorkspace();
    const instance = render(
      <InteractiveApp
        options={{}}
        env={{ TERM_PROGRAM: "vscode" }}
        cwd={root}
      />,
    );

    expect(instance.lastFrame()).toContain("Ctrl+J newline");
    expect(instance.lastFrame()).toContain("configure Shift+Enter in VS Code");
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

  it("inserts a newline for Shift+Enter and submits only on plain Enter", async () => {
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
    instance.stdin.write("\r");
    await settle();

    expect(receivedPrompt).toBe("first\nsecond");
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
