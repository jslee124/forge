import type { Dirent } from "node:fs";
import { readdir, realpath } from "node:fs/promises";
import path from "node:path";

export interface FileMention {
  readonly path: string;
  readonly start: number;
  readonly end: number;
}

export interface EditorState {
  readonly value: string;
  readonly cursor: number;
  readonly mentions: readonly FileMention[];
}

export interface MentionQuery {
  readonly start: number;
  readonly end: number;
  readonly query: string;
}

export interface SubmissionKey {
  readonly return: boolean;
  readonly shift: boolean;
  readonly ctrl: boolean;
  readonly meta: boolean;
}

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".pnpm-store",
  ".turbo",
  ".next",
  "coverage",
  "dist",
  "node_modules",
]);

export function createEditorState(value = ""): EditorState {
  return { value, cursor: value.length, mentions: [] };
}

export function insertEditorText(
  state: EditorState,
  text: string,
): EditorState {
  if (text === "") return state;
  const cursor = state.cursor + text.length;
  return {
    value: `${state.value.slice(0, state.cursor)}${text}${state.value.slice(state.cursor)}`,
    cursor,
    mentions: shiftMentionsForInsertion(
      state.mentions,
      state.cursor,
      text.length,
    ),
  };
}

export function deleteEditorRange(
  state: EditorState,
  start: number,
  end: number,
): EditorState {
  const boundedStart = Math.max(0, Math.min(start, state.value.length));
  const boundedEnd = Math.max(boundedStart, Math.min(end, state.value.length));
  if (boundedStart === boundedEnd) return state;
  return {
    value: `${state.value.slice(0, boundedStart)}${state.value.slice(boundedEnd)}`,
    cursor: boundedStart,
    mentions: shiftMentionsForDeletion(
      state.mentions,
      boundedStart,
      boundedEnd,
    ),
  };
}

export function moveEditorCursor(
  state: EditorState,
  cursor: number,
): EditorState {
  return {
    ...state,
    cursor: Math.max(0, Math.min(cursor, state.value.length)),
  };
}

export function insertFileMention(
  state: EditorState,
  query: MentionQuery,
  filePath: string,
): EditorState {
  const rendered = `@${filePath}`;
  const withoutQuery = deleteEditorRange(state, query.start, query.end);
  const inserted = insertEditorText(withoutQuery, rendered);
  return {
    ...inserted,
    mentions: [
      ...inserted.mentions,
      {
        path: filePath,
        start: query.start,
        end: query.start + rendered.length,
      },
    ].sort((left, right) => left.start - right.start),
  };
}

export function activeMentionQuery(
  value: string,
  cursor: number,
): MentionQuery | undefined {
  const beforeCursor = value.slice(0, cursor);
  const start = beforeCursor.lastIndexOf("@");
  if (start < 0) return undefined;
  if (start > 0 && !/\s/u.test(value[start - 1] ?? "")) return undefined;
  const token = value.slice(start + 1, cursor);
  if (/\s/u.test(token)) return undefined;
  return { start, end: cursor, query: token };
}

export function slashCommandQuery(
  value: string,
  cursor: number,
): string | undefined {
  const beforeCursor = value.slice(0, cursor);
  if (!/^\s*\/[^\s]*$/u.test(beforeCursor)) return undefined;
  return beforeCursor.trimStart();
}

export function classifySubmissionKey(
  input: string,
  key: SubmissionKey,
): "newline" | "submit" | undefined {
  if (
    (key.return && (key.shift || key.meta)) ||
    (key.ctrl && (input === "j" || input === "\n"))
  ) {
    return "newline";
  }
  return key.return ? "submit" : undefined;
}

export function referencedPaths(state: EditorState): readonly string[] {
  const paths = state.mentions
    .filter(
      (mention) =>
        state.value.slice(mention.start, mention.end) === `@${mention.path}`,
    )
    .map(({ path: filePath }) => filePath);
  return [...new Set(paths)];
}

export function assemblePrompt(state: EditorState): string {
  const paths = referencedPaths(state);
  const prompt = state.value;
  if (paths.length === 0) return prompt;
  return [
    prompt,
    "",
    "Referenced files:",
    ...paths.map((filePath) => `- ${filePath}`),
  ].join("\n");
}

