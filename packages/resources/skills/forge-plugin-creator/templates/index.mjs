export default function activate(api) {
  const inputSchema = api.z
    .object({ text: api.z.string().max(10_000) })
    .strict();

  api.registerTool({
    name: "example_tool",
    description: "Return bounded metadata about supplied text.",
    risk: "read",
    inputSchema,
    execute: async (input) => {
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          ok: false,
          error: {
            code: "invalid_input",
            message: "Invalid input for example_tool.",
            retryable: false,
          },
        };
      }
      return {
        ok: true,
        output: { characters: Array.from(parsed.data.text).length },
        truncated: false,
      };
    },
  });
}
