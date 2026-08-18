import { ForgeConfigError } from "@forge/config";
import { PersistenceError } from "@forge/persistence";

import type { AskOptions } from "./ask.js";
import {
  type InteractiveUiDependencies,
  runInkInteractiveFromCli,
} from "./interactive-ui.js";
import { createPersistentInteractiveSession } from "./persistent-session.js";

export interface ResumeOptions extends AskOptions {
  readonly last?: boolean;
}

export async function runResumeFromCli(
  sessionId: string | undefined,
  options: ResumeOptions,
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  try {
    if (sessionId && options.last) {
      process.stderr.write(
        "Resume accepts either a session ID or --last, not both.\n",
      );
      return 2;
    }
    if (!sessionId && !options.last) {
      process.stderr.write(
        "Resume requires a session ID or --last. Use /resume inside Forge to open the session picker.\n",
      );
      return 2;
    }
    const sessionPersistence = await createPersistentInteractiveSession({
      cwd: process.cwd(),
      env,
      ...(sessionId ? { sessionId } : {}),
      ...(options.last ? { last: true } : {}),
    });
    const dependencies: InteractiveUiDependencies = {
      env,
      cwd: process.cwd(),
      sessionPersistence,
    };
    return runInkInteractiveFromCli(options, dependencies);
  } catch (error) {
    if (
      error instanceof PersistenceError ||
      error instanceof ForgeConfigError
    ) {
      process.stderr.write(`Resume error: ${error.message}\n`);
      return 2;
    }
    process.stderr.write("Unexpected error while resuming the session.\n");
    return 1;
  }
}
