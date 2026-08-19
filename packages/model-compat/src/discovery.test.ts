import { describe, expect, it } from "vitest";

import {
  canDiscoverModels,
  discoverModels,
  MAX_DISCOVERY_RESPONSE_BYTES,
  ModelDiscoveryError,
  readModelListing,
} from "./discovery.js";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

/** A body that streams more than the ceiling while declaring nothing. */
function oversizedResponse(): Response {
  const chunk = new Uint8Array(1024 * 1024);
  let sent = 0;
  return new Response(
    new ReadableStream({
      pull(controller) {
        if (sent > MAX_DISCOVERY_RESPONSE_BYTES) {
          controller.close();
          return;
        }
        sent += chunk.byteLength;
        controller.enqueue(chunk);
      },
    }),
    { status: 200 },
  );
}

describe("canDiscoverModels", () => {
  it("accepts the OpenAI-compatible protocols", () => {
    expect(canDiscoverModels("openai-completions")).toBe(true);
    expect(canDiscoverModels("openai-responses")).toBe(true);
  });
});

describe("readModelListing", () => {
  it("reads ids, names, and capacities from common field spellings", () => {
    expect(
      readModelListing({
        data: [
          { id: "a", display_name: "A", context_length: 128000 },
          { id: "b", name: "B", context_window: 200000, max_tokens: 4096 },
        ],
      }),
    ).toEqual([
      { id: "a", name: "A", contextWindow: 128000 },
      { id: "b", name: "B", contextWindow: 200000, maxOutputTokens: 4096 },
    ]);
  });

  it("skips a malformed row instead of failing the whole listing", () => {
    expect(
      readModelListing({ data: [{ id: "" }, null, { id: "kept" }, {}] }),
    ).toEqual([{ id: "kept" }]);
  });

  it("ignores capacities that are not positive integers", () => {
    expect(
      readModelListing({
        data: [{ id: "a", context_window: 0, max_tokens: -1 }],
      }),
    ).toEqual([{ id: "a" }]);
  });

  it("refuses a reply that is not a listing", () => {
    expect(() => readModelListing({ models: [] })).toThrow(ModelDiscoveryError);
    expect(() => readModelListing(null)).toThrow(/by hand/u);
  });
});

describe("discoverModels", () => {
  const base = {
    api: "openai-completions",
    baseUrl: "https://gateway.example/openai/v1",
  } as const;

  it("requests the listing under the endpoint's own path prefix", async () => {
    let seen: { url?: string; headers?: Headers } = {};
    const models = await discoverModels({
      ...base,
      apiKey: "route-secret",
      fetch: async (url, init) => {
        seen = {
          url: String(url),
          headers: new Headers(init?.headers),
        };
        return jsonResponse({ data: [{ id: "glm-4.6" }] });
      },
    });

    // The deployment path must survive, which URL resolution would discard.
    expect(seen.url).toBe("https://gateway.example/openai/v1/models");
    expect(seen.headers?.get("authorization")).toBe("Bearer route-secret");
    expect(models).toEqual([{ id: "glm-4.6" }]);
  });

  it("probes unauthenticated when no key is supplied", async () => {
    let headers: Headers | undefined;
    await discoverModels({
      ...base,
      fetch: async (_url, init) => {
        headers = new Headers(init?.headers);
        return jsonResponse({ data: [] });
      },
    });
    expect(headers?.has("authorization")).toBe(false);
  });

  it("refuses a protocol with no listing Forge can read", async () => {
    await expect(
      discoverModels({
        ...base,
        // A protocol outside the listable set reports that it cannot be
        // interrogated rather than guessing a response shape.
        api: "anthropic-messages" as never,
        fetch: async () => jsonResponse({ data: [] }),
      }),
    ).rejects.toThrow(/by hand/u);
  });

  it("validates the endpoint before reaching the network", async () => {
    let called = false;
    await expect(
      discoverModels({
        api: "openai-completions",
        baseUrl: "http://gateway.example/v1",
        fetch: async () => {
          called = true;
          return jsonResponse({ data: [] });
        },
      }),
    ).rejects.toThrow(/plaintext http/u);
    expect(called).toBe(false);
  });

  it("refuses a key no HTTP header could carry, without blaming the network", async () => {
    let called = false;
    await expect(
      discoverModels({
        ...base,
        apiKey: "bad\u0007key",
        fetch: async () => {
          called = true;
          return jsonResponse({ data: [] });
        },
      }),
    ).rejects.toThrow(/no HTTP header can carry/u);
    expect(called).toBe(false);
  });

  it("explains an authentication failure and a missing listing distinctly", async () => {
    await expect(
      discoverModels({
        ...base,
        fetch: async () => new Response("", { status: 401 }),
      }),
    ).rejects.toThrow(/rejected this API key/u);

    await expect(
      discoverModels({
        ...base,
        fetch: async () => new Response("", { status: 404 }),
      }),
    ).rejects.toThrow(/enter models by hand/u);
  });

  it("reports an unreachable endpoint as a reachability problem", async () => {
    await expect(
      discoverModels({
        ...base,
        fetch: async () => {
          throw new TypeError("connect ECONNREFUSED");
        },
      }),
    ).rejects.toThrow(/could not reach/u);
  });

  it("refuses a declared length beyond the ceiling before transferring", async () => {
    await expect(
      discoverModels({
        ...base,
        fetch: async () =>
          new Response("{}", {
            status: 200,
            headers: {
              "content-length": String(MAX_DISCOVERY_RESPONSE_BYTES + 1),
            },
          }),
      }),
    ).rejects.toThrow(/more than/u);
  });

  it("refuses a body that outgrows the ceiling while declaring nothing", async () => {
    await expect(
      discoverModels({ ...base, fetch: async () => oversizedResponse() }),
    ).rejects.toThrow(/more than/u);
  });

  it("reports a non-JSON reply as such", async () => {
    await expect(
      discoverModels({
        ...base,
        fetch: async () => new Response("<html>nope</html>", { status: 200 }),
      }),
    ).rejects.toThrow(/did not answer with JSON/u);
  });

  it("propagates caller cancellation rather than reporting a bad endpoint", async () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    await expect(
      discoverModels({
        ...base,
        signal: controller.signal,
        fetch: async (_url, init) => {
          init?.signal?.throwIfAborted();
          return jsonResponse({ data: [] });
        },
      }),
    ).rejects.not.toThrow(/could not reach/u);
  });
});
