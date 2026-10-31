/// <reference lib="dom" />
// @vitest-environment jsdom
import { expect, it } from "vitest";
import {
  captureConversation,
  restoreConversation,
} from "./conversation-view.js";

it("restores separate transcript/panel positions and namespaces historical disclosures", () => {
  const root = document.createElement("div");
  root.innerHTML =
    '<div class="live-transcript"></div><details data-view-disclosure="activity" open></details><aside class="live-panel"><div class="studio-panel-body"><div data-history-run="old-run"><details data-view-disclosure="activity" open></details></div></div></aside>';
  const transcript = root.querySelector(".live-transcript");
  const panel = root.querySelector(".studio-panel-body");
  if (!transcript || !panel) throw new Error("Missing regions");
  transcript.scrollTop = 220;
  panel.scrollTop = 90;
  const saved = captureConversation(root, true, "context", "old-run");
  for (const details of root.querySelectorAll("details")) details.open = false;
  transcript.scrollTop = 0;
  panel.scrollTop = 0;
  restoreConversation(root, saved);
  expect(transcript.scrollTop).toBe(220);
  expect(panel.scrollTop).toBe(90);
  expect(root.querySelectorAll("details[open]")).toHaveLength(2);
  restoreConversation(root, { ...saved, expanded: ["main:activity"] });
  expect(root.querySelectorAll("details[open]")).toHaveLength(1);
  expect(root.querySelector(".live-panel details")?.hasAttribute("open")).toBe(
    false,
  );
});
