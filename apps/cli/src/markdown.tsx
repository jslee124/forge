import { Box, Text } from "ink";
import type React from "react";

interface TerminalMarkdownProps {
  readonly children: string;
  readonly dimColor?: boolean;
  readonly layout?: "default" | "answer";
}

type Block =
  | {
      readonly id: string;
      readonly kind: "code";
      readonly language?: string;
      readonly text: string;
    }
  | { readonly id: string; readonly kind: "separator" }
  | { readonly id: string; readonly kind: "line"; readonly text: string };

type LineKind =
  | "blank"
  | "heading"
  | "ordered"
  | "unordered"
  | "quote"
  | "text";

interface LineShape {
  readonly depth: number;
  readonly kind: LineKind;
}

const ANSI_SEQUENCE = new RegExp(
  `${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`,
  "gu",
);

export function TerminalMarkdown({
  children,
  dimColor = false,
  layout = "default",
}: TerminalMarkdownProps): React.JSX.Element {
  const blocks = parseBlocks(stripAnsi(children));
  const answerLayout = layout === "answer";
  return (
    <Box flexDirection="column">
      {blocks.map((block) =>
        block.kind === "code" ? (
          <Box
            key={block.id}
            borderStyle="single"
            borderColor="gray"
            flexDirection="column"
            paddingX={1}
            marginY={1}
          >
            {block.language ? (
              <Text bold color="cyan">
                {block.language}
              </Text>
            ) : null}
            <Text>{block.text || " "}</Text>
          </Box>
        ) : block.kind === "separator" && answerLayout ? (
          <Box key={block.id} marginY={1}>
            <Text dimColor color="gray">
              {"─".repeat(40)}
            </Text>
          </Box>
        ) : block.kind === "separator" ? (
          <MarkdownLine key={block.id} text="---" dimColor={dimColor} />
        ) : answerLayout ? (
          <MarkdownLineBlock
            key={block.id}
            text={block.text}
            dimColor={dimColor}
          />
        ) : (
          <MarkdownLine key={block.id} text={block.text} dimColor={dimColor} />
        ),
      )}
    </Box>
  );
}

function MarkdownLineBlock({
  text,
  dimColor,
}: {
  readonly text: string;
  readonly dimColor: boolean;
}): React.JSX.Element {
  const shape = classifyLine(text);
  const marginTop =
    shape.kind === "heading" || (shape.kind === "ordered" && shape.depth === 0)
      ? 1
      : 0;

  return (
    <Box marginTop={marginTop}>
      <MarkdownLine text={text} dimColor={dimColor} structured />
    </Box>
  );
}

function MarkdownLine({
  text,
  dimColor,
  structured = false,
}: {
  readonly text: string;
  readonly dimColor: boolean;
  readonly structured?: boolean;
}): React.JSX.Element {
  const heading = /^(#{1,3})\s+(.*)$/u.exec(text);
  if (heading) {
    return (
      <Text bold color={heading[1]?.length === 1 ? "cyan" : "blue"}>
        {heading[2]}
      </Text>
    );
  }

  if (structured && /^(?:🔴|📌|📍|✅|🟢|🔵)\s+.+$/u.test(text)) {
    return (
      <Text bold color="cyan">
        {text}
      </Text>
    );
  }

  const unordered = structured
    ? /^(\s*)[-*+]\s+(.*)$/u.exec(text)
    : /^\s*[-*+]\s+(.*)$/u.exec(text);
  if (unordered) {
    const depth = structured ? indentationDepth(unordered[1] ?? "") : 0;
    return (
      <Text dimColor={dimColor}>
        {structured ? indent(depth) : null}
        <Text color="cyan">{structured && depth > 0 ? "◦ " : "• "}</Text>
        <InlineMarkdown
          text={structured ? (unordered[2] ?? "") : (unordered[1] ?? "")}
        />
      </Text>
    );
  }

  const ordered = structured
    ? /^(\s*)(\d+)[.)]\s+(.*)$/u.exec(text)
    : /^\s*(\d+)[.)]\s+(.*)$/u.exec(text);
  if (ordered) {
    const depth = structured ? indentationDepth(ordered[1] ?? "") : 0;
    return (
      <Text dimColor={dimColor}>
        {structured ? indent(depth) : null}
        <Text color="cyan">{structured ? ordered[2] : ordered[1]}. </Text>
        <Text bold={structured && depth === 0}>
          <InlineMarkdown
            text={structured ? (ordered[3] ?? "") : (ordered[2] ?? "")}
          />
        </Text>
      </Text>
    );
  }

  const quote = /^\s*>\s+(.*)$/u.exec(text);
  if (quote) {
    return (
      <Text dimColor={dimColor}>
        <Text color="gray">│ </Text>
        <InlineMarkdown text={quote[1] ?? ""} />
      </Text>
    );
  }

  const callout = structured ? /^\s*(⚠️?|‼️?)\s+(.*)$/u.exec(text) : null;
  if (callout) {
    return (
      <Text dimColor={dimColor}>
        <Text color="yellow" bold>
          {callout[1]}{" "}
        </Text>
        <InlineMarkdown text={callout[2] ?? ""} />
      </Text>
    );
  }

  return (
    <Text dimColor={dimColor}>
      <InlineMarkdown text={text} />
    </Text>
  );
}

