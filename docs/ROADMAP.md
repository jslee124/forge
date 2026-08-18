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
- [ ] Support API-key authentication only for the first implementation
- [ ] Implement a Vercel AI SDK model adapter
- [ ] Add `forge ask <prompt>`
- [ ] Stream text to the terminal
- [ ] Display provider-supplied reasoning or thinking content when available
- [ ] Return readable configuration and provider errors
- [ ] Cancel an active request with Ctrl+C
- [ ] Unit-test configuration without making real API calls

Acceptance criteria:

- `forge ask "hello"` streams a model response.
- Provider-supplied reasoning is visible and absent reasoning is not fabricated.
- A missing API key produces a short actionable error without a stack trace.
- Ctrl+C cancels the request and exits cleanly.

## Milestone 2: Project context and first tool call

Goal: let the model understand repository instructions and safely retrieve
information from the workspace.

- [ ] Resolve the canonical workspace root and run working directory
- [ ] Discover `AGENTS.md` from the workspace root to the working directory
- [ ] Prefer `AGENTS.override.md` at each directory level
- [ ] Apply file and total-size limits and record instruction provenance
- [ ] Define the tool and tool-result types
- [ ] Define the workspace execution context
- [ ] Implement `read_file`
- [ ] Validate paths against the workspace root
- [ ] Classify outside-workspace paths as approval-required
- [ ] Limit file output size
- [ ] Send the tool result back to the model
- [ ] Test normal paths, traversal attempts, missing files, and cancellation

Acceptance criteria:

- Forge can answer a question that requires reading a local file.
- Root and nested project instructions are merged in deterministic order.
- Repository instructions cannot change the active permission policy.
- Forge does not read outside the workspace silently; it returns an
  approval-required result until the approval flow is implemented.
- Tool failures become structured results the model can react to.

## Milestone 3: Native agent loop and policy foundation

Goal: support multiple model and tool steps with explicit runtime control.

- [ ] Implement run state and lifecycle
- [ ] Continue after a tool result
- [ ] Add model-call and tool-call limits
- [ ] Add configurable stop conditions
- [ ] Detect cancellation between steps
- [ ] Route every tool call through a minimal policy gateway
- [ ] Implement `allow`, `confirm`, and `deny` decisions
- [ ] Deny approval-required actions when no approval channel is available
- [ ] Add deterministic tests with a fake model adapter

Acceptance criteria:

- Forge can inspect multiple files before producing a final response.
- It stops at configured limits instead of looping forever.
- No tool can execute without a recorded policy decision.
- Runtime tests cover successful, failed, cancelled, and limit-reached runs.

## Milestone 4: Safe coding tools

Goal: allow Forge to make a small code change and verify it.

- [ ] Implement `list_files`
- [ ] Implement `search`
- [ ] Implement structured file patches
- [ ] Confirm the first workspace patch and show its diff
- [ ] Implement command execution with timeout and output limits
- [ ] Confirm every shell command before execution
- [ ] Ask before an exact operation outside the workspace
- [ ] Resolve symlinks before applying path policy
- [ ] Preserve pre-existing workspace changes
- [ ] Add integration tests in temporary workspaces

Acceptance criteria:

- Forge can locate relevant code, apply a targeted change, and run a test.
- A timed-out command is terminated and reported accurately.
- Workspace reads are automatic and outside-workspace operations require
  explicit approval.
- Approval-required operations are denied when no approval channel exists.
- Unrelated user changes are not overwritten.

## Milestone 5: Permission profiles and security model

Goal: make the boundary between autonomous and user-approved actions explicit.

- [ ] Assign complete risk metadata to tools and actions
- [ ] Add scoped session approvals
- [ ] Add `safe`, `workspace-write`, and `full-access` profiles
- [ ] Reject clearly destructive commands
- [ ] Make the policy independently testable
- [ ] Verify that plugin policy contributions can only make decisions stricter
- [ ] Keep `docs/SECURITY.md` aligned with actual behavior

Acceptance criteria:

- Read-only operations can proceed automatically.
- Sensitive operations pause for approval.
- Denied actions are returned to the agent as structured observations.
- Safety tests cover external paths, symlinks, missing UI, decision precedence,
  and representative destructive commands.
- Documentation distinguishes approval controls from OS-level isolation.

## Milestone 6: Structured traces

Goal: make every run inspectable without relying on terminal scrollback.

- [ ] Define versioned run-event schemas
- [ ] Render terminal output from the event stream
- [ ] Persist events as JSONL
- [ ] Represent provider-supplied reasoning as typed events
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

## Milestone 8: Trusted plugin API (v0.2)

Goal: let users customize Forge without making plugins necessary for basic use.

- [ ] Define a versioned plugin manifest and API
- [ ] Discover portable project skills from `.agents/skills/`
- [ ] Load Forge project configuration from `<workspace-root>/.forge/`
- [ ] Discover project plugins only from `.forge/plugins/`
- [ ] Register custom tools and commands
- [ ] Expose immutable run events to observer plugins
- [ ] Add controlled prompt and policy contribution hooks
- [ ] Require trust before loading project-local plugins
- [ ] Prevent plugins from overriding the policy kernel
- [ ] Add one custom-tool example and one stricter-policy example
- [ ] Document that in-process plugins have full local code privileges

Acceptance criteria:

- Forge works normally with no plugins installed.
- A trusted plugin can add a tool without modifying Forge core.
- Project-local plugins do not load before an explicit trust decision.
- Starting Forge in a repository subdirectory resolves the same project plugin
  set as starting at the repository root.
- Plugin tools pass through the same policy and trace pipeline as built-in tools.
- A plugin cannot turn a core `deny` into `confirm` or `allow` through Forge APIs.

## Milestone 9: OpenAI authentication expansion (post-v0.2)

Goal: add a secure OpenAI login experience without treating another client's
private OAuth behavior as a stable contract.

- [ ] Re-check current official OpenAI authentication documentation and terms
- [ ] Define a provider-independent authentication manager
- [ ] Keep API-key authentication as a supported fallback
- [ ] Add Codex-compatible Sign in with ChatGPT only through an appropriate
  public or explicitly authorized integration
- [ ] Support browser callback and headless login when the supported flow allows
- [ ] Store credentials in the OS credential store by default
- [ ] Implement single-flight token refresh and expiry handling
- [ ] Add `forge auth status` and `forge auth logout`
- [ ] Redact credentials from logs, traces, errors, and plugin events
- [ ] Test login, refresh, cancellation, expiry, corruption, and logout with fake
  authorization responses

Acceptance criteria:

- Forge never requires users to copy another application's credential file.
- API-key and subscription sign-in methods are clearly distinguished in the UI.
- Token refresh is concurrency-safe and does not leak credentials.
- Unsupported or changed upstream behavior fails with an actionable message.
- Documentation does not imply official third-party support beyond what OpenAI
  currently documents.

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
