import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";

import { ProviderSetup, type ProviderSetupResult } from "./provider-setup.js";

const settle = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

describe("ProviderSetup", () => {
  it("configures an auth-none route and searches the full discovered catalog", async () => {
    let completed: ProviderSetupResult | undefined;
    const discover = vi.fn(async () =>
      Array.from({ length: 20 }, (_, index) => ({
        id: `model-${index}`,
        contextWindow: 32_768,
        ...(index === 19
          ? { reasoningEfforts: ["none", "high"] as const }
          : {}),
      })),
    );
    const instance = render(
      <ProviderSetup
        existingProviders={{}}
        discover={discover}
        onCancel={() => undefined}
        onComplete={(result) => {
          completed = result;
        }}
      />,
    );

    instance.stdin.write("ollama");
    await settle();
    instance.stdin.write("\r");
    await settle();
    instance.stdin.write("http://localhost:11434/v1");
    await settle();
    instance.stdin.write("\r");
    await settle();
    instance.stdin.write("\r");
    await settle();
    instance.stdin.write("\u001B[B");
    await settle();
    instance.stdin.write("\r");
    await settle();
    expect(discover).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: "http://localhost:11434/v1",
        api: "openai-completions",
      }),
    );

    instance.stdin.write("model-19");
    await settle();
    expect(instance.lastFrame()).toContain("model-19");
    instance.stdin.write("\r");
    await settle();
    expect(instance.lastFrame()).toContain("[x] none");
    expect(instance.lastFrame()).toContain("[x] high");
    expect(instance.lastFrame()).toContain("Source: discovered from /models");
    instance.stdin.write("\r");
    await settle();
    instance.stdin.write("\r");
    await settle();

    expect(completed).toMatchObject({
      route: "ollama",
      model: "model-19",
      profile: {
        auth: { type: "none" },
        models: [
          {
            id: "model-19",
            contextWindow: 32_768,
            reasoningGears: { none: "none", high: "high" },
          },
        ],
      },
    });
    expect(completed).not.toHaveProperty("apiKey");
    instance.unmount();
  });

  it("adds a model to an existing route without replacing its endpoint", async () => {
    let completed: ProviderSetupResult | undefined;
    const discoverExisting = vi.fn(async () => [
      { id: "model-old" },
      { id: "model-new", contextWindow: 65_536 },
    ]);
    const instance = render(
      <ProviderSetup
        existingProviders={{
          gateway: {
            api: "openai-responses",
            baseUrl: "https://gateway.example/v1",
            auth: { type: "none" },
            models: [{ id: "model-old" }],
          },
        }}
        discoverExisting={discoverExisting}
        onCancel={() => undefined}
        onComplete={(result) => {
          completed = result;
        }}
      />,
    );
    instance.stdin.write("gateway");
    await settle();
    instance.stdin.write("\r");
    await settle();
    expect(discoverExisting).toHaveBeenCalledWith(
      expect.objectContaining({ route: "gateway" }),
    );
    expect(instance.lastFrame()).toContain("Add provider model");
    expect(instance.lastFrame()).toContain("model-new");
    expect(instance.lastFrame()).not.toContain("model-old");
    instance.stdin.write("\r");
    await settle();
    instance.stdin.write("\r");
    await settle();
    instance.stdin.write("\r");
    await settle();

    expect(completed).toMatchObject({
      route: "gateway",
      model: "model-new",
      profile: {
        api: "openai-responses",
        baseUrl: "https://gateway.example/v1",
        auth: { type: "none" },
        models: [
          { id: "model-old" },
          { id: "model-new", contextWindow: 65_536 },
        ],
      },
    });
    expect(completed?.profile.models?.[1]).not.toHaveProperty("reasoningGears");
    instance.unmount();
  });

  it("asks for a new key when an existing bearer route is logged out", async () => {
    const discover = vi.fn(async () => [{ id: "model-new" }]);
    const instance = render(
      <ProviderSetup
        existingProviders={{
          gateway: {
            api: "openai-responses",
            baseUrl: "https://gateway.example/v1",
            auth: { type: "bearer" },
            models: [],
          },
        }}
        discover={discover}
        hasExistingCredential={() => false}
        onCancel={() => undefined}
        onComplete={() => undefined}
      />,
    );

    instance.stdin.write("gateway");
    await settle();
    instance.stdin.write("\r");
    await settle();
    expect(instance.lastFrame()).toContain("Enter a new API key");
    expect(instance.lastFrame()).not.toContain("gateway-secret");
    instance.stdin.write("gateway-secret");
    await settle();
    instance.stdin.write("\r");
    await settle();

    expect(discover).toHaveBeenCalledWith(
      expect.objectContaining({
        api: "openai-responses",
        baseUrl: "https://gateway.example/v1",
        apiKey: "gateway-secret",
      }),
    );
    expect(instance.lastFrame()).not.toContain("gateway-secret");
    instance.unmount();
  });
});
