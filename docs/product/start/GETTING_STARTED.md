# Getting Started

[简体中文](../../zh-CN/product/start/GETTING_STARTED.md) · [Documentation index](../../README.md)

This guide takes you from zero to a working Forge setup using local offline checks first, so you only spend tokens when you deliberately run a prompt.

## Prerequisites

- **Node.js** 24.22.1 or newer
- **pnpm** 11.18.0 (pinned in the root `packageManager` field)
- **Git**
- One model-access route:
  - DeepSeek API key (`DEEPSEEK_API_KEY`)
  - OpenAI API key (`OPENAI_API_KEY`)
  - Any OpenAI-compatible HTTP endpoint
  - Codex CLI signed in with an eligible ChatGPT account (for the separate Codex Engine)

For normal CLI usage, install the single published package `@jslee124/forge` (workspace `@forge/*` packages remain private):

```bash
npm install --global @jslee124/forge
forge --version
```

## 1. Build the source checkout

If you are working from the repository checkout instead of the global npm package:

```bash
git clone https://github.com/jslee124/forge.git
cd forge
pnpm install --frozen-lockfile
pnpm build
pnpm forge --version
```

`pnpm forge --version` should print `0.5.0-preview.1` without touching the network. You can keep using `pnpm forge ...` during development, or run `pnpm link:global` (and later `pnpm unlink:global`) so plain `forge` points to `apps/cli/dist`—remember to rerun `pnpm build` after editing TypeScript sources.

## 2. Pick a model-access route

| Route | Engine | Who holds credentials | Quickest setup |
| --- | --- | --- | --- |
| DeepSeek API | Forge Engine | Forge stored key or `DEEPSEEK_API_KEY` | Run `pnpm forge`, then `/login` |
| OpenAI API | Forge Engine | Forge stored key or `OPENAI_API_KEY` | Run `pnpm forge`, then `/login` |
| OpenAI-compatible route | Forge Engine | Stored route key or env var | Configure via `/login` or user config |
| ChatGPT subscription | Codex Engine | Codex App Server | `pnpm forge auth login openai` |

> **Important:** OpenAI API keys and ChatGPT subscriptions are separate systems. A ChatGPT subscription cannot replace `OPENAI_API_KEY`, and an API key does not authenticate Codex Engine.

### Option A: Interactive `/login` (recommended for local work)

Start `pnpm forge`, run `/login`, pick a provider (or add an OpenAI-compatible endpoint), and paste your key into the masked input. Forge stores it in `$FORGE_HOME/auth.json` (`~/.forge/auth.json` by default) with owner-only file permissions. Then pick models with `/model` and thinking depth with `/effort` (or `Shift+Tab`).

### Option B: Environment variables

Useful for scripts and temporary shells (environment variables always override stored keys):

```bash
export DEEPSEEK_API_KEY="your-api-key"
# or
export OPENAI_API_KEY="your-api-key"
```

Never place secrets in `.forge/config.json`, shell history you commit, issue reports, or trace excerpts—Forge's project configuration schemas reject secret fields automatically.

### Option C: ChatGPT subscription (Codex Engine)

Install Codex CLI first, then sign in through the official App Server:

```bash
pnpm forge auth login openai
pnpm forge auth status openai
pnpm forge models list --provider openai
```

On headless machines without a browser:

```bash
pnpm forge auth login openai --method device-code
```

Codex Engine runs inside Codex App Server with its own tools, sandbox, approvals, and history; native Forge plugins and JSONL run traces do not wrap Codex runs. See [Authentication](AUTHENTICATION.md).

## 3. Verify local config before calling a model

Run these offline commands to inspect merged settings, provenance, and discovered extensions:

```bash
pnpm forge config validate
pnpm forge config show
pnpm forge plugins list
```

A clean installation starts with the `safe` permission profile, a 60-second command timeout, trace persistence enabled, and `manual` context management. Note that a project's `.forge/config.json` may lower budgets or make rules stricter, but cannot override your chosen model, enable plugins, or loosen permissions. See [Configuration](CONFIGURATION.md).

## 4. Run your first task

Start interactive mode in a workspace you recognize:

```bash
pnpm forge
```

Try a read-only prompt first (allowed automatically under `safe` without prompts):

```text
Inspect this repository. Summarize the package structure and name the commands
that verify a change. Do not modify files.
```

Then try a coding change that asks for approval:

```text
Fix one failing test. Show the proposed diff and run the narrowest relevant
verification command before reporting success.
```

Under `safe`, Forge pauses to show the full diff or command (`cwd`, arguments, timeout) before applying the first workspace write or running a shell command. Review carefully before confirming—an approved command runs with your normal OS user privileges, and denying an action cleanly records the refusal instead of retrying behind the scenes.

### One-shot CLI runs

Run without entering the TUI:

```bash
pnpm forge run "Inspect the repository and summarize its architecture"
pnpm forge codex "Inspect the repository and summarize its architecture"
# equivalent Codex selection:
pnpm forge run --engine codex "Inspect the repository"
```

When stdin or stderr is redirected (no TTY approval channel), actions requiring confirmation are denied automatically, so non-interactive scripts should stick to read-only tasks unless given an explicit narrow approval policy.

## 5. Resume and inspect sessions

Inside the interactive UI:

- `/context` — inspect token usage, budget breakdown, and checkpoint status
- `/compact` — create a conversation checkpoint without losing saved history
- `/resume` — browse and resume a saved workspace session
- `/help` — list all interactive slash commands

From your shell:

```bash
pnpm forge resume --last
pnpm forge inspect <run-id>
```

Resuming restores completed conversation context after validating the workspace, without re-arming old approvals, background processes, or provider continuation tokens. See [Sessions and traces](../reference/SESSIONS.md).

## Where to go next

- [CLI UI reference](../reference/CLI_UI.md) — keyboard shortcuts, `@` file mentions, images, and parallel session switching
- [Configuration](CONFIGURATION.md) — user vs. project config precedence and limits
- [Security model](../concepts/SECURITY_MODEL.md) — exact workspace, plugin, and process boundaries
- [Project context](../reference/PROJECT_CONTEXT.md) & [Plugin authoring](../reference/PLUGINS.md) — adding `AGENTS.md`, portable Skills, or local plugins
- [Evaluation guide](../../development/EVALUATION.md) — running `pnpm eval:deterministic` without paid model calls
- [Troubleshooting](TROUBLESHOOTING.md) — diagnosing auth, terminal, or approval issues
