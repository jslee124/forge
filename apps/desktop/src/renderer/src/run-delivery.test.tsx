/// <reference lib="dom" />
// @vitest-environment jsdom
import type { ProductRunDelivery } from "@forge/persistence";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import "./i18n.js";
import { RunDelivery } from "./run-delivery.js";

vi.mock("./file-preview.js", () => ({ DiffViewer: () => null }));
it("shows process outcomes without promoting claims, and previews only on an explicit click", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const preview = vi.fn();
  const delivery: ProductRunDelivery = {
    files: [
      {
        actionId: "write",
        facts: {
          kind: "file",
          path: "src/changed.ts",
          operation: "create",
          bytes: 12,
          patch: "+change",
          truncated: true,
        },
      },
    ],
    commands: [
      {
        actionId: "command",
        facts: {
          kind: "command",
          command: "node check.js",
          cwd: ".",
          exitCode: 1,
          signal: null,
          timedOut: false,
          truncated: false,
        },
      },
    ],
    unresolved: [
      { actionId: "unknown", tool: "run_command", status: "unknown" },
    ],
    incomplete: true,
    omitted: 2,
    unstructured: 1,
  };
  try {
    await act(async () =>
      root.render(
        createElement(RunDelivery, {
          delivery,
          busy: false,
          onPreview: preview,
        }),
      ),
    );
    expect(container.querySelector(".run-delivery")?.hasAttribute("open")).toBe(
      false,
    );
    expect(
      container.querySelector("[data-command-outcome=nonzero]")?.textContent,
    ).toContain("退出码 1");
    expect(container.textContent).toContain("重试前需检查");
    expect(container.textContent).toContain("记录不完整");
    expect(preview).not.toHaveBeenCalled();
    const button = container.querySelector<HTMLButtonElement>(
      ".run-delivery-files button",
    );
    if (!button) throw new Error("Missing preview control");
    await act(async () => button.click());
    expect(preview).toHaveBeenCalledExactlyOnceWith("src/changed.ts");
    await act(async () =>
      root.render(
        createElement(RunDelivery, {
          delivery,
          busy: true,
          onPreview: preview,
        }),
      ),
    );
    expect(button.disabled).toBe(true);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
