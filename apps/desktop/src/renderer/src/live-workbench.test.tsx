/// <reference lib="dom" />
/// <reference types="vite/client" />
/// <reference path="./env.d.ts" />
// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopState } from "../../shared/application-protocol.js";
import type {
  RunCommand,
  RunEvent,
  RunPayload,
} from "../../shared/run-protocol.js";
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
  runCommand.mockReset();
  runCommand.mockResolvedValue(true);
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

async function deliver(payload: RunPayload, sequence = 1) {
  const start = runCommand.mock.calls[0]?.[0];
  if (start?.type !== "start") throw new Error("Run did not start");
  await act(async () => {
    onEvent({
      ...start,
      type: "run-event",
      schemaVersion: 2,
      occurredAt: new Date().toISOString(),
      sequence,
      payload,
    });
  });
}

describe("live composer keyboard and failure feedback", () => {
  it("keeps the next draft on completion and shows a specific budget outcome", async () => {
    await draft("original request");
    await key();
    expect(composer().value).toBe("");
    await draft("next draft");
    await deliver({
      type: "complete",
      outcome: "limit_reached",
      reason: "model_step_limit",
      modelSteps: 12,
      toolCalls: 8,
    });
    expect(composer().value).toBe("next draft");
    expect(container.textContent).toContain("已达到模型步骤上限");
    expect(container.textContent).toContain("8 项工具操作");
  });

  it("retains a newer draft when a successful run finishes", async () => {
    await draft("original request");
    await key();
    await draft("next draft");
    await deliver({ type: "complete", outcome: "completed" });
    expect(composer().value).toBe("next draft");
    expect(container.textContent).toContain("回答已完成");
  });

  it("queues approvals, focuses Deny, and keeps a request after a rejected response", async () => {
    await draft("hello");
    await key();
    const descriptor = {
      actionId: "action1",
      effect: "process" as const,
      resource: "/tmp/workspace",
      preview: "node check.js",
      input: "{}",
      riskFlags: [],
    };
    await deliver({
      type: "approval",
      approvalId: "approval1",
      description: "node check.js",
      descriptor,
    });
    await deliver(
      { type: "approval", approvalId: "approval2", description: "next" },
      2,
    );
    const card = container.querySelector(".run-approval");
    expect(card?.textContent).toContain("2 项待确认");
    const deny = card?.querySelector("button");
    expect(document.activeElement).toBe(deny);
    const allow = card?.querySelector("button.run-approval-allow");
    if (!(allow instanceof HTMLButtonElement))
      throw new Error("Missing allow button");
    runCommand.mockResolvedValueOnce(false);
    await act(async () => allow.click());
    expect(runCommand).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "approve",
        approvalId: "approval1",
        actionId: "action1",
      }),
    );
    expect(container.querySelector(".run-approval")?.textContent).toContain(
      "node check.js",
    );
    await deliver(
      { type: "approval-resolved", approvalId: "approval1", allow: false },
      3,
    );
    expect(container.querySelector(".run-approval")?.textContent).toContain(
      "next",
    );
    expect(container.querySelector(".spinner")).toBeNull();
  });

  it("keeps the approval available if cancellation is rejected", async () => {
    await draft("hello");
    await key();
    await deliver({
      type: "approval",
      approvalId: "pending",
      description: "pwd",
    });
    const stop = container.querySelector(
      ".studio-composer-footer > button:last-child",
    );
    if (!(stop instanceof HTMLButtonElement))
      throw new Error("Missing stop button");
    runCommand.mockResolvedValueOnce(false);
    await act(async () => stop.click());
    expect(runCommand).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "cancel" }),
    );
    const allow = container.querySelector(".run-approval-allow");
    expect(allow).toBeInstanceOf(HTMLButtonElement);
    expect((allow as HTMLButtonElement).disabled).toBe(false);
    expect(container.querySelector(".run-approval")?.textContent).toContain(
      "pwd",
    );
    await deliver({ type: "complete", outcome: "cancelled" }, 2);
    expect(container.querySelector(".run-approval")).toBeNull();
  });
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
          schemaVersion: 2,
          occurredAt: new Date().toISOString(),
          sequence: index + 1,
          payload: { type: "detail", kind: "error", text },
        });
      }
      onEvent({
        ...start,
        type: "run-event",
        schemaVersion: 2,
        occurredAt: new Date().toISOString(),
        sequence: 3,
        payload: { type: "complete", outcome: "failed" },
      });
    });
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.textContent).toContain(
      "Configuration error: undeclared plugin capability",
    );
    expect(container.textContent).toContain("native-start-failed");
    expect(composer().value).toBe("hello");
  });
});
