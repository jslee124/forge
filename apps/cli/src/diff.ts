const ANSI = {
  reset: "\u001B[0m",
  bold: "\u001B[1m",
  cyan: "\u001B[36m",
  yellow: "\u001B[33m",
  addedLine: "\u001B[38;5;120m\u001B[48;5;22m",
  removedLine: "\u001B[38;5;210m\u001B[48;5;52m",
};

export interface DiffSummary {
  readonly operation: "create" | "modify" | "delete";
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
}

export interface DiffRow {
  readonly gutter: string;
  readonly line: string;
  readonly kind: "header" | "hunk" | "addition" | "deletion" | "context";
}

export function summarizeUnifiedDiff(diff: string): DiffSummary {
  const lines = diff.split("\n");
  const oldHeader = lines.find((line) => line.startsWith("--- "))?.slice(4);
  const newHeader = lines.find((line) => line.startsWith("+++ "))?.slice(4);
  const operation =
    oldHeader === "/dev/null"
      ? "create"
      : newHeader === "/dev/null"
        ? "delete"
        : "modify";
  const rawPath = operation === "delete" ? oldHeader : newHeader;
  const filePath = rawPath?.replace(/^[ab]\//u, "") ?? "unknown";
  return {
    operation,
    path: filePath,
    additions: lines.filter(
      (line) => line.startsWith("+") && !line.startsWith("+++"),
    ).length,
    deletions: lines.filter(
      (line) => line.startsWith("-") && !line.startsWith("---"),
    ).length,
  };
}

export function formatDiffPanel(diff: string, color: boolean): string {
  const summary = summarizeUnifiedDiff(diff);
  const title = `${summary.operation.toUpperCase()} ${summary.path}  +${summary.additions} -${summary.deletions}`;
  const body = formatUnifiedDiffRows(diff)
    .map(({ gutter, line, kind }) => colorizeDiffRow(gutter, line, kind, color))
    .join("\n");
  return [
    paint(`╭─ ${title}`, ANSI.bold, color),
    body,
    paint("╰─ Review the exact change before approval", ANSI.bold, color),
  ].join("\n");
}

export function formatUnifiedDiffRows(diff: string): readonly DiffRow[] {
  return numberDiffLines(diff).map(({ line, oldLine, newLine }) => {
    const kind = diffLineKind(line);
    const label =
      kind === "addition" ? " ADD" : kind === "deletion" ? " DEL" : "";
    return {
      gutter: `${formatLineNumber(oldLine)} ${formatLineNumber(newLine)}${label} │ `,
      line,
      kind,
    };
  });
}

function numberDiffLines(diff: string): readonly {
  readonly line: string;
  readonly oldLine?: number;
  readonly newLine?: number;
}[] {
  let oldLine: number | undefined;
  let newLine: number | undefined;
  return diff.split("\n").map((line) => {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u.exec(line);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      return { line };
    }
    if (line.startsWith("---") || line.startsWith("+++")) return { line };
    if (line.startsWith("-")) {
      const numbered = oldLine === undefined ? { line } : { line, oldLine };
      if (oldLine !== undefined) oldLine += 1;
      return numbered;
    }
    if (line.startsWith("+")) {
      const numbered = newLine === undefined ? { line } : { line, newLine };
      if (newLine !== undefined) newLine += 1;
      return numbered;
    }
    const numbered = {
      line,
      ...(oldLine === undefined ? {} : { oldLine }),
      ...(newLine === undefined ? {} : { newLine }),
    };
    if (oldLine !== undefined) oldLine += 1;
    if (newLine !== undefined) newLine += 1;
    return numbered;
  });
}

function formatLineNumber(value: number | undefined): string {
  return value === undefined ? "    " : String(value).padStart(4);
}

function diffLineKind(line: string): DiffRow["kind"] {
  if (line.startsWith("+++") || line.startsWith("---")) return "header";
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "addition";
  if (line.startsWith("-")) return "deletion";
  return "context";
}

function colorizeDiffRow(
  gutter: string,
  line: string,
  kind: DiffRow["kind"],
  color: boolean,
): string {
  const row = `${gutter}${line}`;
  if (kind === "header") {
    return `${paint(gutter, ANSI.yellow, color)}${paint(line, ANSI.bold, color)}`;
  }
  if (kind === "hunk") {
    return `${paint(gutter, ANSI.yellow, color)}${paint(line, ANSI.cyan, color)}`;
  }
  if (kind === "addition") return paint(row, ANSI.addedLine, color);
  if (kind === "deletion") return paint(row, ANSI.removedLine, color);
  return `${paint(gutter, ANSI.yellow, color)}${line}`;
}

function paint(value: string, code: string, enabled: boolean): string {
  return enabled ? `${code}${value}${ANSI.reset}` : value;
}
