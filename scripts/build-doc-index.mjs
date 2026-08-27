import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = path.join(root, "packages", "resources", "docs");
const version = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
).version;
const check = process.argv.includes("--check");
const documents = [
  "GETTING_STARTED",
  "CONFIGURATION",
  "AUTHENTICATION",
  "PLUGINS",
  "PROJECT_CONTEXT",
  "SESSIONS",
  "CONTEXT_MANAGEMENT",
  "SECURITY",
  "RELEASING",
  "TROUBLESHOOTING",
  "CLI_UI",
  "ARCHITECTURE",
  "PRODUCT",
];
const entries = [];

for (const locale of ["en", "zh-CN"]) {
  for (const name of documents) {
    const source = path.join(
      root,
      "docs",
      locale === "en" ? "" : "zh-CN",
      `${name}.md`,
    );
    const content = sanitizePackagedMarkdown(await readFile(source, "utf8"));
    const relativePath = `${locale}/${name}.md`;
    const target = path.join(packageRoot, relativePath);
    const headings = parseHeadings(content);
    if (headings.length === 0) throw new Error(`${source} has no headings.`);
    entries.push({
      id: name.toLocaleLowerCase().replaceAll("_", "-"),
      locale,
      title: headings[0].title,
      headings,
      keywords: keywords(
        `${name} ${headings.map(({ title }) => title).join(" ")}`,
      ),
      path: relativePath,
      sha256: createHash("sha256").update(content).digest("hex"),
    });
    if (check) {
      const packaged = await readFile(target, "utf8").catch(() => undefined);
      if (packaged !== content)
        throw new Error(
          `${relativePath} is stale. Run node scripts/build-doc-index.mjs.`,
        );
    } else {
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content);
    }
  }
}

const index = `${JSON.stringify({ schemaVersion: 1, forgeVersion: version, documents: entries }, null, 2)}\n`;
const indexPath = path.join(packageRoot, "index.json");
if (check) {
  const current = await readFile(indexPath, "utf8").catch(() => undefined);
  if (current !== index)
    throw new Error("Packaged product documentation index is stale.");
} else {
  await mkdir(packageRoot, { recursive: true });
  await writeFile(indexPath, index);
}

function parseHeadings(content) {
  const matches = [...content.matchAll(/^(#{1,6})\s+(.+)$/gmu)];
  const used = new Map();
  return matches.map((match, index) => {
    const title = match[2].trim();
    const base = slug(title) || `section-${index + 1}`;
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    const id = count === 0 ? base : `${base}-${count + 1}`;
    const start = match.index ?? 0;
    const end = matches[index + 1]?.index ?? content.length;
    return {
      id,
      title,
      level: match[1].length,
      start,
      end,
      keywords: keywords(
        `${title} ${content.slice(start, Math.min(end, start + 1200))}`,
      ),
    };
  });
}

function slug(value) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 80);
}

function keywords(value) {
  const latin =
    value.toLocaleLowerCase().match(/[a-z0-9][a-z0-9-]{1,}/gu) ?? [];
  const cjk = value.match(/[\p{Script=Han}]{2,}/gu) ?? [];
  return [...new Set([...latin, ...cjk])].sort().slice(0, 80);
}

function sanitizePackagedMarkdown(content) {
  return content.replace(
    /!?\[([^\]]*)\]\(([^)]+)\)/gu,
    (whole, label, rawReference) => {
      const reference = rawReference.trim().replace(/^<|>$/gu, "");
      if (
        reference.startsWith("#") ||
        reference.startsWith("//") ||
        /^[a-z][a-z0-9+.-]*:/iu.test(reference)
      ) {
        return whole;
      }
      return label;
    },
  );
}
