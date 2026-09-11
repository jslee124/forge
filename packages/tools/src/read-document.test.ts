import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ToolContext } from "@forge/core";
import { afterEach, describe, expect, it } from "vitest";

import { formatTable, readDocument, resolveWorkspace } from "./index.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture(): Promise<{ root: string; context: ToolContext }> {
  const root = await mkdtemp(join(tmpdir(), "forge-document-"));
  roots.push(root);
  await mkdir(join(root, "docs"));
  return {
    root,
    context: {
      workspace: await resolveWorkspace(root),
      signal: new AbortController().signal,
      limits: { maxOutputBytes: 65_536, maxEntries: 500 },
    },
  };
}

describe("read_document", () => {
  it("preserves quoted, multiline and leading-zero CSV values while exposing errors", async () => {
    const { root, context } = await fixture();
    await writeFile(
      join(root, "docs", "records.csv"),
      'id,note,amount\n00123,"two\nlines",10\n00456,ok,20\n00999,"unterminated,30',
    );
    const result = await readDocument(
      {
        path: "docs/records.csv",
        rowStart: 1,
        rowEnd: 2,
        calculation: { column: 2, operation: "sum" },
      },
      context,
    );
    expect(result).toMatchObject({
      ok: true,
      output: {
        kind: "table",
        source: "docs/records.csv",
        rowStart: 1,
        rowEnd: 2,
        rows: [
          ["id", "note", "amount"],
          ["00123", "two\nlines", "10"],
        ],
        analysisScope: "full-file",
        calculation: { value: 30, rowsConsidered: 2, invalidRows: [1, 4] },
        errors: [expect.objectContaining({ row: 4 })],
      },
      truncated: true,
    });
  });

  it("parses TSV independently and labels the preview range", async () => {
    const { root, context } = await fixture();
    await writeFile(
      join(root, "table.tsv"),
      "code\tvalue\n0007\t42\n0008\t43\n",
    );
    const result = await readDocument(
      { path: "table.tsv", rowStart: 2, rowEnd: 2 },
      context,
    );
    expect(result).toMatchObject({
      ok: true,
      output: {
        kind: "table",
        delimiter: "\t",
        rowStart: 2,
        rowEnd: 2,
        totalRows: 4,
        rows: [["0007", "42"]],
      },
      truncated: true,
    });
  });

  it("does not report EOF clamping as truncation, but marks omitted earlier rows", async () => {
    const { root, context } = await fixture();
    await writeFile(join(root, "short.csv"), "id,value\n001,10");
    await expect(
      readDocument({ path: "short.csv", rowEnd: 100 }, context),
    ).resolves.toMatchObject({ ok: true, truncated: false });
    await expect(
      readDocument({ path: "short.csv", rowStart: 2, rowEnd: 100 }, context),
    ).resolves.toMatchObject({ ok: true, truncated: true });
    await writeFile(join(root, "short.pdf"), minimalPdf("Hello PDF"));
    await expect(
      readDocument({ path: "short.pdf", pageEnd: 100 }, context),
    ).resolves.toMatchObject({ ok: true, truncated: false });
  });

  it("serializes quoted CSV and TSV content for the existing approved file writer", async () => {
    const { context } = await fixture();
    await expect(
      formatTable(
        { format: "csv", rows: [["00123", "two\nlines", "a,b"]] },
        context,
      ),
    ).resolves.toMatchObject({
      ok: true,
      output: { content: '00123,"two\nlines","a,b"' },
      truncated: false,
    });
    await expect(
      formatTable({ format: "tsv", rows: [["00123", "plain"]] }, context),
    ).resolves.toMatchObject({ ok: true, output: { content: "00123\tplain" } });
  });

  it("extracts bounded PDF pages and retains page numbers", async () => {
    const { root, context } = await fixture();
    await writeFile(join(root, "sample.pdf"), minimalPdf("Hello PDF"));
    const result = await readDocument(
      { path: "sample.pdf", pageStart: 1, pageEnd: 1 },
      context,
    );
    expect(result).toMatchObject({
      ok: true,
      output: {
        kind: "pdf",
        source: "sample.pdf",
        pageStart: 1,
        pageEnd: 1,
        totalPages: 1,
        pages: [{ page: 1, text: "Hello PDF", textless: false }],
      },
    });
  });

  it("marks textless PDF pages without claiming OCR", async () => {
    const { root, context } = await fixture();
    await writeFile(join(root, "scan.pdf"), pdfFromStream(""));
    const result = await readDocument({ path: "scan.pdf" }, context);
    expect(result).toMatchObject({
      ok: true,
      output: {
        kind: "pdf",
        pages: [{ page: 1, text: "", textless: true }],
        note: expect.stringContaining("OCR was not performed"),
      },
    });
  });

  it("extracts both columns from a positioned text-layer PDF", async () => {
    const { root, context } = await fixture();
    await writeFile(
      join(root, "columns.pdf"),
      pdfFromStream("BT /F1 12 Tf 30 72 Td (Left) Tj 170 0 Td (Right) Tj ET"),
    );
    const result = await readDocument({ path: "columns.pdf" }, context);
    expect(result).toMatchObject({ ok: true, output: { kind: "pdf" } });
    if (result.ok && result.output.kind === "pdf") {
      expect(result.output.pages[0]?.text).toContain("Left");
      expect(result.output.pages[0]?.text).toContain("Right");
    }
  });

  it("reports image metadata without claiming model analysis", async () => {
    const { root, context } = await fixture();
    const png = Buffer.alloc(24);
    png.write("\x89PNG\r\n\x1a\n", "binary");
    png.writeUInt32BE(320, 16);
    png.writeUInt32BE(180, 20);
    await writeFile(join(root, "image.png"), png);
    const result = await readDocument({ path: "image.png" }, context);
    expect(result).toMatchObject({
      ok: true,
      output: { kind: "image", width: 320, height: 180, mimeType: "image/png" },
    });
    if (result.ok && result.output.kind === "image")
      expect(result.output.note).toContain("depends on");
  });

  it("reads only the configured text output budget", async () => {
    const { root, context } = await fixture();
    await writeFile(join(root, "large.txt"), "0123456789");
    const result = await readDocument(
      { path: "large.txt" },
      { ...context, limits: { ...context.limits, maxOutputBytes: 4 } },
    );
    expect(result).toEqual({
      ok: true,
      output: { kind: "text", source: "large.txt", text: "0123", bytes: 4 },
      truncated: true,
    });
  });

  it("rejects symlink escapes and observes cancellation", async () => {
    const { root, context } = await fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(
      readDocument(
        { path: "missing.pdf" },
        { ...context, signal: controller.signal },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "cancelled" } });
    await expect(
      readDocument({ path: "../outside.pdf" }, context),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "outside_workspace" },
    });
    expect(root).toBeTruthy();
  });
});

function minimalPdf(text: string): Buffer {
  return pdfFromStream(`BT /F1 12 Tf 72 72 Td (${text}) Tj ET`);
}

function pdfFromStream(stream: string): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1))
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}
