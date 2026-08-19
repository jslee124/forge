export default function activate(api) {
  api.registerTool({
    name: "count_text",
    description: "Count lines, words, and UTF-16 characters in supplied text.",
    risk: "read",
    inputSchema: api.z.object({ text: api.z.string().max(65_536) }).strict(),
    execute: async ({ text }) => ({
      ok: true,
      output: {
        lines: text === "" ? 0 : text.split(/\r?\n/u).length,
        words: text.trim() === "" ? 0 : text.trim().split(/\s+/u).length,
        characters: text.length,
      },
      truncated: false,
    }),
  });

  api.registerCommand({
    name: "custom-tool-info",
    description: "Explain which example tool this plugin registers.",
    execute: ({ write }) => {
      write("This plugin registers the read-risk count_text tool.\n");
    },
  });
}
