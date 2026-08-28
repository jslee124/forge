import { createHash } from "node:crypto";
import { constants, existsSync } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FORGE_VERSION, type ForgeTool, type ToolResult } from "@forge/core";
import { z } from "zod";

export const MAX_DOC_SEARCH_RESULTS = 8;
export const MAX_DOC_SECTION_BYTES = 24_576;

const headingSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  level: z.number().int().min(1).max(6),
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  keywords: z.array(z.string()),
});
const documentSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/u),
  locale: z.enum(["en", "zh-CN"]),
  title: z.string().min(1),
  headings: z.array(headingSchema).min(1),
  keywords: z.array(z.string()),
  path: z.string().regex(/^(?:en|zh-CN)\/[A-Z0-9_]+\.md$/u),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
});
const indexSchema = z.object({
  schemaVersion: z.literal(1),
  forgeVersion: z.string(),
  documents: z.array(documentSchema),
});
type ProductDocument = z.infer<typeof documentSchema>;

export interface ForgeDocSearchResult {
  readonly reference: string;
  readonly forgeVersion: string;
  readonly locale: "en" | "zh-CN";
  readonly fallbackFrom?: "zh-CN";
  readonly document: string;
  readonly section: string;
  readonly excerpt: string;
  readonly score: number;
}

export function resolveBuiltinDocsRoot(moduleUrl: string): string {
  const directory = path.dirname(fileURLToPath(moduleUrl));
  const workspaceCandidate = path.resolve(directory, "..", "docs");
  if (existsSync(path.join(workspaceCandidate, "index.json")))
    return workspaceCandidate;
  const packageCandidate = path.resolve(directory, "..", "resources", "docs");
  if (existsSync(path.join(packageCandidate, "index.json")))
    return packageCandidate;
  return path.resolve(directory, "..", "..", "resources", "docs");
}

interface LocaleEnvironment extends NodeJS.ProcessEnv {
  readonly LC_ALL?: string;
  readonly LC_MESSAGES?: string;
  readonly LANG?: string;
}

export function preferredForgeDocsLocale(
  env: LocaleEnvironment,
): "en" | "zh-CN" {
  const locale = env.LC_ALL || env.LC_MESSAGES || env.LANG || "";
  return /^zh(?:[_-]|$)/iu.test(locale) ? "zh-CN" : "en";
}

export async function createForgeDocsTools(options: {
  readonly locale: "en" | "zh-CN";
  readonly docsRoot?: string;
}): Promise<readonly [ForgeTool, ForgeTool]> {
  const root = await realpath(
    options.docsRoot ?? resolveBuiltinDocsRoot(import.meta.url),
  );
  const indexPath = path.join(root, "index.json");
  const index = indexSchema.parse(
    JSON.parse(await readRegularFile(indexPath, root)),
  );
  if (index.forgeVersion !== FORGE_VERSION) {
    throw new Error(
      `Product documentation index ${index.forgeVersion} does not match Forge ${FORGE_VERSION}.`,
    );
  }
  const documents = new Map<string, ProductDocument>();
  for (const document of index.documents) {
    const key = `${document.locale}:${document.id}`;
    if (documents.has(key))
      throw new Error(`Duplicate product document ${key}.`);
    documents.set(key, document);
  }
  const contentCache = new Map<string, string>();
  const content = async (document: ProductDocument): Promise<string> => {
    const cached = contentCache.get(document.path);
    if (cached !== undefined) return cached;
    const value = await readRegularFile(path.join(root, document.path), root);
    const hash = createHash("sha256").update(value).digest("hex");
    if (hash !== document.sha256)
      throw new Error(
        `Product document ${document.id} failed its content hash check.`,
      );
    contentCache.set(document.path, value);
    return value;
  };

  const search: ForgeTool = {
    name: "search_forge_docs",
    description:
      "Search the version-matched, allowlisted Forge product documentation. Returns stable document and section references, never filesystem paths.",
    inputSchema: z
      .object({
        query: z.string().trim().min(2).max(500),
        limit: z.number().int().min(1).max(MAX_DOC_SEARCH_RESULTS).optional(),
      })
      .strict(),
    risk: "read",
    execute: async (input): Promise<ToolResult> => {
      const request = input as {
        readonly query: string;
        readonly limit?: number;
      };
      let results = await rankedSearch(
        request.query,
        options.locale,
        index.documents,
        content,
      );
      let fallback = false;
      if (results.length === 0 && options.locale === "zh-CN") {
        results = await rankedSearch(
          request.query,
          "en",
          index.documents,
          content,
        );
        fallback = results.length > 0;
      }
      return {
        ok: true,
        truncated: false,
        output: {
          query: request.query,
          forgeVersion: FORGE_VERSION,
          preferredLocale: options.locale,
          ...(fallback ? { fallback: "zh-CN -> en" } : {}),
          results: results.slice(0, request.limit ?? 5).map((result) => ({
            ...result,
            ...(fallback ? { fallbackFrom: "zh-CN" as const } : {}),
          })),
          unknown: results.length === 0,
        },
      };
    },
  };

  const read: ForgeTool = {
    name: "read_forge_doc",
    description:
      "Read one allowlisted Forge product-document section using a stable reference returned by search_forge_docs. Arbitrary paths are rejected.",
    inputSchema: z.object({ reference: z.string().min(1).max(300) }).strict(),
    risk: "read",
    execute: async (input, context): Promise<ToolResult> => {
      const reference = (input as { readonly reference: string }).reference;
      const parsed = parseReference(reference);
      if (!parsed || parsed.version !== FORGE_VERSION)
        return failure(
          "not_found",
          "Unknown or version-mismatched Forge documentation reference.",
        );
      const document = documents.get(`${parsed.locale}:${parsed.documentId}`);
      const section = document?.headings.find(
        ({ id }) => id === parsed.sectionId,
      );
      if (!document || !section)
        return failure("not_found", "Unknown Forge documentation reference.");
      const source = await content(document);
      const maximum = Math.min(
        MAX_DOC_SECTION_BYTES,
        context.limits.maxOutputBytes - 800,
      );
      if (maximum <= 0)
        return failure(
          "output_limit",
          "Tool output budget is too small for product documentation metadata.",
        );
      const raw = source.slice(section.start, section.end).trim();
      const body = Buffer.from(raw).subarray(0, maximum).toString("utf8");
      return {
        ok: true,
        truncated: Buffer.byteLength(raw) > Buffer.byteLength(body),
        output: {
          reference,
          forgeVersion: FORGE_VERSION,
          locale: document.locale,
          document: document.title,
          section: section.title,
          content: body,
          truncated: Buffer.byteLength(raw) > Buffer.byteLength(body),
        },
      };
    },
  };
  return [search, read];
}

