import { formatApprovalScope, type SessionGrant } from "@forge/core";
import { Box, Text } from "ink";
import type React from "react";

import {
  type DiffRow,
  formatUnifiedDiffRows,
  summarizeUnifiedDiff,
} from "../diff.js";

export function PermissionsPanel({
  profile,
  provenance,
  grants,
  selectedIndex,
  revision: _revision,
}: {
  readonly profile: string;
  readonly provenance: string;
  readonly grants: readonly SessionGrant[];
  readonly selectedIndex: number;
  readonly revision: number;
}): React.JSX.Element {
  return (
    <Box
      borderStyle="round"
      borderColor="cyan"
      flexDirection="column"
      paddingX={1}
    >
      <Text bold color="cyan">
        Session permissions
      </Text>
      <Text>
        Effective profile <Text bold>{profile}</Text> · source {provenance}
      </Text>
      <Text dimColor>
        Grants are memory-only for this workspace and disappear on
        new/resume/exit.
      </Text>
      {grants.length === 0 ? (
        <Text dimColor>No active session grants.</Text>
      ) : null}
      {grants.map((grant, index) => (
        <Text key={grant.id} bold={index === selectedIndex}>
          {index === selectedIndex ? "› " : "  "}
          {formatApprovalScope(grant.scope)} · used {grant.useCount} ·{" "}
          {grant.id}
        </Text>
      ))}
      <Text dimColor>↑/↓ select · r revoke · x revoke all · Esc close</Text>
    </Box>
  );
}

export function DiffPanel({
  diff,
}: {
  readonly diff: string;
}): React.JSX.Element {
  const summary = summarizeUnifiedDiff(diff);
  const title = `${summary.operation.toUpperCase()} ${summary.path}`;
  return (
    <Box flexDirection="column">
      <Text bold>
        ╭─ {title} <Text color="greenBright">+{summary.additions}</Text>{" "}
        <Text color="redBright">-{summary.deletions}</Text>
      </Text>
      {formatUnifiedDiffRows(diff).map((row, index) => {
        const key = `${index}-${row.kind}`;
        if (row.kind === "addition" || row.kind === "deletion") {
          return (
            <Text key={key} {...diffRowStyle(row.kind)}>
              {row.gutter}
              {row.line}
            </Text>
          );
        }
        return (
          <Text key={key}>
            <Text color="yellow">{row.gutter}</Text>
            <Text
              {...(row.kind === "header" ? { bold: true } : {})}
              {...(row.kind === "hunk" ? { color: "cyan" as const } : {})}
            >
              {row.line}
            </Text>
          </Text>
        );
      })}
      <Text bold>╰─ Review the exact change before approval</Text>
    </Box>
  );
}

export function diffRowStyle(kind: DiffRow["kind"]): {
  readonly color?: "greenBright" | "redBright";
  readonly backgroundColor?: string;
} {
  if (kind === "addition")
    return { color: "greenBright", backgroundColor: "#123d24" };
  if (kind === "deletion")
    return { color: "redBright", backgroundColor: "#4a171c" };
  return {};
}
