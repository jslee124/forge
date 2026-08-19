# Trusted Plugin API

Forge v0.2 works without plugins. Plugins are optional in-process JavaScript
modules for custom tools, commands, prompt instructions, event observers, and
policy restrictions.

## Security boundary

Loading a plugin executes local code with the full privileges of the Forge
process. A plugin can import Node.js modules, read arbitrary files, start
processes, and use the network. Manifest capabilities document intent and gate
Forge API registration methods, but they are not an OS sandbox.

User plugins load only when their names appear in user configuration. Project
plugins are never imported until the canonical workspace is explicitly trusted.
Trust is stored in `FORGE_HOME/plugin-trust.json`, outside the repository.

```bash
forge plugins list
forge plugins trust
# For an explicit non-interactive decision:
forge plugins trust --yes
forge plugins untrust
```

Discovery reads `plugin.json` only. It does not import an entry, install
dependencies, or run package-manager lifecycle scripts. Starting from a
repository subdirectory resolves the same canonical workspace plugin directory
and trust record as starting at its root.

## Locations and enablement

User plugins live under:

```text
FORGE_HOME/plugins/<plugin-name>/
```

Enable them only in the user-level `FORGE_HOME/config.json`:

```json
{
  "schemaVersion": 1,
  "plugins": {
    "enabled": ["custom-tool"]
  }
}
```

Project configuration cannot set `plugins.enabled`. Project plugins live only
under `<workspace-root>/.forge/plugins/<plugin-name>/` and all discovered
project plugins become loadable only after the workspace trust decision. Forge
does not scan nested or ancestor plugin directories.

## Manifest version 1

Every plugin directory contains a strict `plugin.json`:

```json
{
  "schemaVersion": 1,
  "apiVersion": "1",
  "name": "custom-tool",
  "version": "1.0.0",
  "entry": "./index.mjs",
  "capabilities": ["tools:register", "commands:register"]
}
```

- The directory name must equal `name`.
- `entry` must resolve inside the plugin directory and be `.js`, `.mjs`, or
  `.cjs`.
- Forge rejects unsupported API versions before importing plugin code.
- Supported capabilities are `tools:register`, `commands:register`,
  `events:observe`, `prompt:contribute`, and `policy:restrict`.
- A plugin cannot use a registration API it did not declare.

The entry exports either `default` or a named `activate` function. Forge passes
an immutable API object and Zod as `api.z`, so a simple plugin needs no package
installation:

```js
export default function activate(api) {
  api.registerTool({
    name: "count_text",
    description: "Count characters in supplied text.",
    risk: "read",
    inputSchema: api.z.object({ text: api.z.string() }).strict(),
    execute: async ({ text }) => ({
      ok: true,
      output: { characters: text.length },
      truncated: false
    })
  });
}
```

See [`examples/plugins/custom-tool`](../examples/plugins/custom-tool) for a
custom tool plus command and
[`examples/plugins/stricter-policy`](../examples/plugins/stricter-policy) for a
policy hook.

## Extension points

### Tools

`api.registerTool(tool)` uses the same `ForgeTool` contract as built-ins.
Names must be unique. Model calls to plugin tools pass through the normal input
validation, core policy, approval, execution, run-event, and trace pipeline.
Declaring a risk affects Forge policy, but does not constrain what trusted code
can do directly.

### Commands

`api.registerCommand(command)` adds a trusted local command. Run it with:

```bash
forge plugins run <command-name> [args...]
```

Command output is explicit through `write` and `writeError`. Plugin commands
are direct trusted-code entry points; they are not model tool calls and do not
pass through tool approval.

### Prompt contributions

`api.contributePrompt(hook)` receives an immutable snapshot containing the user
prompt, canonical workspace root, and working directory. A returned string is
bounded to 32 KiB, labelled with its manifest path, and added to the effective
instruction context and run trace provenance.

### Run-event observers

`api.observeRunEvents(observer)` receives a deeply frozen structured clone of
each run event. Observers cannot mutate runtime history. Observer failures are
reported as plugin warnings and do not replace the trace or run result.

### Policy restrictions

`api.restrictPolicy(hook)` receives a frozen action snapshot and may return only
`confirm`, `deny`, or no contribution. Forge computes the strictest result:

```text
deny > confirm > allow
```

Core policy is evaluated first. A core denial returns immediately, and plugin
APIs expose no way to replace the policy kernel, approve an action, or turn a
core confirmation into an allow.

## Portable project skills

Forge discovers Markdown skills only at:

```text
<workspace-root>/.agents/skills/<skill-name>/SKILL.md
```

Discovery never executes a skill. A skill is selected for a run only when the
prompt explicitly contains `$skill-name`. Selected content is limited to 32 KiB
and its path is recorded in the run context. Any scripts or actions described by
a skill still require normal model tool calls, policy decisions, approvals, and
trace events.

## Deliberate limitations

v0.2 has no plugin installer, dependency installation, hot reload, UI
replacement, isolated plugin process, or enforceable network/filesystem
capabilities. Use only code you trust and review manifests and entries before
enabling or trusting them.
