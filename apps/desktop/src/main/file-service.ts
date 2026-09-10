import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  constants,
  copyFile,
  lstat,
  mkdtemp,
  opendir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import { isPathInside, readDocument, resolveWorkspace } from "@forge/tools";

import type {
  ChangeEntry,
  ChangeReview,
  FilePreview,
  ImportedFile,
  PreviewRequest,
  SavedFile,
} from "../shared/file-protocol.js";

const MAX_BASELINE_FILES = 5_000;
const MAX_BASELINE_TEXT_BYTES = 16 * 1024 * 1024;
const MAX_FILE_TEXT_BYTES = 1024 * 1024;
const MAX_PATCH_BYTES = 512 * 1024;
const MAX_REVIEW_PATCH_BYTES = 4 * 1024 * 1024;
const MAX_PREVIEW_BINARY_BYTES = 32 * 1024 * 1024;
const IGNORED = new Set([".git", "node_modules", "dist", "out", "release"]);

type SnapshotEntry = { hash: string; content?: string };
type Snapshot = { entries: Map<string, SnapshotEntry>; truncated: boolean };

export class FileService {
  readonly #afterCopy: ((source: string) => Promise<void>) | undefined;
  #cwd = "";
  #baseline: Snapshot | undefined;
  #baselineKind: ChangeReview["baseline"] = "unavailable";

  constructor(options: { afterCopy?: (source: string) => Promise<void> } = {}) {
    this.#afterCopy = options.afterCopy;
  }

