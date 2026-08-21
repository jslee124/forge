import { mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveImageInputs } from "./image-input.js";

const PNG_HEADER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

describe("image input resolution", () => {
  it("encodes workspace images and preserves explicit HTTPS URLs", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forge-images-"));
    await writeFile(path.join(root, "screen.png"), PNG_HEADER);

    await expect(
      resolveImageInputs(
        ["screen.png", "https://example.com/screen.webp"],
        root,
      ),
    ).resolves.toEqual([
      {
        type: "base64",
        mediaType: "image/png",
        data: PNG_HEADER.toString("base64"),
        filename: "screen.png",
      },
      { type: "url", url: "https://example.com/screen.webp" },
    ]);
  });

  it("accepts an explicitly attached image outside the workspace", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forge-images-root-"));
    const outside = await mkdtemp(path.join(tmpdir(), "forge-images-outside-"));
    const target = path.join(outside, "outside.png");
    await writeFile(target, PNG_HEADER);
    await symlink(target, path.join(root, "outside.png"));

    await expect(
      resolveImageInputs([path.join(root, "outside.png")], root),
    ).resolves.toMatchObject([
      { type: "base64", mediaType: "image/png", filename: "outside.png" },
    ]);
  });

  it("rejects a file whose bytes do not match a supported image", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forge-images-invalid-"));
    await writeFile(path.join(root, "fake.png"), "not an image");

    await expect(resolveImageInputs(["fake.png"], root)).rejects.toThrow(
      "Unsupported image format",
    );
  });
});
