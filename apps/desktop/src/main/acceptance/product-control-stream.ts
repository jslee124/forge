import { CANCEL_COMMAND } from "./product-live-scenarios.js";

export const CONTROL_REASONING_FRAGMENTS = 10000;
/** Standard Responses SSE events, validated through the actual compatibility adapter. */
export function* controlStressEvents(): Generator<{
  type: string;
  [key: string]: unknown;
}> {
  yield {
    type: "response.created",
    response: { id: "control-response", created_at: 1, model: "scripted" },
  };
  yield {
    type: "response.output_item.added",
    output_index: 0,
    item: { type: "reasoning", id: "reason-1" },
  };
  yield {
    type: "response.reasoning_summary_part.added",
    item_id: "reason-1",
    output_index: 0,
    summary_index: 0,
  };
  for (let n = 0; n < CONTROL_REASONING_FRAGMENTS; n++)
    yield {
      type: "response.reasoning_summary_text.delta",
      item_id: "reason-1",
      output_index: 0,
      summary_index: 0,
      delta: `fragment-${n}-${"x".repeat(16)}\n`,
    };
  yield {
    type: "response.reasoning_summary_part.done",
    item_id: "reason-1",
    output_index: 0,
    summary_index: 0,
  };
  yield {
    type: "response.output_item.done",
    output_index: 0,
    item: { type: "reasoning", id: "reason-1" },
  };
  yield {
    type: "response.output_item.added",
    output_index: 1,
    item: { type: "message", id: "message-1" },
  };
  yield {
    type: "response.output_text.delta",
    item_id: "message-1",
    output_index: 1,
    delta: `Large local output\n${"bounded output ".repeat(8000)}`,
  };
  yield {
    type: "response.output_item.done",
    output_index: 1,
    item: { type: "message", id: "message-1" },
  };
  const args = JSON.stringify({
    program: "node",
    args: ["-e", CANCEL_COMMAND],
    cwd: ".",
  });
  const call = {
    type: "function_call",
    status: "completed",
    id: "function-1",
    call_id: "owned-control-command",
    name: "run_command",
    arguments: args,
  };
  yield {
    type: "response.output_item.added",
    output_index: 2,
    item: { ...call, arguments: "" },
  };
  yield {
    type: "response.function_call_arguments.delta",
    item_id: "function-1",
    output_index: 2,
    delta: args,
  };
  yield { type: "response.output_item.done", output_index: 2, item: call };
  yield {
    type: "response.completed",
    response: {
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        output_tokens_details: { reasoning_tokens: 1 },
      },
    },
  };
}
