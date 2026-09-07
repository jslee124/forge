import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { ModelConfigurationError, type ModelImageInput } from "@forge/core";

const MAX_IMAGE_COUNT = 8;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 40 * 1024 * 1024;
const DATA_URL_PATTERN =
  /^data:(image\/(?:jpeg|png|gif|webp));base64,([a-z0-9+/=\s]+)$/iu;

export async function resolveImageInputs(
  sources: readonly string[] | undefined,
  baseDirectory: string,
): Promise<readonly ModelImageInput[]> {
  if (!sources?.length) return [];
  if (sources.length > MAX_IMAGE_COUNT) {
    throw new ModelConfigurationError(
      `Too many image attachments (${sources.length}). Forge allows at most ${MAX_IMAGE_COUNT} per request.`,
    );
  }

  const base = await realpath(baseDirectory);
  const images: ModelImageInput[] = [];
  let totalBytes = 0;
  for (const rawSource of sources) {
    const source = rawSource.trim();
    if (source === "") {
      throw new ModelConfigurationError("Image source must not be empty.");
    }
    if (/^https?:\/\//iu.test(source)) {
      let url: URL;
      try {
        url = new URL(source);
      } catch {
        throw new ModelConfigurationError(`Invalid image URL: ${source}`);
      }
      if (url.username || url.password || source.length > 8_192) {
        throw new ModelConfigurationError(
          "Image URLs must not contain credentials and must be at most 8192 characters.",
        );
      }
      images.push({ type: "url", url: url.toString() });
      continue;
    }
    if (source.startsWith("data:")) {
      if (source.length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 128) {
        throw new ModelConfigurationError(
          "Image data URL exceeds Forge's 20 MiB per-image limit.",
        );
      }
      const match = DATA_URL_PATTERN.exec(source);
      if (!match?.[1] || !match[2]) {
        throw new ModelConfigurationError(
          "Image data URLs must contain base64 JPEG, PNG, GIF, or WebP data.",
        );
      }
      const data = match[2].replace(/\s/gu, "");
      const bytes = Buffer.from(data, "base64");
      assertImageSize(bytes.byteLength, source);
      assertMagicBytes(bytes, match[1]);
      const mediaType = detectMediaType(bytes);
      if (!mediaType) {
        throw new ModelConfigurationError("Unsupported image data URL.");
      }
      totalBytes += bytes.byteLength;
      assertTotalSize(totalBytes);
      images.push({
        type: "base64",
        mediaType,
        data,
      });
      continue;
    }

    // Local images are an explicit user attachment capability (`--image`, an
    // interactive @ mention, or a pasted path). This is intentionally separate
    // from model-invoked file tools, which remain confined to the workspace.
    const candidate = await realpath(path.resolve(base, source)).catch(() => {
      throw new ModelConfigurationError(`Image file does not exist: ${source}`);
    });
    const metadata = await stat(candidate);
    if (!metadata.isFile()) {
      throw new ModelConfigurationError(
        `Image source is not a file: ${source}`,
      );
    }
    assertImageSize(metadata.size, source);
    const bytes = await readFile(candidate);
    const mediaType = detectMediaType(bytes);
    if (!mediaType) {
      throw new ModelConfigurationError(
        `Unsupported image format for ${source}. Use JPEG, PNG, GIF, or WebP.`,
      );
    }
    totalBytes += bytes.byteLength;
    assertTotalSize(totalBytes);
    images.push({
      type: "base64",
      mediaType,
      data: bytes.toString("base64"),
      filename: path.basename(candidate),
    });
  }
  return images;
}

export function isSupportedImagePath(filePath: string): boolean {
  return /\.(?:jpe?g|png|gif|webp)$/iu.test(filePath);
}

function assertImageSize(size: number, source: string): void {
  if (size === 0 || size > MAX_IMAGE_BYTES) {
    throw new ModelConfigurationError(
      `Image ${source} must be between 1 byte and 20 MiB.`,
    );
  }
}

function assertTotalSize(size: number): void {
  if (size > MAX_TOTAL_IMAGE_BYTES) {
    throw new ModelConfigurationError(
      "Image attachments exceed Forge's 40 MiB combined request limit.",
    );
  }
}

function assertMagicBytes(bytes: Uint8Array, mediaType: string): void {
  if (detectMediaType(bytes) !== mediaType) {
    throw new ModelConfigurationError(
      `Image data does not match its declared media type ${mediaType}.`,
    );
  }
}

function detectMediaType(
  bytes: Uint8Array,
): "image/jpeg" | "image/png" | "image/gif" | "image/webp" | undefined {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  const header = Buffer.from(bytes.subarray(0, 12)).toString("ascii");
  if (header.startsWith("GIF87a") || header.startsWith("GIF89a")) {
    return "image/gif";
  }
  if (header.startsWith("RIFF") && header.slice(8, 12) === "WEBP") {
    return "image/webp";
  }
  return undefined;
}
