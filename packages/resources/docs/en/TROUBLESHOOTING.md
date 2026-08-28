# Troubleshooting

简体中文 · Documentation index

Start with the read-only checks below. They reveal most setup problems without
contacting a model or changing the repository.

```bash
node --version
pnpm --version
pnpm forge --version
pnpm forge config validate
pnpm forge config show
pnpm forge plugins list
```

Forge requires Node.js 24 or newer and the repository pins pnpm 11.18.0. When a
command fails, keep the first actionable error line; later provider or session
errors may be consequences of the same configuration problem.

## Install or build fails

### pnpm wants to replace `node_modules` in a non-interactive environment

Use CI mode so pnpm does not wait for a terminal prompt:

```bash
CI=true pnpm install --frozen-lockfile
```

Then rebuild:

```bash
pnpm build
pnpm check
pnpm test
```

### The global `forge` command does not reflect source changes

`pnpm link:global` links the built CLI, not TypeScript source at runtime. Rebuild
the checkout:

```bash
pnpm build
forge --version
```

Confirm which executable your shell sees with `command -v forge`. If the link
is no longer wanted, run `pnpm unlink:global`.

## Configuration is invalid or surprising

Run:

```bash
pnpm forge config validate
pnpm forge config show
```

Common causes are malformed JSON, an unknown field, a missing
`"schemaVersion": 1`, or a user-only field inside project `.forge/config.json`. Project files may
set only stricter `limits` and `context` values. The `show` output includes each
setting's source so an environment or CLI override is visible.

If `FORGE_HOME` is set, Forge does not use `~/.forge` for that process. Check
the `Forge home:` line before editing a file.

## API authentication fails

### `Missing DEEPSEEK_API_KEY` or `Missing OPENAI_API_KEY`

Open interactive Forge and use `/login` to save a key, or export the named
variable:

```bash
export DEEPSEEK_API_KEY="your-api-key"
# or
export OPENAI_API_KEY="your-api-key"
```

Environment values win over `$FORGE_HOME/auth.json`. Inspect the source without
printing the key:

```bash
pnpm forge auth status deepseek
pnpm forge auth status openai-api
```

If `/logout` reports that an environment variable remains active, unset it in
the parent shell yourself. A child process cannot edit its parent's
environment.

### ChatGPT subscription and OpenAI API were confused

They are separate access routes:

- `OPENAI_API_KEY` uses the usage-based OpenAI API through the native Forge
  Engine.
- `forge auth login openai` and `forge codex ...` use ChatGPT subscription
  access through Codex App Server.

Forge never converts one into the other. See Authentication.

### A stored compatible-route key stopped working after an endpoint change

Stored route credentials are bound to the canonical `baseUrl`. Forge refuses
to send an old key to a different endpoint. Open `/login`, select the route,
and save a new credential after reviewing the URL.

### Provider request fails before authentication

Errors such as DNS lookup failure, connection refusal, TLS failure, or timeout
happen before a provider can accept or reject the key. Check network access,
the route's `baseUrl`, proxy variables, and whether a local server is running.
Do not rotate or paste credentials until the transport layer is reachable.

## ChatGPT or Codex Engine setup fails

Confirm that Codex CLI is installed and available, then inspect the shared
account and model catalog:

```bash
pnpm forge auth status openai
pnpm forge models list --provider openai
```

Use device-code login when a browser callback is unavailable:

```bash
pnpm forge auth login openai --method device-code
```

`forge auth logout openai` operates on the shared Codex account and may sign
other local Codex clients out. Forge does not read or repair Codex's credential
file directly.

## A write, command, network request, or subagent was denied

Under `safe`, the first write in each native run requires confirmation. Every
process command, registered network-tool call, and delegated model run also
requires confirmation. Under `workspace-write`, file writes are automatic, but
the latter three actions still require confirmation.

