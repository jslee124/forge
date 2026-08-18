import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  activeMentionQuery,
  assemblePrompt,
  classifySubmissionKey,
  createEditorState,
  deleteEditorRange,
  discoverWorkspaceFiles,
  filterWorkspaceFiles,
  insertEditorText,
  insertFileMention,
  moveEditorCursor,
  referencedPaths,
  slashCommandQuery,
} from "./interactive-model.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("interactive editor model", () => {
  it("edits multi-line text at the cursor", () => {
    let state = createEditorState("hello world");
    state = moveEditorCursor(state, 5);
    state = insertEditorText(state, "\n");
    expect(state).toMatchObject({ value: "hello\n world", cursor: 6 });
    state = deleteEditorRange(state, 5, 6);
    expect(state).toMatchObject({ value: "hello world", cursor: 5 });
  });

  it("distinguishes submission from newline shortcuts", () => {
    expect(
      classifySubmissionKey("", { return: true, shift: false, ctrl: false }),
    ).toBe("submit");
    expect(
      classifySubmissionKey("", { return: true, shift: true, ctrl: false }),
    ).toBe("newline");
    expect(
      classifySubmissionKey("j", { return: false, shift: false, ctrl: true }),
    ).toBe("newline");
  });

  it("detects slash commands only at the beginning of input", () => {
    expect(slashCommandQuery("  /cl", 5)).toBe("/cl");
    expect(slashCommandQuery("open /src", 9)).toBeUndefined();
  });

  it("retains selected files structurally and invalidates edited mentions", () => {
    let state = createEditorState("review @sess please");
    state = moveEditorCursor(state, 12);
    const query = activeMentionQuery(state.value, state.cursor);
    expect(query).toEqual({ start: 7, end: 12, query: "sess" });
    if (!query) throw new Error("Expected an active mention query.");
    state = insertFileMention(state, query, "apps/cli/src/session file.ts");
    expect(referencedPaths(state)).toEqual(["apps/cli/src/session file.ts"]);
    expect(assemblePrompt(state)).toContain(
      "Referenced files:\n- apps/cli/src/session file.ts",
    );

    state = moveEditorCursor(state, 10);
    state = insertEditorText(state, "x");
    expect(referencedPaths(state)).toEqual([]);
  });
});

describe("workspace file completion", () => {
  it("discovers bounded files without dependencies, output, or symlinks", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forge-files-"));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, "src"));
    await mkdir(path.join(root, "node_modules"));
    await mkdir(path.join(root, "dist"));
    await writeFile(path.join(root, "src", "session.ts"), "export {};\n");
    await writeFile(path.join(root, "README.md"), "# Example\n");
    await writeFile(path.join(root, "node_modules", "hidden.js"), "");
    await writeFile(path.join(root, "dist", "hidden.js"), "");
    await symlink(path.join(root, "src"), path.join(root, "linked-src"));

    await expect(discoverWorkspaceFiles(root)).resolves.toEqual([
      "README.md",
      "src/session.ts",
    ]);
  });

  it("ranks basename prefixes and fuzzy path matches", () => {
    const files = [
      "docs/SESSION.md",
      "apps/cli/src/session.ts",
      "apps/cli/src/signals.ts",
    ];
    expect(filterWorkspaceFiles(files, "sess", 2)).toEqual([
      "docs/SESSION.md",
      "apps/cli/src/session.ts",
    ]);
    expect(filterWorkspaceFiles(files, "asig")).toEqual([
      "apps/cli/src/signals.ts",
    ]);
  });
});
