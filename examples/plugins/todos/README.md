# To-do plugin example

This example registers a provider-neutral `todo` tool plus a small prompt
contribution. The model can list, add, update, remove, and clear items while
Forge keeps normal tool validation, policy, event, and trace handling.

Copy this directory to `.forge/plugins/todos` and trust the workspace. The list
is intentionally in memory: it survives multiple turns in one Forge process,
but it is not durable session state, does not render a custom TUI panel, and is
not shared across processes. Those features would require a session storage/UI
extension API rather than the current tool-only plugin seam.
