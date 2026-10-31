/// <reference lib="dom" />
// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import "./i18n.js";
import { Transcript } from "./transcript.js";

let callbacks: Map<number, FrameRequestCallback>;
let resize: () => void;
let count = 0;
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  callbacks = new Map();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = ++count;
    callbacks.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => callbacks.delete(id));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function frame() {
  await act(async () => {
    const entries = [...callbacks.entries()];
    for (const [id, callback] of entries) {
      callbacks.delete(id);
      callback(0);
    }
  });
}
it("follows bottom, pauses on reading above, and resumes only on an explicit jump", async () => {
  await act(async () =>
    root.render(
      <StrictMode>
        <Transcript viewKey="A" live preservePosition={false} followRequest={0}>
          answer
        </Transcript>
      </StrictMode>,
    ),
  );
  const area = container.querySelector<HTMLElement>(".live-transcript");
  if (!area) throw new Error("No transcript");
  let height = 1000;
  let top = 0;
  Object.defineProperties(area, {
    scrollHeight: { get: () => height },
    clientHeight: { get: () => 200 },
    scrollTop: {
      get: () => top,
      set: (value: number) => {
        top = Math.max(0, Math.min(value, height - 200));
      },
    },
  });
  await frame();
  expect(top).toBe(800);
  height = 1200;
  resize();
  await frame();
  expect(top).toBe(1000);
  await act(async () => {
    area.dispatchEvent(
      new WheelEvent("wheel", { deltaY: -100, bubbles: true }),
    );
    area.scrollTop = 400;
    area.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  height = 1400;
  resize();
  await frame();
  expect(top).toBe(400);
  const jump = container.querySelector<HTMLButtonElement>(
    "[data-testid=jump-latest]",
  );
  if (!jump) throw new Error("No jump action");
  await act(async () => jump.click());
  expect(top).toBe(1200);
  expect(container.querySelector("[data-testid=jump-latest]")).toBeNull();
});
it("preserves a browsed position instead of treating a returning run as a new send", async () => {
  await act(async () =>
    root.render(
      <Transcript viewKey="A" live preservePosition followRequest={4}>
        answer
      </Transcript>,
    ),
  );
  const area = container.querySelector<HTMLElement>(".live-transcript");
  if (!area) throw new Error("No transcript");
  Object.defineProperties(area, {
    scrollHeight: { value: 1000 },
    clientHeight: { value: 200 },
  });
  area.scrollTop = 120;
  await frame();
  expect(area.scrollTop).toBe(120);
  expect(container.querySelector("[data-testid=jump-latest]")).not.toBeNull();
});
