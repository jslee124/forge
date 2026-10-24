/// <reference lib="dom" />
/// <reference types="vite/client" />
/// <reference path="./env.d.ts" />
// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopState } from "../../shared/application-protocol.js";
import type { RunCommand, RunEvent } from "../../shared/run-protocol.js";
import "./i18n.js";
import { LiveWorkbench } from "./live-workbench.js";

vi.mock("./markdown.js", () => ({ Markdown: () => null }));
vi.mock("./file-preview.js", () => ({
  ContentPreview: () => null,
  DiffViewer: () => null,
}));
vi.mock("./settings-view.js", () => ({ SettingsView: () => null }));

let root: Root;
let container: HTMLDivElement;
let onEvent: (event: RunEvent) => void;
const runCommand = vi.fn(async (_command: RunCommand) => true);
const state: DesktopState = {
  forgeHome: "/tmp/forge-test",
  cwd: "/tmp/workspace",
  sessionId: "test-session",
  model: "test-model",
  provider: "deepseek",
  sessions: [],
  messages: [],
  context: "",
  auth: "unknown",
  loginUrl: "",
  loginCode: "",
  codexModels: [],
};

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("forgeDesktop", {
    ...window.forgeDesktop,
    platform: "darwin",
    manage: vi.fn(async () => state),
    runCommand,
    onRunEvent: (listener: (event: RunEvent) => void) => {
      onEvent = listener;
      return () => {};
    },
  });
  runCommand.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(LiveWorkbench)));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function composer() {
  const textarea = container.querySelector("textarea");
  if (!textarea) throw new Error("Composer is missing");
  return textarea;
}

async function draft(text: string) {
  const textarea = composer();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    if (!setter) throw new Error("Textarea value setter is missing");
    setter.call(textarea, text);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return textarea;
}

async function key(options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", {
    key: "Enter",
    bubbles: true,
    cancelable: true,
    ...options,
  });
  await act(async () => {
    composer().dispatchEvent(event);
  });
  return event;
}

describe("live composer keyboard and failure feedback", () => {
  it.each([{}, { metaKey: true }, { ctrlKey: true }])(
    "sends with Enter, retaining existing modifier shortcuts: %j",
    async (modifiers) => {
      await draft("hello");
      expect((await key(modifiers)).defaultPrevented).toBe(true);
      expect(runCommand).toHaveBeenCalledWith(
        expect.objectContaining({ type: "start", prompt: "hello" }),
      );
      await key();
      expect(runCommand).toHaveBeenCalledTimes(1);
    },
  );

  it.each([{ shiftKey: true }, { isComposing: true }, { keyCode: 229 }])(
    "preserves newline and IME input: %j",
    async (options) => {
      await draft("hello");
      expect((await key(options)).defaultPrevented).toBe(false);
      expect(runCommand).not.toHaveBeenCalled();
    },
  );

  it("keeps Shift+Enter as a newline with slash suggestions open", async () => {
    await draft("/help");
    expect((await key({ shiftKey: true })).defaultPrevented).toBe(false);
    expect(composer().value).toBe("/help");
    expect((await key()).defaultPrevented).toBe(true);
    expect(composer().value).toBe("");
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("does not start an empty run", async () => {
    await draft("   ");
    await key();
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("retains the original failure reason before the final startup code", async () => {
    await draft("hello");
    await key();
    const start = runCommand.mock.calls[0]?.[0];
    if (start?.type !== "start") throw new Error("Run did not start");
    await act(async () => {
      for (const [index, text] of [
        "Configuration error: undeclared plugin capability",
        "native-start-failed",
      ].entries()) {
        onEvent({
          ...start,
          type: "run-event",
          sequence: index + 1,
          payload: { type: "detail", kind: "error", text },
        });
      }
      onEvent({
        ...start,
        type: "run-event",
        sequence: 3,
        payload: { type: "complete", outcome: "failed" },
      });
    });
    expect(container.querySelector('[role="alert"] pre')?.textContent).toBe(
      "Configuration error: undeclared plugin capability\nnative-start-failed",
    );
    expect(composer().value).toBe("hello");
  });
});
