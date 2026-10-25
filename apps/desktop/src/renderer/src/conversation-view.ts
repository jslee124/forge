export interface ConversationPosition {
  scrollTop: number;
  panelScrollTop: number;
  expanded: string[];
  panel: boolean;
  tab: string;
  runId?: string;
}
function disclosureKey(element: HTMLDetailsElement) {
  const scope =
    element
      .closest<HTMLElement>("[data-history-run]")
      ?.getAttribute("data-history-run") ??
    (element.closest(".live-panel") ? "panel" : "main");
  return `${scope}:${element.getAttribute("data-view-disclosure")}`;
}
export function captureConversation(
  root: HTMLElement,
  panel: boolean,
  tab: string,
  runId?: string,
): ConversationPosition {
  return {
    scrollTop: root.querySelector(".live-transcript")?.scrollTop ?? 0,
    panelScrollTop:
      root.querySelector(".studio-panel-body:not([hidden])")?.scrollTop ?? 0,
    expanded: [
      ...root.querySelectorAll<HTMLDetailsElement>(
        "details[data-view-disclosure][open]",
      ),
    ].map(disclosureKey),
    panel,
    tab,
    ...(runId ? { runId } : {}),
  };
}
export function restoreConversation(
  root: HTMLElement,
  position: ConversationPosition,
) {
  const expanded = new Set(position.expanded);
  for (const element of root.querySelectorAll<HTMLDetailsElement>(
    "details[data-view-disclosure]",
  ))
    element.open = expanded.has(disclosureKey(element));
  restoreConversationScroll(root, position);
}
export function restoreConversationScroll(
  root: HTMLElement,
  position: ConversationPosition,
) {
  const transcript = root.querySelector(".live-transcript");
  if (transcript) transcript.scrollTop = position.scrollTop;
  const panel = root.querySelector(".studio-panel-body:not([hidden])");
  if (panel) panel.scrollTop = position.panelScrollTop;
}
