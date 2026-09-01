> Forge can create plugins. Ask the connected model to build one for your use
> case and point it to this document.

# Plugin authoring guide

[简体中文](zh-CN/PLUGINS.md) · [Documentation index](README.md)

Forge 0.3.4 works without plugins. A plugin is an optional in-process JavaScript
module that can register model-callable tools and explicit local commands,
contribute instructions, observe immutable run events, or make policy stricter.

This page is both a human guide and the contract a coding model should follow
when writing a Forge plugin. The checked-in implementation is authoritative:
[`packages/plugin-api/src/types.ts`](../packages/plugin-api/src/types.ts),
[`schema.ts`](../packages/plugin-api/src/schema.ts), and
[`host.ts`](../packages/plugin-api/src/host.ts).

## Contents

- [Quick start](#quick-start)
- [Locations, enablement, and trust](#locations-enablement-and-trust)
- [Plugin anatomy](#plugin-anatomy)
- [Manifest version 1](#manifest-version-1)
- [Activation and API reference](#activation-and-api-reference)
- [Custom tools](#custom-tools)
- [Other extension points](#other-extension-points)
- [Discovery and run lifecycle](#discovery-and-run-lifecycle)
- [Portable Skills are different](#portable-skills-are-different)
- [Testing a plugin](#testing-a-plugin)
- [Web tools example](#web-tools-example)
- [Instructions for a model author](#instructions-for-a-model-author)
- [Security boundary](#security-boundary)
- [Deliberate limitations](#deliberate-limitations)

## Quick start

Create a user plugin at `$FORGE_HOME/plugins/count-text/` (normally
`~/.forge/plugins/count-text/`):

```text
count-text/
|-- plugin.json
`-- index.mjs
```

`plugin.json`:

```json
{
  "schemaVersion": 1,
  "apiVersion": "1",
  "name": "count-text",
  "version": "1.0.0",
  "entry": "./index.mjs",
  "capabilities": ["tools:register"]
}
```

`index.mjs`:

```js
export default function activate(api) {
  const inputSchema = api.z
    .object({ text: api.z.string().max(10000) })
    .strict();

  api.registerTool({
    name: "count_text",
    description: "Count Unicode characters in supplied text.",
    risk: "read",
    inputSchema,
    execute: async (input) => {
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          ok: false,
          error: {
            code: "invalid_input",
            message: "Invalid input for count_text.",
            retryable: false
          }
        };
      }
      return {
        ok: true,
        output: { characters: Array.from(parsed.data.text).length },
        truncated: false
      };
    }
  });
}
```

Enable it in the user-level `$FORGE_HOME/config.json`:

```json
{
  "schemaVersion": 1,
  "plugins": {
    "enabled": ["count-text"]
  }
}
```

Then verify discovery and start Forge:

```bash
forge plugins list
forge
```

The blue startup frame lists enabled user plugins, trusted or skipped project
plugins, and discovered built-in, user, and project Skills. This listing reads manifests and Skill
metadata only; it does not import plugin entry files early.

## Locations, enablement, and trust

Forge supports two scopes:

| Scope | Location | How it becomes loadable |
| --- | --- | --- |
| User | `$FORGE_HOME/plugins/<name>/` | Add the name to user `plugins.enabled` |
| Project | `<workspace>/.forge/plugins/<name>/` | Run `forge plugins trust` for the canonical workspace |

Project configuration cannot set `plugins.enabled`. User configuration cannot
silently trust project code. Project trust is stored outside the repository in
`$FORGE_HOME/plugin-trust.json` and is keyed by the canonical workspace path.

```bash
forge plugins list
forge plugins trust
forge plugins trust --yes   # explicit non-interactive decision
forge plugins untrust
```

The same decision is available inside an interactive Forge session. Enter
`/plugins`, review the project plugin versions and capabilities, press `t`, and
confirm with `y`. A trusted workspace can be revoked from the same panel with
`u`. The header updates immediately, and newly trusted plugins load on the next
native Forge Engine task without restarting the TUI.

Discovery is intentionally shallow. Forge does not scan arbitrary ancestors,
nested plugin directories, or `node_modules`, and it does not install packages
or run lifecycle scripts. Starting in a repository subdirectory still resolves
the same workspace root and trust record.

## Plugin anatomy

A dependency-free plugin needs only a strict manifest and a JavaScript entry:

```text
my-plugin/
|-- plugin.json          # declarative metadata, read before trust/import
|-- index.mjs            # activation function
|-- README.md            # recommended setup and safety notes
`-- test/                # optional plugin-owned tests
```

The entry may import sibling `.js`/`.mjs` files. Forge does not provide a
dependency installer, so a shared plugin that imports third-party packages must
document how the user installs them and must not rely on package-manager hooks
running automatically.

## Manifest version 1

Every manifest is strict: unknown keys are rejected.

| Field | Required value |
| --- | --- |
| `schemaVersion` | Number `1` |
| `apiVersion` | String `"1"` |
| `name` | Lowercase kebab-case, 1–64 characters, equal to directory name |
| `version` | Non-empty plugin version string |
| `entry` | Relative `.js`, `.mjs`, or `.cjs` path that stays inside the plugin directory |
| `capabilities` | Array of the capabilities the entry intends to use |

Supported capabilities:

| Capability | Meaning |
| --- | --- |
| `tools:register` | Call `api.registerTool()` |
| `commands:register` | Call `api.registerCommand()` |
| `prompt:contribute` | Call `api.contributePrompt()` |
| `subagents:register` | Call `api.registerSubagent()` to declare a host-run child role |
| `events:observe` | Call `api.observeRunEvents()` |
| `policy:restrict` | Call `api.restrictPolicy()` |
| `network:access` | Declare that a registered `network`-risk tool performs external I/O |

Forge rejects an unsupported API version before import. It also rejects use of
a registration method that was not declared. A `network`-risk tool additionally
requires `network:access`.

Capabilities are review and API gates, not an operating-system sandbox. Trusted
JavaScript can still call Node.js directly, including during activation.

## Activation and API reference

The entry exports either `default` or a named `activate` function. It may be
synchronous or asynchronous; Forge awaits it before starting the run.

```js
export async function activate(api) {
  // register extension points here
}
```

The frozen `api` object contains:

| Member | Purpose |
| --- | --- |
| `api.apiVersion` | Current plugin API version, currently `"1"` |
| `api.z` | Forge's Zod instance for input schemas; no plugin dependency needed |
| `api.registerTool(tool)` | Register a model-callable tool |
| `api.registerCommand(command)` | Register an explicit local command |
| `api.registerSubagent(definition)` | Register an isolated, host-managed child role as a model tool |
| `api.contributePrompt(hook)` | Add bounded instructions to a run |
| `api.observeRunEvents(observer)` | Observe immutable event snapshots |
| `api.restrictPolicy(hook)` | Change an effective decision only to `confirm` or `deny` |

Registration names must be unique across built-ins and loaded plugins. Treat
activation as setup: do not perform surprising writes, network requests, or
long-running work merely because Forge starts.

## Custom tools

`api.registerTool()` receives the provider-neutral `ForgeTool` contract:

```ts
interface ForgeTool {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  risk: "read" | "write" | "process" | "network" | "model";
  execute(input: unknown, context: ToolContext): Promise<ToolResult>;
}
```

Tool names use lower snake case and must match
`^[a-z][a-z0-9_]{0,63}$`. Descriptions and schema descriptions are sent to the
model, so say exactly when the tool should be called and keep inputs bounded.

### Risk selection

| Risk | Use for | Default policy |
| --- | --- | --- |
| `read` | Workspace-bounded, side-effect-free inspection | Allow |
| `write` | Workspace file changes | Confirm first write in `safe`; allow in `workspace-write` |
| `process` | Starting any child process | Confirm every call |
| `network` | Sending data to or fetching data from an external service | Confirm every call |
| `model` | Starting an additional delegated model run | Confirm every call |

Do not label a network or process action as `read` merely because it does not
modify the repository. The risk describes the external effect, not only the
shape of the returned data.

Every plugin tool call follows the same runtime path as a built-in tool:

```text
model proposal
  -> schema validation
  -> core policy
  -> stricter plugin policy hooks
  -> approval when required
  -> execute
  -> structured RunEvents
  -> redacted trace and observers
  -> tool result returned to model
```

The `context` passed to `execute` contains the canonical workspace root/current
directory, the run's `AbortSignal`, and strict limits:

```ts
interface ToolContext {
  workspace: { root: string; cwd: string };
  signal: AbortSignal;
  limits: {
    maxOutputBytes: number;
    maxEntries: number;
    commandTimeoutMs?: number;
  };
}
```

Honor cancellation promptly and let configured limits win over plugin defaults.
Successful and failed results are explicit:

```js
return {
  ok: true,
  output: { value: "bounded JSON-serializable data" },
  truncated: false
};

return {
  ok: false,
  error: {
    code: "invalid_input",
    message: "Explain a safe corrective action without secrets.",
    retryable: false
  }
};
```

Use an existing Forge error code from `@forge/core` (`invalid_input`,
`cancelled`, `io_error`, `output_limit`, `timed_out`, and so on). Never include
credentials, authorization headers, or private response bodies in errors.

## Other extension points

### Subagents

`api.registerSubagent()` is declarative: the plugin defines a role, generated
parent-tool name, instructions, allowed child tools, and tight limits. It never
receives credentials or a callable model/runtime object.

```js
api.registerSubagent({
  name: "code-reviewer",
  toolName: "delegate_code_review",
  description: "Delegate a focused read-only review.",
  instructions: "Report concrete correctness and security findings.",
  tools: ["list_files", "read_file", "search"],
  limits: { maxModelSteps: 4, maxToolCalls: 8 }
});
```

Declare `subagents:register`. Role names are kebab-case; generated tool names
are lower snake case and share the normal built-in/plugin name namespace.
Instructions are required and capped at 16 KiB. At most 32 unique, already
registered non-subagent tools may be selected. Per-child limits are capped at
8 model steps and 20 tool calls.

The generated tool accepts `{ task: string }`, has `model` risk, and requires
approval for every delegation. Forge creates a fresh adapter and isolated
conversation, inherits project instructions, workspace, context settings,
cancellation, approval channel, and the effective core-plus-plugin policy, and
exposes only the declared tools. Subagent tools are never included in child
tool sets, preventing recursive delegation.

One parent run may start at most four children. All children also share budgets
equal to the configured parent `maxSteps` and `maxToolCalls`; a plugin's limit
can only reduce those ceilings. Results are bounded by `maxToolOutputBytes`.
When tracing is enabled, each child gets a separate run trace whose envelopes
carry `parentRunId` and `subagentName`; the parent tool result carries the child
`runId`, status, step/tool counts, and final text.

See [`examples/plugins/code-review-subagent`](../examples/plugins/code-review-subagent).

### Commands

Commands are explicit trusted-code entry points, not model tool calls:

```js
api.registerCommand({
  name: "hello",
  description: "Print a local greeting.",
  execute: async ({ args, write }) => {
    write(`hello ${args.join(" ") || "world"}\n`);
    return 0;
  }
});
```

Run them with `forge plugins run hello [args...]`. The context exposes `cwd`,
`workspaceRoot`, `args`, `signal`, `write`, and `writeError`. Commands bypass
model-tool approval because the user invokes them directly; they still execute
with the full privileges of the trusted plugin.

### Prompt contributions

`api.contributePrompt(hook)` receives an immutable snapshot containing the
current prompt, canonical workspace root, and working directory. A returned
string is limited to 32 KiB, labelled with its manifest path, added to the
effective instruction context, and included in instruction provenance.

Return `undefined` when no contribution is needed. Treat the user prompt as
untrusted data and do not use a prompt hook as a hidden command runner.

### Run-event observers

`api.observeRunEvents(observer)` receives a deeply frozen structured clone of
each `RunEvent`. Observers cannot mutate runtime history. Observer failures
produce warnings without replacing the run result or trace. Events are redacted
for configured secrets before observers receive them.

### Policy restrictions

`api.restrictPolicy(hook)` receives a frozen snapshot of the tool, call, and
validated input. It may return only:

```js
{ kind: "confirm", reason: "..." }
{ kind: "deny", reason: "..." }
undefined
```

Forge combines decisions using `deny > confirm > allow`. A plugin cannot turn a
core confirmation or denial into an allow. See
[`examples/plugins/stricter-policy`](../examples/plugins/stricter-policy).

## Discovery and run lifecycle

The native Forge Engine performs these steps for each prompt:

1. Load and validate configuration.
2. Load bounded user/project instructions.
3. Discover bounded built-in, user, and project Skill metadata, resolve
   collisions, and preserve explicit `$skill-name` selection.
4. Discover plugin manifests.
5. Exclude disabled user plugins and untrusted project plugins.
6. Resolve each entry inside its plugin directory and import it.
7. Activate plugins and validate registrations/capabilities/name conflicts.
8. Collect bounded prompt contributions.
9. Build the model request and combined tool registry.
10. Run all proposed tools through policy, approval, execution, events, and
    traces.

The interactive startup frame stops after metadata discovery for display. The
actual entry import/activation still happens only when the Forge Engine starts a
run. The Codex Engine is a separate runtime owned by Codex App Server and does
not load Forge plugins.

## Portable Skills are different

Forge discovers Markdown Skills at:

```text
<installed-package>/resources/skills/<skill-name>/SKILL.md
$FORGE_HOME/skills/<skill-name>/SKILL.md
<workspace-root>/.agents/skills/<skill-name>/SKILL.md
```

A Skill is guidance, not executable plugin code. Discovery never executes it.
Each `SKILL.md` starts with bounded YAML frontmatter containing a kebab-case
`name` matching its directory and a task-oriented `description`.
`disable-model-invocation: true` makes that Skill explicit-only.

The first model request contains only the bounded catalog fields `id`, `name`,
`description`, and `source`; Skill bodies are loaded lazily through the
host-owned `load_skill` read tool. That tool accepts only registered opaque IDs,
limits and deduplicates loads, revalidates canonical paths and file identities,
and rejects symlinks or files outside the registered root. Name collisions use
`project > user > builtin`; an explicit `$skill-name` overrides automatic
routing. Selection, load, rejection, and truncation are trace events visible in
`forge inspect`.

Scripts or actions described by a Skill still require normal model tool calls,
policy, approval, and trace events. Selecting or loading a project Skill does
not trust project plugin code and does not widen `read_file` beyond the active
workspace.

## Testing a plugin

Plugin tests must not require a paid model or a real external service. Use fake
transport responses and the real host/policy boundary where possible.

Recommended loop:

```bash
forge plugins list
pnpm typecheck
pnpm test
pnpm check
```

For a project plugin, inspect the manifest before trust, then make the decision
explicit:

```bash
forge plugins list
forge plugins trust
forge run "Use my plugin to perform its smallest safe task"
forge plugins untrust
```

Alternatively, use `/plugins` in the TUI for the same explicit review,
confirmation, and revocation flow.

For a user plugin under test, point `FORGE_HOME` at a temporary directory and
enable only that plugin. A robust plugin test should cover:

- Manifest discovery without importing the entry.
- Host activation and registered names/capabilities.
- Invalid inputs and cancellation.
- Output/entry/timeout limits and `truncated` accuracy.
- Model/network/process/write policy decisions where relevant.
- Redaction: secrets never occur in a result, event, error, or test snapshot.
- Recoverable provider failures without live network calls.

## Web tools example

[`examples/plugins/web-tools`](../examples/plugins/web-tools) is a complete,
dependency-free test of the current plugin system. It registers:

- `web_search`: Brave Search when `BRAVE_SEARCH_API_KEY` exists, otherwise
  DuckDuckGo's non-JavaScript HTML search.
- `web_fetch`: extracts bounded readable text from public HTTP(S) pages.

The Brave path follows the official
[Web Search API](https://api-dashboard.search.brave.com/api-reference/web/search/get).
The key-free fallback uses DuckDuckGo's documented
[non-JavaScript search](https://duckduckgo.com/duckduckgo-help-pages/features/non-javascript).

Install it as a user plugin:

```bash
mkdir -p "${FORGE_HOME:-$HOME/.forge}/plugins"
cp -R examples/plugins/web-tools "${FORGE_HOME:-$HOME/.forge}/plugins/web-tools"
```

Then add `"web-tools"` to `plugins.enabled` and restart Forge. Its own
[`README.md`](../examples/plugins/web-tools/README.md) documents search-provider
selection and implemented controls.

The example treats web access as external I/O, so both tools use `network` risk
and require approval on every call. Forge's shared HTTP transport honors
`HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` (including lowercase aliases), so
plugins using the global `fetch` work with ordinary HTTP(S) proxy setups.
`web_fetch` validates every initial and redirect URL, blocks local hostnames and
private IP literals, and resolves direct destinations before connection. For a
proxied destination, the explicitly configured proxy owns DNS resolution;
`NO_PROXY` destinations retain direct-DNS validation. It also restricts ports
and MIME types and bounds redirects, time, downloads, characters, entries, and
serialized output. These controls reduce accidental SSRF and runaway output;
they are not a network sandbox, and a configured proxy is part of the trust
boundary.

## MCP, to-dos, and subagents

The examples make the current extension boundary concrete:

| Capability | Current plugin API | Example / limitation |
| --- | --- | --- |
| MCP server tools | Yes, with protocol and lifecycle limits | [`mcp-stdio`](../examples/plugins/mcp-stdio) registers approved `process`-risk list/call bridge tools for one configured stdio server. |
| Lightweight to-dos | Yes | [`todos`](../examples/plugins/todos) registers an in-memory tool and bounded prompt contribution. Persistence and a custom TUI panel are not available. |
| Host-managed subagents | Yes | [`code-review-subagent`](../examples/plugins/code-review-subagent) declares a read-only child role; Forge owns its adapter, policy, budgets, cancellation, and linked trace. |

The MCP example intentionally targets session-based, newline-delimited stdio
revision `2025-11-25`; it is evidence that a plugin can bridge MCP tools, not a
claim that Forge has complete MCP host support. Streamable HTTP, current
handshake-free protocol support, server reuse, prompts/resources/roots,
sampling, tasks, and lifecycle disposal need a first-class host or expanded
plugin contract.

Subagents currently inherit the active parent model; plugins cannot select a
different provider/model, pass parent conversation history, persist a child as
an independently resumable session, stream child deltas into a dedicated TUI
panel, or enable nested delegation. Those remain deliberate host limitations,
not behaviors plugins should emulate with direct provider calls or recursive
CLI spawning.

## Instructions for a model author

When asked to write a Forge plugin, follow this sequence:

1. Read this entire document and inspect the current plugin types/schema/host.
2. Decide user versus project scope from the user's intent; never record trust
   or edit user configuration unless requested.
3. Choose the smallest manifest capability set. A network tool needs both
   `tools:register` and `network:access`.
4. Use plain ESM JavaScript and `api.z` unless a dependency is genuinely
   necessary. Forge does not compile TypeScript plugin entries or install deps.
5. Validate inside `execute` even though the runtime validates first; direct
   tests and future callers should receive a structured failure.
6. Choose the honest risk. Bound every input and every output, honor
   `context.signal`, and use `context.limits` as the upper authority.
7. Keep activation free of surprising side effects. Do work only after an
   explicit command or approved tool call.
8. Add deterministic tests with fake I/O. Exercise discovery and activation
   through `loadPluginHost` when changing Forge itself.
9. Run formatting, type checks, targeted tests, and the full suite.
10. Document setup, required environment variables, data sent externally,
    safety controls, and known limitations without claiming sandboxing.

Before handing off, verify:

- Directory name equals manifest `name`.
- Manifest/API versions are exactly supported.
- Entry stays inside the plugin directory and exports an activation function.
- All used APIs, subagents, and `network` tools declare their capabilities.
- Tool/command names do not collide and descriptions are model-readable.
- Errors are actionable and contain no secrets.
- Output sizes are measured after JSON serialization when that matters.
- Project code is not executed before explicit trust.
- Documentation distinguishes discovery, enablement, trust, activation, and
  tool-call approval.

## Security boundary

Loading a plugin executes local code with the full privileges of the Forge
process. It may import Node.js modules, read arbitrary files, start processes,
or use the network without going through a registered tool. Only install or
trust code you have reviewed.

Forge enforces safety at its supported API boundaries:

- Project entries are not imported before canonical workspace trust.
- Manifest/API/capability/name/schema contracts are validated.
- Model-called plugin tools follow core policy and approval.
- `model`, `network`, `process`, and applicable write actions require confirmation.
- Policy hooks can only make decisions stricter.
- Prompt contributions and Skill content are bounded and attributed.
- Observer input is cloned, frozen, and secret-redacted.

Those properties do not isolate a malicious trusted entry. Strong isolation
would require a restricted process or OS sandbox.

## Deliberate limitations

Forge 0.3.4 has no plugin installer, dependency resolver, package registry, hot
reload, TypeScript entry compilation, custom interactive UI, provider
registration, isolated plugin process, or enforceable filesystem/network
capabilities. Plugin commands run only through `forge plugins run`; they do not
become interactive slash commands. These gaps are explicit so plugin authors
can target the implemented contract instead of guessing at future APIs.

## Skills and product documentation are resources

Skills are non-executable, untrusted instruction resources discovered from built-in, user, and project scopes. `forge plugins list` reports executable plugins; `forge resources list` reports Skill source, invocation status, collision shadowing, and diagnostics. The interactive equivalents are `/plugins` and `/resources`.

The built-in `forge-product-help` Skill requires a documentation lookup before implementation-specific product answers. `search_forge_docs` and `read_forge_doc` use a version-matched packaged allowlist and stable `forge-doc:<version>:<locale>:<document>#<section>` references. They reject filesystem paths and do not inherit `read_file` access.