  async setWorkspace(
    cwd: string,
    baseline: Exclude<
      ChangeReview["baseline"],
      "unavailable"
    > = "workspace-selection",
  ): Promise<void> {
    this.#cwd = await realpath(cwd);
    if (!(await stat(this.#cwd)).isDirectory())
      throw new Error("workspace-unavailable");
    this.#baseline = await snapshot(this.#cwd);
    this.#baselineKind = baseline;
  }

  async importFile(
    source: string,
    conflict: "rename" | "overwrite" | "cancel",
  ): Promise<ImportedFile | null> {
    this.#assertWorkspace();
    const canonicalSource = await realpath(source);
    if (!(await stat(canonicalSource)).isFile()) throw new Error("not-file");
    let destination = join(this.#cwd, basename(source));
    let renamed = false;
    let overwritten = false;
    if (await exists(destination)) {
      if (conflict === "cancel") return null;
      if (conflict === "rename") {
        destination = await availableName(destination);
        renamed = true;
      } else {
        overwritten = true;
      }
    }
    await safeCopy(canonicalSource, destination, overwritten, this.#afterCopy);
    return { path: relativePath(this.#cwd, destination), renamed, overwritten };
  }

  async saveAs(
    source: string,
    destination: string,
    overwrite: boolean,
  ): Promise<SavedFile> {
    const canonicalSource = await this.#workspaceFile(source);
    const target = resolve(destination);
    if ((await exists(target)) && !overwrite) throw new Error("already-exists");
    if (canonicalSource !== target)
      await safeCopy(canonicalSource, target, overwrite, this.#afterCopy);
    return {
      source,
      destination: target,
      overwritten: overwrite && canonicalSource !== target,
    };
  }

  async preview(request: PreviewRequest): Promise<FilePreview> {
    this.#assertWorkspace();
    const signal = new AbortController().signal;
    const context = {
      workspace: await resolveWorkspace(this.#cwd),
      signal,
      limits: { maxOutputBytes: 512 * 1024, maxEntries: 500 },
    };
    const result = await readDocument(request, context);
    if (!result.ok) throw new Error(result.error.code);
    let dataUrl: string | undefined;
    if (result.output.kind === "image" || result.output.kind === "pdf") {
      const file = await this.#workspaceFile(request.path);
      const info = await stat(file);
      if (info.size <= MAX_PREVIEW_BINARY_BYTES) {
        const mime =
          result.output.kind === "pdf"
            ? "application/pdf"
            : result.output.mimeType;
        dataUrl = `data:${mime};base64,${(await readFile(file)).toString("base64")}`;
      }
    }
    return {
      document: result.output,
      truncated: result.truncated,
      ...(dataUrl ? { dataUrl } : {}),
    };
  }

  async review(): Promise<ChangeReview> {
    this.#assertWorkspace();
    const current = await snapshot(this.#cwd);
    const baseline = this.#baseline;
    if (!baseline) {
      return {
        baseline: "unavailable",
        attribution: "changed-since-baseline",
        entries: [],
        truncated: true,
        limitations: ["no-baseline"],
        engineCoverage: engineCoverage(),
      };
    }
    const paths = [
      ...new Set([...baseline.entries.keys(), ...current.entries.keys()]),
    ].sort();
    const entries: ChangeEntry[] = [];
    let patchBytes = 0;
    let patchTruncated = false;
    for (const path of paths) {
      const before = baseline.entries.get(path);
      const after = current.entries.get(path);
      if (before?.hash === after?.hash) continue;
      const status = !before ? "added" : !after ? "deleted" : "modified";
      const canPatch =
        status === "modified"
          ? before?.content !== undefined && after?.content !== undefined
          : (before?.content ?? after?.content) !== undefined;
      const candidate = canPatch
        ? unifiedPatch(
            path,
            before?.content ?? "",
            after?.content ?? "",
            status,
          )
        : null;
      const candidateBytes = candidate ? Buffer.byteLength(candidate) : 0;
      const patch =
        candidate &&
        candidateBytes <= MAX_PATCH_BYTES &&
        patchBytes + candidateBytes <= MAX_REVIEW_PATCH_BYTES
          ? candidate
          : null;
      if (!canPatch || (candidate && !patch)) patchTruncated = true;
      patchBytes += patch ? candidateBytes : 0;
      entries.push({
        path,
        status,
        patch,
      });
    }
    const truncated = baseline.truncated || current.truncated || patchTruncated;
    return {
      baseline: this.#baselineKind,
      attribution: "changed-since-baseline",
      entries,
      truncated,
      limitations: [
        "no-agent-attribution",
        "concurrent-edits-indistinguishable",
        ...(truncated ? (["bounded-snapshot"] as const) : []),
      ],
      engineCoverage: engineCoverage(),
    };
  }

  async workspaceFile(path: string): Promise<string> {
    return this.#workspaceFile(path);
  }

  async #workspaceFile(path: string): Promise<string> {
    this.#assertWorkspace();
    const candidate = resolve(this.#cwd, path);
    if (!isPathInside(this.#cwd, candidate))
      throw new Error("outside-workspace");
    const canonical = await realpath(candidate);
    if (!isPathInside(this.#cwd, canonical))
      throw new Error("outside-workspace");
    if (!(await stat(canonical)).isFile()) throw new Error("not-file");
    return canonical;
  }

  #assertWorkspace(): void {
    if (!this.#cwd) throw new Error("workspace-unavailable");
  }
}

function engineCoverage(): ChangeReview["engineCoverage"] {
  return {
    native: "approval-plus-baseline",
    codex: "baseline-only",
  };
}

async function snapshot(root: string): Promise<Snapshot> {
  const entries = new Map<string, SnapshotEntry>();
  let textBytes = 0;
  let truncated = false;
  const visit = async (directory: string): Promise<void> => {
    const handle = await opendir(directory);
    const children = [];
    for await (const child of handle) children.push(child);
    children.sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) {
      if (entries.size >= MAX_BASELINE_FILES) {
        truncated = true;
        return;
      }
      if (child.isDirectory() && IGNORED.has(child.name)) continue;
      const absolute = join(directory, child.name);
      if (child.isDirectory()) await visit(absolute);
      else if (child.isFile()) {
        const path = relativePath(root, absolute);
        const info = await stat(absolute);
        let entry: SnapshotEntry;
        if (
          info.size <= MAX_FILE_TEXT_BYTES &&
          textBytes + info.size <= MAX_BASELINE_TEXT_BYTES
        ) {
          const bytes = await readFile(absolute);
          entry = { hash: createHash("sha256").update(bytes).digest("hex") };
          if (!bytes.subarray(0, 8_192).includes(0)) {
            entry.content = bytes.toString("utf8");
            textBytes += bytes.length;
          }
        } else {
          entry = { hash: await hashFile(absolute) };
          truncated = true;
        }
        entries.set(path, entry);
      }
    }
  };
  await visit(root);
  return { entries, truncated };
}

async function safeCopy(
  source: string,
  destination: string,
  overwrite: boolean,
  afterCopy?: (source: string) => Promise<void>,
): Promise<void> {
  await realpath(dirname(destination));
  if (!overwrite) {
    await copyFile(source, destination, constants.COPYFILE_EXCL);
    await afterCopy?.(source);
    if ((await hashFile(source)) !== (await hashFile(destination))) {
      await rm(destination, { force: true });
      throw new Error("source-changed");
    }
    return;
  }
  const temporary = await mkdtemp(join(dirname(destination), ".forge-copy-"));
  const staged = join(temporary, basename(destination));
  try {
    await copyFile(source, staged, constants.COPYFILE_EXCL);
    await afterCopy?.(source);
    if ((await hashFile(source)) !== (await hashFile(staged)))
      throw new Error("source-changed");
    await rename(staged, destination);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function exists(path: string): Promise<boolean> {
  return lstat(path).then(
    () => true,
    () => false,
  );
}

async function availableName(path: string): Promise<string> {
  const extension = extname(path);
  const stem = basename(path, extension);
  for (let index = 2; index < 10_000; index++) {
    const candidate = join(dirname(path), `${stem} ${index}${extension}`);
    if (!(await exists(candidate))) return candidate;
  }
  throw new Error("name-conflict");
}

function relativePath(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

function unifiedPatch(
  path: string,
  before: string,
  after: string,
  status: ChangeEntry["status"],
): string {
  const oldPath = status === "added" ? "/dev/null" : `a/${path}`;
  const newPath = status === "deleted" ? "/dev/null" : `b/${path}`;
  const beforeLines = before ? before.replace(/\n$/, "").split("\n") : [];
  const afterLines = after ? after.replace(/\n$/, "").split("\n") : [];
  return [
    `diff --git a/${path} b/${path}`,
    `--- ${oldPath}`,
    `+++ ${newPath}`,
    `@@ -${beforeLines.length ? 1 : 0},${beforeLines.length} +${afterLines.length ? 1 : 0},${afterLines.length} @@`,
    ...beforeLines.map((line) => `-${line}`),
    ...afterLines.map((line) => `+${line}`),
    "",
  ].join("\n");
}
