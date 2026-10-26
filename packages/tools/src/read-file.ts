import { isUtf8 } from "node:buffer";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, stat } from "node:fs/promises";

import type { ForgeTool, ToolContext, ToolResult } from "@forge/core";
import { z } from "zod";
import {
  cancelled,
  failure,
  relativeWorkspacePath,
  resolveToolPath,
} from "./path.js";

const MAX_SCAN_BYTES = 64 * 1024 * 1024;
export const readFileInputSchema = z
  .object({
    path: z
      .string()
      .min(1)
      .describe("Workspace-relative UTF-8 text file path."),
    format: z
      .enum(["raw", "numbered"])
      .optional()
      .describe(
        "Default raw. Numbered prefixes each source line with its 1-based number for citation; presentation only, never a rewrite baseline.",
      ),
    startLine: z
      .number()
      .int()
      .min(1)
      .max(10_000_000)
      .optional()
      .describe(
        "First line, 1-based. Omit both range fields for a complete bounded read.",
      ),
    lineCount: z
      .number()
      .int()
      .min(1)
      .max(2000)
      .optional()
      .describe(
        "Maximum lines to return; defaults to 200 when startLine is supplied.",
      ),
  })
  .strict();
export type ReadFileInput = z.infer<typeof readFileInputSchema>;
export interface ReadFileOutput {
  readonly path: string;
  readonly content: string;
  readonly contentFormat?: "numbered";
  readonly bytes: number;
  readonly sha256: string | null;
  readonly rewriteAvailable: boolean;
  readonly startLine: number;
  readonly endLine: number | null;
  readonly returnedLines: number;
  readonly totalLines: number | null;
  readonly totalLinesKnown: boolean;
  readonly partial: boolean;
  /** Metadata identity for detecting change, never a full-content hash or authorization. */
  readonly resourceVersion: string;
  readonly scannedBytes: number;
  readonly limitReason?: "output_limit" | "scan_limit";
}
export const readFileTool: ForgeTool = {
  name: "read_file",
  description:
    "Read workspace UTF-8 text, optionally by 1-based startLine/lineCount. Prefer bounded line ranges and format=numbered for source citations. Numbered content is presentation only and cannot authorize a whole-file rewrite. Ranges and truncated reads never provide a full-file rewrite hash. Streaming skips at most 64 MiB; output and omissions are explicit.",
  inputSchema: readFileInputSchema,
  risk: "read",
  execute: (input, context) => {
    const parsed = readFileInputSchema.safeParse(input);
    return parsed.success
      ? readFile(parsed.data, context)
      : Promise.resolve(
          failure("invalid_input", "Invalid input for read_file."),
        );
  },
};

