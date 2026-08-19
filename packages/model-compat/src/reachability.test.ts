import { describe, expect, it } from "vitest";

import { classifyReachFailure, reachAdvice } from "./reachability.js";

/** An undici-shaped failure: the actionable code sits below the message. */
function wrapped(code: string): Error {
  const inner: NodeJS.ErrnoException = new Error("underlying");
  inner.code = code;
  const middle = new Error("fetch failed", { cause: inner });
  return new Error("stream failed", { cause: middle });
}

describe("classifyReachFailure", () => {
  it("finds the code through a wrapped cause chain", () => {
    expect(classifyReachFailure(wrapped("UND_ERR_CONNECT_TIMEOUT"))).toBe(
      "connect",
    );
    expect(classifyReachFailure(wrapped("ECONNREFUSED"))).toBe("connect");
    expect(classifyReachFailure(wrapped("ENOTFOUND"))).toBe("dns");
  });

  it("separates a name that does not resolve from an address that refuses", () => {
    expect(classifyReachFailure(wrapped("EAI_AGAIN"))).toBe("dns");
    expect(classifyReachFailure(wrapped("ETIMEDOUT"))).toBe("connect");
  });

  it("reports an unrecognized failure rather than guessing", () => {
    expect(classifyReachFailure(new Error("boom"))).toBe("unknown");
    expect(classifyReachFailure(wrapped("EACCES"))).toBe("unknown");
    expect(classifyReachFailure(undefined)).toBe("unknown");
  });

  it("stops walking a self-referential cause chain", () => {
    const looping: Error & { cause?: unknown } = new Error("loop");
    looping.cause = looping;
    expect(classifyReachFailure(looping)).toBe("unknown");
  });

  it("finds the code through a retry wrapper that uses lastError", () => {
    // The real shape from a retried request:
    // RetryError -> APICallError -> ConnectTimeoutError. RetryError exposes
    // the attempt through `lastError`, not `cause`, so a cause-only walk
    // reported this as unknown.
    const connect: NodeJS.ErrnoException = new Error("Connect Timeout Error");
    connect.code = "UND_ERR_CONNECT_TIMEOUT";
    const apiCall = new Error("Cannot connect to API", { cause: connect });
    const retry = Object.assign(new Error("Failed after 3 attempts"), {
      lastError: apiCall,
      errors: [apiCall, apiCall, apiCall],
    });

    expect(classifyReachFailure(retry)).toBe("connect");
  });

  it("finds the code inside an aggregate's errors array", () => {
    const dns: NodeJS.ErrnoException = new Error("getaddrinfo");
    dns.code = "ENOTFOUND";
    const aggregate = Object.assign(new Error("all attempts failed"), {
      errors: [new Error("unrelated"), dns],
    });

    expect(classifyReachFailure(aggregate)).toBe("dns");
  });

  it("bounds the search over a wide aggregate", () => {
    const wide = Object.assign(new Error("many"), {
      errors: Array.from({ length: 500 }, () => new Error("noise")),
    });

    expect(classifyReachFailure(wide)).toBe("unknown");
  });
});

describe("reachAdvice", () => {
  it("points a name failure at the baseUrl and not at the network", () => {
    expect(reachAdvice("dns")).toMatch(/baseUrl/u);
    expect(reachAdvice("dns")).not.toMatch(/proxy/iu);
  });

  it("mentions the proxy switch only when the address refused", () => {
    // Node ignores HTTPS_PROXY unless NODE_USE_ENV_PROXY is set, so a user
    // whose shell and browser work through a proxy sees only Forge time out.
    expect(reachAdvice("connect")).toMatch(/NODE_USE_ENV_PROXY/u);
    expect(reachAdvice("connect")).toMatch(/HTTPS_PROXY/u);
  });

  it("falls back to generic advice for an unknown failure", () => {
    expect(reachAdvice("unknown")).toMatch(/check the network/u);
  });
});
