---
name: forge-plugin-creator
description: Create, modify, validate or troubleshoot specifically Forge plugins and their plugin.json/API integration. Not for arbitrary workspace tools, functions, request call paths or generic manifests. 用于 Forge 插件及其 API 接入，不用于普通工作区工具、函数、请求调用链或通用清单调查。
---

# Forge plugin creator

Use this workflow for Forge plugin work. This Skill is instruction text, not a
plugin: it is never imported or executed and grants no filesystem, process,
network, model, or approval capability. A generated plugin is trusted
in-process JavaScript with the local privileges of Forge, so activation and
trust must remain explicit.

The presence of a `tools/` directory, a function called `tool`, a command or a
generic manifest does not establish that the workspace implements a Forge plugin.
For a request to explain workspace code, inspect the relevant source first and
follow only dependencies needed for the requested answer. Do not inspect Forge's
plugin API or templates unless actual Forge plugin integration is in scope.

## Required inspection

Before generating or changing code:

1. Inspect the active `plugin.json` schema in
   `packages/plugin-api/src/schema.ts`, the API types in
   `packages/plugin-api/src/types.ts`, and `PLUGIN_API_VERSION` when working in
   the Forge repository.
2. Inspect the nearest maintained example under `examples/plugins/` that uses
   the requested extension point.
3. Outside the Forge repository, load the registered
   `references/plugin-api.md` resource supplied with this Skill. Treat its
   version as matching the installed CLI.
4. Load a registered template only as a starting point. Adapt it to the task;
   do not copy capabilities or risks that are not needed.

Do not claim an API, capability, or hook exists without one of those sources.

## Workflow

1. Choose the scope: user plugins live at
   `$FORGE_HOME/plugins/<name>/`; project plugins live at
   `<workspace>/.forge/plugins/<name>/` and require canonical project trust.
2. Create a strict manifest and dependency-free `.mjs` entry when practical.
   The manifest name must equal its directory name.
3. Declare only the capabilities actually used. A network-risk tool also
   requires `network:access`.
4. Give every model-callable input a strict, bounded schema and label its real
   external effect: `read`, `write`, `process`, `network`, or `model`.
5. Keep tool execution inside Forge's proposal, schema validation, policy,
   approval, execution, result, event, and trace path. Never perform the work
   from a prompt hook or observer to evade that path.
6. Add focused tests that activate through the real plugin host when the Forge
   repository is available. Test invalid input and capability/trust boundaries,
   not only the success path.
7. Document enablement or `forge plugins trust`; never silently edit trust
   state or imply that repository content is trusted merely because a Skill
   selected it.

## Completion gate

Before reporting completion, validate all of the following:

- plugin and directory names are lowercase kebab-case and match;
- the entry is relative, stays inside the plugin directory, exists, and is
  `.js`, `.mjs`, or `.cjs`;
- `schemaVersion`, `apiVersion`, capabilities, hook usage, and risk labels
  match the inspected runtime;
- tool and command names are valid and do not collide with built-ins or other
  loaded plugins;
- project code is not loaded until the canonical workspace is trusted;
- plugin results are bounded and do not expose credentials;
- `pnpm build`, `pnpm typecheck`, focused plugin tests, and
  `pnpm check:docs` pass in the Forge repository, without paid model calls.

If a requested validation cannot run outside the Forge repository, say exactly
which installed-CLI checks were performed and which repository checks remain.
