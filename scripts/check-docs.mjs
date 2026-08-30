import { access, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const ignoredDirectories = new Set([
  ".git",
  ".pnpm-store",
  "artifacts",
  "dist",
  "node_modules",
]);

const markdownFiles = await collectMarkdown(repositoryRoot);
const headingCache = new Map();
const failures = [];
let localLinkCount = 0;

await validateDocumentationCatalog();

for (const sourcePath of markdownFiles) {
  const source = await readFile(sourcePath, "utf8");
  const searchable = stripFencedCode(source);
  for (const reference of extractReferences(searchable)) {
    const target = normalizeReference(reference);
    if (target === undefined) continue;
    localLinkCount += 1;
    await validateLocalReference(sourcePath, target);
  }
}

async function validateDocumentationCatalog() {
  const docsRoot = path.join(repositoryRoot, "docs");
  const catalogPath = path.join(docsRoot, "catalog.json");
  let catalog;
  try {
    catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  } catch (error) {
    failures.push(
      `docs/catalog.json: could not read the documentation catalog: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }
  if (catalog.schemaVersion !== 1) {
    failures.push("docs/catalog.json: unsupported schemaVersion.");
    return;
  }
  const classified = new Map();
  const historicalPaths = [];
  const redirectPaths = [];
  const add = (relativePath, role) => {
    const normalized = relativePath.replaceAll(path.sep, "/");
    const previous = classified.get(normalized);
    if (previous) {
      failures.push(
        `docs/catalog.json: ${normalized} is classified as both ${previous} and ${role}.`,
      );
      return;
    }
    classified.set(normalized, role);
  };
  for (const [key, role] of [
    ["currentProduct", "current-product"],
    ["currentDevelopment", "current-development"],
  ]) {
    const basenames = catalog[key];
    if (!Array.isArray(basenames)) {
      failures.push(`docs/catalog.json: ${key} must be an array.`);
      continue;
    }
    for (const basename of basenames) {
      if (typeof basename !== "string" || !/^[A-Z0-9_]+$/u.test(basename)) {
        failures.push(
          `docs/catalog.json: invalid ${key} basename ${basename}.`,
        );
        continue;
      }
      add(`${basename}.md`, role);
      add(`zh-CN/${basename}.md`, role);
      if (
        role === "current-product" &&
        /(?:^V\d|PLAN|REVIEW|ROADMAP)/u.test(basename)
      ) {
        failures.push(
          `docs/catalog.json: historical or planning document ${basename} cannot be current-product.`,
        );
      }
    }
  }
  if (!Array.isArray(catalog.history)) {
    failures.push("docs/catalog.json: history must be an array.");
  } else {
    for (const entry of catalog.history) {
      if (
        !entry ||
        typeof entry.path !== "string" ||
        typeof entry.snapshot !== "string" ||
        (!entry.path.includes("/history/") &&
          !entry.path.startsWith("history/"))
      ) {
        failures.push("docs/catalog.json: invalid historical document entry.");
        continue;
      }
      add(entry.path, "historical");
      historicalPaths.push(entry.path);
    }
  }
  if (!Array.isArray(catalog.redirects)) {
    failures.push("docs/catalog.json: redirects must be an array.");
  } else {
    for (const redirect of catalog.redirects) {
      if (typeof redirect !== "string") {
        failures.push("docs/catalog.json: invalid redirect entry.");
        continue;
      }
      add(redirect, "redirect");
      redirectPaths.push(redirect);
    }
  }
  const discovered = (await collectMarkdown(docsRoot)).map((filePath) =>
    path.relative(docsRoot, filePath).split(path.sep).join("/"),
  );
  for (const relativePath of discovered) {
    if (!classified.has(relativePath)) {
      failures.push(
        `docs/catalog.json: ${relativePath} has no documentation role.`,
      );
    }
  }
  for (const [relativePath, role] of classified) {
    if (!discovered.includes(relativePath)) {
      failures.push(
        `docs/catalog.json: ${relativePath} is classified as ${role} but does not exist.`,
      );
    }
  }
  for (const relativePath of historicalPaths) {
    const content = await readFile(
      path.join(docsRoot, relativePath),
      "utf8",
    ).catch(() => "");
    if (
      !/(?:Document role: historical|文档角色：历史)/u.test(
        content.slice(0, 1_500),
      )
    ) {
      failures.push(
        `docs/catalog.json: historical document ${relativePath} is missing a visible role banner.`,
      );
    }
  }
  for (const relativePath of redirectPaths) {
    const content = await readFile(
      path.join(docsRoot, relativePath),
      "utf8",
    ).catch(() => "");
    if (
      Buffer.byteLength(content, "utf8") > 2_048 ||
      !/(?:moved|已移动)/iu.test(content)
    ) {
      failures.push(
        `docs/catalog.json: redirect ${relativePath} must be a short moved-document pointer.`,
      );
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  console.error(
    `Documentation check failed with ${failures.length} broken local reference${failures.length === 1 ? "" : "s"}.`,
  );
  process.exitCode = 1;
} else {
  console.log(
    `Checked ${markdownFiles.length} Markdown files and ${localLinkCount} local references.`,
  );
}

async function collectMarkdown(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".agents") continue;
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectMarkdown(entryPath)));
    else if (entry.isFile() && entry.name.endsWith(".md"))
      files.push(entryPath);
  }
  return files.sort();
}

function stripFencedCode(source) {
  return source.replace(/^\s*(```|~~~)[\s\S]*?^\s*\1\s*$/gmu, "");
}

function extractReferences(source) {
  const references = [];
  for (const match of source.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/gu)) {
    references.push(match[1]);
  }
  for (const match of source.matchAll(/\b(?:href|src|srcset)="([^"]+)"/gu)) {
    references.push(match[1]);
  }
  return references;
}

