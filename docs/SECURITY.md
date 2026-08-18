# Security Model

## Status

This document defines Forge's intended security model. Until a feature is
implemented and tested, it is a design target rather than a security guarantee.

## Principle

Forge is safe by default, but approval is not the same as isolation. The product
must state which boundaries it enforces and which risks remain with the user.

## Default decisions

| Action | Default decision |
| --- | --- |
| Read, list, or search inside the workspace | Allow |
| First patch inside the workspace | Confirm |
| Later patches covered by the session approval | Allow |
| Any process command | Confirm |
| Built-in file operation outside the workspace | Deny in v0.1 |
| Approval-required action without an approval channel | Deny |

Narrow outside-workspace approvals are a possible later feature. They are not
part of v0.1, so a repository task cannot expand Forge's file-tool boundary by
asking the user for an exception.

## Permission profiles

### `safe`

The default profile. Workspace reads are automatic. Workspace modifications and
process commands require confirmation according to the table above.

### `workspace-write`

Workspace file tools may modify files automatically after the user selects this
profile. Process commands still require confirmation, and outside-workspace
file access remains denied in v0.1.

### `full-access`

Deferred until after v0.1. A future explicit advanced mode would require clear
warnings and a user decision; a project file or plugin could never enable it
silently. Forge will not expose a profile whose name implies isolation it does
not provide.

## Configuration boundary

Forge treats `~/.forge/config.json` as user-controlled configuration. Project
`.forge/config.json` may override ordinary project behavior but cannot set a
less restrictive permission profile, mark the project trusted, suppress a
mandatory approval, increase a user-defined safety limit, or enable a plugin
from an untrusted project.

API keys, OAuth credentials, and other secrets are invalid in both user and
project configuration. User configuration may reference a provider or
credential name, while the secret value comes from an environment variable or
the operating-system credential store.

Forge must validate configuration before loading plugins or starting a run. It
should warn when user configuration or user-plugin directories have unsafe
filesystem permissions on platforms where that check is meaningful.

## Filesystem boundary

Built-in file tools resolve canonical paths and symlinks before applying policy.
Paths inside the selected workspace can follow the active permission profile.
Paths outside it are denied in v0.1.

The policy applies to Forge file tools. It does not automatically constrain a
child process that has already been approved.

## Process boundary

The v0.1 `run_command` tool accepts a program and an argument array and starts it
with Node.js `spawn` using `shell: false`. Shell syntax such as pipelines,
redirection, command substitution, and compound commands is not accepted.

Every process command requires confirmation in the default profile. The
approval prompt must show at least:

- The exact program and individually quoted arguments
- The working directory
- The timeout
- The requested environment changes, when relevant

Starting a process with its working directory inside the workspace does not stop
it from reading or writing elsewhere. Without an operating-system sandbox,
Forge cannot claim filesystem or network isolation for an approved child
process. `shell: false` stops Forge itself from parsing shell expressions; it
does not prevent an approved program, such as a package manager, from starting
other processes or interpreting its own scripts.

## Network boundary

The initial runtime does not enforce network isolation. An approved process
command or trusted plugin may access the network with the permissions of the
Forge process. The UI and documentation must not imply otherwise.

## Non-interactive operation

If an operation requires approval and no approval channel is available, Forge
denies the operation unless the user supplied a narrow approval before the run.
Non-interactive mode must never interpret silence as approval.

The evaluation harness may provide an approval channel that approves only the
exact program, arguments, working directory, and timeout declared by a fixture.
It is test infrastructure, not a general bypass.

## Plugin trust

In-process TypeScript plugins are trusted local code. They can call Node.js APIs
directly and therefore may read files, start processes, or use the network
outside Forge's tool API.

Forge's plugin API prevents plugins from weakening core policy through supported
hooks, but this is not isolation from malicious plugin code. Project-local
plugins require an explicit project-trust decision before loading. Strong plugin
isolation requires a separate process or operating-system sandbox.

Project trust is keyed by the canonical workspace path and stored outside the
repository under the user-level Forge home. A repository-controlled `.forge/`
file cannot mark the project trusted. Forge must not execute code from
`.forge/plugins/` during discovery or before the user makes that trust decision.

## Repository-provided instructions

`AGENTS.md`, `.agents/`, and non-executable `.forge/` configuration are
repository-controlled input. They may influence the model and therefore may
contain prompt injection, but they cannot approve tool calls, enable
`full-access`, or weaken a core policy decision.

Skills and configuration are not executed merely because they are discovered.
Any referenced script or requested action still passes through the normal tool,
approval, and trace pipeline. Forge records the source paths of loaded
instructions and selected skills so the user can inspect the effective context.

## Reasoning visibility

Reasoning or thinking content returned by the model provider is visible to the
user by default. Forge must identify it as provider-supplied content and must not
claim access to reasoning that the provider did not return.

Reasoning content may contain repository data or other sensitive information.
Trace persistence and export must use the same redaction policy as model and
tool events.

## Credential handling

API keys, access tokens, refresh tokens, authorization codes, and PKCE verifiers
are secrets. They must never appear in prompts, traces, terminal debug output,
plugin events, crash reports, or repository files.

Forge should prefer the operating-system credential store. A file fallback must
be explicit, stored outside the project, written atomically with owner-only
permissions, and documented as sensitive plaintext storage.

OAuth token refresh must be single-flight so concurrent model requests do not
race to rotate the same refresh token. Logout clears Forge-owned credentials.
Forge must not silently import or modify another application's credential file.

## Out of scope for v0.1

- A hardened operating-system sandbox
- Guaranteed network isolation
- Isolation from malicious trusted plugins
- Reliable prevention of prompt injection
- Protection after the user explicitly approves a harmful command
- Treating another application's private OAuth integration as a stable public API
- Built-in file access outside the selected workspace
- Shell-language execution and compound shell commands
