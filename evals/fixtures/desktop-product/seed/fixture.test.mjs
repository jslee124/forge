import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePort } from "./workflow.mjs";

test("rejects port zero", () => assert.throws(() => parsePort("0")));
test("accepts a valid port", () => assert.equal(parsePort("8080"), 8080));
