import { createHash } from "node:crypto";
import type { ModelToolResult } from "./model.js";
import type { ToolCall } from "./tools.js";

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
