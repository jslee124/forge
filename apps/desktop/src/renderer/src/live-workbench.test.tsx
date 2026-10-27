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
import i18n from "./i18n.js";
import { LiveWorkbench } from "./live-workbench.js";

vi.mock("./markdown.js", () => ({
  Markdown: ({ children }: { children: string }) =>
    createElement("p", null, children),
}));
vi.mock("./file-preview.js", () => ({
  ContentPreview: () => null,
  DiffViewer: () => null,
}));
vi.mock("./settings-view.js", () => ({
  SettingsView: ({ onBack }: { onBack: () => void }) =>
    createElement(
      "button",
      { type: "button", onClick: onBack, "data-testid": "settings-back" },
      "back",
    ),
}));

let root: Root;
let container: HTMLDivElement;
let onEvent: (event: RunEvent) => void;
const runCommand = vi.fn(async (_command: RunCommand) => true);
const state: DesktopState = {
  readiness: { ready: true },
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
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
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
  await i18n.changeLanguage("zh-CN");
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
  await act(async () => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
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

describe("reviewed recovery", () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute("open");
    };
    vi.mocked(window.forgeDesktop.manage).mockImplementation(
      async (command) => {
        const source = runCommand.mock.calls[0]?.[0];
        const current: DesktopState = {
          ...state,
          defaultSelection: {
            engine: "native",
            provider: "deepseek",
            model: "test-model",
            effort: "high",
          },
          runHistory: {
            runs:
              source?.type === "start"
                ? [
                    {
                      schemaVersion: 1,
                      sessionId: source.sessionId,
                      runId: source.runId,
                      engine: "native",
                      prompt: "original request",
                      state: "finished",
                      startedAt: new Date().toISOString(),
                      updatedAt: new Date().toISOString(),
                      sequence: 1,
                      omittedCharacters: 0,
                      omittedEvents: 0,
                    },
                  ]
                : [],
          },
        };
        if (command.type === "prepare-recovery")
          current.recoveryPlan = {
            token: "review-token",
            ...(command.responseLocale
              ? { responseLocale: command.responseLocale }
              : {}),
            sessionId: state.sessionId as string,
            sourceRunId: command.sourceRunId,
            kind: command.kind,
            prompt:
              command.kind === "retry"
                ? "original request"
                : "Summarize recorded facts",
            selection: {
              engine: "native",
              provider: "deepseek",
              model: "test-model",
              effort: "high",
            },
            permissionProfile: "safe",
            maxModelSteps: 1,
            maxToolCalls: 0,
            incomplete: true,
          };
        return current;
      },
    );
  });

  async function finishedSource() {
    await draft("original request");
    await key();
    await deliver({
      type: "complete",
      outcome: "limit_reached",
      reason: "model_step_limit",
    });
    await draft("next draft");
  }
  async function click(selector: string) {
    const button = container.querySelector<HTMLButtonElement>(selector);
    if (!button || button.disabled)
      throw new Error(`Unavailable control: ${selector}`);
    await act(async () => button.click());
  }
  it.each(["en", "zh-CN"] as const)(
    "reviews a %s summary before starting and preserves the next draft",
    async (responseLocale) => {
      await act(async () => {
        await i18n.changeLanguage(responseLocale);
      });
      await finishedSource();
      await click("[data-run-result=current] [data-recovery=summarize]");
      expect(runCommand).toHaveBeenCalledTimes(1);
      expect(window.forgeDesktop.manage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "prepare-recovery",
          responseLocale,
        }),
      );
      expect(container.querySelector("dialog")?.textContent).toContain(
        responseLocale === "zh-CN" ? "简体中文" : "English",
      );
      expect(container.querySelector("dialog")?.textContent).toContain(
        "test-model",
      );
      expect(document.activeElement).toBe(
        container.querySelector("dialog button"),
      );
      await click("dialog .studio-confirmation-actions button:last-child");
      expect(runCommand).toHaveBeenCalledTimes(2);
      expect(runCommand.mock.calls[1]?.[0]).toMatchObject({
        type: "start",
        prompt: "Summarize recorded facts",
        permissionProfile: "safe",
        recovery: { kind: "summarize", token: "review-token" },
      });
      expect(composer().value).toBe("next draft");
    },
  );
  it("keeps the draft on cancel and loads retry only after explicit replacement", async () => {
    await finishedSource();
    await click("[data-run-result=current] [data-recovery=retry]");
    await click("dialog .studio-confirmation-actions button:first-child");
    expect(composer().value).toBe("next draft");
    expect(runCommand).toHaveBeenCalledTimes(1);
    await click("[data-run-result=current] [data-recovery=retry]");
    await click("dialog .studio-confirmation-actions button:last-child");
    expect(composer().value).toBe("original request");
    expect(runCommand).toHaveBeenCalledTimes(1);
    expect(
      container.querySelector<HTMLButtonElement>(
        "[data-testid=composer-engine]",
      )?.disabled,
    ).toBe(true);
    await draft("edited original request");
    await key();
    expect(runCommand.mock.calls[1]?.[0]).toMatchObject({
      prompt: "edited original request",
      recovery: { kind: "retry", token: "review-token" },
    });
  });
});

