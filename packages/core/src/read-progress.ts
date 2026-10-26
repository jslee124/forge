import { createHash } from "node:crypto";
import type { ModelToolResult } from "./model.js";
import type { ToolCall } from "./tools.js";

/** Bounded, run-local stop evidence; never caches results or grants authority. */
export class ReadProgressTracker {
  readonly #seen = new Set<string>();
  readonly #latest = new Map<string, string>();
  #previous: string | undefined;
  #consecutive = 0;
  #repeated = 0;

  observe(
    calls: readonly ToolCall[],
    results: readonly ModelToolResult[],
  ): boolean {
    const fingerprint = unchangedReadFingerprint(calls, results);
    if (!fingerprint) {
      this.#reset();
      return false;
    }
    // A changed result for the same read scope is new evidence, even when a
    // resource returns to an earlier version. Forget prior cycles conservatively.
    const observations: { scope: string; evidence: string }[] = [];
    for (const [index, call] of calls.entries()) {
      const result = results[index];
      const evidence = result && unchangedReadFingerprint([call], [result]);
      if (!evidence) {
        this.#reset();
        return false;
      }
      observations.push({
        scope: JSON.stringify(flatRecord(call.input)),
        evidence,
      });
    }
    if (
      observations.some(
        ({ scope, evidence }) =>
          this.#latest.has(scope) && this.#latest.get(scope) !== evidence,
      )
    ) {
      this.#reset();
    }
    // Exceeding tracking capacity forgets evidence instead of guessing a loop.
    if (
      this.#seen.size >= 64 ||
      this.#latest.size + observations.length > 256
    ) {
      this.#reset();
    }
    this.#consecutive =
      fingerprint === this.#previous ? this.#consecutive + 1 : 1;
    this.#repeated = this.#seen.has(fingerprint) ? this.#repeated + 1 : 0;
    this.#seen.add(fingerprint);
    for (const { scope, evidence } of observations)
      this.#latest.set(scope, evidence);
    this.#previous = fingerprint;
    return this.#consecutive >= 3 || this.#repeated >= 3;
  }

  #reset(): void {
    this.#seen.clear();
    this.#latest.clear();
    this.#previous = undefined;
    this.#consecutive = 0;
    this.#repeated = 0;
  }
}

/** Stop-only evidence. Never serves cached results or authorizes another operation. */
export function unchangedReadFingerprint(
  calls: readonly ToolCall[],
  results: readonly ModelToolResult[],
): string | undefined {
  if (!calls.length || calls.length !== results.length) return;
  const fingerprints: string[] = [];
  for (let index = 0; index < calls.length; index++) {
    const call = calls[index];
    const entry = results[index];
    if (
      !call ||
      call.name !== "read_file" ||
      !entry?.result.ok ||
      entry.callId !== call.id
    )
      return;
    const output = entry.result.output;
    if (
      !output ||
      typeof output !== "object" ||
      !("resourceVersion" in output) ||
      typeof output.resourceVersion !== "string" ||
      !output.resourceVersion ||
      output.resourceVersion.length > 128
    )
      return;
    const input = flatRecord(call.input);
    const evidence = flatRecord(output);
    if (!input || !evidence) return;
    fingerprints.push(
      createHash("sha256")
        .update(
          JSON.stringify([
            call.name,
            input,
            output.resourceVersion,
            evidence,
            entry.result.truncated,
          ]),
        )
        .digest("hex"),
    );
  }
  return fingerprints.sort().join(":");
}
function flatRecord(value: unknown): [string, unknown][] | undefined {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    return;
  const entries = Object.entries(value);
  if (
    entries.some(
      ([, entry]) =>
        entry !== null &&
        !["string", "number", "boolean"].includes(typeof entry),
    )
  )
    return;
  return entries.sort(([a], [b]) => a.localeCompare(b));
}
