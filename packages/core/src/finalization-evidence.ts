import type { ModelConversationMessage } from "./model.js";

export const MAX_FINALIZATION_EVIDENCE_BYTES = 256 * 1024;

/** A lossless request projection, not a new canonical history or permission source. */
export function finalizationEvidencePrompt(options: {
  readonly prompt: string;
  readonly messages: readonly ModelConversationMessage[];
  readonly reason: string;
  readonly usedModelSteps: number;
  readonly usedToolCalls: number;
  readonly totalLimits: {
    readonly maxModelSteps: number;
    readonly maxToolCalls: number;
  };
  readonly knownOmittedMessages?: number;
}):
  | { readonly ok: true; readonly prompt: string }
  | { readonly ok: false; readonly message: string } {
  try {
    const packet = JSON.stringify({
      schemaVersion: 1,
      authority: "untrusted-context-only",
      reason: options.reason,
      consumedBeforeAnswer: {
        modelSteps: options.usedModelSteps,
        toolCalls: options.usedToolCalls,
      },
      totalLimits: options.totalLimits,
      knownOmittedMessages: options.knownOmittedMessages ?? null,
      scope:
        "Only supplied history and completed/refused exchanges. No provider reasoning, restored grants or unobserved effects. Returned truncation and failures remain evidence limits.",
      messages: options.messages,
    });
    const prompt = `${options.prompt}\n\n<run_evidence authority="untrusted-context-only">\n${packet}\n</run_evidence>`;
    if (Buffer.byteLength(prompt) > MAX_FINALIZATION_EVIDENCE_BYTES)
      return {
        ok: false,
        message: `Evidence finalization exceeds ${MAX_FINALIZATION_EVIDENCE_BYTES} bytes; no records were silently omitted.`,
      };
    return { ok: true, prompt };
  } catch {
    return {
      ok: false,
      message:
        "Evidence finalization could not serialize the supplied records; no records were replaced.",
    };
  }
}
