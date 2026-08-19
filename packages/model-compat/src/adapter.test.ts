import type { ProviderProfile } from "@forge/config";
import { ModelConfigurationError } from "@forge/core";
import { describe, expect, it } from "vitest";

import {
  CompatModelAdapter,
  type CompatTransport,
  type CompatTransportRequest,
  createCompatModelAdapter,
  DEFAULT_COMPAT_CONTEXT_WINDOW,
  resolveReasoningWireValue,
} from "./index.js";

function recordingTransport(): {
  readonly transport: CompatTransport;
  readonly requests: CompatTransportRequest[];
} {
  const requests: CompatTransportRequest[] = [];
  return {
    requests,
    transport: {
      // biome-ignore lint/correctness/useYield: the stub records the request and produces no events.
      async *stream(request) {
        requests.push(request);
      },
    },
  };
}

async function drain(iterable: AsyncIterable<unknown>): Promise<void> {
  for await (const _ of iterable) {
    // The stub yields nothing; draining is what performs the call.
  }
}

describe("resolveReasoningWireValue", () => {
  it("sends nothing when the model declares no gears", () => {
    expect(resolveReasoningWireValue("high")).toBeUndefined();
    expect(resolveReasoningWireValue("high", { id: "m" })).toBeUndefined();
  });

  it("sends nothing for a model declared non-reasoning", () => {
    expect(
      resolveReasoningWireValue("high", { id: "m", reasoningGears: false }),
    ).toBeUndefined();
  });

  it("maps a declared gear to its wire spelling", () => {
    const profile = {
      id: "m",
      reasoningGears: { none: null, low: "low", high: "think-hard" },
    } as const;
    expect(resolveReasoningWireValue("high", profile)).toBe("think-hard");
    expect(resolveReasoningWireValue("low", profile)).toBe("low");
  });

  it("treats a null gear as offered but spelled by absence", () => {
    expect(
      resolveReasoningWireValue("none", {
        id: "m",
        reasoningGears: { none: null, high: "high" },
      }),
    ).toBeUndefined();
  });

  it("sends nothing for a gear the model does not offer", () => {
    expect(
      resolveReasoningWireValue("max", {
        id: "m",
        reasoningGears: { low: "low" },
      }),
    ).toBeUndefined();
  });
});

describe("CompatModelAdapter", () => {
  it("dispatches the resolved wire value and route metadata", async () => {
    const { transport, requests } = recordingTransport();
    const adapter = new CompatModelAdapter({
      apiKey: "secret",
      route: "my-gateway",
      api: "openai-completions",
      baseUrl: "https://gateway.example/openai/v1",
      model: "glm-4.6",
      reasoningEffort: "high",
      profile: { id: "glm-4.6", reasoningGears: { high: "think-hard" } },
      transport,
    });

    await drain(adapter.stream({ prompt: "hi" }, new AbortController().signal));

    expect(requests[0]?.reasoningEffort).toBe("think-hard");
    expect(requests[0]?.api).toBe("openai-completions");
    expect(requests[0]?.baseUrl).toBe("https://gateway.example/openai/v1");
    expect(requests[0]?.route).toBe("my-gateway");
  });

  it("omits the reasoning parameter entirely when no gear applies", async () => {
    const { transport, requests } = recordingTransport();
    const adapter = new CompatModelAdapter({
      apiKey: "secret",
      route: "my-gateway",
      api: "openai-responses",
      baseUrl: "https://gateway.example/v1",
      model: "plain",
      reasoningEffort: "high",
      transport,
    });

    await drain(adapter.stream({ prompt: "hi" }, new AbortController().signal));

    expect(requests[0] && "reasoningEffort" in requests[0]).toBe(false);
  });

  it("reports configured sizes as declared and unsized models as fallback", () => {
    const base = {
      apiKey: "secret",
      route: "my-gateway",
      api: "openai-completions",
      baseUrl: "https://gateway.example/v1",
      model: "m",
      reasoningEffort: "medium",
      transport: recordingTransport().transport,
    } as const;

    const unsized = new CompatModelAdapter(base);
    expect(unsized.context.contextWindowSource).toBe("configured-fallback");
    expect(unsized.context.contextWindowTokens).toBe(
      DEFAULT_COMPAT_CONTEXT_WINDOW,
    );

    const sized = new CompatModelAdapter({
      ...base,
      profile: { id: "m", contextWindow: 200_000, maxOutputTokens: 16_384 },
    });
    expect(sized.context.contextWindowSource).toBe("adapter-table");
    expect(sized.context.contextWindowTokens).toBe(200_000);
    expect(sized.context.maxOutputTokens).toBe(16_384);
    expect(sized.context.provider).toBe("my-gateway");
  });

  it("refuses a continuation produced by a different route", async () => {
    const adapter = new CompatModelAdapter({
      apiKey: "secret",
      route: "my-gateway",
      api: "openai-completions",
      baseUrl: "https://gateway.example/v1",
      model: "m",
      reasoningEffort: "medium",
      transport: recordingTransport().transport,
    });

    expect(
      await adapter.context.projectContinuation?.(
        { provider: "other-route", data: { messages: [] } },
        100,
      ),
    ).toBeUndefined();
  });
});

