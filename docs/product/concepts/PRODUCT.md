# Product Definition

[简体中文](../../zh-CN/product/concepts/PRODUCT.md) · [Documentation index](../../README.md)

Forge is a lightweight, transparent, safe-by-default coding agent that inspects local repositories, runs bounded tools, asks before risky actions, and records what happened. You can use it in the terminal (`@jslee124/forge`) or through the separate Electron desktop preview.

Unlike opaque agent wrappers, Forge tries to make every step inspectable: provider-supplied reasoning stays visible when returned, policy decisions happen before execution, and every run leaves an auditable trace rather than just a confident final paragraph.

## Who it is for

- **Agent builders & contributors** who want an explicit, modular TypeScript codebase to inspect, test, and experiment with runtime, policy, and context mechanics.
- **Individual developers** who want a focused local coding assistant with explicit workspace boundaries, readable diffs, and reproducible checks instead of black-box automation.

## Core workflow

```bash
forge run "Add input validation and update the tests"
```

1. **Validate setup**: Forge resolves user (`~/.forge/`) and project settings, freezes active `AGENTS.md` instructions for the run, and binds to the workspace root.
2. **Reason & inspect**: The active model selects read-only tools (`list_files`, `read_file`, `search`) to explore the codebase—allowed automatically inside the workspace under the `safe` profile.
3. **Approve changes & commands**: Before the first workspace edit or any process command (`run_command`), Forge pauses for explicit approval (or denies automatically in non-interactive runs without an approval channel).
4. **Verify & report**: Forge runs targeted checks requested or appropriate for the change, then ends with a terminal status (`completed`, `failed`, `cancelled`, `denied`, or `limit_reached`) grounded in observed tool results.

## Product principles

- **Transparent**: Provider reasoning blocks, tool calls, policy decisions, token estimates, and costs are exposed cleanly in the terminal and saved to redacted JSONL traces. When a model does not return reasoning text, Forge never fabricates it.
- **Safe by default**: Filesystem tools stay confined to the workspace (after resolving symlinks), edits require exact matches or complete-read hashes, commands use `spawn` with `shell: false`, and risky actions wait for explicit consent.
- **Verifiable**: Natural-language summaries never substitute for failing tests or builds; runtime stop conditions keep tool exits and narrative output distinct.
- **Modular, not framework-owned**: Forge uses focused libraries (Commander, Ink, AI SDK, Zod) where they eliminate boilerplate while keeping core loop, policy, and persistence logic under explicit repository control.
- **Extensible without weakening safeguards**: Trusted plugins can add tools, commands, prompt snippets, and single-depth host-managed subagents, and may tighten policy decisions—but never relax a core `deny` or `confirm`.
- **Small before broad**: Depth and reliability on core coding workflows matter more than shipping dozens of half-verified integrations.

## What ships today

- **Public CLI (`@jslee124/forge`)**: Non-interactive runs (`forge run`, `forge codex`) plus a multi-line Ink terminal UI with `@` file mentions, `/` slash commands, diff previews, and parallel session switching.
- **Model & engine routing**: Native DeepSeek, OpenAI API, and custom OpenAI-compatible HTTP routes (`@forge/model-*`), alongside official ChatGPT subscription runs via Codex App Server (`forge codex`).
- **Configuration & project context**: Hierarchical `~/.forge/config.json` and `.forge/config.json` with `forge config show` provenance, layered `AGENTS.md` instructions, portable Skills (`load_skill`), and explicitly trusted `.forge/plugins/`.
- **Sessions, context & traces**: Schema v3 session persistence (`forge resume`), redacted JSONL traces (`forge inspect <run-id>`), context budgeting (`/context`), manual checkpoints (`/compact`), and opt-in automatic compaction.
- **Desktop preview**: An Electron workbench ([Desktop guide](../operations/DESKTOP.md)) supporting both Native Forge and Codex engines, saved sessions, file/change/activity panels, approvals, and installer downloads. See [desktop productization work](../../development/DESKTOP_PRODUCT_IMPLEMENTATION.md#remaining-acceptance-work-2026-10-27) for open acceptance gates.

*(Originally anchored by the [v0.1 Acceptance Contract](../../history/v0.1/ACCEPTANCE.md).)*

## Intentional boundaries & future directions

Forge does **not** currently include:

- Remote execution or multi-machine session sync
- Vector RAG / repository-wide embedding indexes
- Automatic git commits, pushes, or pull requests
- OS-level process/plugin sandboxing (approved commands and trusted local JS plugins run with your OS user privileges)
- Built-in Anthropic Messages or Gemini adapters
- Arbitrary recursive multi-agent swarms (plugin subagents run one level deep under host control)

Future exploratory directions (broader evaluations, alternative runtime adapters, HTTP/SSE control surfaces, SQLite indexing) are tracked on the [Roadmap](../../development/ROADMAP.md) and carry no release promises until scheduled and verified.
