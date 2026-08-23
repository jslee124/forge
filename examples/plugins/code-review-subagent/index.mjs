export default function activate(api) {
  api.registerSubagent({
    name: "code-reviewer",
    toolName: "delegate_code_review",
    description:
      "Delegate a focused, read-only code review to an isolated subagent and return its findings.",
    instructions: [
      "You are a focused code-review subagent.",
      "Inspect only the files needed for the delegated task.",
      "Prioritize concrete correctness, security, recovery, and test gaps.",
      "Return concise findings with file paths and evidence; do not edit files.",
      "If no actionable issue is found, say so explicitly.",
    ].join(" "),
    tools: ["list_files", "read_file", "search"],
    limits: { maxModelSteps: 4, maxToolCalls: 8 },
  });
}
