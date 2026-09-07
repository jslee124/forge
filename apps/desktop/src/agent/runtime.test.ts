import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createAgentRequestHandler,
  parseAgentRequest,
  resourcesAreAvailable,
} from "./runtime.js";

describe("Desktop Agent runtime", () => {
  it("rejects malformed messages", () => {
    expect(parseAgentRequest({ type: "run", requestId: "1" })).toBeUndefined();
    expect(parseAgentRequest({ type: "ping" })).toBeUndefined();
  });

  it("finds only complete Forge resource roots", async () => {
    const root = await mkdtemp(join(tmpdir(), "forge-desktop-resources-"));
    expect(await resourcesAreAvailable(root)).toBe(false);
    await mkdir(join(root, "skills"));
    await mkdir(join(root, "docs"));
    await writeFile(join(root, "docs", "index.json"), "{}");
    expect(await resourcesAreAvailable(root)).toBe(true);
  });

  it("responds to ping and shutdown without accepting arbitrary operations", async () => {
    const send = vi.fn();
    const exit = vi.fn();
    const handle = createAgentRequestHandler({
      resourceRoot: undefined,
      send,
      exit,
    });
    await handle({ type: "unknown", requestId: "ignored" });
    await handle({ type: "ping", requestId: "ping-1" });
    await handle({ type: "shutdown", requestId: "stop-1" });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      type: "pong",
      requestId: "ping-1",
      resourcesAvailable: false,
    });
    expect(send.mock.calls[1]?.[0]).toEqual({
      type: "shutdown-complete",
      requestId: "stop-1",
    });
    expect(exit).toHaveBeenCalledOnce();
  });
});
