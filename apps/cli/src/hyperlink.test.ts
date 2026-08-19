import { describe, expect, it } from "vitest";

import { supportsHyperlinks, terminalHyperlink } from "./hyperlink.js";

const SIGN_IN_URL =
  "https://auth.openai.com/oauth/authorize?response_type=code";

describe("supportsHyperlinks", () => {
  it("stays disabled when output is not a terminal", () => {
    expect(
      supportsHyperlinks({ env: { TERM_PROGRAM: "vscode" }, isTTY: false }),
    ).toBe(false);
  });

  it("recognizes known terminal programs case-insensitively", () => {
    for (const program of ["vscode", "Ghostty", "WezTerm", "iTerm.app"]) {
      expect(
        supportsHyperlinks({ env: { TERM_PROGRAM: program }, isTTY: true }),
      ).toBe(true);
    }
  });

  it("recognizes terminals that do not set TERM_PROGRAM", () => {
    expect(supportsHyperlinks({ env: { WT_SESSION: "1" }, isTTY: true })).toBe(
      true,
    );
    expect(
      supportsHyperlinks({ env: { KONSOLE_VERSION: "220000" }, isTTY: true }),
    ).toBe(true);
    expect(
      supportsHyperlinks({ env: { TERM: "xterm-kitty" }, isTTY: true }),
    ).toBe(true);
  });

  it("requires a VTE release that implements OSC 8", () => {
    expect(
      supportsHyperlinks({ env: { VTE_VERSION: "4800" }, isTTY: true }),
    ).toBe(false);
    expect(
      supportsHyperlinks({ env: { VTE_VERSION: "5202" }, isTTY: true }),
    ).toBe(true);
  });

  it("stays disabled on unknown terminals and dumb terminals", () => {
    expect(supportsHyperlinks({ env: {}, isTTY: true })).toBe(false);
    expect(supportsHyperlinks({ env: { TERM: "dumb" }, isTTY: true })).toBe(
      false,
    );
  });

  it("honors NO_COLOR as a request for undecorated output", () => {
    expect(
      supportsHyperlinks({
        env: { TERM_PROGRAM: "vscode", NO_COLOR: "1" },
        isTTY: true,
      }),
    ).toBe(false);
  });

  it("lets FORCE_HYPERLINK override detection in both directions", () => {
    expect(
      supportsHyperlinks({ env: { FORCE_HYPERLINK: "1" }, isTTY: false }),
    ).toBe(true);
    expect(
      supportsHyperlinks({
        env: { TERM_PROGRAM: "vscode", FORCE_HYPERLINK: "0" },
        isTTY: true,
      }),
    ).toBe(false);
  });
});

describe("terminalHyperlink", () => {
  it("wraps the URL in one OSC 8 sequence on a supported terminal", () => {
    const rendered = terminalHyperlink(SIGN_IN_URL, {
      env: { TERM_PROGRAM: "vscode" },
      isTTY: true,
    });

    expect(rendered).toBe(
      `\u001B]8;;${SIGN_IN_URL}\u0007${SIGN_IN_URL}\u001B]8;;\u0007`,
    );
    // The visible label remains the complete address.
    expect(rendered).toContain(SIGN_IN_URL);
  });

  it("returns the bare URL when the terminal is unknown", () => {
    expect(terminalHyperlink(SIGN_IN_URL, { env: {}, isTTY: true })).toBe(
      SIGN_IN_URL,
    );
  });

  it("refuses to wrap a URL containing terminal control characters", () => {
    const hostile = `https://example.com\u0007;rm -rf /`;

    expect(
      terminalHyperlink(hostile, {
        env: { TERM_PROGRAM: "vscode" },
        isTTY: true,
      }),
    ).toBe(hostile);
  });
});