async function rankedSearch(
  query: string,
  locale: "en" | "zh-CN",
  documents: readonly ProductDocument[],
  load: (document: ProductDocument) => Promise<string>,
): Promise<ForgeDocSearchResult[]> {
  const queryTerms = terms(query);
  const results: ForgeDocSearchResult[] = [];
  for (const document of documents.filter(
    (candidate) => candidate.locale === locale,
  )) {
    const source = await load(document);
    for (const heading of document.headings) {
      const haystack = new Set(
        terms(
          `${document.id} ${document.title} ${document.keywords.join(" ")} ${heading.title} ${heading.keywords.join(" ")}`,
        ),
      );
      const score = queryTerms.reduce(
        (total, term) =>
          total + (haystack.has(term) ? (term.length >= 5 ? 2 : 1) : 0),
        0,
      );
      if (score === 0) continue;
      results.push({
        reference: reference(document, heading.id),
        forgeVersion: FORGE_VERSION,
        locale,
        document: document.title,
        section: heading.title,
        excerpt: source
          .slice(heading.start, Math.min(heading.end, heading.start + 280))
          .replace(/\s+/gu, " ")
          .trim(),
        score,
      });
    }
  }
  return results.sort(
    (left, right) =>
      right.score - left.score || left.reference.localeCompare(right.reference),
  );
}

function terms(value: string): string[] {
  const normalized = value.normalize("NFKC").toLocaleLowerCase();
  const words = normalized.match(/[a-z0-9][a-z0-9-]{1,}/gu) ?? [];
  const han = normalized.match(/[\p{Script=Han}]+/gu) ?? [];
  const bigrams = han.flatMap((chunk) =>
    [...chunk]
      .slice(0, -1)
      .map((character, index) => `${character}${[...chunk][index + 1]}`),
  );
  return [...new Set([...words, ...han, ...bigrams])];
}

function reference(document: ProductDocument, sectionId: string): string {
  return `forge-doc:${FORGE_VERSION}:${document.locale}:${document.id}#${sectionId}`;
}

function parseReference(value: string):
  | {
      version: string;
      locale: "en" | "zh-CN";
      documentId: string;
      sectionId: string;
    }
  | undefined {
  const match =
    /^forge-doc:([^:]+):(en|zh-CN):([a-z0-9-]+)#([\p{L}\p{N}-]+)$/u.exec(value);
  return match
    ? {
        version: match[1] as string,
        locale: match[2] as "en" | "zh-CN",
        documentId: match[3] as string,
        sectionId: match[4] as string,
      }
    : undefined;
}

async function readRegularFile(
  filePath: string,
  root: string,
): Promise<string> {
  const link = await lstat(filePath);
  if (!link.isFile() || link.isSymbolicLink())
    throw new Error(
      "Product documentation must be regular, non-symlink files.",
    );
  const canonical = await realpath(filePath);
  if (!isInside(root, canonical))
    throw new Error("Product documentation escaped its allowlisted root.");
  const handle = await open(
    canonical,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function failure(
  code: "not_found" | "output_limit",
  message: string,
): Extract<ToolResult, { readonly ok: false }> {
  return { ok: false, error: { code, message, retryable: false } };
}
