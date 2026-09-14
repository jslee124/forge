import { useSyncExternalStore } from "react";

export type ThemeMode = "system" | "light" | "dark";
const storageKey = "forge.desktop.theme";
const media = window.matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set<() => void>();
export function parseTheme(value: string | null): ThemeMode {
  return value === "light" || value === "dark" ? value : "system";
}
function readPreference(): ThemeMode {
  try {
    return parseTheme(localStorage.getItem(storageKey));
  } catch {
    return "system";
  }
}
let mode = readPreference();
let resolved = "light";
function apply() {
  resolved = mode === "system" ? (media.matches ? "dark" : "light") : mode;
  document.documentElement.setAttribute("data-theme", resolved);
  document.documentElement.style.colorScheme = resolved;
  for (const listener of listeners) listener();
}
export function setTheme(value: ThemeMode) {
  mode = value;
  try {
    localStorage.setItem(storageKey, value);
  } catch {
    /* Keep the in-memory preference when storage is unavailable. */
  }
  apply();
}
media.addEventListener("change", apply);
window.addEventListener("storage", (event) => {
  if (event.key === storageKey || event.key === null) {
    mode = readPreference();
    apply();
  }
});
apply();
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function useTheme() {
  const snapshot = useSyncExternalStore(subscribe, () => `${mode}:${resolved}`);
  const [preference, appearance] = snapshot.split(":");
  return { mode: preference as ThemeMode, resolved: appearance, setTheme };
}
