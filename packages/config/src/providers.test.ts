import { describe, expect, it } from "vitest";

import {
  isLoopbackHost,
  ProviderEndpointError,
  parseProviderBaseUrl,
  providerUrl,
} from "./providers.js";

describe("parseProviderBaseUrl", () => {
  it("accepts an https endpoint and drops trailing slashes", () => {
    expect(parseProviderBaseUrl("https://gateway.example/v1/")).toBe(
      "https://gateway.example/v1",
    );
    expect(parseProviderBaseUrl("  https://gateway.example/v1///  ")).toBe(
      "https://gateway.example/v1",
    );
  });

  it("keeps deployment path segments", () => {
    expect(parseProviderBaseUrl("https://gateway.example/openai/v1")).toBe(
      "https://gateway.example/openai/v1",
    );
  });

  it("allows plain http only for loopback hosts", () => {
    expect(parseProviderBaseUrl("http://localhost:11434/v1")).toBe(
      "http://localhost:11434/v1",
    );
    expect(parseProviderBaseUrl("http://127.0.0.1:8000/v1")).toBe(
      "http://127.0.0.1:8000/v1",
    );
    expect(parseProviderBaseUrl("http://[::1]:8000/v1")).toBe(
      "http://[::1]:8000/v1",
    );
  });

  it("refuses plaintext to a host that is not this machine", () => {
    expect(() => parseProviderBaseUrl("http://gateway.example/v1")).toThrow(
      ProviderEndpointError,
    );
    // A loopback-looking name that resolves elsewhere must not pass.
    expect(() =>
      parseProviderBaseUrl("http://localhost.evil.example/v1"),
    ).toThrow(ProviderEndpointError);
  });

  it("refuses credentials embedded in the URL", () => {
    expect(() =>
      parseProviderBaseUrl("https://user:secret@gateway.example/v1"),
    ).toThrow(ProviderEndpointError);
  });

  it("refuses a query string or fragment that path joining would break", () => {
    expect(() =>
      parseProviderBaseUrl("https://gateway.example/v1?key=1"),
    ).toThrow(ProviderEndpointError);
    expect(() => parseProviderBaseUrl("https://gateway.example/v1#x")).toThrow(
      ProviderEndpointError,
    );
  });

  it("refuses a non-HTTP scheme, an empty value, and a bare host", () => {
    expect(() => parseProviderBaseUrl("ftp://gateway.example")).toThrow(
      ProviderEndpointError,
    );
    expect(() => parseProviderBaseUrl("   ")).toThrow(ProviderEndpointError);
    expect(() => parseProviderBaseUrl("gateway.example/v1")).toThrow(
      ProviderEndpointError,
    );
  });
});

describe("isLoopbackHost", () => {
  it("accepts the loopback range and rejects look-alikes", () => {
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("LocalHost")).toBe(true);
    expect(isLoopbackHost("127.5.4.3")).toBe(true);
    expect(isLoopbackHost("[::1]")).toBe(true);
    expect(isLoopbackHost("128.0.0.1")).toBe(false);
    expect(isLoopbackHost("127.0.0.999")).toBe(false);
    expect(isLoopbackHost("notlocalhost")).toBe(false);
    expect(isLoopbackHost("localhost.evil.example")).toBe(false);
  });
});

describe("providerUrl", () => {
  it("joins by prefix so deployment segments survive", () => {
    expect(providerUrl("https://gateway.example/openai/v1", "/models")).toBe(
      "https://gateway.example/openai/v1/models",
    );
    // Resolving "/models" against the base as a URL would drop /openai/v1.
    expect(providerUrl("https://gateway.example/openai/v1", "models")).toBe(
      "https://gateway.example/openai/v1/models",
    );
  });
});
