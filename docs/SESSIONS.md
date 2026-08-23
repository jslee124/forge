# Persistent Sessions and Run Traces

[简体中文](zh-CN/SESSIONS.md) · [Documentation index](zh-CN/README.md)

## Goal

Forge persists enough trusted metadata and completed conversation history to
continue an interactive chat after the process exits. This is deliberately
separate from replaying an in-progress tool call.

The core relationship is:

```text
Session
|-- completed user/assistant turns
|-- provider-exposed reasoning summaries for completed assistant turns
|-- optional derived context checkpoint
|-- workspace and working-directory metadata
`-- Run 1 -> events.jsonl
    Run 2 -> events.jsonl
    Run 3 -> events.jsonl
```

A **session** is the user-facing conversation selected by `forge resume` or
`/resume`. A **run** is one bounded agent-loop execution for one submitted
prompt. Resuming a session creates a new run inside that session.

## Storage layout

Milestone 6 uses transparent local files rather than a database:

```text
$FORGE_HOME/
|-- sessions/
|   `-- <session-id>.json
`-- runs/
    `-- <run-id>.jsonl
```

Session snapshots use `schemaVersion: 2`; v1 snapshots migrate on load. Trace
envelopes retain `schemaVersion: 1`. Files are written only under the resolved
Forge home. Session snapshots are replaced atomically. Run traces are append-only
while their run is active.

Each session stores:

- Session ID, creation time, and last-updated time
- Canonical workspace root and the saved working directory
- Completed user and assistant messages
- Provider-exposed reasoning text associated with completed assistant messages
- The ordered run IDs belonging to the session
- An optional versioned checkpoint with source/tail hashes and provenance

Each trace line is a versioned envelope containing the run ID, optional session
ID, sequence number, timestamp, and one structured `RunEvent`. Subagent trace
envelopes additionally carry `parentRunId` and `subagentName`; the parent trace
links back through the completed delegation tool result.

## Resume behavior

Forge supports:

```bash
forge resume <session-id>
forge resume --last
```

The interactive `/resume` command opens a bounded list of saved sessions for
the current canonical workspace. Selecting one replaces the empty/current
conversation with its completed history and continues in that saved session.

Resume follows these rules:

1. Only completed user/assistant turns and their provider-exposed reasoning are
   restored for display.
2. A new prompt always starts a new bounded run with a new run ID.
3. Current configuration and `AGENTS.md` instructions are loaded again.
4. Approval state is new for every resumed run.
5. Provider continuation records and partially completed tool calls are never
   resumed.
6. A saved session from another workspace is rejected unless the user starts
   from that workspace explicitly.
7. Missing or invalid session files produce an actionable configuration-style
   error without starting a model request.
8. A valid checkpoint restores the same bounded active view; a stale or invalid
   checkpoint is ignored without changing the canonical transcript.

This means Forge restores conversation context, not authority or executable
state. Saved reasoning remains display-only and is not added to the model's
conversation history. Providers may expose only a reasoning summary, not their
private internal chain of thought; Forge saves only the text actually emitted.
For Codex App Server turns, Forge explicitly requests a detailed reasoning
summary and renders the streamed summary notifications.

## Inspect behavior

`forge inspect <run-id>` reads and validates the corresponding JSONL trace,
then renders an event timeline plus duration, model steps, tool calls, token
usage, context-budget categories, retained/omitted messages, estimation error,
and terminal status. Inspection never executes tools or contacts the model
provider.

Terminal rendering and trace persistence consume the same `RunEvent` objects.
The trace is therefore evidence of the runtime path, rather than a second log
assembled from terminal strings.

## Redaction and safety

Before persistence, Forge redacts configured credential values and recognized
secret-bearing fields. In particular, `DEEPSEEK_API_KEY` must never appear in a
session snapshot or run trace.

Run traces may still contain repository contents, diffs, commands, model text,
and provider-returned reasoning. Files under `sessions/` and `runs/` are local
sensitive data and must not be committed to a repository.

Session resume does not weaken the existing security model:

- Previous approvals are not restored.
- A previous permission profile is not trusted as a grant; current user
  configuration and explicit CLI choices determine the next run.
- Project files cannot edit session metadata under `FORGE_HOME` through
  built-in workspace file tools.
- Inspecting or listing sessions is read-only and performs no model call.

## Deferred behavior

- Resuming in the middle of an active model stream or tool call
- Branching or forking a session
- Cross-machine synchronization
- SQLite indexing
- Deleting canonical transcript history through a retention policy
- Cross-provider reuse of provider-native opaque checkpoints
- Trace encryption
