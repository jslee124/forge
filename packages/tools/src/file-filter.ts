/** Workspace-relative globs: *, ?, and whole-segment ** only; no regex/extglob. */
export function supportedFileGlob(pattern: string): boolean {
  return (
    !pattern.startsWith("/") &&
    !/[\\[\]{}()!]/u.test(pattern) &&
    pattern
      .split("/")
      .every(
        (part) =>
          part &&
          part !== "." &&
          part !== ".." &&
          (!part.includes("**") || part === "**"),
      )
  );
}
export function matchesFileGlob(file: string, pattern: string): boolean {
  const parts = file.split("/");
  const tokens = pattern.split("/");
  const memo = new Map<string, boolean>();
  const visit = (i: number, j: number): boolean => {
    const key = `${i}:${j}`;
    const known = memo.get(key);
    if (known !== undefined) return known;
    const result =
      j === tokens.length
        ? i === parts.length
        : tokens[j] === "**"
          ? visit(i, j + 1) || (i < parts.length && visit(i + 1, j))
          : i < parts.length &&
            matchesSegment(parts[i] ?? "", tokens[j] ?? "") &&
            visit(i + 1, j + 1);
    memo.set(key, result);
    return result;
  };
  return visit(0, 0);
}
function matchesSegment(text: string, pattern: string): boolean {
  const characters = Array.from(text);
  const tokens = Array.from(pattern);
  let i = 0;
  let j = 0;
  let star = -1;
  let retry = 0;
  while (i < characters.length) {
    if (
      tokens[j] === "?" ||
      (j < tokens.length && tokens[j] === characters[i])
    ) {
      i++;
      j++;
    } else if (tokens[j] === "*") {
      star = j++;
      retry = i;
    } else if (star >= 0) {
      j = star + 1;
      i = ++retry;
    } else return false;
  }
  while (tokens[j] === "*") j++;
  return j === tokens.length;
}
