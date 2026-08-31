# Security Model

简体中文 · Documentation index

## Status

This document defines Forge's implemented security model through v0.3.3,
including Milestones 10-14.
Built-in tools stay inside the selected workspace, every valid tool action
passes through a policy decision, and approval-required actions are denied when
no approval channel is available. The `safe` and `workspace-write` permission
profiles are implemented. Persisted sessions restore completed conversation
only, and every resumed run receives fresh policy and approval state;
`full-access` remains deferred.

Context checkpoints are derived, untrusted conversation memory. They cannot
carry approvals, trust decisions, permission profiles, or current verification
status. Fresh instructions and the current request remain mandatory; the
canonical transcript is retained separately. Provider-native opaque context is
treated as sensitive state and is never exposed to plugin observers or ordinary
trace payloads.

## Principle

Forge is safe by default, but approval is not the same as isolation. The product
must state which boundaries it enforces and which risks remain with the user.

## Default decisions

| Action | Default decision |
| --- | --- |
| Read, list, or search inside the workspace | Allow |
| First write inside the workspace | Confirm |
| Later writes covered by the run approval | Allow |
| Any process command | Confirm |
| Any registered network tool | Confirm |
| Any delegated subagent model run | Confirm |
| Built-in file operation outside the workspace | Deny (current boundary) |
| Approval-required action without an approval channel | Deny |

Narrow outside-workspace approvals are a possible later feature. They are not
implemented, so a repository task cannot expand Forge's file-tool boundary by
asking the user for an exception.

## Permission profiles

### `safe`

The default profile. Workspace reads are automatic. Workspace modifications,
process commands, registered network tools, and delegated subagent model runs
require confirmation according to the table above.

### `workspace-write`

Workspace file tools may modify files automatically after the user selects this
profile. Process commands, registered network tools, and delegated subagent
model runs still require confirmation, and outside-workspace file access
remains denied.

### `full-access`

Still deferred. A future explicit advanced mode would require clear
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
Forge's owner-readable credential file. ChatGPT subscription credentials stay
inside Codex App Server's credential boundary.

Forge must validate configuration before loading plugins or starting a run. It
should warn when user configuration or user-plugin directories have unsafe
filesystem permissions on platforms where that check is meaningful.

## Filesystem boundary

Current model requests use one `edit_file` write tool. `create` uses exclusive
creation and cannot replace an existing path; `replace` keeps exact unique-text
and pre-commit re-read checks; `rewrite` requires the SHA-256 from a complete
prior `read_file` and checks it before preview and commit. A truncated read
cannot authorize rewrite. All operations still pass through the ordinary write
policy, bounded diff preview, and approval path.

Built-in file tools resolve canonical paths and symlinks before applying policy.
Paths inside the selected workspace can follow the active permission profile.
Paths outside it are denied.

Local image attachments are a separate, user-authorized input capability.
Forge accepts an outside-workspace path only when the user explicitly supplies
it with `--image`, pastes or drags it into the interactive composer, or selects
an in-workspace `@` mention. Forge never infers attachments from ordinary
prompt prose, repository content, or model output. The model's filesystem tools
remain workspace-confined.

Before encoding a local attachment, Forge resolves its canonical path, requires
a regular readable file, validates JPEG/PNG/GIF/WebP magic bytes, and enforces
per-image, combined-size, and count limits. User-supplied HTTP(S) image URLs are
sent to the selected provider for retrieval; Forge does not fetch them itself.
Session snapshots and ordinary run events do not persist base64 image bytes.

The policy applies to Forge file tools. It does not automatically constrain a
child process that has already been approved.

## Process boundary

Interactive approval is structured: `1` allows once, `2` creates only the
displayed in-memory session scope, and `3` denies with optional bounded
feedback. Command scopes bind the exact program and argument array, canonical
workspace and cwd, and a timeout ceiling. Workspace-write, network
tool/destination, and delegated-model scopes use similarly normalized host
fields rather than model-authored text. `/permissions` lists use counts and can
revoke one or all grants.

Session grants are never serialized or restored. Changed arguments, cwd,
destination, workspace, or a timeout above the ceiling re-prompts. Destructive,
credential-sensitive, install, publish, and broad external-effect commands are
not eligible for reuse. Plugin policy hooks can still change `allow` to
`confirm`/`deny` or `confirm` to `deny`; they cannot create or widen a grant.

The current `run_command` tool accepts a program and an argument array and starts it
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

The runtime distinguishes registered network tools from workspace reads. A
plugin must declare `network:access` before registering a `network`-risk tool,
and every such model call requires confirmation under both `safe` and
`workspace-write`. Non-interactive runs deny it when no approval channel is
available.

The checked-in `web-tools` example additionally restricts protocols and ports,
checks initial and redirect host addresses, blocks local/private/reserved
ranges, accepts readable MIME types only, and bounds redirects, time,
downloads, and retained output. Those checks reduce accidental SSRF and
resource exhaustion, but they cannot provide OS-level network isolation or
fully eliminate DNS rebinding between validation and connection.

