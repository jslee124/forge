import { spawnSync } from "node:child_process";
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
const catalogSchemaVersion = 3;
const catalogDocumentPathPattern = /^[A-Za-z0-9_]+(?:\/[A-Za-z0-9_]+)*\.md$/u;
const generatedDocumentationRoot = "packages/resources/docs/";
const generatedDocumentationPrefixes = [
  generatedDocumentationRoot,
  "apps/desktop/out/",
  "apps/desktop/release/",
];
const decisionPathPattern = /^decisions\/\d{4}-[a-z0-9-]+\.md$/u;
const pinnedReferencePattern =
  /https:\/\/github\.com\/jslee124\/forge\/blob\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._%~/-]+)/gu;
const decisionStatuses = new Set([
  "proposed",
  "accepted",
  "superseded",
  "deprecated",
]);

const markdownFiles = await collectMarkdown(repositoryRoot);
const headingCache = new Map();
const failures = [];
let localLinkCount = 0;

await validateDocumentationCatalog();
const markdownGraph = await buildMarkdownGraph();
await validateReachability(markdownGraph);
validateDirectoryIndexes(markdownGraph);
await validatePublishedReportIndex();
await validateCurrentReleasePointer();
await validatePinnedReferences();

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
  if (catalog.schemaVersion !== catalogSchemaVersion) {
    failures.push(
      `docs/catalog.json: unsupported schemaVersion; expected ${catalogSchemaVersion}.`,
    );
    return;
  }
  const classified = new Map();
  const historicalPaths = [];
  const redirectPaths = [];
  const decisionEntries = [];
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
    const documentPaths = catalog[key];
    if (!Array.isArray(documentPaths)) {
      failures.push(`docs/catalog.json: ${key} must be an array.`);
      continue;
    }
    for (const documentPath of documentPaths) {
      if (
        typeof documentPath !== "string" ||
        !catalogDocumentPathPattern.test(documentPath)
      ) {
        failures.push(
          `docs/catalog.json: invalid ${key} path ${documentPath}; expected a docs-relative path such as product/start/GETTING_STARTED.md.`,
        );
        continue;
      }
      add(documentPath, role);
      add(`zh-CN/${documentPath}`, role);
      if (
        role === "current-product" &&
        /(?:^V\d|PLAN|REVIEW|ROADMAP)/u.test(path.basename(documentPath, ".md"))
      ) {
        failures.push(
          `docs/catalog.json: historical or planning document ${documentPath} cannot be current-product.`,
        );
      }
    }
  }
  if (!Array.isArray(catalog.instructions)) {
    failures.push("docs/catalog.json: instructions must be an array.");
  } else {
    for (const entry of catalog.instructions) {
      if (
        typeof entry !== "string" ||
        !/(?:^|\/)AGENTS\.md$/u.test(entry) ||
        !catalogDocumentPathPattern.test(entry)
      ) {
        failures.push(
          "docs/catalog.json: invalid instruction entry; expected a docs-relative AGENTS.md path.",
        );
        continue;
      }
      add(entry, "instruction");
    }
  }
  if (!Array.isArray(catalog.decisions)) {
    failures.push("docs/catalog.json: decisions must be an array.");
  } else {
    for (const entry of catalog.decisions) {
      if (
        !entry ||
        typeof entry.path !== "string" ||
        typeof entry.status !== "string" ||
        !decisionPathPattern.test(entry.path) ||
        !decisionStatuses.has(entry.status)
      ) {
        failures.push(
          "docs/catalog.json: invalid decision record; expected decisions/<NNNN>-<slug>.md with a proposed, accepted, superseded, or deprecated status.",
        );
        continue;
      }
      add(entry.path, "decision");
      decisionEntries.push(entry);
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
  for (const entry of decisionEntries) {
    const content = await readFile(
      path.join(docsRoot, entry.path),
      "utf8",
    ).catch(() => "");
    const statusIndex = content.search(/^##\s+Status\s*$/mu);
    if (statusIndex === -1) {
      failures.push(
        `docs/catalog.json: decision record ${entry.path} is missing a "## Status" section.`,
      );
      continue;
    }
    const declared = content
      .slice(statusIndex)
      .split("\n")
      .slice(1)
      .find((line) => line.trim() !== "");
    if (
      declared === undefined ||
      !declared.toLocaleLowerCase().includes(entry.status)
    ) {
      failures.push(
        `docs/catalog.json: decision record ${entry.path} does not declare its catalog status "${entry.status}" under "## Status".`,
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

async function buildMarkdownGraph() {
  const markdownPaths = new Set(markdownFiles);
  const graph = new Map();
  for (const sourcePath of markdownFiles) {
    const source = stripFencedCode(await readFile(sourcePath, "utf8"));
    const targets = [];
    for (const reference of extractReferences(source)) {
      const targetPath = resolveLocalPath(sourcePath, reference);
      if (targetPath === undefined || targetPath === sourcePath) continue;
      if (markdownPaths.has(targetPath)) targets.push(targetPath);
    }
    graph.set(sourcePath, targets);
  }
  return graph;
}

async function validateReachability(graph) {
  const reachable = new Set(markdownFiles.filter(isDocumentationEntry));
  const queue = [...reachable];
  while (queue.length > 0) {
    for (const targetPath of graph.get(queue.pop()) ?? []) {
      if (reachable.has(targetPath)) continue;
      reachable.add(targetPath);
      queue.push(targetPath);
    }
  }
  for (const sourcePath of markdownFiles) {
    if (reachable.has(sourcePath)) continue;
    const relativePath = relative(sourcePath).split(path.sep).join("/");
    if (
      generatedDocumentationPrefixes.some((prefix) =>
        relativePath.startsWith(prefix),
      )
    )
      continue;
    failures.push(
      `${relativePath}: is not reachable from any documentation entry point; link it from an index page, README, AGENTS.md, or skill.`,
    );
  }
}

function validateDirectoryIndexes(graph) {
  const appsRoot = path.join(repositoryRoot, "apps");
  const markdownPaths = new Set(markdownFiles);
  for (const sourcePath of markdownFiles) {
    const relativePath = relative(sourcePath).split(path.sep).join("/");
    if (!relativePath.startsWith("apps/")) continue;
    if (isDocumentationEntry(sourcePath)) continue;
    if (
      generatedDocumentationPrefixes.some((prefix) =>
        relativePath.startsWith(prefix),
      )
    )
      continue;
    const indexPaths = [];
    for (
      let directory = path.dirname(sourcePath);
      directory.startsWith(appsRoot);
      directory = path.dirname(directory)
    ) {
      for (const name of ["AGENTS.md", "README.md"]) {
        const candidate = path.join(directory, name);
        if (markdownPaths.has(candidate)) indexPaths.push(candidate);
      }
      if (directory === appsRoot) break;
    }
    const listed = indexPaths.some((indexPath) =>
      (graph.get(indexPath) ?? []).includes(sourcePath),
    );
    if (listed) continue;
    const expected =
      indexPaths.length > 0
        ? relative(indexPaths[0]).split(path.sep).join("/")
        : "a directory AGENTS.md or README.md";
    failures.push(
      `${relativePath}: is not listed in ${expected}; add it to that directory index.`,
    );
  }
}

function isDocumentationEntry(filePath) {
  const relativePath = relative(filePath).split(path.sep).join("/");
  if (/(?:^|\/)README(?:\.[A-Za-z-]+)?\.md$/u.test(relativePath)) return true;
  if (/(?:^|\/)AGENTS\.md$/u.test(relativePath)) return true;
  if (/(?:^|\/)SKILL\.md$/u.test(relativePath)) return true;
  if (/\/references\/[^/]+\.md$/u.test(relativePath)) return true;
  if (/^\.github\/(?:releases|release-notes)\/[^/]+\.md$/u.test(relativePath))
    return true;
  return false;
}

async function validatePublishedReportIndex() {
  const reportsRoot = path.join(repositoryRoot, "evals", "reports");
  const indexPath = path.join(reportsRoot, "README.md");
  const indexSource = await readFile(indexPath, "utf8").catch(() => undefined);
  if (indexSource === undefined) {
    failures.push(
      "evals/reports/README.md: published report index is missing.",
    );
    return;
  }
  const references = extractReferences(stripFencedCode(indexSource))
    .map((reference) => resolveLocalPath(indexPath, reference))
    .filter((targetPath) => targetPath !== undefined);
  for (const entry of await readdir(reportsRoot, { withFileTypes: true })) {
    if (entry.name === "README.md") continue;
    const isReport = entry.isDirectory()
      ? true
      : entry.isFile() && entry.name.endsWith(".md");
    if (!isReport) continue;
    const entryPath = path.join(reportsRoot, entry.name);
    const listed = references.some(
      (targetPath) =>
        targetPath === entryPath ||
        targetPath.startsWith(`${entryPath}${path.sep}`),
    );
    if (!listed) {
      failures.push(
        `evals/reports/README.md: ${entry.name} is not listed in the published report index.`,
      );
    }
  }
}

async function validateCurrentReleasePointer() {
  const version = JSON.parse(
    await readFile(path.join(repositoryRoot, "package.json"), "utf8"),
  ).version;
  const evidenceRoot = path.join(
    repositoryRoot,
    "evals",
    "reports",
    `v${version}`,
  );
  const evidenceStat = await stat(evidenceRoot).catch(() => undefined);
  if (evidenceStat === undefined || !evidenceStat.isDirectory()) return;
  for (const documentationIndex of ["docs/README.md", "docs/zh-CN/README.md"]) {
    const indexPath = path.join(repositoryRoot, documentationIndex);
    const indexSource = await readFile(indexPath, "utf8").catch(
      () => undefined,
    );
    if (indexSource === undefined) continue;
    const linked = extractReferences(stripFencedCode(indexSource))
      .map((reference) => resolveLocalPath(indexPath, reference))
      .some(
        (targetPath) =>
          targetPath === evidenceRoot ||
          (targetPath?.startsWith(`${evidenceRoot}${path.sep}`) ?? false),
      );
    if (!linked) {
      failures.push(
        `${documentationIndex}: evals/reports/v${version}/ exists but the documentation index does not link the current release evidence.`,
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

async function validatePinnedReferences() {
  const scanPaths = [
    ...markdownFiles,
    ...(await collectMarkdown(path.join(repositoryRoot, ".github"))),
  ];
  const broken = new Map();
  for (const sourcePath of scanPaths) {
    const source = await readFile(sourcePath, "utf8");
    for (const match of source.matchAll(pinnedReferencePattern)) {
      let targetPath;
      try {
        targetPath = decodeURIComponent(match[2]).replace(/[.,;:]+$/u, "");
      } catch {
        continue;
      }
      const absolutePath = path.join(repositoryRoot, targetPath);
      if (!isInsideRepository(absolutePath)) continue;
      const state = await pinnedTargetState(match[1], targetPath, absolutePath);
      if (state !== false) continue;
      const key = `${match[1]}/${targetPath}`;
      if (!broken.has(key)) broken.set(key, new Set());
      broken.get(key).add(relative(sourcePath).split(path.sep).join("/"));
    }
  }
  for (const [key, sources] of broken) {
    failures.push(
      `${[...sources].sort().join(", ")}: pinned reference https://github.com/jslee124/forge/blob/${key} does not resolve. A branch target must exist in this worktree; a tag or commit target must contain the path. Published release notes and shipped builds keep that URL, so restore the path, leave a redirect, or correct the link.`,
    );
  }
}

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

// A branch reference must resolve in the worktree, because the worktree is the
// proposed state of the branch being changed. A tag or commit reference is
// immutable, so it is validated against that git object instead — never against
// the worktree, which would mask a path that only exists on the branch.
// Returns undefined when the ref cannot be resolved locally, which skips the
// check rather than reporting a false failure in a shallow clone.
async function pinnedTargetState(ref, targetPath, absolutePath) {
  const kind = refKind(ref);
  if (kind === undefined || kind === "unknown") {
    return (await pathExists(absolutePath)) ? true : undefined;
  }
  if (kind === "branch") return pathExists(absolutePath);
  const entry = gitResult(["cat-file", "-e", `${ref}:${targetPath}`]);
  if (entry === undefined) return undefined;
  return entry.ok;
}

function refKind(ref) {
  for (const [candidates, kind] of [
    [["refs/heads/", "refs/remotes/origin/"], "branch"],
    [["refs/tags/"], "tag"],
  ]) {
    for (const prefix of candidates) {
      const result = gitResult([
        "rev-parse",
        "--verify",
        "--quiet",
        `${prefix}${ref}`,
      ]);
      if (result === undefined) return undefined;
      if (result.ok) return kind;
    }
  }
  const commit = gitResult([
    "rev-parse",
    "--verify",
    "--quiet",
    `${ref}^{commit}`,
  ]);
  if (commit === undefined) return undefined;
  return commit.ok ? "commit" : "unknown";
}

function gitResult(args) {
  const result = spawnSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  if (result.error !== undefined && result.error !== null) return undefined;
  return { ok: result.status === 0, stdout: result.stdout ?? "" };
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

function resolveLocalPath(sourcePath, rawReference) {
  const reference = normalizeReference(rawReference);
  if (reference === undefined) return undefined;
  const hashIndex = reference.indexOf("#");
  const rawFile = hashIndex === -1 ? reference : reference.slice(0, hashIndex);
  const queryIndex = rawFile.indexOf("?");
  const filePart = queryIndex === -1 ? rawFile : rawFile.slice(0, queryIndex);
  if (filePart === "") return undefined;
  let decodedFile;
  try {
    decodedFile = decodeURIComponent(filePart);
  } catch {
    return undefined;
  }
  const targetPath = decodedFile.startsWith("/")
    ? path.join(repositoryRoot, decodedFile.slice(1))
    : path.resolve(path.dirname(sourcePath), decodedFile);
  return isInsideRepository(targetPath) ? targetPath : undefined;
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
