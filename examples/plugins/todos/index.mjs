const todos = [];
let nextId = 1;

export default function activate(api) {
  api.contributePrompt(() =>
    [
      "A todo tool is available for multi-step work.",
      "Use it when a task benefits from an explicit short plan; keep exactly one item in_progress and update items as work advances.",
      "Do not create todos for simple one-step requests.",
    ].join(" "),
  );

  api.registerTool({
    name: "todo",
    description:
      "Create, inspect, update, remove, or clear the current Forge process's lightweight task list.",
    risk: "read",
    inputSchema: api.z.discriminatedUnion("action", [
      api.z.object({ action: api.z.literal("list") }).strict(),
      api.z
        .object({
          action: api.z.literal("add"),
          text: api.z.string().trim().min(1).max(500),
        })
        .strict(),
      api.z
        .object({
          action: api.z.literal("update"),
          id: api.z.number().int().positive(),
          status: api.z.enum(["pending", "in_progress", "completed"]),
          text: api.z.string().trim().min(1).max(500).optional(),
        })
        .strict(),
      api.z
        .object({
          action: api.z.literal("remove"),
          id: api.z.number().int().positive(),
        })
        .strict(),
      api.z.object({ action: api.z.literal("clear") }).strict(),
    ]),
    execute: async (input) => {
      if (input.action === "add") {
        todos.push({ id: nextId++, text: input.text, status: "pending" });
      } else if (input.action === "update") {
        const todo = todos.find(({ id }) => id === input.id);
        if (!todo) return failure(`Todo ${input.id} was not found.`);
        if (
          input.status === "in_progress" &&
          todos.some(
            ({ id, status }) => id !== input.id && status === "in_progress",
          )
        ) {
          return failure("Only one todo may be in_progress at a time.");
        }
        todo.status = input.status;
        if (input.text) todo.text = input.text;
      } else if (input.action === "remove") {
        const index = todos.findIndex(({ id }) => id === input.id);
        if (index < 0) return failure(`Todo ${input.id} was not found.`);
        todos.splice(index, 1);
      } else if (input.action === "clear") {
        todos.splice(0);
      }
      return {
        ok: true,
        output: { todos: todos.map((todo) => ({ ...todo })) },
        truncated: false,
      };
    },
  });
}

function failure(errorMessage) {
  return {
    ok: false,
    error: { code: "invalid_input", message: errorMessage, retryable: false },
  };
}
