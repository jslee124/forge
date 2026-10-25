/// <reference lib="dom" />
/// <reference types="vite/client" />
// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import "./i18n.js";
import { CopyButton } from "./copy-button.js";
import { Markdown } from "./markdown.js";

vi.mock("./theme.js", () => ({ useTheme: () => ({ resolved: "dark" }) }));

vi.mock("shiki/core", () => ({
  createHighlighterCore: async () => ({
    codeToTokens: (value: string) => ({
      tokens: [[{ content: value, color: undefined, fontStyle: undefined }]],
    }),
  }),
}));
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
let previous: PropertyDescriptor | undefined;
const writeText = vi.fn(async (_text: string) => {});
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  previous = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  if (previous) Object.defineProperty(navigator, "clipboard", previous);
  else Reflect.deleteProperty(navigator, "clipboard");
  vi.unstubAllGlobals();
});
it("copies the exact answer and surfaces clipboard failure instead of claiming success", async () => {
  await act(async () =>
    root.render(
      createElement(CopyButton, { text: "answer\nexact", label: "复制回答" }),
    ),
  );
  const button = container.querySelector("button");
  if (!button) throw new Error("No copy control");
  await act(async () => button.click());
  expect(writeText).toHaveBeenCalledExactlyOnceWith("answer\nexact");
  expect(button.textContent).toContain("已复制");
  writeText.mockRejectedValueOnce(new Error("permission revoked"));
  await act(async () => button.click());
  expect(button.textContent).not.toContain("已复制");
  expect(container.querySelector("[role=status]")?.textContent).toContain(
    "复制失败",
  );
  await act(async () =>
    root.render(
      createElement(CopyButton, {
        text: "different answer",
        label: "复制回答",
      }),
    ),
  );
  expect(button.textContent).not.toContain("已复制");
  writeText.mockRejectedValueOnce(new Error("not allowed"));
  await act(async () => button.click());
  expect(container.querySelector("[role=status]")?.textContent).toContain(
    "复制失败",
  );
});
it("renders one valid fenced code block with a copy action and keyboard-scrollable code/table", async () => {
  const code = 'const html = "<script>untrusted</script>";';
  await act(async () =>
    root.render(
      <Markdown>{`\`\`\`tsx\n${code}\n\`\`\`\n\n| a | b |\n|---|---|\n| 1 | 2 |`}</Markdown>,
    ),
  );
  expect(container.querySelector("pre pre")).toBeNull();
  expect(container.querySelector("pre section")).toBeNull();
  expect(container.querySelector("script")).toBeNull();
  expect(
    container.querySelector(".code-block-scroll")?.getAttribute("tabindex"),
  ).toBe("0");
  expect(
    container.querySelector(".markdown-table")?.getAttribute("tabindex"),
  ).toBe("0");
  const button =
    container.querySelector<HTMLButtonElement>(".code-block button");
  if (!button) throw new Error("No code copy");
  await act(async () => button.click());
  expect(writeText).toHaveBeenCalledWith(code);
});
