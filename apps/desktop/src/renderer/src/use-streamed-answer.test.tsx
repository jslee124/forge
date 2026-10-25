/// <reference lib="dom" />
// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useStreamedAnswer } from "./use-streamed-answer.js";

let pending: Map<number, FrameRequestCallback>;
let serial = 0;
let current: ReturnType<typeof useStreamedAnswer>;
let root: ReturnType<typeof createRoot>;
let element: HTMLDivElement;
function Probe() {
  current = useStreamedAnswer();
  return createElement("div", null, current.answer);
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  pending = new Map();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = ++serial;
    pending.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => pending.delete(id));
  element = document.createElement("div");
  root = createRoot(element);
  await act(async () => root.render(createElement(Probe)));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
it("coalesces chunks into one frame and flushes the terminal chunk without waiting", async () => {
  await act(async () => {
    current.append("first ");
    current.append("second");
  });
  expect(pending.size).toBe(1);
  expect(element.textContent).toBe("");
  const callback = [...pending.values()][0];
  if (!callback) throw new Error("No frame");
  await act(async () => callback(0));
  expect(element.textContent).toBe("first second");
  await act(async () => {
    current.append(" terminal");
    expect(current.flush()).toBe("first second terminal");
  });
  expect(element.textContent).toBe("first second terminal");
  expect(pending.size).toBe(0);
});
it("rejects stale frames after a new run and discloses bounded preview omissions", async () => {
  await act(async () => current.append("old run"));
  const stale = [...pending.values()][0];
  if (!stale) throw new Error("No frame");
  await act(async () => {
    current.reset();
    current.append("new run");
    stale(0);
  });
  expect(element.textContent).toBe("");
  await act(async () => current.flush());
  expect(element.textContent).toBe("new run");
  await act(async () => {
    current.reset();
    current.append("x".repeat(1_000_000));
    current.append("end");
    current.flush();
  });
  expect(current.answer).toHaveLength(1_000_000);
  expect(current.answer.endsWith("end")).toBe(true);
  expect(current.omittedCharacters).toBe(3);
});
