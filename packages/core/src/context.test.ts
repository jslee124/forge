import { describe, expect, it } from "vitest";

import type { ModelAdapter, ModelRequest, ModelStreamEvent } from "./index.js";
import {
  budgetModelRequest,
  conservativeRequestEstimate,
  conservativeTextTokens,
  conservativeValueTokens,
  contextPressureSnapshot,
  selectRecentConversation,
} from "./index.js";

class ContextModel implements ModelAdapter {
  readonly context = {
    provider: "fake",
    modelId: "fake-small",
    contextWindowTokens: 1_000,
    contextWindowSource: "adapter-table" as const,
    maxOutputTokens: 200,
    nativeCompaction: "unsupported" as const,
    continuationProjection: "unsupported" as const,
    estimateRequestTokens: async (request: ModelRequest) =>
      conservativeRequestEstimate(request),
  };

  async *stream(): AsyncIterable<ModelStreamEvent> {
    yield {
      type: "finish",
      finishReason: "stop",
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 0,
      },
    };
  }
}

describe("context budgeting", () => {
  it("subtracts the larger output or buffer reserve exactly once", async () => {
    const report = await budgetModelRequest({
      model: new ContextModel(),
      request: { prompt: "hello" },
      configuration: {
        mode: "manual",
        reservedOutputTokens: 100,
        bufferTokens: 250,
        recentTailTokens: 100,
        summaryTargetTokens: 50,
      },
    });

    expect(report.effectiveReserveTokens).toBe(250);
    expect(report.availableInputTokens).toBe(750);
    expect(report.estimationMethod).toBe("conservative-fallback");
  });

  it("keeps only complete recent turns at deterministic boundaries", () => {
    const messages = [
      { role: "user" as const, content: "old question" },
      { role: "assistant" as const, content: "old answer" },
      { role: "user" as const, content: "recent question" },
      { role: "assistant" as const, content: "recent answer" },
      { role: "user" as const, content: "unmatched current request" },
    ];
    const recentPairBudget = conservativeValueTokens(messages.slice(2, 4));
    const view = selectRecentConversation(messages, recentPairBudget);

    expect(view.messages).toEqual(messages.slice(2, 4));
    expect(view.retainedTailStartIndex).toBe(2);
    expect(view.omittedMessageCount).toBe(3);
  });

  it("counts current instructions while avoiding duplicate prompt/history already owned by continuation", () => {
    const continuation = conservativeRequestEstimate({
      prompt: "x".repeat(10_000),
      instructions: "y".repeat(10_000),
      conversation: [{ role: "user", content: "z".repeat(10_000) }],
      continuation: { provider: "fake", data: { state: "small" } },
    });
    const initial = conservativeRequestEstimate({
      prompt: "x".repeat(10_000),
      instructions: "y".repeat(10_000),
      conversation: [{ role: "user", content: "z".repeat(10_000) }],
    });

    const withoutInstructions = conservativeRequestEstimate({
      prompt: "ignored duplicate",
      continuation: { provider: "fake", data: { state: "small" } },
    });
    expect(continuation.tokens - withoutInstructions.tokens).toBe(
      conservativeTextTokens("y".repeat(10_000)),
    );
    expect(continuation.tokens).toBeLessThan(initial.tokens / 2);
  });

  it("rejects mandatory overflow caused by current instructions even with a small continuation", async () => {
    const report = await budgetModelRequest({
      model: new ContextModel(),
      request: {
        prompt: "ignored duplicate",
        instructions: "host instruction ".repeat(500),
        continuation: { provider: "fake", data: { state: "small" } },
      },
      configuration: {
        mode: "manual",
        reservedOutputTokens: 100,
        bufferTokens: 100,
        recentTailTokens: 100,
        summaryTargetTokens: 50,
      },
    });
    expect(report.estimates.instructions).toBeGreaterThan(900);
    expect(report.mandatoryFits).toBe(false);
    expect(report.fits).toBe(false);
  });

  it("budgets visual tokens without treating base64 transport bytes as text", () => {
    const estimate = conservativeRequestEstimate({
      prompt: "inspect",
      continuation: {
        provider: "deepseek",
        data: {
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "file",
                  mediaType: "image/png",
                  data: { type: "data", data: "a".repeat(4_000_000) },
                },
              ],
            },
          ],
        },
      },
    });

    expect(estimate.tokens).toBeGreaterThanOrEqual(4_096);
    expect(estimate.tokens).toBeLessThan(5_000);
  });

  it("defines projected pressure against input capacity after one reserve", async () => {
    const budget = await budgetModelRequest({
      model: new ContextModel(),
      request: { prompt: "hello" },
      configuration: {
        mode: "manual",
        reservedOutputTokens: 100,
        bufferTokens: 250,
        recentTailTokens: 100,
        summaryTargetTokens: 50,
      },
    });
    const snapshot = contextPressureSnapshot(budget, "manual");
    expect(snapshot.availableInputTokens).toBe(750);
    expect(snapshot.ratio).toBe(
      budget.estimatedInputTokens / budget.availableInputTokens,
    );
    expect(snapshot.confidence).toBe("estimated");
  });
});
