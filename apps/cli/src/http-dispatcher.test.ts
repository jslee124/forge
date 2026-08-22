import { describe, expect, it, vi } from "vitest";

import {
  configureHttpDispatcher,
  resolveHttpProxySettings,
} from "./http-dispatcher.js";

describe("HTTP dispatcher", () => {
  it("reads lowercase proxy variables before uppercase aliases", () => {
    expect(
      resolveHttpProxySettings({
        http_proxy: "http://lower-http.example:8080",
        HTTP_PROXY: "http://upper-http.example:8080",
        https_proxy: "http://lower-https.example:8080",
        HTTPS_PROXY: "http://upper-https.example:8080",
        no_proxy: "localhost,.example.test",
        NO_PROXY: "ignored.example",
      }),
    ).toEqual({
      httpProxy: "http://lower-http.example:8080",
      httpsProxy: "http://lower-https.example:8080",
      noProxy: "localhost,.example.test",
    });
  });

  it("installs an environment-aware dispatcher only when configured", () => {
    const dispatcher = {} as never;
    const dependencies = {
      createAgent: vi.fn(() => dispatcher),
      setGlobalDispatcher: vi.fn(),
      install: vi.fn(),
    };

    expect(
      configureHttpDispatcher(
        { HTTPS_PROXY: "http://127.0.0.1:1082" },
        dependencies,
      ),
    ).toBe(true);
    expect(dependencies.createAgent).toHaveBeenCalledWith({
      httpsProxy: "http://127.0.0.1:1082",
    });
    expect(dependencies.setGlobalDispatcher).toHaveBeenCalledWith(dispatcher);
    expect(dependencies.install).toHaveBeenCalledOnce();

    dependencies.createAgent.mockClear();
    expect(configureHttpDispatcher({}, dependencies)).toBe(false);
    expect(dependencies.createAgent).not.toHaveBeenCalled();
  });

  it("rejects unsupported proxy schemes without echoing credentials", () => {
    expect(() =>
      resolveHttpProxySettings({
        HTTPS_PROXY: "socks5://secret@example.test:1080",
      }),
    ).toThrow("HTTPS_PROXY must use the http:// or https:// scheme.");
  });
});
