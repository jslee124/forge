import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FileService } from "./file-service.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "forge-files-"));
  roots.push(root);
  const workspace = join(root, "workspace");
  const outside = join(root, "outside");
  await mkdir(workspace);
  await mkdir(outside);
  await writeFile(join(workspace, "existing.txt"), "before\n");
  const service = new FileService();
  await service.setWorkspace(workspace, "task-start");
  return { root, workspace, outside, service };
}

describe("desktop file service", () => {
  it("reviews add, edit and delete against an ordinary-folder task baseline", async () => {
    const f = await fixture();
    await writeFile(join(f.workspace, "existing.txt"), "after\n");
    await writeFile(join(f.workspace, "added.txt"), "added\n");
    await rm(join(f.workspace, "existing.txt"));
    await writeFile(join(f.workspace, "changed.txt"), "new\n");
    const first = await f.service.review();
    expect(first).toMatchObject({
      baseline: "task-start",
      attribution: "changed-since-baseline",
      entries: [
        { path: "added.txt", status: "added" },
        { path: "changed.txt", status: "added" },
        { path: "existing.txt", status: "deleted" },
      ],
    });
    expect(first.limitations).toContain("no-agent-attribution");
  });

  it("keeps pre-existing content out of the change list", async () => {
    const f = await fixture();
    expect((await f.service.review()).entries).toEqual([]);
  });

  it("imports an explicit external copy and handles rename, overwrite and cancel conflicts", async () => {
    const f = await fixture();
    const source = join(f.outside, "existing.txt");
    await writeFile(source, "external\n");
    expect(await f.service.importFile(source, "cancel")).toBeNull();
    expect(await readFile(join(f.workspace, "existing.txt"), "utf8")).toBe(
      "before\n",
    );
    expect(await f.service.importFile(source, "rename")).toMatchObject({
      path: "existing 2.txt",
      renamed: true,
    });
    expect(await readFile(source, "utf8")).toBe("external\n");
    expect(await f.service.importFile(source, "overwrite")).toMatchObject({
      overwritten: true,
    });
    expect(await readFile(join(f.workspace, "existing.txt"), "utf8")).toBe(
      "external\n",
    );
  });

  it("removes a new copy and preserves an overwrite target when the source changes concurrently", async () => {
    const f = await fixture();
    const source = join(f.outside, "moving.txt");
    await writeFile(source, "first");
    const service = new FileService({
      afterCopy: async (path) => writeFile(path, "changed and longer"),
    });
    await service.setWorkspace(f.workspace, "task-start");
    await expect(service.importFile(source, "rename")).rejects.toThrow(
      "source-changed",
    );
    await expect(readFile(join(f.workspace, "moving.txt"))).rejects.toThrow();
    await writeFile(join(f.workspace, "moving.txt"), "workspace original");
    await writeFile(source, "again");
    await expect(service.importFile(source, "overwrite")).rejects.toThrow(
      "source-changed",
    );
    expect(await readFile(join(f.workspace, "moving.txt"), "utf8")).toBe(
      "workspace original",
    );
  });

  it("exports copies without changing the workspace original and requires overwrite", async () => {
    const f = await fixture();
    const destination = join(f.outside, "saved.txt");
    await writeFile(destination, "old\n");
    await expect(
      f.service.saveAs("existing.txt", destination, false),
    ).rejects.toThrow("already-exists");
    await f.service.saveAs("existing.txt", destination, true);
    expect(await readFile(destination, "utf8")).toBe("before\n");
    expect(await readFile(join(f.workspace, "existing.txt"), "utf8")).toBe(
      "before\n",
    );
  });

  it("denies traversal and symlink escapes for preview and export", async () => {
    const f = await fixture();
    const secret = join(f.outside, "secret.txt");
    await writeFile(secret, "secret");
    await symlink(secret, join(f.workspace, "escape.txt"));
    await expect(f.service.preview({ path: "escape.txt" })).rejects.toThrow(
      "outside_workspace",
    );
    await expect(
      f.service.saveAs(
        "../outside/secret.txt",
        join(f.outside, "copy.txt"),
        false,
      ),
    ).rejects.toThrow("outside-workspace");
  });

  it("previews bounded text and exposes its source", async () => {
    const f = await fixture();
    const preview = await f.service.preview({ path: "existing.txt" });
    expect(preview).toMatchObject({
      document: { kind: "text", source: "existing.txt", text: "before\n" },
      truncated: false,
    });
  });
});