When stdin/stderr are not TTYs, a one-shot native run has no approval channel;
confirmation-required actions are denied. This is expected fail-closed
behavior. Run in a terminal, narrow the task to read-only behavior, or use a
purpose-built automation/evaluation approval channel. Do not switch profiles
expecting OS isolation: neither profile sandboxes an approved process.

## A project plugin is listed but skipped

Project plugins are discovered from the canonical workspace root's
`.forge/plugins/` directory but are not imported before trust. Review the code,
then use either the interactive `/plugins` panel or:

```bash
pnpm forge plugins list
pnpm forge plugins trust
```

For an explicit non-interactive trust decision:

```bash
pnpm forge plugins trust --yes
```

Trust is stored outside the repository and is keyed to the canonical workspace
path. A copied or moved checkout needs a new decision. User plugins instead
live under `$FORGE_HOME/plugins` and must be named in `plugins.enabled`.

The Codex Engine owns a separate tool runtime and does not load Forge plugins.

## `web_search` or `web_fetch` is unavailable

These are not built-in tools. They come from the optional checked-in
`examples/plugins/web-tools` example. Install and enable that plugin explicitly,
then restart Forge and confirm the startup resource panel lists it.

If requests fail behind a proxy, the example honors `HTTP_PROXY`,
`HTTPS_PROXY`, and `NO_PROXY` (plus lowercase aliases). Configure an HTTP or
mixed proxy endpoint, not a SOCKS-only port. Direct and `NO_PROXY` destinations
retain private/reserved-address checks. See the example README.

## Reasoning is missing or marked unavailable

Forge renders and persists only reasoning text the provider actually exposes.
Positive reasoning-token usage does not guarantee that the API returned a
displayable summary or delta. Forge will not invent hidden chain of thought.

Check the selected provider, model, and effort:

```bash
pnpm forge config show
```

Then use `/model` and `/effort` to select a capability advertised by the
provider. If answers stream normally but reasoning is explicitly unavailable,
the limitation may be upstream rather than a terminal rendering failure.

## Image attachment fails

Forge accepts JPEG, PNG, GIF, and WebP, with at most 8 images, 20 MiB each, and
40 MiB total. It validates file magic bytes rather than trusting the extension.
The selected native model must declare image support.

User-pasted or `--image` paths are explicit attachment authorization and may be
outside the workspace. Model-invoked file tools remain workspace-confined.
Check for a readable regular file, supported format, size limit, and compatible
model. Session files do not persist base64 image data.

## Resume cannot find or open a session

Sessions are workspace-bound. Start Forge inside the same canonical repository
and try:

```bash
pnpm forge resume --last
```

Session snapshots live under `$FORGE_HOME/sessions`. Changing `FORGE_HOME`,
moving the checkout, deleting a snapshot, or corrupting its JSON changes what
is available. Resume restores only completed turns; it cannot continue an
interrupted stream or pending tool call.

## Terminal input or rendering looks wrong

- Enter submits.
- Shift+Enter inserts a newline in supported terminals.
- Ctrl+J is the portable multiline fallback.
- Ctrl+C closes a menu first, cancels a run second, and exits only when idle.
- `NO_COLOR` disables color; redirected output uses plain terminal-safe text.

Forge has specific keyboard handling for VS Code and Ghostty. If a terminal
cannot distinguish Shift+Enter, use Ctrl+J. Record the terminal name, `TERM`,
and the exact key behavior when reporting a reproducible issue; do not include
credentials or private trace content.

## Collect a safe diagnostic bundle

Before opening an issue, capture only non-secret output:

```bash
node --version
pnpm --version
pnpm forge --version
pnpm forge config validate
pnpm forge plugins list
git rev-parse --short HEAD
```

Also include the command, expected behavior, first actionable error, operating
system, terminal, and whether the run used Forge Engine or Codex Engine. If a
native trace exists, `forge inspect <run-id>` can summarize it, but review the
result before sharing: traces may contain repository text, diffs, commands,
model output, and provider-exposed reasoning.
