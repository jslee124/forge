import { Text } from "ink";
import type React from "react";

import type { EditorState } from "../interactive-model.js";

export function PromptWithCursor({
  state,
  active,
}: {
  readonly state: EditorState;
  readonly active: boolean;
}): React.JSX.Element {
  if (!active)
    return <Text dimColor>{state.value || "Waiting for the agent…"}</Text>;
  const before = state.value.slice(0, state.cursor);
  const character = state.value.slice(state.cursor, nextCursor(state));
  const after = state.value.slice(state.cursor + character.length);
  return (
    <Text>
      {before}
      <Text inverse>{character || " "}</Text>
      {after}
    </Text>
  );
}

export function previousCursor(state: EditorState): number {
  if (state.cursor <= 0) return 0;
  const characters = Array.from(state.value.slice(0, state.cursor));
  return state.cursor - (characters.at(-1)?.length ?? 0);
}

export function nextCursor(state: EditorState): number {
  if (state.cursor >= state.value.length) return state.value.length;
  return (
    state.cursor + (Array.from(state.value.slice(state.cursor))[0]?.length ?? 0)
  );
}
