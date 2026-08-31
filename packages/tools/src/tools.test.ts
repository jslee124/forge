import {
  mkdir,
  mkdtemp,
  readFile as readTextFile,
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
  applyPatch,
  createFile,
  editFile,
  executeToolCall,
  listFiles,
  previewEditFile,
  proposeToolCall,
  readFile,
  resolveWorkspace,
  runCommand,
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
      output: {
        path: "README.md",
        content: "The answer",
        bytes: 10,
        sha256: null,
        rewriteAvailable: false,
      },
      truncated: true,
    });
  });

  it("returns a rewrite version only for a complete read", async () => {
    const { context } = await fixture();
    const result = await readFile({ path: "README.md" }, context);

    expect(result).toMatchObject({
      ok: true,
      output: {
        rewriteAvailable: true,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
      truncated: false,
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

describe("workspace patches", () => {
  it("applies exact structured replacements and returns a diff", async () => {
    const { root, context } = await fixture();

    const result = await applyPatch(
      {
        path: "src/index.ts",
        edits: [{ oldText: "answer = 42", newText: "answer = 43" }],
      },
      context,
    );

    expect(result).toMatchObject({
      ok: true,
      output: {
        path: "src/index.ts",
        replacements: 1,
        diff: expect.stringContaining("+export const answer = 43;"),
      },
    });
    await expect(
      readTextFile(path.join(root, "src/index.ts"), "utf8"),
    ).resolves.toBe("export const answer = 43;\n");
  });

  it("rejects stale, ambiguous, traversal, and symlink patch targets", async () => {
    const { root, outside, context } = await fixture();
    await writeFile(path.join(root, "duplicates.txt"), "same\nsame\n");
    await symlink(outside, path.join(root, "external-link"));

    const stale = await applyPatch(
      { path: "README.md", edits: [{ oldText: "missing", newText: "new" }] },
      context,
    );
    const ambiguous = await applyPatch(
      { path: "duplicates.txt", edits: [{ oldText: "same", newText: "new" }] },
      context,
    );
    const traversal = await applyPatch(
      { path: "../outside.txt", edits: [{ oldText: "secret", newText: "x" }] },
      context,
    );
    const symlinkEscape = await applyPatch(
      { path: "external-link", edits: [{ oldText: "secret", newText: "x" }] },
      context,
    );

    expect(stale).toMatchObject({ ok: false, error: { code: "stale_patch" } });
    expect(ambiguous).toMatchObject({
      ok: false,
      error: { code: "stale_patch" },
    });
    expect(traversal).toMatchObject({
      ok: false,
      error: { code: "outside_workspace" },
    });
    expect(symlinkEscape).toMatchObject({
      ok: false,
      error: { code: "outside_workspace" },
    });
    await expect(readTextFile(outside, "utf8")).resolves.toBe("secret\n");
  });
});

describe("file creation", () => {
  it("creates a new UTF-8 file without replacing existing content", async () => {
    const { root, context } = await fixture();

    const created = await createFile(
      { path: "hello.md", content: "hello, world\n" },
      context,
    );
    const duplicate = await createFile(
      { path: "hello.md", content: "replacement\n" },
      context,
    );

    expect(created).toEqual({
      ok: true,
      output: { path: "hello.md", bytes: 13 },
      truncated: false,
    });
    expect(duplicate).toMatchObject({
      ok: false,
      error: { code: "already_exists" },
    });
    await expect(
      readTextFile(path.join(root, "hello.md"), "utf8"),
    ).resolves.toBe("hello, world\n");
  });

  it("denies traversal, symlink-parent escapes, and missing parents", async () => {
    const { root, outside, context } = await fixture();
    await symlink(path.dirname(outside), path.join(root, "external-directory"));

    const traversal = await createFile(
      { path: "../escaped.md", content: "no\n" },
      context,
    );
    const symlinkEscape = await createFile(
      { path: "external-directory/escaped.md", content: "no\n" },
      context,
    );
    const missingParent = await createFile(
      { path: "missing/hello.md", content: "no\n" },
      context,
    );

    expect(traversal).toMatchObject({
      ok: false,
      error: { code: "outside_workspace" },
    });
    expect(symlinkEscape).toMatchObject({
      ok: false,
      error: { code: "outside_workspace" },
    });
    expect(missingParent).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
  });
});

describe("process commands", () => {
  it("runs without a shell and reports non-zero results with bounded output", async () => {
    const { context } = await fixture();
    const limitedContext = {
      ...context,
      limits: { ...context.limits, maxOutputBytes: 8 },
    };

    const result = await runCommand(
      {
        program: process.execPath,
        args: [
          "-e",
          "process.stdout.write('123456'); process.stderr.write('abcdef'); process.exit(7)",
        ],
        cwd: ".",
        timeoutMs: 60_000,
      },
      limitedContext,
    );

    expect(result).toMatchObject({
      ok: true,
      output: { exitCode: 7, timedOut: false, cwd: "." },
      truncated: true,
    });
    if (result.ok) {
      expect(
        Buffer.byteLength(result.output.stdout + result.output.stderr),
      ).toBeLessThanOrEqual(8);
    }
  });

  it("terminates timed-out and cancelled child processes", async () => {
    const { context } = await fixture();
    const timedOut = await runCommand(
      {
        program: process.execPath,
        args: ["-e", "setInterval(() => {}, 1000)"],
        cwd: ".",
        timeoutMs: 20,
      },
      context,
    );
    const controller = new AbortController();
    const cancellation = runCommand(
      {
        program: process.execPath,
        args: ["-e", "setInterval(() => {}, 1000)"],
        cwd: ".",
        timeoutMs: 60_000,
      },
      { ...context, signal: controller.signal },
    );
    setTimeout(() => controller.abort("test"), 20);

    expect(timedOut).toMatchObject({ ok: true, output: { timedOut: true } });
    await expect(cancellation).resolves.toMatchObject({
      ok: false,
      error: { code: "cancelled" },
    });
  });

  it("denies outside working directories and rejects shell expressions", async () => {
    const { context } = await fixture();
    const outside = await runCommand(
      {
        program: process.execPath,
        args: ["--version"],
        cwd: "..",
        timeoutMs: 60_000,
      },
      context,
    );

    expect(outside).toMatchObject({
      ok: false,
      error: { code: "outside_workspace" },
    });
    expect(
      proposeToolCall({
        id: "shell",
        name: "run_command",
        input: { program: "echo hello | sh", args: [] },
      }),
    ).toMatchObject({ ok: false, error: { code: "invalid_input" } });
  });
});

describe("tool proposal and execution", () => {
  it("creates, exactly replaces, and guardedly rewrites through edit_file", async () => {
    const { root, context } = await fixture();
    const created = await editFile(
      { operation: "create", path: "new.txt", content: "one\n" },
      context,
    );
    expect(created).toMatchObject({
      ok: true,
      output: { operation: "create", path: "new.txt" },
    });

    const replaced = await editFile(
      {
        operation: "replace",
        path: "new.txt",
        edits: [{ oldText: "one", newText: "two" }],
      },
      context,
    );
    expect(replaced).toMatchObject({
      ok: true,
      output: { operation: "replace", replacements: 1 },
    });

    const read = await readFile({ path: "new.txt" }, context);
    expect(read.ok).toBe(true);
    if (!read.ok || read.output.sha256 === null) return;
    const rewritten = await editFile(
      {
        operation: "rewrite",
        path: "new.txt",
        content: "three\n",
        expectedSha256: read.output.sha256,
      },
      context,
    );
    expect(rewritten).toMatchObject({
      ok: true,
      output: { operation: "rewrite", path: "new.txt" },
    });
    expect(await readTextFile(path.join(root, "new.txt"), "utf8")).toBe(
      "three\n",
    );
  });

  it("rejects stale and unsafe edit_file operations", async () => {
    const { root, context } = await fixture();
    const read = await readFile({ path: "README.md" }, context);
    expect(read.ok).toBe(true);
    if (!read.ok || read.output.sha256 === null) return;
    await writeFile(path.join(root, "README.md"), "user change\n");

    await expect(
      editFile(
        {
          operation: "rewrite",
          path: "README.md",
          content: "replacement\n",
          expectedSha256: read.output.sha256,
        },
        context,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "stale_file" } });
    await expect(
      editFile(
        { operation: "create", path: "README.md", content: "replacement\n" },
        context,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "already_exists" } });
  });

  it("preserves a truncated create preview so it cannot be approved", async () => {
    const { context } = await fixture();
    const preview = await previewEditFile(
      {
        operation: "create",
        path: "large.txt",
        content: "content that exceeds the preview",
      },
      { ...context, limits: { ...context.limits, maxOutputBytes: 12 } },
    );

    expect(preview).toMatchObject({
      ok: true,
      output: { operation: "create", path: "large.txt" },
      truncated: true,
    });
  });

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
      "edit_file",
      "run_command",
    ]);
    expect(definitions.every((definition) => !("execute" in definition))).toBe(
      true,
    );
    expect(
      proposeToolCall({ id: "legacy", name: "apply_patch", input: {} }),
    ).toMatchObject({
      ok: false,
      error: {
        code: "unknown_tool",
        message: expect.stringContaining("edit_file"),
      },
    });
  });
});