describe("separate execution and conversation browsing", () => {
  let execution: DesktopState;
  let delayed: ((value: DesktopState) => void) | undefined;
  function snapshot(sessionId: string): DesktopState {
    return {
      ...execution,
      browsedSession: {
        sessionId,
        cwd: `/tmp/${sessionId}`,
        title: sessionId,
        messages: [
          {
            id: "saved-message",
            role: "assistant",
            kind: "answer",
            content: `saved ${sessionId} content`,
          },
        ],
        runHistory: { runs: [] },
        truncated: false,
      },
    };
  }
  beforeEach(async () => {
    execution = {
      ...state,
      sessions: [
        { id: state.sessionId, title: "task A", cwd: state.cwd },
        { id: "task-B", title: "task B", cwd: "/tmp/task-B" },
        { id: "task-C", title: "task C", cwd: "/tmp/task-C" },
      ],
    };
    delayed = undefined;
    vi.mocked(window.forgeDesktop.manage).mockImplementation(
      async (command) => {
        if (command.type === "browse-session") {
          if (command.sessionId === "task-C")
            return await new Promise<DesktopState>((resolve) => {
              delayed = resolve;
            });
          return snapshot(command.sessionId);
        }
        if (command.type === "resume")
          execution = {
            ...execution,
            sessionId: command.sessionId,
            cwd: `/tmp/${command.sessionId}`,
          };
        return execution;
      },
    );
    await act(async () => {
      root.unmount();
      root = createRoot(container);
      root.render(createElement(LiveWorkbench));
    });
  });
  async function click(selector: string) {
    const button = container.querySelector<HTMLButtonElement>(selector);
    if (!button || button.disabled) throw new Error(`Unavailable ${selector}`);
    await act(async () => button.click());
  }
  it("isolates messages and drafts, preserves scroll/disclosures and binds approvals to A", async () => {
    await draft("A prompt");
    await key();
    await draft("A next draft");
    await deliver({ type: "text", text: "live only A" });
    await deliver({ type: "detail", kind: "system", text: "A activity" }, 2);
    const transcript = container.querySelector(".live-transcript");
    const disclosure = container.querySelector<HTMLDetailsElement>(
      ".run-activity-disclosure",
    );
    if (!transcript || !disclosure) throw new Error("Missing active view");
    transcript.scrollTop = 123;
    disclosure.open = true;
    await click('[data-session-id="task-B"]');
    expect(composer().value).toBe("");
    expect(container.querySelector(".live-transcript")?.textContent).toContain(
      "saved task-B content",
    );
    expect(
      container.querySelector(".live-transcript")?.textContent,
    ).not.toContain("live only A");
    await draft("B draft");
    await key();
    expect(
      runCommand.mock.calls.filter(([command]) => command.type === "start"),
    ).toHaveLength(1);
    composer().focus();
    await deliver(
      { type: "approval", approvalId: "pending-A", description: "A command" },
      3,
    );
    expect(document.activeElement).toBe(composer());
    expect(container.querySelector(".run-approval")).toBeNull();
    expect(container.querySelector(".run-navigation")?.textContent).toContain(
      "1 项审批",
    );
    await click('[data-testid="return-active"]');
    expect(composer().value).toBe("A next draft");
    expect(container.querySelector(".live-transcript")?.textContent).toContain(
      "live only A",
    );
    expect(container.querySelector(".live-transcript")?.scrollTop).toBe(123);
    expect(
      container.querySelector<HTMLDetailsElement>(".run-activity-disclosure")
        ?.open,
    ).toBe(true);
    await click(".run-approval-allow");
    const start = runCommand.mock.calls[0]?.[0];
    expect(runCommand).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "approve",
        sessionId: state.sessionId,
        runId: start?.runId,
        approvalId: "pending-A",
      }),
    );
    await click('[data-session-id="task-B"]');
    expect(composer().value).toBe("B draft");
  });
  it("stops A from B and keeps B selected when A completes; continuation is explicit", async () => {
    await draft("A prompt");
    await key();
    await click('[data-session-id="task-B"]');
    await draft("B future request");
    await click('[data-testid="stop-active"]');
    expect(runCommand).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "cancel", sessionId: state.sessionId }),
    );
    await deliver({ type: "complete", outcome: "cancelled" }, 2);
    expect(
      container
        .querySelector(".live-transcript")
        ?.getAttribute("data-view-session"),
    ).toBe("task-B");
    expect(composer().value).toBe("B future request");
    expect(
      container.querySelector('[data-testid="resume-viewed"]'),
    ).not.toBeNull();
    await key();
    expect(
      runCommand.mock.calls.filter(([command]) => command.type === "start"),
    ).toHaveLength(1);
    await click('[data-testid="resume-viewed"]');
    expect(composer().value).toBe("B future request");
    await key();
    expect(
      runCommand.mock.calls.filter(
        ([command]) => command.type === "start",
      )[1]?.[0],
    ).toMatchObject({ sessionId: "task-B", prompt: "B future request" });
  });
  it("ignores a late snapshot after returning to the execution view", async () => {
    await draft("A prompt");
    await key();
    await deliver({ type: "text", text: "A stream" });
    await click('[data-session-id="task-B"]');
    await click('[data-session-id="task-C"]');
    expect(delayed).toBeTypeOf("function");
    await click('[data-testid="return-active"]');
    await act(async () => delayed?.(snapshot("task-C")));
    expect(
      container
        .querySelector(".live-transcript")
        ?.getAttribute("data-view-session"),
    ).toBe(state.sessionId);
    expect(container.querySelector(".live-transcript")?.textContent).toContain(
      "A stream",
    );
  });
  it("keeps B visible after successful A completion and shows A's refreshed answer on return", async () => {
    await draft("A prompt");
    await key();
    await click('[data-session-id="task-B"]');
    await draft("B stays here");
    execution = {
      ...execution,
      messages: [
        {
          id: "final-A",
          role: "assistant",
          kind: "answer",
          content: "completed A answer",
        },
      ],
    };
    await deliver({ type: "complete", outcome: "completed" }, 2);
    expect(container.querySelector(".live-transcript")?.textContent).toContain(
      "saved task-B content",
    );
    expect(
      container.querySelector(".live-transcript")?.textContent,
    ).not.toContain("completed A answer");
    expect(composer().value).toBe("B stays here");
    await click('[data-testid="return-active"]');
    expect(container.querySelector(".live-transcript")?.textContent).toContain(
      "completed A answer",
    );
  });
  it("can abandon the first pending snapshot without waiting for disk navigation", async () => {
    await draft("A prompt");
    await key();
    await click('[data-session-id="task-C"]');
    await click('[data-testid="return-active"]');
    await act(async () => delayed?.(snapshot("task-C")));
    expect(
      container
        .querySelector(".live-transcript")
        ?.getAttribute("data-view-session"),
    ).toBe(state.sessionId);
    expect(
      runCommand.mock.calls.filter(([command]) => command.type === "start"),
    ).toHaveLength(1);
  });
});

