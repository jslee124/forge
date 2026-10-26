/// <reference lib="dom" />
// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type {
  UpdateCommand,
  UpdateStatus,
} from "../../shared/update-protocol.js";
import i18n from "./i18n.js";
import { UpdateView } from "./update-view.js";

it.each(["en", "zh-CN"])(
  "reviews %s public switching without rewriting saved startup preference",
  async (locale) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute("open");
    };
    await i18n.changeLanguage(locale);
    const status: UpdateStatus = {
      version: "0.4.0-local.adfbad2",
      localBuild: true,
      sourceRevision: "adfbad2",
      platform: "darwin",
      channel: "preview",
      startup: true,
      phase: "unchecked",
    };
    const update = vi.fn<(command: UpdateCommand) => Promise<UpdateStatus>>(
      async () => status,
    );
    vi.stubGlobal("forgeDesktop", undefined);
    Object.defineProperty(window, "forgeDesktop", {
      configurable: true,
      value: { update },
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(createElement(UpdateView)));
      expect(
        container.querySelector("[data-testid=local-build-identity]")
          ?.textContent,
      ).toContain("adfbad2");
      const startup = container.querySelector<HTMLInputElement>(
        "input[type=checkbox]",
      );
      expect(startup?.checked).toBe(false);
      expect(startup?.disabled).toBe(true);
      const check = Array.from(container.querySelectorAll("button")).find(
        (e) =>
          e.textContent ===
          (locale === "zh-CN" ? "检查更新" : "Check for updates"),
      );
      if (!check) throw Error("Missing update check");
      await act(async () => check.click());
      expect(
        update.mock.calls.every(([command]) => command.type === "status"),
      ).toBe(true);
      expect(container.querySelector("dialog")?.textContent).toContain(
        locale === "zh-CN" ? "覆盖本地修改" : "replaces local changes",
      );
      await act(async () =>
        container
          .querySelector<HTMLButtonElement>(
            "dialog .studio-confirmation-actions button:first-child",
          )
          ?.click(),
      );
      expect(
        update.mock.calls.every(([command]) => command.type === "status"),
      ).toBe(true);
      await act(async () => check.click());
      await act(async () =>
        container
          .querySelector<HTMLButtonElement>(
            "dialog .studio-confirmation-actions button:last-child",
          )
          ?.click(),
      );
      expect(update).toHaveBeenCalledWith({
        type: "check",
        allowLocalReplacement: true,
      });
      expect(status.startup).toBe(true);
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  },
);
