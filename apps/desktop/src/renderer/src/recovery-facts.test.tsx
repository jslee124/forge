/// <reference lib="dom" />
// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { RecoverySource } from "../../shared/application-protocol.js";
import { ConversationMessage } from "./conversation-message.js";
import i18n from "./i18n.js";
import { RecoveryFacts } from "./recovery-facts.js";

vi.mock("./markdown.js", () => ({
  Markdown: ({ children }: { children: string }) => children,
}));
vi.mock("./file-preview.js", () => ({ DiffViewer: () => null }));
it.each(["en", "zh-CN"])(
  "keeps %s recorded failure apart from model claims and missing source",
  async (locale) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    await i18n.changeLanguage(locale);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const source: RecoverySource = {
      sourceRunId: "source",
      record: {
        summary: {
          schemaVersion: 1,
          sessionId: "session",
          runId: "source",
          engine: "native",
          prompt: "source task",
          state: "finished",
          startedAt: "2026-10-27T00:00:00Z",
          updatedAt: "2026-10-27T00:00:00Z",
          sequence: 1,
          omittedCharacters: 0,
          omittedEvents: 0,
          completion: {
            outcome: "interrupted",
            partial: true,
            reason: "disconnected",
          },
        },
        activity: { items: [], omitted: 0 },
        incomplete: true,
        delivery: {
          files: [],
          commands: [
            {
              actionId: "command",
              facts: {
                kind: "command",
                command: "node --test fixture.test.mjs",
                cwd: ".",
                exitCode: 1,
                signal: null,
                timedOut: false,
                truncated: false,
              },
            },
          ],
          unresolved: [],
          incomplete: true,
          omitted: 0,
          unstructured: 0,
        },
      },
    };
    try {
      await act(async () =>
        root.render(
          createElement(
            "div",
            {},
            createElement(RecoveryFacts, { source, onPreview: vi.fn() }),
            createElement(ConversationMessage, {
              author: "assistant",
              content: "All tests passed; npm test ran.",
              explanation: true,
            }),
          ),
        ),
      );
      const facts = container.querySelector("[data-recovery-source]");
      expect(facts?.textContent).toContain("node --test fixture.test.mjs");
      expect(facts?.textContent).not.toContain("npm test");
      expect(facts?.textContent).toContain(
        i18n.t("delivery.commandOutcomes.nonzero", { code: 1 }),
      );
      expect(facts?.textContent).toContain(
        i18n.t("runUi.outcomes.interrupted"),
      );
      expect(facts?.textContent).toContain(
        i18n.t("runUi.reasons.disconnected"),
      );
      expect(facts?.textContent).not.toContain(
        i18n.t("runUi.reasons.tool_call_limit"),
      );
      expect(facts?.textContent).toContain(i18n.t("recovery.incomplete"));
      expect(
        container.querySelector(".recovery-explanation-label")?.textContent,
      ).toBe(i18n.t("recovery.explanation"));
      await act(async () =>
        root.render(
          createElement(RecoveryFacts, {
            source: { sourceRunId: "source" },
            onPreview: vi.fn(),
          }),
        ),
      );
      expect(container.textContent).toContain(
        i18n.t("recovery.sourceUnavailable"),
      );
      expect(container.textContent).toContain(i18n.t("recovery.unknownStatus"));
      expect(container.textContent).not.toContain("node --test");
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  },
);
