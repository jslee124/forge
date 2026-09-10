import type { ReadDocumentInput, ReadDocumentOutput } from "@forge/tools";
import { z } from "zod";

export const FILE_IMPORT_CHANNEL = "forge-desktop:file-import";
export const FILE_PREVIEW_CHANNEL = "forge-desktop:file-preview";
export const FILE_SAVE_AS_CHANNEL = "forge-desktop:file-save-as";
export const FILE_OPEN_CHANNEL = "forge-desktop:file-open";
export const FILE_REVEAL_CHANNEL = "forge-desktop:file-reveal";
export const CHANGE_REVIEW_CHANNEL = "forge-desktop:change-review";

export const relativeFilePathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine(
    (value) => !value.includes("\0") && !value.startsWith("/"),
    "Expected a workspace-relative path",
  );

export const previewRequestSchema = z
  .object({
    path: relativeFilePathSchema,
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
export type PreviewRequest = z.infer<typeof previewRequestSchema>;

export interface FilePreview {
  readonly document: ReadDocumentOutput;
  readonly truncated: boolean;
  readonly dataUrl?: string;
}

export interface ImportedFile {
  readonly path: string;
  readonly renamed: boolean;
  readonly overwritten: boolean;
}

export interface SavedFile {
  readonly source: string;
  readonly destination: string;
  readonly overwritten: boolean;
}

export interface ChangeEntry {
  readonly path: string;
  readonly status: "added" | "modified" | "deleted";
  readonly patch: string | null;
}

export interface ChangeReview {
  readonly baseline:
    | "task-start"
    | "resume-time"
    | "workspace-selection"
    | "unavailable";
  readonly attribution: "changed-since-baseline";
  readonly entries: readonly ChangeEntry[];
  readonly truncated: boolean;
  readonly limitations: readonly (
    | "no-baseline"
    | "no-agent-attribution"
    | "concurrent-edits-indistinguishable"
    | "bounded-snapshot"
  )[];
  readonly engineCoverage: Readonly<{
    native: "approval-plus-baseline";
    codex: "baseline-only";
  }>;
}

export interface FileApi {
  importFile(): Promise<ImportedFile | null>;
  previewFile(request: PreviewRequest): Promise<FilePreview>;
  saveFileAs(path: string): Promise<SavedFile | null>;
  openFile(path: string): Promise<void>;
  revealFile(path: string): Promise<void>;
  reviewChanges(): Promise<ChangeReview>;
}

const documentSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text"),
    source: z.string(),
    text: z.string(),
    bytes: z.number(),
  }),
  z.object({
    kind: z.literal("image"),
    source: z.string(),
    mimeType: z.enum(["image/png", "image/jpeg"]),
    bytes: z.number(),
    width: z.number().nullable(),
    height: z.number().nullable(),
    note: z.string(),
  }),
  z.object({
    kind: z.literal("pdf"),
    source: z.string(),
    pageStart: z.number(),
    pageEnd: z.number(),
    totalPages: z.number(),
    pages: z.array(
      z.object({ page: z.number(), text: z.string(), textless: z.boolean() }),
    ),
    note: z.string().optional(),
  }),
  z.object({
    kind: z.literal("table"),
    source: z.string(),
    delimiter: z.enum([",", "\t"]),
    rowStart: z.number(),
    rowEnd: z.number(),
    totalRows: z.number(),
    rows: z.array(z.array(z.string())),
    errors: z.array(
      z.object({ row: z.number(), code: z.string(), message: z.string() }),
    ),
    analysisScope: z.literal("full-file"),
    calculation: z
      .object({
        column: z.number(),
        operation: z.enum(["sum", "average", "minimum", "maximum"]),
        value: z.number().nullable(),
        rowsConsidered: z.number(),
        invalidRows: z.array(z.number()),
      })
      .optional(),
  }),
]);
export const filePreviewSchema = z.object({
  document: documentSchema,
  truncated: z.boolean(),
  dataUrl: z
    .string()
    .max(48 * 1024 * 1024)
    .optional(),
});
export const importedFileSchema = z.object({
  path: z.string(),
  renamed: z.boolean(),
  overwritten: z.boolean(),
});
export const savedFileSchema = z.object({
  source: z.string(),
  destination: z.string(),
  overwritten: z.boolean(),
});
export const changeReviewSchema = z.object({
  baseline: z.enum([
    "task-start",
    "resume-time",
    "workspace-selection",
    "unavailable",
  ]),
  attribution: z.literal("changed-since-baseline"),
  entries: z.array(
    z.object({
      path: z.string(),
      status: z.enum(["added", "modified", "deleted"]),
      patch: z.string().nullable(),
    }),
  ),
  truncated: z.boolean(),
  limitations: z.array(
    z.enum([
      "no-baseline",
      "no-agent-attribution",
      "concurrent-edits-indistinguishable",
      "bounded-snapshot",
    ]),
  ),
  engineCoverage: z.object({
    native: z.literal("approval-plus-baseline"),
    codex: z.literal("baseline-only"),
  }),
});

export function asReadDocumentInput(
  request: PreviewRequest,
): ReadDocumentInput {
  return request;
}
