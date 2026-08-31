import { runLiveEvaluation } from "./live-runner.js";

export async function main(
  argv = process.argv.slice(2),
  env = process.env,
): Promise<number> {
  try {
    const options = parseArguments(argv);
    const { report, output } = await runLiveEvaluation({
      env,
      ...(options.taskIds ? { taskIds: options.taskIds } : {}),
      ...(options.trials ? { trialsPerTask: options.trials } : {}),
      ...(options.model ? { modelId: options.model } : {}),
      ...(options.thinking ? { thinking: options.thinking } : {}),
      ...(options.output ? { outputDirectory: options.output } : {}),
      ...(options.editContract ? { editContract: options.editContract } : {}),
      ...(options.allowDirty ? { allowDirty: true } : {}),
      onProgress: (message) => process.stderr.write(`${message}\n`),
    });
    const passed = report.trials.filter((trial) => trial.passed).length;
    process.stdout.write(
      `Recorded ${passed}/${report.trials.length} passing trials in ${output}\n`,
    );
    return passed === report.trials.length ? 0 : 1;
  } catch (error) {
    process.stderr.write(
      `Evaluation error: ${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    return 2;
  }
}

interface CliOptions {
  readonly taskIds?: readonly string[];
  readonly trials?: number;
  readonly model?: string;
  readonly thinking?: "enabled" | "disabled";
  readonly output?: string;
  readonly editContract?: "legacy" | "union" | "flat";
  readonly allowDirty?: boolean;
}

function parseArguments(argv: readonly string[]): CliOptions {
  if (!argv.includes("--live"))
    throw new Error("Pass --live to run paid provider evaluations.");
  const values = new Map<string, string[]>();
  let allowDirty = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--live") continue;
    if (argument === "--allow-dirty") {
      allowDirty = true;
      continue;
    }
    if (!argument?.startsWith("--"))
      throw new Error(`Unexpected argument: ${argument ?? ""}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--"))
      throw new Error(`Missing value for ${argument}.`);
    const current = values.get(argument) ?? [];
    current.push(value);
    values.set(argument, current);
    index += 1;
  }
  const known = new Set([
    "--task",
    "--trials",
    "--model",
    "--thinking",
    "--output",
    "--edit-contract",
  ]);
  for (const key of values.keys()) {
    if (!known.has(key)) throw new Error(`Unknown option: ${key}`);
  }
  const trialsValue = single(values, "--trials");
  const thinkingValue = single(values, "--thinking");
  if (
    thinkingValue !== undefined &&
    thinkingValue !== "enabled" &&
    thinkingValue !== "disabled"
  ) {
    throw new Error("Thinking must be enabled or disabled.");
  }
  const taskIds = values.get("--task");
  const model = single(values, "--model");
  const output = single(values, "--output");
  const editContract = single(values, "--edit-contract");
  if (
    editContract !== undefined &&
    editContract !== "legacy" &&
    editContract !== "union" &&
    editContract !== "flat"
  ) {
    throw new Error("Edit contract must be legacy, union, or flat.");
  }
  return {
    ...(taskIds ? { taskIds } : {}),
    ...(trialsValue ? { trials: Number(trialsValue) } : {}),
    ...(model ? { model } : {}),
    ...(thinkingValue ? { thinking: thinkingValue } : {}),
    ...(output ? { output } : {}),
    ...(editContract ? { editContract } : {}),
    ...(allowDirty ? { allowDirty: true } : {}),
  };
}

function single(
  values: ReadonlyMap<string, readonly string[]>,
  key: string,
): string | undefined {
  const entries = values.get(key);
  if (!entries) return undefined;
  if (entries.length !== 1)
    throw new Error(`${key} may only be specified once.`);
  return entries[0];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await main();
}
