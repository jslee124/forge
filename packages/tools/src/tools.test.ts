import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ToolContext } from "@forge/core";
import { afterEach, describe, expect, it } from "vitest";

import {
  executeToolCall,
  listFiles,
  proposeToolCall,
  readFile,
  resolveWorkspace,
  search,
  toModelToolDefinitions,
  WorkspaceResolutionError,
} from "./index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture(): Promise<{
  readonly root: string;
  readonly outside: string;
  readonly context: ToolContext;
}> {
  const parent = await mkdtemp(path.join(tmpdir(), "forge-tools-"));
  temporaryDirectories.push(parent);
  const root = path.join(parent, "workspace");
  const outside = path.join(parent, "outside.txt");
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "README.md"), "The answer is forty-two.\n");
  await writeFile(
    path.join(root, "src", "index.ts"),
    "export const answer = 42;\n",
  );
  await writeFile(outside, "secret\n");

  return {
    root,
    outside,
    context: {
      workspace: await resolveWorkspace(root),
      signal: new AbortController().signal,
      limits: { maxOutputBytes: 65_536, maxEntries: 200 },
    },
  };
}

describe("workspace resolution", () => {
  it("canonicalizes the root and an in-workspace working directory", async () => {
    const { root } = await fixture();
    const workspace = await resolveWorkspace(root, path.join(root, "src"));

    expect(workspace.root).toBe(await realpath(root));
    expect(workspace.cwd).toBe(await realpath(path.join(root, "src")));
  });

  it("rejects a working directory outside the workspace", async () => {
    const { root, outside } = await fixture();

    await expect(resolveWorkspace(root, path.dirname(outside))).rejects.toThrow(
      WorkspaceResolutionError,
    );
  });
});

describe("read-only tools", () => {
  it("lists files deterministically without following symlinks", async () => {
    const { root, outside, context } = await fixture();
    await symlink(outside, path.join(root, "external-link"));

    const result = await listFiles({ path: ".", depth: 2 }, context);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output.entries).toEqual([
        { path: "external-link", type: "symlink" },
        { path: "README.md", type: "file" },
        { path: "src", type: "directory" },
        { path: "src/index.ts", type: "file" },
      ]);
      expect(result.truncated).toBe(false);
    }
  });

  it("reads a file and enforces the byte limit", async () => {
    const { context } = await fixture();
    const limitedContext = {
      ...context,
      limits: { ...context.limits, maxOutputBytes: 10 },
    };

    const result = await readFile({ path: "README.md" }, limitedContext);

    expect(result).toEqual({
      ok: true,
      output: { path: "README.md", content: "The answer", bytes: 10 },
      truncated: true,
    });
  });

  it("bounds directory entries and search matches", async () => {
    const { context } = await fixture();
    const oneEntryContext = {
      ...context,
      limits: { ...context.limits, maxEntries: 1 },
    };

    const listed = await listFiles({ path: ".", depth: 2 }, oneEntryContext);
    const searched = await search(
      {
        query: "answer",
        path: ".",
        caseSensitive: false,
        maxMatches: 1,
      },
      context,
    );

    expect(listed).toMatchObject({
      ok: true,
      output: { entries: [{ path: "README.md", type: "file" }] },
      truncated: true,
    });
    expect(searched).toMatchObject({
      ok: true,
      output: { matches: [{ path: "README.md" }] },
      truncated: true,
    });
  });

  it("denies traversal and a symlink escape before reading file content", async () => {
    const { root, outside, context } = await fixture();
    await symlink(outside, path.join(root, "external-link"));

    const traversal = await readFile({ path: "../outside.txt" }, context);
    const symlinkEscape = await readFile({ path: "external-link" }, context);

    expect(traversal).toMatchObject({
      ok: false,
      error: { code: "outside_workspace" },
    });
    expect(symlinkEscape).toMatchObject({
      ok: false,
      error: { code: "outside_workspace" },
    });
  });

  it("returns structured missing-file and wrong-kind failures", async () => {
    const { context } = await fixture();

    await expect(
      readFile({ path: "missing.txt" }, context),
    ).resolves.toMatchObject({ ok: false, error: { code: "not_found" } });
    await expect(
      listFiles({ path: "README.md", depth: 1 }, context),
    ).resolves.toMatchObject({ ok: false, error: { code: "not_directory" } });
  });

  it("searches literal text and reports location", async () => {
    const { context } = await fixture();

    const result = await search(
      {
        query: "ANSWER",
        path: ".",
        caseSensitive: false,
        maxMatches: 10,
      },
      context,
    );

    expect(result).toMatchObject({
      ok: true,
      output: {
        matches: [
          { path: "README.md", line: 1, column: 5 },
          { path: "src/index.ts", line: 1, column: 14 },
        ],
      },
    });
  });

  it("returns cancellation as a structured result", async () => {
    const { context } = await fixture();
    const controller = new AbortController();
    controller.abort("test");

    const result = await search(
      {
        query: "answer",
        path: ".",
        caseSensitive: false,
        maxMatches: 10,
      },
      { ...context, signal: controller.signal },
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "cancelled" },
    });
  });
});

describe("tool proposal and execution", () => {
  it("validates a model call before explicitly executing it", async () => {
    const { context } = await fixture();
    const call = {
      id: "call-1",
      name: "read_file",
      input: { path: "README.md" },
    };

    const proposed = proposeToolCall(call);
    expect(proposed.ok).toBe(true);

    const result = await executeToolCall(call, context);
    expect(result).toMatchObject({
      ok: true,
      output: { content: "The answer is forty-two.\n" },
    });
  });

  it("rejects unknown tools and invalid model input", () => {
    expect(
      proposeToolCall({ id: "1", name: "delete_everything", input: {} }),
    ).toMatchObject({ ok: false, error: { code: "unknown_tool" } });
    expect(
      proposeToolCall({ id: "2", name: "read_file", input: {} }),
    ).toMatchObject({ ok: false, error: { code: "invalid_input" } });
  });

  it("exports model schemas without execution callbacks", () => {
    const definitions = toModelToolDefinitions();

    expect(definitions.map(({ name }) => name)).toEqual([
      "list_files",
      "read_file",
      "search",
    ]);
    expect(definitions.every((definition) => !("execute" in definition))).toBe(
      true,
    );
  });
});
