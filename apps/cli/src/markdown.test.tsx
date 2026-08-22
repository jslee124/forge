import { renderToString } from "ink";
import { describe, expect, it } from "vitest";

import { TerminalMarkdown } from "./markdown.js";

describe("terminal Markdown", () => {
  it("renders headings, lists, inline styles, links, and quotes without markers", () => {
    const output = renderToString(
      <TerminalMarkdown>{`## Result
- **Changed** \`run.ts\`
1. Verified
> See [docs](https://example.com)`}</TerminalMarkdown>,
      { columns: 100 },
    );

    expect(output).toContain("Result");
    expect(output).toContain("• Changed run.ts");
    expect(output).toContain("1. Verified");
    expect(output).toContain("│ See docs (https://example.com)");
    expect(output).not.toContain("## Result");
    expect(output).not.toContain("**Changed**");
  });

  it("renders a fenced code block and tolerates an unfinished streaming fence", () => {
    const output = renderToString(
      <TerminalMarkdown>{`\`\`\`ts
const answer = 42;`}</TerminalMarkdown>,
      { columns: 60 },
    );

    expect(output).toContain("ts");
    expect(output).toContain("const answer = 42;");
    expect(output).not.toContain("```");
    expect(output).toContain("┌");
  });

  it("keeps list nesting and gives section markers their own treatment", () => {
    const output = renderToString(
      <TerminalMarkdown layout="answer">{`🔴 Headlines
1. **First item**
  - Nested detail
---
⚠️ Sources are time-sensitive`}</TerminalMarkdown>,
      { columns: 80 },
    );

    expect(output).toContain("🔴 Headlines");
    expect(output).toContain("1. First item");
    expect(output).toContain("  ◦ Nested detail");
    expect(output).toContain("─");
    expect(output).toContain("⚠️ Sources are time-sensitive");
  });

  it("removes model-supplied ANSI control sequences", () => {
    const output = renderToString(
      <TerminalMarkdown>{"safe \u001B[31mred\u001B[0m"}</TerminalMarkdown>,
    );

    expect(output).toContain("safe red");
    expect(output).not.toContain("\u001B[31m");
  });
});