export async function readFile(
  input: ReadFileInput,
  context: ToolContext,
): Promise<ToolResult<ReadFileOutput>> {
  const parsed = readFileInputSchema.safeParse(input);
  if (!parsed.success)
    return failure("invalid_input", "Invalid input for read_file.");
  if (context.signal.aborted) return cancelled();
  const resolved = await resolveToolPath(input.path, context.workspace);
  if (!resolved.ok) return resolved;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    if (!(await stat(resolved.path)).isFile())
      return failure("not_file", "The requested path is not a regular file.");
    handle = await open(
      resolved.path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const before = await handle.stat({ bigint: true });
    if (!before.isFile())
      return failure("not_file", "The requested path is not a regular file.");
    const version = (value: typeof before) =>
      createHash("sha256")
        .update(
          [value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs].join(
            ":",
          ),
        )
        .digest("hex");
    const resourceVersion = version(before);
    const ranged =
      input.startLine !== undefined || input.lineCount !== undefined;
    const startLine = input.startLine ?? 1;
    const lastLine = ranged
      ? startLine + (input.lineCount ?? 200) - 1
      : Infinity;
    const outputLimit = Math.max(0, Math.floor(context.limits.maxOutputBytes));
    const chunks: Buffer[] = [];
    const readLimit = ranged
      ? MAX_SCAN_BYTES
      : Math.min(MAX_SCAN_BYTES, outputLimit + 1);
    const buffer = Buffer.alloc(Math.max(1, Math.min(65_536, readLimit)));
    let position = 0;
    let processed = 0;
    let line = 1;
    let selected = 0;
    let lastByte: number | undefined;
    let stopped = false;
    while (!stopped && position < readLimit) {
      if (context.signal.aborted) return cancelled();
      const { bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(buffer.length, readLimit - position),
        position,
      );
      if (!bytesRead) break;
      position += bytesRead;
      const chunk = buffer.subarray(0, bytesRead);
      let offset = 0;
      let selectedStart: number | undefined;
      let selectedEnd = 0;
      while (offset < bytesRead) {
        const newline = chunk.indexOf(10, offset);
        let end = newline < 0 ? bytesRead : newline + 1;
        if (line >= startLine) {
          end = Math.min(end, offset + outputLimit + 1 - selected);
          selectedStart ??= offset;
          selectedEnd = end;
          selected += end - offset;
        }
        processed += end - offset;
        lastByte = buffer[end - 1];
        if (newline >= 0 && end === newline + 1) line++;
        offset = end;
        if (selected > outputLimit || line > lastLine) {
          stopped = true;
          break;
        }
      }
      if (selectedStart !== undefined)
        chunks.push(Buffer.from(chunk.subarray(selectedStart, selectedEnd)));
    }
    if (context.signal.aborted) return cancelled();
    if (version(await handle.stat({ bigint: true })) !== resourceVersion)
      return failure(
        "stale_file",
        "The file changed while being read. Read it again.",
        true,
      );
    const completeScan = BigInt(processed) === before.size;
    const outputLimited = selected > outputLimit;
    const scanLimited = !stopped && !completeScan && position >= MAX_SCAN_BYTES;
    const raw = Buffer.concat(chunks);
    let end = Math.min(raw.length, outputLimit);
    if (outputLimited)
      while (end > 0 && ((raw[end] ?? 0) & 0xc0) === 0x80) end--;
    const bytes = raw.subarray(0, end);
    if (!isUtf8(bytes) || bytes.includes(0))
      return failure(
        "not_text",
        "The requested content is not valid UTF-8 text.",
      );
    const rawContent = bytes.toString("utf8");
    const numbered =
      input.format === "numbered"
        ? numberLines(rawContent, startLine, outputLimit)
        : undefined;
    const content = numbered?.content ?? rawContent;
    const returnedLines = numbered?.returnedLines ?? lineCount(rawContent);
    const totalLines = completeScan
      ? before.size === 0n
        ? 0
        : line - (lastByte === 10 ? 1 : 0)
      : null;
    const presentationLimited = numbered?.truncated === true;
    const truncated = outputLimited || scanLimited || presentationLimited;
    const partial = ranged || truncated;
    const rewriteAvailable = !partial && !numbered;
    return {
      ok: true,
      output: {
        path: relativeWorkspacePath(context.workspace, resolved.path),
        content,
        ...(numbered ? { contentFormat: "numbered" as const } : {}),
        bytes: Buffer.byteLength(content),
        sha256: rewriteAvailable
          ? createHash("sha256").update(bytes).digest("hex")
          : null,
        rewriteAvailable,
        startLine,
        endLine: returnedLines ? startLine + returnedLines - 1 : null,
        returnedLines,
        totalLines,
        totalLinesKnown: completeScan,
        partial,
        resourceVersion,
        scannedBytes: position,
        ...(outputLimited || presentationLimited
          ? { limitReason: "output_limit" as const }
          : scanLimited
            ? { limitReason: "scan_limit" as const }
            : {}),
      },
      truncated,
    };
  } catch {
    return failure("io_error", "The file could not be read.", true);
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
function lineCount(text: string): number {
  if (!text) return 0;
  let count = text.endsWith("\n") ? 0 : 1;
  for (
    let index = text.indexOf("\n");
    index >= 0;
    index = text.indexOf("\n", index + 1)
  )
    count++;
  return count;
}

/** Prefix only returned source lines; labels share the existing content byte cap. */
function numberLines(text: string, startLine: number, limit: number) {
  const parts: string[] = [];
  let used = 0;
  let offset = 0;
  let returnedLines = 0;
  while (offset < text.length) {
    const prefix = `${startLine + returnedLines}: `;
    const prefixBytes = Buffer.byteLength(prefix);
    if (used + prefixBytes >= limit) break;
    const newline = text.indexOf("\n", offset);
    const end = newline < 0 ? text.length : newline + 1;
    const raw = Buffer.from(text.slice(offset, end));
    let length = Math.min(raw.length, limit - used - prefixBytes);
    while (
      length > 0 &&
      length < raw.length &&
      ((raw[length] ?? 0) & 0xc0) === 0x80
    )
      length--;
    if (!length) break;
    parts.push(prefix, raw.subarray(0, length).toString("utf8"));
    used += prefixBytes + length;
    returnedLines++;
    if (length < raw.length)
      return { content: parts.join(""), returnedLines, truncated: true };
    offset = end;
  }
  return {
    content: parts.join(""),
    returnedLines,
    truncated: offset < text.length,
  };
}
