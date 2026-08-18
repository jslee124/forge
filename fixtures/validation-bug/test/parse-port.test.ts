import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parsePort } from "../src/parse-port.ts";

describe("parsePort", () => {
  it("accepts decimal integer ports in range", () => {
    assert.equal(parsePort("1"), 1);
    assert.equal(parsePort("3000"), 3000);
    assert.equal(parsePort("65535"), 65535);
  });

  it("rejects malformed and out-of-range input", () => {
    for (const value of [
      "",
      "  ",
      "+80",
      "-1",
      "1.5",
      "1e3",
      "3000abc",
      "0",
      "65536",
    ]) {
      assert.throws(() => parsePort(value), { message: /valid port/u });
    }
  });
});
