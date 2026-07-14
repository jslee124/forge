# Roadmap

## Working rules

- Complete one milestone before expanding the next one.
- Every milestone must produce a runnable behavior.
- Acceptance criteria define completion, not the number of files written.
- Keep the default test suite independent from paid model calls.
- Update this document when implementation teaches us that the plan is wrong.

## Milestone 0: Project foundation

Goal: create a small, consistent TypeScript project that is easy to run and
test.

- [ ] Add `package.json` and pin the package manager
- [ ] Configure strict TypeScript
- [ ] Configure formatting and linting
- [ ] Configure Vitest
- [ ] Add a minimal CLI entry point
- [ ] Add CI for type checking, tests, and linting

Acceptance criteria:

- A new contributor can install dependencies with one documented command.
- The CLI prints its version and help text.
- Type checking, tests, and linting run locally with documented commands.
- The same checks run in CI.

## Milestone 1: Model conversation

Goal: prove the model integration and streaming path before building an agent.

- [ ] Read model configuration from environment variables
- [ ] Implement a Vercel AI SDK model adapter
- [ ] Add `forge ask <prompt>`
- [ ] Stream text to the terminal
- [ ] Return readable configuration and provider errors
- [ ] Cancel an active request with Ctrl+C
- [ ] Unit-test configuration without making real API calls

Acceptance criteria:

- `forge ask "hello"` streams a model response.
- A missing API key produces a short actionable error without a stack trace.
- Ctrl+C cancels the request and exits cleanly.

## Milestone 2: First tool call

Goal: let the model safely retrieve information from the workspace.

- [ ] Define the tool and tool-result types
- [ ] Define the workspace execution context
- [ ] Implement `read_file`
- [ ] Validate paths against the workspace root
- [ ] Limit file output size
- [ ] Send the tool result back to the model
- [ ] Test normal paths, traversal attempts, missing files, and cancellation

Acceptance criteria:

- Forge can answer a question that requires reading a local file.
- Forge rejects attempts to read outside the selected workspace.
- Tool failures become structured results the model can react to.

## Milestone 3: Native agent loop

Goal: support multiple model and tool steps with explicit runtime control.

- [ ] Implement run state and lifecycle
- [ ] Continue after a tool result
- [ ] Add model-call and tool-call limits
- [ ] Add configurable stop conditions
- [ ] Detect cancellation between steps
- [ ] Add deterministic tests with a fake model adapter

Acceptance criteria:

- Forge can inspect multiple files before producing a final response.
- It stops at configured limits instead of looping forever.
- Runtime tests cover successful, failed, cancelled, and limit-reached runs.

## Milestone 4: Coding tools

Goal: allow Forge to make a small code change and verify it.

- [ ] Implement `list_files`
- [ ] Implement `search`
- [ ] Implement structured file patches
- [ ] Show file changes to the user
- [ ] Implement command execution with timeout and output limits
- [ ] Preserve pre-existing workspace changes
- [ ] Add integration tests in temporary workspaces

Acceptance criteria:

- Forge can locate relevant code, apply a targeted change, and run a test.
- A timed-out command is terminated and reported accurately.
- File operations remain inside the selected workspace.
- Unrelated user changes are not overwritten.

## Milestone 5: Approval and safety policy

Goal: make the boundary between autonomous and user-approved actions explicit.

- [ ] Assign risk metadata to tools and actions
- [ ] Implement `allow`, `confirm`, and `deny` decisions
- [ ] Add interactive approval to the CLI
- [ ] Reject clearly destructive commands
- [ ] Make the policy independently testable
- [ ] Document the security model and limitations

Acceptance criteria:

- Read-only operations can proceed automatically.
- Sensitive operations pause for approval.
- Denied actions are returned to the agent as structured observations.
- Safety tests cover path escape and representative destructive commands.

## Milestone 6: Structured traces

Goal: make every run inspectable without relying on terminal scrollback.

- [ ] Define versioned run-event schemas
- [ ] Render terminal output from the event stream
- [ ] Persist events as JSONL
- [ ] Redact known secrets
- [ ] Add `forge inspect <run-id>`
- [ ] Record duration and model/tool usage metadata

Acceptance criteria:

- A completed run can be reconstructed from its trace.
- Terminal rendering and persistence consume the same structured events.
- Trace files contain no configured API keys.

## Milestone 7: First end-to-end release

Goal: publish a small but truthful v0.1 portfolio release.

- [ ] Create at least three fixture repository tasks
- [ ] Add end-to-end graders based on hidden tests
- [ ] Run each task multiple times
- [ ] Report pass rate, latency, tool calls, and token usage
- [ ] Record a short terminal demo
- [ ] Expand the README with setup, usage, results, and limitations
- [ ] Tag the v0.1 release

Acceptance criteria:

- Forge completes at least one repository-level task end to end.
- Reported benchmark numbers are reproducible from documented commands.
- The README never claims capabilities that the release does not implement.

## Later extensions

These items are intentionally unordered and are not part of v0.1:

- More evaluation tasks and graders
- LangChain runtime adapter and benchmark comparison
- LangGraph checkpoint experiment
- HTTP API and Server-Sent Events
- Persistent run metadata in SQLite
- Resumable sessions
- Dynamic context management
- Additional model providers
- MCP integration
- Stronger process isolation
