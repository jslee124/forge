export class RetryCache {
  readonly #entries = new Map<string, Promise<unknown>>();

  getOrLoad<T>(key: string, loader: () => Promise<T>): Promise<T> {
    const existing = this.#entries.get(key) as Promise<T> | undefined;
    if (existing) return existing;

    const pending = loader();
    this.#entries.set(key, pending);
    return pending;
  }
}