it("blocks missing credentials before creating or running, retaining the draft and offering configuration", async () => {
  const manage = vi.mocked(window.forgeDesktop.manage);
  manage.mockResolvedValueOnce({
    ...state,
    readiness: { ready: false, issue: "missing_credentials" },
  });
  await draft("keep my request");
  await key();
  expect(runCommand).not.toHaveBeenCalled();
  expect(manage.mock.calls.some(([command]) => command.type === "create")).toBe(
    false,
  );
  expect(composer().value).toBe("keep my request");
  expect(
    container.querySelector('[data-testid="setup-required"]')?.textContent,
  ).toContain("API 密钥");
  const configure = container.querySelector<HTMLButtonElement>(
    '[data-testid="setup-required"] button',
  );
  expect(configure?.textContent).toBe("配置模型");
  await act(async () => configure?.click());
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>("[data-testid=settings-back]")
      ?.click(),
  );
  expect(composer().value).toBe("keep my request");
});

it("hides budget recovery for a configuration error and links to model settings", async () => {
  await draft("request");
  await key();
  await deliver({
    type: "complete",
    outcome: "failed",
    reason: "configuration_error",
    message: "configuration-invalid",
  });
  expect(container.querySelector("[data-recovery=continue]")).toBeNull();
  expect(container.querySelector("[data-recovery=summarize]")).toBeNull();
  expect(
    container.querySelector("[data-run-result=current]")?.textContent,
  ).toContain("配置模型");
});

