export function operationError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return (
    [
      "recovery-stale",
      "recovery-native-only",
      "recovery-source-active",
      "recovery-original-unavailable",
      "recovery-prompt-too-large",
      "recovery-select-source",
      "workspace-unavailable",
      "workspace-changed",
      "auto-workspace-boundary",
      "session-busy",
      "session-conflict",
      "session-storage-failed",
      "configuration-invalid",
      "outside-workspace",
      "outside_workspace",
      "already-exists",
      "limit_reached",
      "io_error",
      "source-changed",
      "web-settings-invalid",
      "web-bundle-unavailable",
      "web-plugin-exists",
      "web-plugin-missing",
    ].find((code) => message.includes(code)) ?? "management-failed"
  );
}
