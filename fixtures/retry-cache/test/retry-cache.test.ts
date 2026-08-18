import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { RetryCache } from "../src/retry-cache.ts";

describe("RetryCache", () => {
  it("deduplicates concurrent successful loads", async () => {
    const cache = new RetryCache();
    let calls = 0;
    const loader = async () => {
      calls += 1;
      return "profile";
    };

    const [first, second] = await Promise.all([
      cache.getOrLoad("mori", loader),
      cache.getOrLoad("mori", loader),
    ]);

    assert.equal(first, "profile");
    assert.equal(second, "profile");
    assert.equal(calls, 1);
  });

  it("retries after a rejected load", async () => {
    const cache = new RetryCache();
    let calls = 0;
    const loader = async () => {
      calls += 1;
      if (calls === 1) throw new Error("temporary failure");
      return "recovered";
    };

    await assert.rejects(cache.getOrLoad("mori", loader));
    await assert.doesNotReject(cache.getOrLoad("mori", loader));
    assert.equal(calls, 2);
  });
});
