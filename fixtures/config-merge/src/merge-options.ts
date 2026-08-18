export interface WorkerOptions {
  readonly enabled: boolean;
  readonly retries: number;
  readonly label: string;
}

export function mergeWorkerOptions(
  defaults: WorkerOptions,
  overrides: Partial<WorkerOptions>,
): WorkerOptions {
  return {
    enabled: overrides.enabled || defaults.enabled,
    retries: overrides.retries || defaults.retries,
    label: overrides.label || defaults.label,
  };
}
