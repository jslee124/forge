import { PassThrough } from "node:stream";

import { Text, useApp } from "ink";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";

import { runInteractiveLifecycle } from "./lifecycle.js";

function ExitImmediately(): React.JSX.Element {
  const { exit } = useApp();
  useEffect(() => exit(0), [exit]);
  return <Text>done</Text>;
}

describe("interactive lifecycle", () => {
  it("returns resize listeners to baseline across repeated mounts", async () => {
    // Vitest itself owns enough process beforeExit listeners to cross Node's
    // warning threshold when Ink briefly adds its per-instance fallback. This
    // regression targets the observed stdout resize listener, so isolate that
    // stream lifecycle while allowing all other process.once calls through.
    const processOnce = process.once.bind(process);
    vi.spyOn(process, "once").mockImplementation(((event, listener) =>
      event === "beforeExit"
        ? process
        : processOnce(event, listener)) as typeof process.once);
    const stdin = new PassThrough() as unknown as NodeJS.ReadStream;
    const stdout = new PassThrough() as unknown as NodeJS.WriteStream;
    const stderr = new PassThrough() as unknown as NodeJS.WriteStream;
    Object.assign(stdin, { isTTY: true, setRawMode: () => stdin });
    Object.assign(stdout, { isTTY: true, columns: 100, rows: 30 });
    const baseline = stdout.listenerCount("resize");

    for (let cycle = 0; cycle < 12; cycle += 1) {
      await expect(
        runInteractiveLifecycle(<ExitImmediately />, {
          stdin,
          stdout,
          stderr,
          keyboardMode: "disabled",
          incrementalRendering: false,
          patchConsole: false,
        }),
      ).resolves.toBe(0);
      expect(stdout.listenerCount("resize")).toBe(baseline);
    }
    vi.restoreAllMocks();
  });
});