function InlineMarkdown({
  text,
}: {
  readonly text: string;
}): React.JSX.Element {
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\[[^\]]+\]\([^\s)]+\))/gu;
  const parts: React.ReactNode[] = [];
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index;
    if (index > offset) parts.push(text.slice(offset, index));
    const token = match[0];
    if (token.startsWith("`")) {
      parts.push(
        <Text key={index} color="yellow">
          {token.slice(1, -1)}
        </Text>,
      );
    } else if (token.startsWith("**") || token.startsWith("__")) {
      parts.push(
        <Text key={index} bold>
          {token.slice(2, -2)}
        </Text>,
      );
    } else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/u.exec(token);
      parts.push(
        <Text key={index} color="cyan">
          {link?.[1]} <Text dimColor>({link?.[2]})</Text>
        </Text>,
      );
    }
    offset = index + token.length;
  }
  parts.push(text.slice(offset));
  return <>{parts}</>;
}

function parseBlocks(markdown: string): readonly Block[] {
  const blocks: Block[] = [];
  let nextId = 0;
  let language: string | undefined;
  let code: string[] | undefined;
  for (const line of markdown.split("\n")) {
    const fence = /^```\s*([\w.+-]+)?\s*$/u.exec(line);
    if (fence) {
      if (code) {
        blocks.push({
          id: `block-${nextId++}`,
          kind: "code",
          ...(language ? { language } : {}),
          text: code.join("\n"),
        });
        code = undefined;
        language = undefined;
      } else {
        code = [];
        language = fence[1];
      }
    } else if (code) {
      code.push(line);
    } else if (/^\s*(?:---+|___+|\*\*\*+)\s*$/u.test(line)) {
      blocks.push({ id: `block-${nextId++}`, kind: "separator" });
    } else {
      blocks.push({ id: `block-${nextId++}`, kind: "line", text: line });
    }
  }
  if (code) {
    blocks.push({
      id: `block-${nextId++}`,
      kind: "code",
      ...(language ? { language } : {}),
      text: code.join("\n"),
    });
  }
  return blocks;
}

function classifyLine(text: string): LineShape {
  if (text.trim() === "") return { kind: "blank", depth: 0 };
  if (/^\s*#{1,3}\s+.+$/u.test(text)) {
    return { kind: "heading", depth: 0 };
  }
  if (/^\s*(?:🔴|📌|📍|✅|🟢|🔵)\s+.+$/u.test(text)) {
    return { kind: "heading", depth: 0 };
  }
  const ordered = /^(\s*)\d+[.)]\s+.+$/u.exec(text);
  if (ordered) {
    return { kind: "ordered", depth: indentationDepth(ordered[1] ?? "") };
  }
  const unordered = /^(\s*)[-*+]\s+.+$/u.exec(text);
  if (unordered) {
    return { kind: "unordered", depth: indentationDepth(unordered[1] ?? "") };
  }
  if (/^\s*>\s+.+$/u.test(text)) return { kind: "quote", depth: 0 };
  return { kind: "text", depth: 0 };
}

function indentationDepth(value: string): number {
  return Math.floor(value.replace(/\t/gu, "  ").length / 2);
}

function indent(depth: number): string {
  return "  ".repeat(depth);
}

function stripAnsi(value: string): string {
  return value.replace(ANSI_SEQUENCE, "");
}
