import { expect, it } from "vitest";
import { sourceUrlSchema } from "./application-protocol.js";

it("only opens bounded HTTP(S) source URLs without embedded credentials", () => {
  for (const url of [
    "https://example.com/article?q=source#part",
    "http://example.com/",
  ])
    expect(sourceUrlSchema.parse(url)).toBe(url);
  for (const url of [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "mailto:test@example.com",
    "https://secret@example.com/",
    "https://user:secret@example.com/",
    "not a URL",
    `https://example.com/${"x".repeat(2048)}`,
  ])
    expect(sourceUrlSchema.safeParse(url).success).toBe(false);
});
