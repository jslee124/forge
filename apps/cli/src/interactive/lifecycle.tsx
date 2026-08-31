import { type Instance, render } from "ink";
import type React from "react";

export interface InteractiveLifecycleOptions {
  readonly stdin: NodeJS.ReadStream;
  readonly stdout: NodeJS.WriteStream;
  readonly stderr: NodeJS.WriteStream;
  readonly keyboardMode: "enabled" | "disabled";
  readonly incrementalRendering: boolean;
  readonly patchConsole?: boolean;
}

export async function runInteractiveLifecycle(
  app: React.ReactElement,
  options: InteractiveLifecycleOptions,
): Promise<number> {
  let instance: Instance | undefined;
  try {
    instance = render(app, {
      stdin: options.stdin,
      stdout: options.stdout,
      stderr: options.stderr,
      exitOnCtrlC: false,
      incrementalRendering: options.incrementalRendering,
      patchConsole: options.patchConsole ?? true,
      kittyKeyboard: { mode: options.keyboardMode },
    });
    const result = await instance.waitUntilExit();
    return typeof result === "number" ? result : 0;
  } finally {
    // Ink removes its stdout resize listener during unmount. Calling unmount
    // here is intentionally idempotent with useApp().exit() and covers errors
    // thrown before waitUntilExit settles.
    instance?.unmount();
  }
}
