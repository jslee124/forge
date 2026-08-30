import { Box, Text, useWindowSize } from "ink";
import type React from "react";

interface TerminalMarkdownProps {
  readonly children: string;
  readonly dimColor?: boolean;
  readonly layout?: "default" | "answer";
  readonly terminalWidth?: number;
}

type Block =
  | {
      readonly id: string;
      readonly kind: "code";
      readonly language?: string;
      readonly text: string;
    }
  | {
      readonly id: string;
      readonly kind: "table";
      readonly headers: readonly string[];
      readonly rows: readonly (readonly string[])[];
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
  terminalWidth: terminalWidthOverride,
}: TerminalMarkdownProps): React.JSX.Element {
  const blocks = parseBlocks(stripAnsi(children));
  const answerLayout = layout === "answer";
  const { columns } = useWindowSize();
  const terminalWidth = terminalWidthOverride ?? columns;
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
        ) : block.kind === "table" ? (
          <MarkdownTable
            key={block.id}
            block={block}
            dimColor={dimColor}
            terminalWidth={terminalWidth}
          />
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
  const lines = markdown.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
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
      const table = parseTable(lines, index, `block-${nextId}`);
      if (table) {
        blocks.push(table.block);
        nextId += 1;
        index = table.nextIndex - 1;
      } else if (/^\s*(?:---+|___+|\*\*\*+)\s*$/u.test(line)) {
        blocks.push({ id: `block-${nextId++}`, kind: "separator" });
      } else {
        blocks.push({ id: `block-${nextId++}`, kind: "line", text: line });
      }
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

function parseTable(
  lines: readonly string[],
  startIndex: number,
  id: string,
): { readonly block: Block; readonly nextIndex: number } | undefined {
  const header = parseTableRow(lines[startIndex] ?? "");
  const delimiter = parseTableRow(lines[startIndex + 1] ?? "");
  if (!header || !delimiter?.every(isTableDelimiter)) {
    return undefined;
  }

  const columnCount = Math.max(header.length, delimiter.length);
  const rows: string[][] = [];
  let nextIndex = startIndex + 2;
  while (nextIndex < lines.length) {
    const row = parseTableRow(lines[nextIndex] ?? "");
    if (!row) break;
    rows.push(padTableRow(row, columnCount));
    nextIndex += 1;
  }

  return {
    block: {
      id,
      kind: "table",
      headers: padTableRow(header, columnCount),
      rows,
    },
    nextIndex,
  };
}

function parseTableRow(line: string): readonly string[] | undefined {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return undefined;

  let content = trimmed;
  if (content.startsWith("|")) content = content.slice(1);
  if (content.endsWith("|") && !content.endsWith("\\|")) {
    content = content.slice(0, -1);
  }

  const cells: string[] = [];
  let cell = "";
  let escaped = false;
  for (const character of content) {
    if (escaped) {
      cell += character;
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === "|") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += character;
    }
  }
  if (escaped) cell += "\\";
  cells.push(cell.trim());
  return cells.length > 0 ? cells : undefined;
}

function isTableDelimiter(value: string): boolean {
  return /^:?-{3,}:?$/u.test(value.trim());
}

function padTableRow(row: readonly string[], columnCount: number): string[] {
  return Array.from({ length: columnCount }, (_, index) => row[index] ?? "");
}

function MarkdownTable({
  block,
  dimColor,
  terminalWidth,
}: {
  readonly block: Extract<Block, { kind: "table" }>;
  readonly dimColor: boolean;
  readonly terminalWidth: number;
}): React.JSX.Element {
  const rows = [block.headers, ...block.rows];
  const naturalWidths = block.headers.map((_, columnIndex) =>
    Math.max(1, ...rows.map((row) => inlineTextWidth(row[columnIndex] ?? ""))),
  );
  const widths = fitTableWidths(naturalWidths, terminalWidth);

  return (
    <Box flexDirection="column" marginY={1}>
      <MarkdownTableRow cells={block.headers} widths={widths} header />
      <Text color="gray">
        {widths.map((width) => "─".repeat(width)).join("  ")}
      </Text>
      {block.rows.map((row) => (
        <MarkdownTableRow
          key={`${block.id}-row-${row.join("\u0000")}`}
          cells={row}
          widths={widths}
          dimColor={dimColor}
        />
      ))}
    </Box>
  );
}

function MarkdownTableRow({
  cells,
  widths,
  dimColor = false,
  header = false,
}: {
  readonly cells: readonly string[];
  readonly widths: readonly number[];
  readonly dimColor?: boolean;
  readonly header?: boolean;
}): React.JSX.Element {
  return (
    <Box flexDirection="row" columnGap={2} alignItems="flex-start">
      {widths.map((width, index) => (
        <Box
          key={`table-cell-${width}-${cells[index] ?? ""}`}
          width={width}
          flexShrink={0}
        >
          <Text
            bold={header}
            dimColor={dimColor}
            wrap="wrap"
            {...(header ? { color: "cyan" } : {})}
          >
            <InlineMarkdown text={cells[index] ?? ""} />
          </Text>
        </Box>
      ))}
    </Box>
  );
}

function fitTableWidths(
  naturalWidths: readonly number[],
  terminalWidth: number,
): number[] {
  const columnGap = Math.max(0, (naturalWidths.length - 1) * 2);
  const availableWidth = Math.max(
    naturalWidths.length,
    terminalWidth > 0 ? terminalWidth - 4 : 76,
  );
  const widths = [...naturalWidths];
  let excess = widths.reduce((total, width) => total + width, 0) + columnGap;

  while (excess > availableWidth) {
    const widestIndex = widths.reduce(
      (selectedIndex, width, index) =>
        width > (widths[selectedIndex] ?? 0) ? index : selectedIndex,
      0,
    );
    if ((widths[widestIndex] ?? 1) <= 1) break;
    widths[widestIndex] = (widths[widestIndex] ?? 1) - 1;
    excess -= 1;
  }
  return widths;
}

function inlineTextWidth(value: string): number {
  const plain = value
    .replace(/`([^`]+)`/gu, "$1")
    .replace(/\*\*([^*]+)\*\*/gu, "$1")
    .replace(/__([^_]+)__/gu, "$1")
    .replace(/\[([^\]]+)\]\([^\s)]+\)/gu, "$1");
  return displayWidth(plain);
}

function displayWidth(value: string): number {
  let width = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint === 0 || /\p{Mark}/u.test(character)) continue;
    width += isWideCodePoint(codePoint) ? 2 : 1;
  }
  return width;
}

function isWideCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    codePoint === 0x2329 ||
    codePoint === 0x232a ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  );
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
