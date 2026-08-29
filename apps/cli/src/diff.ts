const ANSI = {
  reset: "\u001B[0m",
  bold: "\u001B[1m",
  cyan: "\u001B[36m",
  yellow: "\u001B[33m",
  addedLine: "\u001B[38;5;255m\u001B[48;5;22m",
  removedLine: "\u001B[38;5;255m\u001B[48;5;52m",
};

export interface DiffSummary {
  readonly operation: "create" | "modify" | "delete";
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
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
  const body = numberDiffLines(diff)
    .map(({ line, oldLine, newLine }) => {
      const kindLabel = diffKindLabel(line);
      const label = kindLabel === "" ? "" : ` ${kindLabel}`;
      const gutter = `${formatLineNumber(oldLine)} ${formatLineNumber(newLine)}${label} │ `;
      return `${paint(gutter, ANSI.yellow, color)}${colorizeDiffLine(line, color)}`;
    })
    .join("\n");
  return [
    paint(`╭─ ${title}`, ANSI.bold, color),
    body,
    paint("╰─ Review the exact change before approval", ANSI.bold, color),
  ].join("\n");
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

function diffKindLabel(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---")) return "";
  if (line.startsWith("+")) return "ADD";
  if (line.startsWith("-")) return "DEL";
  return "";
}

function colorizeDiffLine(line: string, color: boolean): string {
  if (line.startsWith("+++") || line.startsWith("---")) {
    return paint(line, ANSI.bold, color);
  }
  if (line.startsWith("@@")) return paint(line, ANSI.cyan, color);
  if (line.startsWith("+")) return paint(line, ANSI.addedLine, color);
  if (line.startsWith("-")) return paint(line, ANSI.removedLine, color);
  return line;
}

function paint(value: string, code: string, enabled: boolean): string {
  return enabled ? `${code}${value}${ANSI.reset}` : value;
}
