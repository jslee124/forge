import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mergeWorkerOptions } from "../src/merge-options.ts";

const defaults = { enabled: true, retries: 3, label: "primary" };

describe("mergeWorkerOptions", () => {
  it("uses defaults for omitted fields", () => {
    assert.deepEqual(mergeWorkerOptions(defaults, {}), defaults);
  });

  it("preserves an explicit false override", () => {
    assert.deepEqual(mergeWorkerOptions(defaults, { enabled: false }), {
      enabled: false,
      retries: 3,
      label: "primary",
    });
  });
});