it.each([
  ["configuration_error", "provider-authentication-failed", "供应商拒绝访问"],
  ["disconnected", "provider-connection-failed", "模型连接中断"],
  ["execution_error", "provider-unavailable", "模型服务暂不可用"],
  ["execution_error", "provider-rate-limited", "供应商报告速率或额度限制"],
] as const)(
  "shows a specific provider failure and avoids unrelated budget actions",
  async (reason, message, label) => {
    await draft("request");
    await key();
    await deliver({ type: "complete", outcome: "failed", reason, message });
    expect(
      container.querySelector("[data-run-result=current]")?.textContent,
    ).toContain(label);
    expect(container.querySelector("[data-recovery=continue]")).toBeNull();
    if (reason === "configuration_error") {
      expect(container.querySelector("[data-recovery=retry]")).toBeNull();
      expect(
        container.querySelector("[data-run-result=current]")?.textContent,
      ).toContain("配置模型");
    } else
      expect(container.querySelector("[data-recovery=retry]")).not.toBeNull();
  },
);

describe("retained task entry", () => {
  it("opens the saved record without sending or fabricating conversation", async () => {
    const summary = {
      schemaVersion: 1 as const,
      sessionId: state.sessionId,
      runId: "crashed",
      engine: "native" as const,
      prompt: "恢复中文任务",
      state: "running" as const,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      sequence: 0,
      omittedCharacters: 0,
      omittedEvents: 0,
    };
    vi.mocked(window.forgeDesktop.manage).mockResolvedValue({
      ...state,
      sessions: [
        { id: state.sessionId, title: summary.prompt, cwd: state.cwd },
      ],
      runHistory: { runs: [summary] },
    });
    await act(async () => {
      root.unmount();
      root = createRoot(container);
      root.render(createElement(LiveWorkbench));
    });
    expect(container.querySelector(".studio-welcome")).toBeNull();
    expect(container.querySelector(".retained-task")?.textContent).toContain(
      summary.prompt,
    );
    const button = container.querySelector<HTMLButtonElement>(
      ".retained-task button",
    );
    expect(button).not.toBeNull();
    await act(async () => button?.click());
    expect(window.forgeDesktop.manage).toHaveBeenCalledWith({
      type: "run-history",
      runId: "crashed",
    });
    expect(
      container.querySelector<HTMLElement>(
        ".studio-panel-body:not([hidden]) .run-history",
      ),
    ).not.toBeNull();
    expect(runCommand).not.toHaveBeenCalled();
    expect(container.querySelector(".conversation-message")).toBeNull();
  });
});
