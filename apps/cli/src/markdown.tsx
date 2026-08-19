import { Box, Text } from "ink";
import type React from "react";

interface TerminalMarkdownProps {
  readonly children: string;
  readonly dimColor?: boolean;
}

type Block =
  | {
      readonly id: string;
      readonly kind: "code";
      readonly language?: string;
      readonly text: string;
    }
  | { readonly id: string; readonly kind: "line"; readonly text: string };

const ANSI_SEQUENCE = new RegExp(
  `${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`,
  "gu",
);

export function TerminalMarkdown({
  children,
  dimColor = false,
}: TerminalMarkdownProps): React.JSX.Element {
  const blocks = parseBlocks(stripAnsi(children));
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
        ) : (
          <MarkdownLine key={block.id} text={block.text} dimColor={dimColor} />
        ),
      )}
    </Box>
  );
}

function MarkdownLine({
  text,
  dimColor,
}: {
  readonly text: string;
  readonly dimColor: boolean;
}): React.JSX.Element {
  const heading = /^(#{1,3})\s+(.*)$/u.exec(text);
  if (heading) {
    return (
      <Text bold color={heading[1]?.length === 1 ? "cyan" : "blue"}>
        {heading[2]}
      </Text>
    );
  }

  const unordered = /^\s*[-*+]\s+(.*)$/u.exec(text);
  if (unordered) {
    return (
      <Text dimColor={dimColor}>
        <Text color="cyan">• </Text>
        <InlineMarkdown text={unordered[1] ?? ""} />
      </Text>
    );
  }

  const ordered = /^\s*(\d+)[.)]\s+(.*)$/u.exec(text);
  if (ordered) {
    return (
      <Text dimColor={dimColor}>
        <Text color="cyan">{ordered[1]}. </Text>
        <InlineMarkdown text={ordered[2] ?? ""} />
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

function stripAnsi(value: string): string {
  return value.replace(ANSI_SEQUENCE, "");
}
