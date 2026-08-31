import { Box, Text } from "ink";
import type React from "react";

import { TerminalMarkdown } from "../markdown.js";
import { DiffPanel } from "./approvals.js";
import type { TranscriptEntry } from "./types.js";

export function TranscriptBlock({
  entry,
}: {
  readonly entry: TranscriptEntry;
}): React.JSX.Element {
  switch (entry.kind) {
    case "user":
      return (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color="cyan">
            › You
          </Text>
          <Text>{entry.text}</Text>
        </Box>
      );
    case "reasoning":
      return (
        <Box
          borderStyle="single"
          borderColor="gray"
          flexDirection="column"
          paddingX={1}
          marginBottom={1}
        >
          <Text bold color="magenta">
            ◆ Reasoning
          </Text>
          <TerminalMarkdown dimColor>{entry.text}</TerminalMarkdown>
        </Box>
      );
    case "answer":
      return (
        <Box flexDirection="column" paddingX={1} marginBottom={1}>
          <Text bold color="green">
            ● Answer
          </Text>
          <TerminalMarkdown layout="answer">{entry.text}</TerminalMarkdown>
        </Box>
      );
    case "tool":
      return <Text color="yellow">{entry.text}</Text>;
    case "warning":
      return <Text color="yellow">⚠ {entry.text}</Text>;
    case "error":
      return <Text color="red">✗ {entry.text}</Text>;
    case "system":
      return <Text dimColor>{entry.text}</Text>;
    case "diff":
      return <DiffPanel diff={entry.text} />;
    case "raw":
      return <TerminalMarkdown layout="answer">{entry.text}</TerminalMarkdown>;
  }
}