export async function discoverWorkspaceFiles(
  workspaceRoot: string,
  options: {
    readonly signal?: AbortSignal;
    readonly maxFiles?: number;
    readonly maxDepth?: number;
  } = {},
): Promise<readonly string[]> {
  const root = await realpath(workspaceRoot);
  const maxFiles = options.maxFiles ?? 5_000;
  const maxDepth = options.maxDepth ?? 12;
  const files: string[] = [];

  const visit = async (directory: string, depth: number): Promise<void> => {
    if (
      options.signal?.aborted ||
      files.length >= maxFiles ||
      depth > maxDepth
    ) {
      return;
    }
    let entries: Dirent[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (options.signal?.aborted || files.length >= maxFiles) return;
      if (entry.isSymbolicLink()) continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) {
          await visit(absolutePath, depth + 1);
        }
      } else if (entry.isFile()) {
        files.push(path.relative(root, absolutePath).split(path.sep).join("/"));
      }
    }
  };

  await visit(root, 0);
  return files;
}

export function filterWorkspaceFiles(
  files: readonly string[],
  query: string,
  limit = 10,
): readonly string[] {
  return filterFuzzy(files, query, (filePath) => filePath, limit);
}

export function filterFuzzy<T>(
  items: readonly T[],
  query: string,
  getText: (item: T) => string | readonly string[],
  limit = items.length,
): readonly T[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (normalized === "") return items.slice(0, limit);

  return items
    .map((item) => {
      const text = getText(item);
      const fields = typeof text === "string" ? [text] : text;
      const matches = fields
        .map((field) => ({ text: field, score: fuzzyScore(field, normalized) }))
        .filter(
          (match): match is { readonly text: string; readonly score: number } =>
            match.score !== undefined,
        )
        .sort(
          (left, right) =>
            left.score - right.score || left.text.localeCompare(right.text),
        );
      const best = matches[0];
      return { item, text: best?.text ?? "", score: best?.score };
    })
    .filter(
      (
        candidate,
      ): candidate is {
        readonly item: T;
        readonly text: string;
        readonly score: number;
      } => candidate.score !== undefined,
    )
    .sort(
      (left, right) =>
        left.score - right.score || left.text.localeCompare(right.text),
    )
    .slice(0, limit)
    .map(({ item }) => item);
}

function fuzzyScore(filePath: string, query: string): number | undefined {
  if (query === "") return filePath.length;
  const candidate = filePath.toLocaleLowerCase();
  const direct = candidate.indexOf(query);
  if (direct >= 0) {
    const baseName = candidate.slice(candidate.lastIndexOf("/") + 1);
    return (
      direct + (baseName.startsWith(query) ? -100 : 0) + filePath.length / 1_000
    );
  }
  let queryIndex = 0;
  let gapScore = 0;
  let previousMatch = -1;
  for (
    let index = 0;
    index < candidate.length && queryIndex < query.length;
    index += 1
  ) {
    if (candidate[index] === query[queryIndex]) {
      if (previousMatch >= 0) gapScore += index - previousMatch - 1;
      previousMatch = index;
      queryIndex += 1;
    }
  }
  return queryIndex === query.length
    ? 1_000 + gapScore + filePath.length / 1_000
    : undefined;
}

function shiftMentionsForInsertion(
  mentions: readonly FileMention[],
  position: number,
  length: number,
): readonly FileMention[] {
  return mentions.flatMap((mention) => {
    if (position <= mention.start) {
      return [
        {
          ...mention,
          start: mention.start + length,
          end: mention.end + length,
        },
      ];
    }
    if (position >= mention.end) return [mention];
    return [];
  });
}

function shiftMentionsForDeletion(
  mentions: readonly FileMention[],
  start: number,
  end: number,
): readonly FileMention[] {
  const length = end - start;
  return mentions.flatMap((mention) => {
    if (mention.end <= start) return [mention];
    if (mention.start >= end) {
      return [
        {
          ...mention,
          start: mention.start - length,
          end: mention.end - length,
        },
      ];
    }
    return [];
  });
}
