import { open, readFile as readBytes, stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import type { ForgeTool, ToolContext, ToolResult } from "@forge/core";
import Papa from "papaparse";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { z } from "zod";

import {
  cancelled,
  failure,
  relativeWorkspacePath,
  resolveToolPath,
} from "./path.js";

const MAX_PDF_BYTES = 32 * 1024 * 1024;
const MAX_TABLE_BYTES = 16 * 1024 * 1024;
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_PAGES_PER_READ = 20;
const MAX_ROWS_PER_READ = 500;

export const readDocumentInputSchema = z
  .object({
    path: z.string().min(1).describe("Workspace-relative document path."),
    pageStart: z.number().int().min(1).optional(),
    pageEnd: z.number().int().min(1).optional(),
    rowStart: z.number().int().min(1).optional(),
    rowEnd: z.number().int().min(1).optional(),
    calculation: z
      .object({
        column: z.number().int().min(0),
        operation: z.enum(["sum", "average", "minimum", "maximum"]),
      })
      .strict()
      .optional(),
  })
  .strict();

export type ReadDocumentInput = z.infer<typeof readDocumentInputSchema>;

export type ReadDocumentOutput =
  | {
      readonly kind: "pdf";
      readonly source: string;
      readonly pageStart: number;
      readonly pageEnd: number;
      readonly totalPages: number;
      readonly pages: readonly {
        readonly page: number;
        readonly text: string;
        readonly textless: boolean;
      }[];
      readonly note?: string;
    }
  | {
      readonly kind: "table";
      readonly source: string;
      readonly delimiter: "," | "\t";
      readonly rowStart: number;
      readonly rowEnd: number;
      readonly totalRows: number;
      readonly rows: readonly (readonly string[])[];
      readonly errors: readonly {
        readonly row: number;
        readonly code: string;
        readonly message: string;
      }[];
      readonly analysisScope: "full-file";
      readonly calculation?: {
        readonly column: number;
        readonly operation: "sum" | "average" | "minimum" | "maximum";
        readonly value: number | null;
        readonly rowsConsidered: number;
        readonly invalidRows: readonly number[];
      };
    }
  | {
      readonly kind: "text";
      readonly source: string;
      readonly text: string;
      readonly bytes: number;
    }
  | {
      readonly kind: "image";
      readonly source: string;
      readonly mimeType: "image/png" | "image/jpeg";
      readonly bytes: number;
      readonly width: number | null;
      readonly height: number | null;
      readonly note: string;
    };

export const readDocumentTool: ForgeTool = {
  name: "read_document",
  description:
    "Read a bounded page or row range from a PDF, CSV, TSV, text, or image inside the workspace. PDF text extraction is not OCR; table values remain strings.",
  inputSchema: readDocumentInputSchema,
  risk: "read",
  execute: async (input, context) => {
    const parsed = readDocumentInputSchema.safeParse(input);
    return parsed.success
      ? readDocument(parsed.data, context)
      : failure("invalid_input", "Invalid input for read_document.");
  },
};

export async function readDocument(
  input: ReadDocumentInput,
  context: ToolContext,
): Promise<ToolResult<ReadDocumentOutput>> {
  if (context.signal.aborted) return cancelled();
  const resolved = await resolveToolPath(input.path, context.workspace);
  if (!resolved.ok) return resolved;
  try {
    const info = await stat(resolved.path);
    if (!info.isFile())
      return failure("not_file", "The requested path is not a regular file.");
    const source = relativeWorkspacePath(context.workspace, resolved.path);
    const extension = source.toLowerCase().split(".").pop() ?? "";
    if (extension === "pdf") {
      if (info.size > MAX_PDF_BYTES)
        return failure(
          "limit_reached",
          "PDF exceeds the 32 MiB reading limit.",
        );
      return readPdf(resolved.path, source, input, context);
    }
    if (extension === "csv" || extension === "tsv") {
      if (info.size > MAX_TABLE_BYTES)
        return failure(
          "limit_reached",
          "Table exceeds the 16 MiB parsing limit.",
        );
      return readTable(resolved.path, source, extension, input, context);
    }
    if (["png", "jpg", "jpeg"].includes(extension)) {
      if (info.size > MAX_IMAGE_BYTES)
        return failure(
          "limit_reached",
          "Image exceeds the 32 MiB preview limit.",
        );
      const header = await readBytes(resolved.path);
      if (context.signal.aborted) return cancelled();
      const dimensions = imageDimensions(header, extension);
      return {
        ok: true,
        output: {
          kind: "image",
          source,
          mimeType: extension === "png" ? "image/png" : "image/jpeg",
          bytes: info.size,
          ...dimensions,
          note: "Preview is available. Model analysis depends on the selected engine's image-input support.",
        },
        truncated: false,
      };
    }
    const handle = await open(resolved.path, "r");
    try {
      const maximum = context.limits.maxOutputBytes;
      const buffer = Buffer.alloc(maximum + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (context.signal.aborted) return cancelled();
      const slice = buffer.subarray(0, Math.min(bytesRead, maximum));
      return {
        ok: true,
        output: {
          kind: "text",
          source,
          text: slice.toString("utf8"),
          bytes: slice.byteLength,
        },
        truncated: bytesRead > maximum,
      };
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (context.signal.aborted) return cancelled();
    return failure(
      "io_error",
      error instanceof Error && error.message
        ? `The document could not be read: ${error.message}`
        : "The document could not be read.",
      true,
    );
  }
}

async function readPdf(
  path: string,
  source: string,
  input: ReadDocumentInput,
  context: ToolContext,
): Promise<ToolResult<ReadDocumentOutput>> {
  const bytes = await readBytes(path);
  // biome-ignore lint/complexity/useLiteralKeys: ProcessEnv is index-signature-only under strict TypeScript.
  const resourceRoot = process.env["FORGE_PDFJS_RESOURCE_ROOT"];
  const resourceUrl = (name: string) =>
    resourceRoot
      ? `${pathToFileURL(join(resourceRoot, name)).toString()}/`
      : undefined;
  const loading = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
    useWorkerFetch: false,
    ...(resourceUrl("cmaps") ? { cMapUrl: resourceUrl("cmaps") } : {}),
    ...(resourceUrl("standard_fonts")
      ? { standardFontDataUrl: resourceUrl("standard_fonts") }
      : {}),
    ...(resourceUrl("wasm") ? { wasmUrl: resourceUrl("wasm") } : {}),
  });
  const document = await loading.promise;
  try {
    const start = Math.min(input.pageStart ?? 1, document.numPages);
    const requestedEnd =
      input.pageEnd ?? Math.min(document.numPages, start + 4);
    if (requestedEnd < start)
      return failure("invalid_input", "pageEnd must not be before pageStart.");
    const end = Math.min(
      requestedEnd,
      document.numPages,
      start + MAX_PAGES_PER_READ - 1,
    );
    const pages: { page: number; text: string; textless: boolean }[] = [];
    let outputBytes = 0;
    let truncated = requestedEnd > end;
    for (let pageNumber = start; pageNumber <= end; pageNumber++) {
      if (context.signal.aborted) return cancelled();
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      const available = Math.max(
        0,
        context.limits.maxOutputBytes - outputBytes,
      );
      const bounded = Buffer.from(text).subarray(0, available).toString("utf8");
      pages.push({
        page: pageNumber,
        text: bounded,
        textless: text.length === 0,
      });
      outputBytes += Buffer.byteLength(bounded);
      if (bounded.length < text.length) {
        truncated = true;
        break;
      }
    }
    const last = pages.at(-1)?.page ?? start;
    return {
      ok: true,
      output: {
        kind: "pdf",
        source,
        pageStart: start,
        pageEnd: last,
        totalPages: document.numPages,
        pages,
        ...(pages.some((page) => page.textless)
          ? {
              note: "One or more pages have no extractable text. OCR was not performed.",
            }
          : {}),
      },
      truncated: truncated || last < document.numPages,
    };
  } finally {
    document.cleanup();
    await loading.destroy();
  }
}

async function readTable(
  path: string,
  source: string,
  extension: string,
  input: ReadDocumentInput,
  context: ToolContext,
): Promise<ToolResult<ReadDocumentOutput>> {
  const raw = await readBytes(path);
  if (context.signal.aborted) return cancelled();
  const delimiter = extension === "tsv" ? "\t" : ",";
  const parsed = Papa.parse<string[]>(raw.toString("utf8"), {
    delimiter,
    dynamicTyping: false,
    skipEmptyLines: false,
  });
  const totalRows = parsed.data.length;
  const start = Math.min(input.rowStart ?? 1, Math.max(totalRows, 1));
  const requestedEnd = input.rowEnd ?? Math.min(totalRows, start + 49);
  if (requestedEnd < start)
    return failure("invalid_input", "rowEnd must not be before rowStart.");
  const end = Math.min(requestedEnd, totalRows, start + MAX_ROWS_PER_READ - 1);
  const rows = parsed.data.slice(start - 1, end).map((row) => row.map(String));
  const calculation = input.calculation
    ? calculateColumn(
        parsed.data,
        input.calculation.column,
        input.calculation.operation,
      )
    : undefined;
  return {
    ok: true,
    output: {
      kind: "table",
      source,
      delimiter,
      rowStart: start,
      rowEnd: end,
      totalRows,
      rows,
      errors: parsed.errors.map((error) => ({
        row: (error.row ?? 0) + 1,
        code: error.code,
        message: error.message,
      })),
      analysisScope: "full-file",
      ...(calculation ? { calculation } : {}),
    },
    truncated: requestedEnd > end || end < totalRows,
  };
}

function calculateColumn(
  rows: readonly string[][],
  column: number,
  operation: "sum" | "average" | "minimum" | "maximum",
) {
  const values: number[] = [];
  const invalidRows: number[] = [];
  for (const [index, row] of rows.entries()) {
    const raw = row[column]?.trim() ?? "";
    const value = raw === "" ? Number.NaN : Number(raw);
    if (Number.isFinite(value)) values.push(value);
    else invalidRows.push(index + 1);
  }
  const value =
    values.length === 0
      ? null
      : operation === "sum"
        ? values.reduce((sum, item) => sum + item, 0)
        : operation === "average"
          ? values.reduce((sum, item) => sum + item, 0) / values.length
          : operation === "minimum"
            ? Math.min(...values)
            : Math.max(...values);
  return {
    column,
    operation,
    value,
    rowsConsidered: values.length,
    invalidRows,
  };
}

function imageDimensions(
  bytes: Buffer,
  extension: string,
): { width: number | null; height: number | null } {
  if (extension === "png" && bytes.length >= 24) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (extension === "jpg" || extension === "jpeg") {
    for (let offset = 2; offset + 8 < bytes.length; ) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1] ?? 0;
      const length = bytes.readUInt16BE(offset + 2);
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker)
      )
        return {
          width: bytes.readUInt16BE(offset + 7),
          height: bytes.readUInt16BE(offset + 5),
        };
      if (length < 2) break;
      offset += length + 2;
    }
  }
  return { width: null, height: null };
}
