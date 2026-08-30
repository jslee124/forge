import { describe, expect, it } from "vitest";

import type { CanonicalConversationMessage } from "./model.js";
import {
  projectCanonicalConversation,
  stableCanonicalConversationJson,
  validateCanonicalConversation,
} from "./model.js";

const closedHistory: readonly CanonicalConversationMessage[] = [
  {
    id: "run:user",
    runId: "run",
    role: "user",
    content: [{ type: "text", text: "inspect" }],
  },
  {
    id: "run:assistant:1",
    runId: "run",
    step: 1,
    role: "assistant",
    content: [
      { type: "text", text: "I will inspect." },
      {
        type: "tool-call",
        id: "call-1",
        name: "read_file",
        input: { path: "src/index.ts" },
      },
    ],
  },
  {
    id: "run:tool:1:0",
    runId: "run",
    step: 1,
    role: "tool",
    toolCallId: "call-1",
    toolName: "read_file",
    content: [
      {
        type: "text",
        text: '{"ok":false,"error":{"code":"io_error"}}',
      },
    ],
    isError: true,
  },
  {
    id: "run:assistant:2",
    runId: "run",
    step: 2,
    role: "assistant",
    content: [{ type: "text", text: "The read failed." }],
  },
];

describe("canonical conversation history", () => {
  it("projects closed tool exchanges without changing call IDs or errors", () => {
    expect(projectCanonicalConversation(closedHistory)).toEqual([
      { role: "user", content: "inspect" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "I will inspect." },
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "read_file",
            input: { path: "src/index.ts" },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "read_file",
            output: {
              type: "text",
              value: '{"ok":false,"error":{"code":"io_error"}}',
            },
          },
        ],
      },
      { role: "assistant", content: "The read failed." },
    ]);
    expect(stableCanonicalConversationJson(closedHistory)).toBe(
      JSON.stringify(closedHistory),
    );
  });

  it("rejects orphan results, dangling calls, duplicate IDs, and hostile metadata", () => {
    expect(() =>
      validateCanonicalConversation(closedHistory.slice(0, 2)),
    ).toThrow("Dangling");
    expect(() => validateCanonicalConversation(closedHistory.slice(2))).toThrow(
      "Orphan",
    );
    const first = closedHistory[0];
    if (!first) throw new Error("Fixture is missing its first message.");
    expect(() => validateCanonicalConversation([first, first])).toThrow(
      "Duplicate canonical message",
    );
    const hostile = structuredClone(
      closedHistory,
    ) as CanonicalConversationMessage[];
    const assistant = hostile[1];
    if (assistant?.role === "assistant") {
      const call = assistant.content[1];
      if (call?.type === "tool-call") {
        Object.assign(call, { providerMetadata: { token: 1n } });
      }
    }
    expect(() => validateCanonicalConversation(hostile)).toThrow(
      "not JSON-safe",
    );
  });

  it("allows provider tool-call IDs to repeat across independent exchanges", () => {
    const repeated = closedHistory.map((message) => ({
      ...structuredClone(message),
      id: message.id.replace("run", "run-2"),
      runId: "run-2",
    })) as CanonicalConversationMessage[];
    expect(() =>
      validateCanonicalConversation([...closedHistory, ...repeated]),
    ).not.toThrow();
  });
});
