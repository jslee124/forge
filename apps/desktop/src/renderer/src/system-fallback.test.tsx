/// <reference lib="dom" />
// @vitest-environment jsdom
import type { ProductRunDelivery } from "@forge/persistence";
import i18n from "i18next";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import "./i18n.js";
import { SystemFallback } from "./system-fallback.js";

it.each(["en", "zh-CN"])(
  "shows recorded facts without turning an exit code into task success (%s)",
  async (locale) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    const root = createRoot(container);
    const delivery: ProductRunDelivery = {
      files: [
        {
          actionId: "edit",
          facts: {
            kind: "file",
            path: "<script>fixture.ts",
            operation: "create",
            bytes: 10,
            patch: "+change",
            truncated: false,
          },
        },
      ],
      commands: [0, 1, null].map((exitCode, i) => ({
        actionId: `cmd-${i}`,
        facts: {
          kind: "command",
          command: "node fixture.test.mjs",
          cwd: ".",
          exitCode,
          signal: null,
          timedOut: false,
          truncated: false,
          stdout: "fixture output",
        },
      })),
      unresolved: [
        { actionId: "denied", tool: "run_command", status: "denied" },
      ],
      incomplete: true,
      omitted: 0,
      unstructured: 0,
    };
    try {
      await i18n.changeLanguage(locale);
      await act(async () =>
        root.render(
          createElement(SystemFallback, {
            delivery,
            original: "Partial run result. Original retained.",
          }),
        ),
      );
      expect(container.querySelector("h3")?.textContent).toBe(
        locale === "zh-CN"
          ? "系统整理的部分结果"
          : "System-generated partial result",
      );
      expect(container.textContent).toContain(
        locale === "zh-CN" ? "退出码 1" : "Exited with code 1",
      );
      expect(container.textContent).toContain(
        locale === "zh-CN" ? "退出码 0" : "Exited with code 0",
      );
      expect(container.textContent).toContain(
        locale === "zh-CN" ? "进程结果未知" : "Process result unknown",
      );
      expect(container.querySelector("script")).toBeNull();
      expect(container.querySelector("code")?.textContent).toBe(
        "<script>fixture.ts",
      );
      expect(
        container.querySelector(".system-fallback-limit")?.textContent,
      ).toContain(
        locale === "zh-CN" ? "尚未确认任务整体完成" : "remain unconfirmed",
      );
      expect(container.querySelector("details[open]")).toBeNull();
      expect(container.querySelector(".studio-answer-avatar")).toBeNull();
      expect(container.textContent).not.toContain(
        locale === "zh-CN" ? "没有未解决操作" : "No unresolved operations",
      );
      await act(async () =>
        root.render(createElement(SystemFallback, { original: "original" })),
      );
      expect(container.textContent).toContain(
        locale === "zh-CN" ? "尚未载入" : "not loaded",
      );
      expect(container.textContent).not.toContain(
        locale === "zh-CN" ? "未记录结构化文件" : "No structured",
      );
    } finally {
      await act(async () => root.unmount());
      await i18n.changeLanguage("zh-CN");
      vi.unstubAllGlobals();
    }
  },
);