describe("createCompatModelAdapter", () => {
  const profile: ProviderProfile = {
    api: "openai-completions",
    baseUrl: "https://gateway.example/openai/v1/",
    models: [{ id: "glm-4.6" }, { id: "kimi-k2" }],
  };

  it("resolves the route credential and canonicalizes the endpoint", async () => {
    const { transport, requests } = recordingTransport();
    const adapter = createCompatModelAdapter({
      env: { FORGE_MY_GATEWAY_API_KEY: "route-secret" },
      route: "my-gateway",
      profile,
      model: "glm-4.6",
      reasoningEffort: "medium",
      transport,
    });

    await drain(adapter.stream({ prompt: "hi" }, new AbortController().signal));

    expect(requests[0]?.apiKey).toBe("route-secret");
    // The trailing slash is removed so path joining stays a prefix operation.
    expect(requests[0]?.baseUrl).toBe("https://gateway.example/openai/v1");
  });

  it("uses the environment variable the route profile declares", async () => {
    const { transport, requests } = recordingTransport();
    const adapter = createCompatModelAdapter({
      env: { MY_TOKEN: "declared-secret" },
      route: "my-gateway",
      profile: { ...profile, apiKeyEnv: "MY_TOKEN" },
      model: "glm-4.6",
      reasoningEffort: "medium",
      transport,
    });

    await drain(adapter.stream({ prompt: "hi" }, new AbortController().signal));

    expect(requests[0]?.apiKey).toBe("declared-secret");
  });

  it("names the configured models when an unknown one is selected", () => {
    expect(() =>
      createCompatModelAdapter({
        env: { FORGE_MY_GATEWAY_API_KEY: "secret" },
        route: "my-gateway",
        profile,
        model: "absent",
        reasoningEffort: "medium",
        transport: recordingTransport().transport,
      }),
    ).toThrow(/does not configure model "absent".*glm-4\.6, kimi-k2/su);
  });

  it("accepts any model id when the route lists none", async () => {
    const { transport, requests } = recordingTransport();
    const adapter = createCompatModelAdapter({
      env: { FORGE_MY_GATEWAY_API_KEY: "secret" },
      route: "my-gateway",
      profile: { api: "openai-responses", baseUrl: "https://g.example/v1" },
      model: "hand-entered",
      reasoningEffort: "medium",
      transport,
    });

    await drain(adapter.stream({ prompt: "hi" }, new AbortController().signal));

    expect(requests[0]?.model).toBe("hand-entered");
  });

  it("reports a missing credential without reaching the network", () => {
    expect(() =>
      createCompatModelAdapter({
        env: {},
        route: "my-gateway",
        profile,
        model: "glm-4.6",
        reasoningEffort: "medium",
        transport: recordingTransport().transport,
      }),
    ).toThrow(ModelConfigurationError);
  });
});
