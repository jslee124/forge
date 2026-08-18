import { mergeWorkerOptions, type WorkerOptions } from "./merge-options.ts";

const defaults: WorkerOptions = {
  enabled: true,
  retries: 3,
  label: "primary",
};

export function configureWorker(
  overrides: Partial<WorkerOptions>,
): WorkerOptions {
  return mergeWorkerOptions(defaults, overrides);
}
