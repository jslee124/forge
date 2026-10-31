import type { ProductActivityItem } from "@forge/application";
import type { RunEvent } from "../../shared/run-protocol.js";

export type ActivityItem = ProductActivityItem;
export interface ActivityState {
  readonly items: readonly ActivityItem[];
  readonly omitted: number;
}
export const initialActivity: ActivityState = { items: [], omitted: 0 };
const MAX_ITEMS = 500;
const MAX_TEXT = 65_536;
type ActivityInput = { type: "reset" } | { type: "event"; event: RunEvent };

export function activityReducer(
  state: ActivityState,
  input: ActivityInput,
): ActivityState {
  if (input.type === "reset") return initialActivity;
  const { payload, sequence } = input.event;
  let items = state.items;
  if (payload.type === "detail") {
    const previous = items.at(-1);
    if (
      payload.kind === "reasoning" &&
      previous?.kind === "reasoning" &&
      previous.step === payload.step
    ) {
      const text = previous.text + payload.text;
      items = [
        ...items.slice(0, -1),
        {
          ...previous,
          text: text.slice(0, MAX_TEXT),
          truncated: previous.truncated || text.length > MAX_TEXT,
        },
      ];
    } else {
      items = [
        ...items,
        {
          id: `detail-${sequence}`,
          kind: payload.kind,
          text: payload.text.slice(0, MAX_TEXT),
          truncated: payload.text.length > MAX_TEXT,
          ...(payload.step ? { step: payload.step } : {}),
        },
      ];
    }
  } else if (payload.type === "action") {
    const id = `action-${payload.action.actionId}`;
    const { facts: _facts, ...activityAction } = payload.action;
    const item: ActivityItem = {
      id,
      kind: "action",
      text: "",
      action: activityAction,
      truncated: Boolean(payload.action.truncated),
    };
    items = items.some((entry) => entry.id === id)
      ? items.map((entry) => (entry.id === id ? item : entry))
      : [...items, item];
  } else if (payload.type === "approval") {
    items = [
      ...items,
      {
        id: `approval-${payload.approvalId}`,
        kind: "approval",
        text: payload.description.slice(0, MAX_TEXT),
        truncated: payload.description.length > MAX_TEXT,
        decision: "pending",
      },
    ];
  } else if (payload.type === "approval-resolved") {
    items = items.map((item) =>
      item.id === `approval-${payload.approvalId}`
        ? { ...item, decision: payload.allow ? "allowed" : "denied" }
        : item,
    );
  } else return state;
  return {
    items: items.slice(-MAX_ITEMS),
    omitted: state.omitted + Math.max(0, items.length - MAX_ITEMS),
  };
}