An approved process command or trusted plugin code may still access the network
directly with the permissions of the Forge process. Manifest capabilities gate
Forge registration APIs; they do not constrain arbitrary Node.js calls. The UI
and documentation must not imply otherwise.

## Delegated model runs

Subagent tools use the separate `model` risk and require confirmation on every
call, including under `workspace-write`, because they incur another model run.
The approval view shows the generated tool name and delegated task. The host
creates the child adapter and never exposes credentials to the plugin.

Children inherit the effective parent policy and approval channel, receive only
declared non-subagent tools, share bounded run/step/tool budgets, use the same
workspace and abort signal, and return bounded output. Recursive delegation is
not available. With tracing enabled, child events are stored in a separate
trace linked by `parentRunId` and `subagentName`; the parent tool result records
the child run ID. This is runtime containment, not provider or OS isolation.

## Non-interactive operation

If an operation requires approval and no approval channel is available, Forge
denies the operation unless the user supplied a narrow approval before the run.
Non-interactive mode must never interpret silence as approval.

The evaluation harness may provide an approval channel that approves only the
exact program, arguments, working directory, and timeout declared by a fixture.
It is test infrastructure, not a general bypass.

## Plugin trust

In-process JavaScript plugins are trusted local code. They can call Node.js APIs
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
Skill discovery reads bounded metadata; `load_skill` accepts only registered
opaque IDs, revalidates canonical roots, non-symlink regular files, and the
discovered file identity, and returns bounded content. It does not widen the
workspace `read_file` boundary. Any referenced script or requested action still
passes through the normal tool, approval, and trace pipeline. Forge records
Skill discovery, source, selection reason, load rejection, and truncation so
the user can inspect the effective context.

## Reasoning visibility

Reasoning or thinking content returned by the model provider is visible to the
user by default. Forge must identify it as provider-supplied content and must not
claim access to reasoning that the provider did not return.

Reasoning content may contain repository data or other sensitive information.
Trace persistence and export must use the same redaction policy as model and
tool events.

## Persistent sessions

Resuming a session restores completed canonical conversation blocks, including
closed tool-call/result pairs, but never executable authority. Historical tool
output is untrusted context rather than current verification. Forge creates a
new policy instance for every resumed run and never restores prior approvals,
pending tool calls, child processes, or provider continuation metadata. Current
user configuration and project instructions are loaded again before the next
prompt.

Session snapshots and traces are stored outside the repository under
`FORGE_HOME`. They may contain repository text, diffs, commands, and model
output, so they are local sensitive data even after configured credentials are
redacted.

## Credential handling

DeepSeek/OpenAI API keys, access tokens, refresh tokens, authorization codes,
and PKCE verifiers
are secrets. They must never appear in prompts, traces, terminal debug output,
plugin events, crash reports, or repository files.

Forge currently resolves API keys from process environment variables first,
then from the explicit `$FORGE_HOME/auth.json` fallback. The fallback is stored
outside the project, written atomically, protected by directory mode `0700` and
file mode `0600`, and documented as sensitive plaintext storage rather than an
operating-system keychain. OS credential-store integration remains a preferred
future improvement.

Provider/model/reasoning selections are ordinary configuration and may be
saved under `FORGE_HOME`; credentials remain separate. Credential-shaped
fields and known secret values are redacted before traces and plugin observers
receive events.

OAuth token refresh must be single-flight so concurrent model requests do not
race to rotate the same refresh token. Logout clears Forge-owned credentials.
Forge must not silently import or modify another application's credential file.

For ChatGPT subscription access, Forge delegates OAuth and refresh to the
official Codex App Server. Forge sends account JSON-RPC requests but never reads
Codex's credential file or receives its tokens. This account is shared Codex
state, so the explicit `forge auth logout openai` command may also sign other
local Codex clients out.

Codex Engine security semantics are separate from the native Forge policy
kernel. Its `safe` profile maps to Codex read-only sandboxing. Users must select
`workspace-write` explicitly to let Codex modify the workspace. Codex tool
events do not pass through Forge's built-in/plugin tool policy or native JSONL
trace pipeline; the CLI labels this execution path rather than implying they do.

## Current limitations retained from the v0.1 boundary

- A hardened operating-system sandbox
- Guaranteed network isolation
- Isolation from malicious trusted plugins
- Reliable prevention of prompt injection
- Protection after the user explicitly approves a harmful command
- Treating another application's private OAuth integration as a stable public API
- Built-in file access outside the selected workspace
- Shell-language execution and compound shell commands

Packaged product documentation uses a separate allowlisted resource catalog. Search returns opaque, versioned document/section references; reads revalidate the file, content hash, package version, and output budget. The documentation tools reject arbitrary paths and do not widen workspace file access. Skill and documentation text remains untrusted and cannot grant permissions, expose secrets, or authorize commands.
