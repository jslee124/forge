import { spawn } from "node:child_process";

import type { ForgeTool, ToolContext, ToolResult } from "@forge/core";
import { z } from "zod";

import {
  cancelled,
  failure,
  relativeWorkspacePath,
  resolveToolPath,
} from "./path.js";

export const DEFAULT_COMMAND_TIMEOUT_MS = 60_000;

export const runCommandInputSchema = z.object({
  program: z
    .string()
    .min(1)
    .max(512)
    .refine((value) => !/[\s|&;<>()$`]/u.test(value), {
      message: "program must be one executable token, not a shell expression",
    }),
  args: z.array(z.string().max(8192)).max(100).default([]),
  cwd: z.string().min(1).default("."),
  timeoutMs: z
    .number()
    .int()
    .min(1)
    .max(3_600_000)
    .default(DEFAULT_COMMAND_TIMEOUT_MS),
});

export type RunCommandInput = z.infer<typeof runCommandInputSchema>;

export interface RunCommandOutput {
  readonly program: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export const runCommandTool: ForgeTool = {
  name: "run_command",
  description:
    "Run one executable with a structured argument array inside the workspace. Shell syntax is not supported.",
  inputSchema: runCommandInputSchema,
  risk: "process",
  execute: async (input, context) => {
    const parsed = runCommandInputSchema.safeParse(input);
    if (!parsed.success) {
      return failure("invalid_input", "Invalid input for run_command.");
    }
    return runCommand(parsed.data, context);
  },
};

export async function runCommand(
  input: RunCommandInput,
  context: ToolContext,
): Promise<ToolResult<RunCommandOutput>> {
  if (context.signal.aborted) {
    return cancelled();
  }
  const resolvedCwd = await resolveToolPath(input.cwd, context.workspace);
  if (!resolvedCwd.ok) {
    return resolvedCwd;
  }
  const timeoutMs = Math.min(
    input.timeoutMs,
    context.limits.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
  );

  return await new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(input.program, input.args, {
        cwd: resolvedCwd.path,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      resolve(failure("process_error", "The command could not be started."));
      return;
    }

    let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let truncated = false;
    let timedOut = false;
    let aborted = false;
    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;

    const retain = (
      current: Buffer<ArrayBufferLike>,
      chunk: Buffer<ArrayBufferLike>,
    ): Buffer<ArrayBufferLike> => {
      const retained = stdout.length + stderr.length;
      const remaining = Math.max(0, context.limits.maxOutputBytes - retained);
      if (chunk.length > remaining) {
        truncated = true;
      }
      return Buffer.concat([current, chunk.subarray(0, remaining)]);
    };
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = retain(stdout, chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = retain(stderr, chunk);
    });

    const terminate = () => {
      if (child.exitCode !== null || child.signalCode !== null) {
        return;
      }
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 500);
      killTimer.unref();
    };
    const onAbort = () => {
      aborted = true;
      terminate();
    };
    context.signal.addEventListener("abort", onAbort, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutMs);
    timeout.unref();

    const cleanup = () => {
      clearTimeout(timeout);
      if (killTimer) {
        clearTimeout(killTimer);
      }
      context.signal.removeEventListener("abort", onAbort);
    };
    child.once("error", () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(failure("process_error", "The command could not be started."));
    });
    child.once("close", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (aborted) {
        resolve(cancelled());
        return;
      }
      resolve({
        ok: true,
        output: {
          program: input.program,
          args: input.args,
          cwd: relativeWorkspacePath(context.workspace, resolvedCwd.path),
          timeoutMs,
          exitCode,
          signal,
          stdout: stdout.toString("utf8"),
          stderr: stderr.toString("utf8"),
          timedOut,
        },
        truncated,
      });
    });
  });
}
