import { describe, expect, it } from "vitest";

import {
  evaluateResourceCases,
  PRODUCT_QUESTION_FIXTURES,
  type ResourceEvaluationCase,
} from "./resource-evaluation.js";

describe("offline resource evaluation", () => {
  it("covers matching, non-matching, ambiguous, explicit, disabled, collision, repeated, and over-budget fake-model cases", () => {
    const cases: ResourceEvaluationCase[] = [
      fake("matching", ["review"], ["review"], ["review"]),
      fake("non-matching", [], [], []),
      fake("ambiguous", [], [], []),
      fake("explicit", ["deploy"], ["deploy"], ["deploy"]),
      fake("disabled-automatic", [], [], []),
      fake("collision-project-wins", ["review"], ["review"], ["review"]),
      fake("repeated-load-rejected", ["review"], ["review"], ["review"]),
      fake("over-budget-rejected", [], [], []),
    ];
    expect(evaluateResourceCases(cases)).toEqual({
      selectionPrecision: 1,
      selectionRecall: 1,
      unnecessaryLoads: 0,
      catalogTokens: 512,
      loadedTokens: 128,
      citationAccuracy: 1,
      averageLatencyMs: 1,
      taskCompletion: 1,
    });
  });

  it("includes all required product areas and an unsupported fixture", () => {
    expect(PRODUCT_QUESTION_FIXTURES.map(({ id }) => id)).toEqual([
      "plugin-api",
      "configuration",
      "authentication",
      "sessions",
      "context",
      "security",
      "release",
      "unknown",
    ]);
    expect(PRODUCT_QUESTION_FIXTURES.at(-1)?.document).toBeUndefined();
  });
});

function fake(
  id: string,
  expectedSkills: readonly string[],
  selectedSkills: readonly string[],
  loadedSkills: readonly string[],
): ResourceEvaluationCase {
  return {
    id,
    expectedSkills,
    selectedSkills,
    loadedSkills,
    catalogTokens: 64,
    loadedTokens: expectedSkills.length === 0 ? 0 : 32,
    citedReferences: [],
    expectedCitations: [],
    latencyMs: 1,
    completed: true,
  };
}
