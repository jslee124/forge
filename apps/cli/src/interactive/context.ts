import type { ContextStatus } from "../persistent-session.js";

export interface ContextModeChoice {
  readonly kind: "session" | "default";
  readonly mode: "manual" | "automatic";
  readonly label: string;
}

export function contextModeChoices(
  status: ContextStatus,
): readonly ContextModeChoice[] {
  return [
    {
      kind: "session",
      mode: "manual",
      label: "Manual · ask before compacting",
    },
    {
      kind: "session",
      mode: "automatic",
      label:
        status.pressure.mode === "paused"
          ? "Automatic · resume for this session"
          : "Automatic · compact when needed",
    },
    {
      kind: "default",
      mode: "manual",
      label: "Save Manual as user default",
    },
    {
      kind: "default",
      mode: "automatic",
      label: "Save Automatic as user default",
    },
  ];
}

export function contextRing(ratio: number): "○" | "◔" | "◑" | "◕" | "●" {
  return ratio >= 0.9
    ? "●"
    : ratio >= 0.75
      ? "◕"
      : ratio >= 0.5
        ? "◑"
        : ratio >= 0.25
          ? "◔"
          : "○";
}

export function formatContextIndicator(
  status: ContextStatus,
  width: number,
  stateOverride?: ContextStatus["pressure"]["state"],
): string {
  const ratio = status.pressure.ratio;
  const value =
    status.pressure.confidence === "unavailable"
      ? "?"
      : `${status.pressure.confidence === "exact" ? "" : "~"}${Math.round(ratio * 100)}%`;
  const compact = `${contextRing(ratio)} ${value}`;
  if (width < 48) return contextRing(ratio);
  if (width < 72) return compact;
  const effectiveState = stateOverride ?? status.pressure.state;
  const state =
    effectiveState === "compact-soon"
      ? "compact soon"
      : effectiveState === "compacting"
        ? "compacting"
        : effectiveState === "compacted"
          ? "compacted"
          : effectiveState === "paused"
            ? "auto paused"
            : status.pressure.mode === "automatic-session" ||
                status.pressure.mode === "automatic-default"
              ? "context · automatic"
              : "context · manual";
  return `${compact} ${state}`;
}

export function contextPressureColor(
  ratio: number,
): "green" | "yellow" | "red" {
  return ratio >= 0.9 ? "red" : ratio >= 0.75 ? "yellow" : "green";
}
