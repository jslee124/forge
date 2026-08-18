# Interactive CLI UI

## Status

This document defines the implemented Milestone 4.6 terminal experience. Ink
now provides the interactive renderer while the non-interactive commands and
Forge-owned runtime retain their existing boundaries.

## Goals

The interactive CLI should make common coding-agent actions discoverable
without moving the agent loop, tools, or policy decisions out of Forge core.
The terminal UI should provide:

- A multi-line prompt editor
- Discoverable slash-command completion
- Workspace-file completion with `@`
- Clear streamed reasoning, answers, tool activity, and run state
- Terminal-native Markdown for headings, lists, quotes, links, inline code,
  emphasis, and fenced code blocks
- A readable diff review before file-write approval
- Keyboard-only operation with predictable cancellation

Ink is the renderer for the interactive CLI. Commander remains
responsible for process-level command parsing. React and Ink must stay inside
`apps/cli`; `@forge/core` must remain independent of the terminal framework.
Forge uses full-frame Ink updates so terminal reflow during a resize cannot
leave stale rows from the previous width.

## Interaction states

The UI owns an explicit state machine so menus, streaming output, and approval
prompts never compete for the same terminal input:

```text
editing
 |-- "/" --> selecting_command -- execute/insert --> editing
 |-- "@" --> selecting_file ---- insert ---------> editing
 `-- submit --> running --> awaiting_approval --> running --> editing
                    `---------------- completed ------------^
```

Only the active state consumes keyboard input. Ctrl+C closes an open completion
menu first, cancels an active run second, and preserves the existing deliberate
session-exit behavior when Forge is otherwise idle.

## Prompt editor

- Enter submits a non-empty prompt when no completion or approval menu owns the
  key.
- Shift+Enter inserts a newline without submitting. Terminal integrations that
  encode it as Meta+Enter (`ESC+Enter`) are treated the same way.
- Because some legacy terminals do not distinguish Shift+Enter from Enter,
  Ctrl+J also inserts a newline as a portable fallback. The input footer should
  advertise the shortcut that is available.
- Forge directly enables the enhanced keyboard protocol in known-compatible
  terminals such as VS Code and Ghostty, avoiding a startup capability query
  that some terminals echo as input. Older or unknown terminals continue to
  use Ctrl+J or Meta+Enter as fallbacks.
- The editor preserves newlines exactly when constructing the user message.
- Left/right movement, backspace, delete, Home/End, paste, Unicode text, and
  terminal resize must not corrupt the buffer or display.
- Up/down keys navigate an open completion menu. When no menu is open, they may
  later be used for prompt history; history is not required for Milestone 4.6.

## Slash-command completion

Typing `/` as the first non-whitespace character opens a list of available
commands. Additional characters filter the list by command name.

Each command is defined once with its name, description, and handler. The same
registry drives completion and `/help`, preventing the two surfaces from
drifting. The registry contains `/help`, `/clear`, `/resume`, and `/exit`.

- Up/Down changes the highlighted command.
- Enter executes the highlighted command.
- Tab completes its name without executing it.
- Escape closes the menu without changing the input.
- A slash elsewhere in ordinary prose or a filesystem path does not open the
  command menu.

## Workspace-file mentions

Typing `@` opens a bounded list of files beneath the selected workspace. Text
after the active `@` token filters candidates by relative path using
case-insensitive fuzzy matching.

- Candidate paths are workspace-relative and use `/` as the display separator.
- `.git`, dependency directories, build output, and paths outside the canonical
  workspace are excluded.
- The menu shows at most 10 ranked candidates and indicates when more matches
  exist.
- Up/Down changes the highlighted file; Enter or Tab inserts it; Escape closes
  the menu.
- Selecting a file inserts a visible mention while retaining a structured
  `{ path }` reference in editor state. Paths with spaces must not depend on
  reparsing the rendered prompt.
- File discovery is read-only, bounded, cancellable, and does not invoke the
  model or run an external shell command for every keystroke.

On submission, Forge sends the user's text plus an explicit list of referenced
workspace-relative paths to the model. Selecting a mention does not
automatically inject the complete file contents. The model can use `read_file`
through the normal tool, policy, and trace path when it needs the contents.

Example logical message:

```text
Please explain the cancellation behavior.

Referenced files:
- apps/cli/src/session.ts
```

## Diff review

File-write approval must present the exact proposed change in a dedicated,
readable panel before the user decides. The renderer should show:

- Operation and path: create, modify, or delete
- A compact file summary and changed-line counts
- Unified diff hunks with old/new line numbers
- Added lines in green with `+`, removed lines in red with `-`, and subdued
  context lines
- Clear file and hunk headers that remain understandable without color
- Syntax highlighting when the file type is known, without allowing syntax
  color to obscure addition/removal meaning
- An explicit truncation message when a safety display limit is reached

Approval must never rely on color alone. `--no-color`, a non-color terminal,
and common color-vision deficiencies must retain the `+`/`-`, headers, and line
number cues. A diff that exceeds the safe review limit remains unapprovable;
visual truncation must not silently turn partial content into approval for an
unseen patch.

The approval controls are visible next to the diff and describe their scope.
For example, approving the first workspace write covers later workspace writes
only in the current run, while process commands continue to require separate
approval.

Process-command approval uses the same dedicated panel. It renders a
shell-readable `$ command` line followed by clearly labelled working-directory
and timeout rows; these details must not appear as detached transcript text.

## Rendering boundaries

The CLI may turn runtime events into components such as message blocks, tool
activity rows, status indicators, and diff panels. It must not infer execution
success from presentation state or parse previously rendered terminal text.

Core events and approval requests remain the source of truth. Interactive and
non-interactive commands continue to share the same Forge-owned runtime,
workspace validation, policy gateway, and tool execution behavior.

Model Markdown is rendered as a bounded terminal-native subset rather than
HTML. The renderer must tolerate incomplete constructs while text is streaming
and strip model-supplied ANSI control sequences before styling output.

## Test strategy

Milestone 4.6 should include deterministic tests for:

- Slash-menu opening, filtering, navigation, selection, and dismissal
- File candidate filtering, ignored directories, result limits, spaces, and
  prevention of workspace escape
- Structured file mentions and the exact model message assembled from them
- Enter submission versus Shift+Enter, Meta+Enter, and Ctrl+J newline insertion
- Multi-line editing, paste, Unicode, resize, and cancellation
- State transitions between editing, completion, running, and approval
- Diff rendering for create and modify operations, multiple hunks, no-color
  output, truncation, and approval scope

No UI test may require a paid model request. Component tests should consume
scripted input and events, while a small pseudo-terminal integration test proves
the supported key sequences in representative terminals.
