export interface SigintSource {
  once(event: "SIGINT", listener: () => void): unknown;
  off(event: "SIGINT", listener: () => void): unknown;
}

export interface CancellationScope {
  readonly signal: AbortSignal;
  dispose(): void;
}

export function createSigintCancellationScope(
  source: SigintSource = process,
): CancellationScope {
  const controller = new AbortController();
  const onSigint = () => controller.abort("SIGINT");

  source.once("SIGINT", onSigint);

  return {
    signal: controller.signal,
    dispose: () => source.off("SIGINT", onSigint),
  };
}
