import { EventEmitter } from "node:events";

import { describe, expect, it } from "vitest";

import { createSigintCancellationScope, type SigintSource } from "./signals.js";

describe("SIGINT cancellation", () => {
  it("aborts with SIGINT and removes the listener", () => {
    const source = new EventEmitter();
    const scope = createSigintCancellationScope(source as SigintSource);

    source.emit("SIGINT");

    expect(scope.signal.aborted).toBe(true);
    expect(scope.signal.reason).toBe("SIGINT");

    scope.dispose();
    expect(source.listenerCount("SIGINT")).toBe(0);
  });
});
