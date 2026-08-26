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
