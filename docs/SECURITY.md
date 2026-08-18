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
| Any shell command | Confirm |
| Exact file operation outside the workspace | Confirm |
| Approval-required action without an approval channel | Deny |

An outside-workspace approval applies only to the canonical path and operation
shown to the user. Forge does not silently turn it into permanent access to a
directory tree.

## Permission profiles

### `safe`

The default profile. Workspace reads are automatic. Workspace modifications and
shell commands require confirmation according to the table above.

### `workspace-write`

Workspace file tools may modify files automatically after the user selects this
profile. Shell commands and outside-workspace access remain separately
controlled.

### `full-access`

An explicit advanced mode with clear warnings. Enabling it is a user decision,
not something a project file or plugin may do silently.

## Filesystem boundary

Built-in file tools resolve canonical paths and symlinks before applying policy.
Paths inside the selected workspace can follow the active permission profile.
Paths outside it require explicit approval.

The policy applies to Forge file tools. It does not automatically constrain a
shell process that has already been approved.

## Shell boundary

Every shell command requires confirmation in the default profile. The approval
prompt must show at least:

- The exact command
- The working directory
- The timeout
- The requested environment changes, when relevant

Starting a process with its working directory inside the workspace does not stop
it from reading or writing elsewhere. Without an operating-system sandbox,
Forge cannot claim filesystem or network isolation for an approved shell
command.

## Network boundary

The initial runtime does not enforce network isolation. An approved shell
command or trusted plugin may access the network with the permissions of the
Forge process. The UI and documentation must not imply otherwise.

## Non-interactive operation

If an operation requires approval and no approval channel is available, Forge
denies the operation unless the user supplied a narrow approval before the run.
Non-interactive mode must never interpret silence as approval.

## Plugin trust

In-process TypeScript plugins are trusted local code. They can call Node.js APIs
directly and therefore may read files, start processes, or use the network
outside Forge's tool API.

Forge's plugin API prevents plugins from weakening core policy through supported
hooks, but this is not isolation from malicious plugin code. Project-local
plugins require an explicit project-trust decision before loading. Strong plugin
isolation requires a separate process or operating-system sandbox.

Project trust is keyed by the canonical workspace path and stored outside the
repository. A repository-controlled `.forge/` file cannot mark the project
trusted. Forge must not execute code from `.forge/plugins/` during discovery or
before the user makes that trust decision.

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
