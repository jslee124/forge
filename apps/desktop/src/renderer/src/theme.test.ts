/// <reference lib="dom" />
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("desktop appearance preference", () => {
  let systemDark = false;
  let onSystemChange: () => void;
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    systemDark = false;
    vi.stubGlobal("matchMedia", () => ({
      get matches() {
        return systemDark;
      },
      addEventListener: (_type: string, listener: () => void) => {
        onSystemChange = listener;
      },
    }));
  });
  it("follows live system changes but preserves an explicit override", async () => {
    const { setTheme } = await import("./theme.js");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    systemDark = true;
    onSystemChange();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    setTheme("light");
    onSystemChange();
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem("forge.desktop.theme")).toBe("light");
    setTheme("system");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });
  it("restores saved appearance and falls back for invalid values", async () => {
    localStorage.setItem("forge.desktop.theme", "dark");
    const { parseTheme } = await import("./theme.js");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(parseTheme("invalid")).toBe("system");
  });
});
