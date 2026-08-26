# Getting Started

[简体中文](zh-CN/GETTING_STARTED.md) · [Documentation index](README.md)

This guide takes a new contributor from a clean checkout to a verified Forge
session. It uses only local validation until you deliberately send a prompt to
a provider.

## What you will do

1. Install and build the development checkout.
2. Choose one model-access route.
3. Validate the effective configuration without a paid request.
4. Run a read-only prompt, then a coding task with explicit approvals.
5. Find the saved session and run trace.

## Prerequisites

- Node.js 24 or newer
- pnpm 11.18.0, as pinned by the root `packageManager` field
- Git
- One model-access route:
  - a DeepSeek API key;
  - an OpenAI API key;
  - a configured OpenAI-compatible endpoint; or
  - Codex CLI with an eligible ChatGPT account for the separate Codex Engine.

Forge's development workspace remains private. Release automation produces one
public CLI package, `@jslee124/forge`, while internal packages and the plugin
SDK remain private. Until the first npm release is visible, run from source or
link the current checkout globally.

For a published build:

```bash
npm install --global @jslee124/forge
forge --version
```

## 1. Install the checkout

```bash
git clone https://github.com/jslee124/forge.git
cd forge
pnpm install --frozen-lockfile
pnpm build
pnpm forge --version
```

The final command builds the workspace and should print `0.3.0-bootstrap.0` for the current
source release. It does not contact a model provider.

During development you can keep using `pnpm forge`. To expose the same checkout
as a global `forge` command:

```bash
pnpm link:global
forge --version
```

The link points to `apps/cli/dist`, so run `pnpm build` after source changes.
Remove it later with `pnpm unlink:global`.

## 2. Choose an access route

Forge exposes two execution engines. Pick the route that matches how you want
to authenticate and which runtime should own tools and approvals.

| Route | Engine | Credential owner | Start here |
| --- | --- | --- | --- |
| DeepSeek API | Forge Engine | Forge stored key or `DEEPSEEK_API_KEY` | Run `pnpm forge`, then `/login` |
| OpenAI API | Forge Engine | Forge stored key or `OPENAI_API_KEY` | Run `pnpm forge`, then `/login` |
| OpenAI-compatible endpoint | Forge Engine | Configured environment variable or Forge stored route key | Add the route through `/login` or user configuration |
| ChatGPT subscription | Codex Engine | Codex App Server | `pnpm forge auth login openai` |

OpenAI API usage and ChatGPT subscription access are separate. A ChatGPT
subscription does not supply `OPENAI_API_KEY`, and an API key does not make a
Codex subscription session.

### Option A: interactive API-key setup

Start the terminal UI:

```bash
pnpm forge
```

Enter `/login`, choose DeepSeek, OpenAI API, or a configured route, and paste
the key into the masked field. Forge saves it to `$FORGE_HOME/auth.json`
(`~/.forge/auth.json` by default), protected by owner-only filesystem
permissions. Environment variables take precedence over a saved key.

Use `/model` to choose the engine, provider, and model. Use `/effort` or
Shift+Tab to choose a reasoning level advertised by that model.

### Option B: environment variables

Environment variables are convenient for automation and temporary shells:

```bash
export DEEPSEEK_API_KEY="your-api-key"
# or
export OPENAI_API_KEY="your-api-key"
```

Do not put keys in `.forge/config.json`, prompts, committed shell files, issue
reports, or run-trace examples. Forge's user and project configuration schemas
reject secret fields.

### Option C: ChatGPT subscription through Codex

Install Codex CLI first, then let the official App Server own browser or device
code sign-in:

```bash
pnpm forge auth login openai
pnpm forge auth status openai
pnpm forge models list --provider openai
```

For a headless machine, use:

```bash
pnpm forge auth login openai --method device-code
```

The Codex Engine owns its own agent runtime, sandbox, tools, approvals, and
conversation state. Native Forge plugins and JSONL run traces do not wrap that
engine. See [Authentication](AUTHENTICATION.md) for the complete boundary.

## 3. Validate configuration locally

These commands parse and merge configuration without making a model request:

```bash
pnpm forge config validate
pnpm forge config show
pnpm forge plugins list
```

`config show` prints the effective value and source for each public setting. A
fresh configuration begins with the `safe` permission profile, 12 model steps,
40 tool calls, a 60-second command timeout, trace persistence enabled, and
context mode `warn`.

If the output is surprising, read [Configuration](CONFIGURATION.md) before
starting a run. In particular, project `.forge/config.json` may only tighten
limits and context behavior; it cannot select a model, enable plugins, or widen
permissions.

## 4. Run a first task

### Start read-only

From a small repository you understand, start the interactive UI:

```bash
pnpm forge
```

Ask a bounded question first:

```text
Inspect this repository. Summarize the package structure and name the commands
that verify a change. Do not modify files.
```

Workspace listing, reading, and search are allowed automatically under the
default `safe` profile. A native Forge Engine run streams model output and
provider-exposed reasoning separately and records structured runtime events.

### Try a coding task

```text
Fix one failing test. Show the proposed diff and run the narrowest relevant
verification command before reporting success.
```

Under `safe`, Forge asks before the first workspace write in that run and before
every process command. Read the full diff, command arguments, working directory,
and timeout before approving. Approval is not process isolation: an approved
program runs with your user privileges.

If you reject an action, Forge records the denial. It does not silently widen
the policy or treat missing input as consent.

### One-shot commands

Use the native Forge Engine without entering the interactive UI:

```bash
pnpm forge run "Inspect the repository and summarize its architecture"
```

Use the separate Codex Engine:

```bash
pnpm forge codex "Inspect the repository and summarize its architecture"
# equivalent engine selection:
pnpm forge run --engine codex "Inspect the repository"
```

A one-shot native run started from a TTY presents approval prompts in plain
terminal UI. If stdin or stderr is redirected, there is no approval channel and
any confirmation-required action is denied, so automated invocations should
start with read-only prompts unless they provide an explicit narrow channel.

## 5. Continue and inspect

Inside the terminal UI:

```text
/context    show the current context budget and checkpoint status
/compact    create an explicit conversation checkpoint
/resume     choose a saved session for this workspace
/help       show every interactive command
```

From the shell:

```bash
pnpm forge resume --last
pnpm forge inspect <run-id>
```

A session stores completed user/assistant turns. A run is one bounded agent-loop
execution with its own ID and JSONL event trace. Resume restores completed
conversation text, not old approvals, pending tool calls, child processes, or
provider continuation state. See [Sessions and traces](SESSIONS.md).

## Next steps

- Learn every terminal control in [CLI UI](CLI_UI.md).
- Customize models and limits with [Configuration](CONFIGURATION.md).
- Read [Security](SECURITY.md) before opening an untrusted repository or
  trusting a plugin.
- Add repository instructions or a Skill with [Project context](PROJECT_CONTEXT.md).
- Build an extension with [Plugin authoring](PLUGINS.md).
- Reproduce the paid-call-free evidence with `pnpm eval:deterministic` and the
  [Evaluation guide](EVALUATION.md).
- If setup does not behave as described, use [Troubleshooting](TROUBLESHOOTING.md).
