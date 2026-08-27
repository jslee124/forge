export interface ResourceEvaluationCase {
  readonly id: string;
  readonly expectedSkills: readonly string[];
  readonly selectedSkills: readonly string[];
  readonly loadedSkills: readonly string[];
  readonly catalogTokens: number;
  readonly loadedTokens: number;
  readonly citedReferences: readonly string[];
  readonly expectedCitations: readonly string[];
  readonly latencyMs: number;
  readonly completed: boolean;
}

export interface ResourceEvaluationMetrics {
  readonly selectionPrecision: number;
  readonly selectionRecall: number;
  readonly unnecessaryLoads: number;
  readonly catalogTokens: number;
  readonly loadedTokens: number;
  readonly citationAccuracy: number;
  readonly averageLatencyMs: number;
  readonly taskCompletion: number;
}

export const PRODUCT_QUESTION_FIXTURES = Object.freeze([
  {
    id: "plugin-api",
    query: "How do trusted plugins register tools?",
    document: "plugins",
  },
  {
    id: "configuration",
    query: "Where is Forge configuration loaded from?",
    document: "configuration",
  },
  {
    id: "authentication",
    query: "How does provider authentication work?",
    document: "authentication",
  },
  {
    id: "sessions",
    query: "How do I resume a saved session?",
    document: "sessions",
  },
  {
    id: "context",
    query: "When does context compaction run?",
    document: "context-management",
  },
  {
    id: "security",
    query: "Does Forge provide an OS sandbox?",
    document: "security",
  },
  {
    id: "release",
    query: "How is the npm package verified?",
    document: "releasing",
  },
  {
    id: "unknown",
    query: "Does Forge teleport repositories?",
    document: undefined,
  },
]);

export function evaluateResourceCases(
  cases: readonly ResourceEvaluationCase[],
): ResourceEvaluationMetrics {
  let truePositive = 0;
  let selected = 0;
  let expected = 0;
  let unnecessaryLoads = 0;
  let catalogTokens = 0;
  let loadedTokens = 0;
  let correctCitations = 0;
  let citations = 0;
  let latency = 0;
  let completed = 0;
  for (const entry of cases) {
    const expectedSet = new Set(entry.expectedSkills);
    truePositive += entry.selectedSkills.filter((name) =>
      expectedSet.has(name),
    ).length;
    selected += entry.selectedSkills.length;
    expected += expectedSet.size;
    unnecessaryLoads += entry.loadedSkills.filter(
      (name) => !expectedSet.has(name),
    ).length;
    catalogTokens += entry.catalogTokens;
    loadedTokens += entry.loadedTokens;
    const expectedReferences = new Set(entry.expectedCitations);
    correctCitations += entry.citedReferences.filter((reference) =>
      expectedReferences.has(reference),
    ).length;
    citations += entry.citedReferences.length;
    latency += entry.latencyMs;
    if (entry.completed) completed += 1;
  }
  return {
    selectionPrecision: ratio(truePositive, selected),
    selectionRecall: ratio(truePositive, expected),
    unnecessaryLoads,
    catalogTokens,
    loadedTokens,
    citationAccuracy: ratio(correctCitations, citations),
    averageLatencyMs: cases.length === 0 ? 0 : latency / cases.length,
    taskCompletion: ratio(completed, cases.length),
  };
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}
