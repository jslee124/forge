# Plugin Model

## Goal

Forge should work out of the box with no plugins installed while allowing users
to add focused capabilities without modifying the core runtime.

The first external plugin API is planned for v0.2. The v0.1 architecture keeps
the extension boundary explicit so that it does not need to be retrofitted into
the agent loop later.

## Initial extension points

Trusted plugins may eventually:

- Register custom tools
- Register user commands
- Contribute prompt instructions
- Observe immutable run events
- Participate in selected lifecycle hooks
- Add policy contributions that make a decision stricter

The first version will not support arbitrary terminal UI replacement, hot
reload, automatic package installation, or overriding mandatory security
components.

## Policy precedence

Policy decisions form a strict ordering:

```text
deny > confirm > allow
```

The effective decision is the strictest decision produced by core policy, user
configuration, and plugin policy contributions. A plugin can request additional
confirmation or deny an action. It cannot turn a core `deny` into `confirm` or
`allow`.

All built-in and plugin tools use the same policy, execution, event, and trace
pipeline.

## Events versus hooks

### Run events

Run events are immutable observations. Plugins may subscribe to them for logs,
metrics, notifications, and integrations, but cannot change completed history.

### Lifecycle hooks

Lifecycle hooks are explicit customization points with narrow typed return
values. Forge will define which fields a hook may contribute or restrict rather
than exposing mutable runtime state.

## Trust model

### User plugins

Plugins explicitly installed or loaded by the user are treated as trusted local
code. Forge should display their source and requested capabilities during
installation when practical.

### Project plugins

Project-local plugins must not load until the user trusts the project. A trust
decision must use the canonical project path and must not be inferred from the
fact that the user opened the directory.

The planned project location is:

```text
<workspace-root>/.forge/plugins/<plugin-name>/
```

Forge resolves `<workspace-root>` once and does not recursively discover nested
or ancestor `.forge/plugins/` directories. It displays the manifest path and
declared capabilities before asking for trust. Trust state is stored outside the
repository, and an untrusted project plugin is skipped in non-interactive mode.

Discovery must not automatically install dependencies or run package-manager
lifecycle scripts. See [Project Context and Local
Customization](PROJECT_CONTEXT.md).

### In-process limitation

An in-process TypeScript plugin can import Node.js modules and execute arbitrary
local code. A manifest capability list improves review and user understanding,
but it is not an enforceable sandbox by itself.

Restricted third-party plugins require a future isolated process or OS-level
sandbox with a narrow RPC protocol.

## Illustrative manifest

The final schema is deferred. A future plugin might declare:

```json
{
  "name": "forge-github",
  "version": "0.1.0",
  "apiVersion": "1",
  "entry": "./src/index.ts",
  "permissions": [
    "tools:register",
    "workspace:read",
    "network:api.github.com"
  ]
}
```

For an in-process plugin, these permissions describe intent and support user
review. They do not replace the trust warning.

## Compatibility

The plugin API should be versioned separately from the Forge application. Forge
must reject an incompatible plugin with an actionable error instead of loading
it partially.