function normalizeReference(rawReference) {
  let reference = rawReference.trim();
  if (reference.startsWith("<") && reference.endsWith(">")) {
    reference = reference.slice(1, -1);
  }
  const optionalTitle = /^(\S+)(?:\s+["'][^"']*["'])$/u.exec(reference);
  if (optionalTitle) reference = optionalTitle[1];
  if (
    reference === "" ||
    reference.startsWith("//") ||
    /^[a-z][a-z0-9+.-]*:/iu.test(reference)
  ) {
    return undefined;
  }
  return reference;
}

async function validateLocalReference(sourcePath, reference) {
  const hashIndex = reference.indexOf("#");
  const rawFile = hashIndex === -1 ? reference : reference.slice(0, hashIndex);
  const rawFragment = hashIndex === -1 ? "" : reference.slice(hashIndex + 1);
  const queryIndex = rawFile.indexOf("?");
  const filePart = queryIndex === -1 ? rawFile : rawFile.slice(0, queryIndex);
  let decodedFile;
  let decodedFragment;
  try {
    decodedFile = decodeURIComponent(filePart);
    decodedFragment = decodeURIComponent(rawFragment);
  } catch {
    failures.push(
      `${relative(sourcePath)}: invalid URL encoding in ${reference}`,
    );
    return;
  }
  const targetPath =
    decodedFile === ""
      ? sourcePath
      : decodedFile.startsWith("/")
        ? path.join(repositoryRoot, decodedFile.slice(1))
        : path.resolve(path.dirname(sourcePath), decodedFile);
  if (!isInsideRepository(targetPath)) {
    failures.push(
      `${relative(sourcePath)}: local reference escapes the repository: ${reference}`,
    );
    return;
  }
  try {
    await access(targetPath);
  } catch {
    failures.push(`${relative(sourcePath)}: missing target ${reference}`);
    return;
  }
  if (decodedFragment === "") return;
  const targetStat = await stat(targetPath);
  if (!targetStat.isFile() || path.extname(targetPath) !== ".md") return;
  const headings = await headingsFor(targetPath);
  if (!headings.has(decodedFragment)) {
    failures.push(
      `${relative(sourcePath)}: missing heading #${decodedFragment} in ${relative(targetPath)}`,
    );
  }
}

async function headingsFor(markdownPath) {
  const cached = headingCache.get(markdownPath);
  if (cached !== undefined) return cached;
  const source = stripFencedCode(await readFile(markdownPath, "utf8"));
  const headings = new Set();
  const occurrences = new Map();
  for (const match of source.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gmu)) {
    const base = githubHeadingSlug(match[1]);
    const occurrence = occurrences.get(base) ?? 0;
    occurrences.set(base, occurrence + 1);
    headings.add(occurrence === 0 ? base : `${base}-${occurrence}`);
  }
  headingCache.set(markdownPath, headings);
  return headings;
}

function githubHeadingSlug(heading) {
  return heading
    .toLocaleLowerCase()
    .replace(/<[^>]*>/gu, "")
    .replace(/[`*_~]/gu, "")
    .replace(/[^\p{Letter}\p{Number}\p{Mark}\s-]/gu, "")
    .trim()
    .replace(/\s+/gu, "-");
}

function isInsideRepository(targetPath) {
  const relativePath = path.relative(repositoryRoot, targetPath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

function relative(targetPath) {
  return path.relative(repositoryRoot, targetPath) || ".";
}
