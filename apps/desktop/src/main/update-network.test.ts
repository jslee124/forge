import { beforeEach, expect, it, vi } from "vitest";
import { repository } from "./update-release.js";

const fake = vi.hoisted(() => ({
  listener: undefined as
    | undefined
    | ((
        details: { url: string },
        callback: (result: { cancel?: boolean }) => void,
      ) => void),
  hops: [] as string[],
  options: undefined as RequestInit | undefined,
}));
vi.mock("electron", () => ({
  session: {
    fromPartition: () => ({
      webRequest: {
        onBeforeRequest: (listener: typeof fake.listener) => {
          fake.listener = listener;
        },
      },
      fetch: async (_url: string, options: RequestInit) => {
        fake.options = options;
        for (const url of fake.hops) {
          let cancelled = false;
          fake.listener?.({ url }, (result) => {
            cancelled = !!result.cancel;
          });
          if (cancelled) throw new Error("net::ERR_BLOCKED_BY_CLIENT");
        }
        return new Response("fixture");
      },
    }),
  },
}));

import { createUpdateFetch } from "./update-network.js";

const source = `https://github.com/${repository}/releases/download/desktop-0.3.4/forge-desktop-0.3.4-arm64.dmg`;
beforeEach(() => {
  fake.hops = [];
  fake.options = undefined;
});
it("validates each redirect before Chromium sends it, with no credentials", async () => {
  const fetch = createUpdateFetch();
  fake.hops = [
    source,
    "https://release-assets.githubusercontent.com/asset?sig=x",
  ];
  expect((await fetch(source)).status).toBe(200);
  expect(fake.options).toMatchObject({
    redirect: "follow",
    credentials: "omit",
    cache: "no-store",
  });
  fake.hops = [source, "https://evil.example/asset"];
  await expect(fetch(source)).rejects.toThrow("Untrusted");
});
it("blocks unexpected requests, API cross-host redirects and excessive redirects", async () => {
  const fetch = createUpdateFetch();
  fake.listener?.({ url: source }, (result) =>
    expect(result.cancel).toBe(true),
  );
  const api = `https://api.github.com/repos/${repository}/releases`;
  fake.hops = [api, source];
  await expect(fetch(api)).rejects.toThrow("Untrusted");
  fake.hops = Array.from({ length: 6 }, () => source);
  await expect(fetch(source)).rejects.toThrow("Too many");
});
