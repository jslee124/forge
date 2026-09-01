# Forge plugin API reference

This reference is version-matched to Forge 0.3.4 and plugin API version `"1"`.
The runtime schema and types remain authoritative when they are present.

## Manifest

`plugin.json` is strict. It requires `schemaVersion: 1`, `apiVersion: "1"`, a
lowercase kebab-case `name` of 1–64 characters matching the directory, a
non-empty `version`, a relative in-directory `.js`/`.mjs`/`.cjs` `entry`, and a
bounded `capabilities` array.

Capabilities are `tools:register`, `commands:register`, `prompt:contribute`,
`subagents:register`, `events:observe`, `policy:restrict`, and
`network:access`. Registration methods require their matching declaration.
Network-risk tools also require `network:access`.

## Activation API

Export `default` or named `activate`. The frozen API exposes `apiVersion`, `z`,
`registerTool`, `registerCommand`, `registerSubagent`, `contributePrompt`,
`observeRunEvents`, and `restrictPolicy`.

Tool names use lower snake case and match `^[a-z][a-z0-9_]{0,63}$`. Command and
subagent names use lowercase kebab-case. Built-in tool names such as
`list_files`, `read_file`, `search`, `edit_file`, legacy-reserved
`create_file`/`apply_patch`,
`run_command`, and `load_skill` are reserved.

Tool risks are `read`, `write`, `process`, `network`, and `model`. The active
policy and approval channel decide execution. A policy hook may only tighten a
decision to `confirm` or `deny`; it cannot grant `allow`.

User plugins require their name in `$FORGE_HOME/config.json` under
`plugins.enabled`. Project plugins require `forge plugins trust` for the
canonical workspace. Capabilities are review/API gates, not an OS sandbox:
trusted plugin JavaScript runs in-process with Forge's local privileges.
