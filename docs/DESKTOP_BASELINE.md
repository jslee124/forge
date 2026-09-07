# Forge desktop D01 baseline and technical verification

[简体中文](zh-CN/DESKTOP_BASELINE.md) · [Design contract](DESKTOP_APP_PLAN.md) · [Task checklist](DESKTOP_APP_TASKS.md)

## Status and use

This is `current-development`, recorded 2026-09-06 as the D01 deliverable. It
documents the verified baseline, selected technical decisions, and labeled
unknowns for the desktop effort. It is not shipped behavior, packaged product
help, or live-provider evidence. Every check below was executed on the exact
checkout recorded in section 1; rerun the commands before relying on them after
code changes.

## 1. Verified checkout and toolchain baseline

| Item | Value |
| --- | --- |
| Commit | `5bbcd15f3557b507f08713985c769d423198457d` (branch `dev`, clean worktree) |
| Node.js (development) | v24.18.0 |
| pnpm | 11.18.0 (`packageManager` pinned) |
| Repository engine requirement | `node >=24` (root [package.json](../package.json)) |
| TypeScript | 7.0.2 (`tsc -b` project references) |
| Lint/format | Biome 2.5.8 |
| Test runner | Vitest 4.1.10 |
| Bundler (CLI npm package) | esbuild 0.28.2 |

Current offline test baseline at this commit: `CI=true pnpm build && CI=true
pnpm exec vitest run` → **58 test files, 360 tests, all passed** (~9s).

`CI=true pnpm check` initially failed on pre-existing lint/format errors in the
vendored `.agents/skills/archify` tooling committed at `4a41f93` (unrelated to
desktop work); the shared Biome config now excludes `**/.agents` the same way
`dist`/`coverage` were already excluded, and `CI=true pnpm check` passes.

Workspaces: `apps/cli` plus 11 `packages/*` private `@forge/*` packages
(`auth`, `codex-app-server`, `config`, `core`, `model-compat`,
`model-deepseek`, `model-openai`, `persistence`, `plugin-api`, `resources`,
`tools`) and `evals`. All `@forge/*` packages are private; this stays true for
desktop.

## 2. TUI engine paths (verified against source)

Both engines are wired through the same interactive submission and share one
canonical conversation:

### Native Forge engine

- CLI entry: [program.ts](../apps/cli/src/program.ts) defines `ask`, `run`
  (`--engine forge|codex`), `codex`, `auth`, `models`, `config`, `inspect`,
  `resume`, `plugins`, `resources`.
- Assembly: `runTask` in [run.ts](../apps/cli/src/run.ts) (line 118) loads
  config/instructions/Skills/plugin host, builds the model adapter, resolves
  the workspace, and calls `runAgent` from `@forge/core` with
  `RunDependencies` (injectable env/cwd/streams/signal/approval
  channel/store/conversation/checkpoint). It is already dependency-injected
  and terminal-free — the Ink-free path is `renderEventsToOutput: false` plus
  an injected `onEvent`; no rewrite is needed to host it in a child process.
- Events: `RunEvent` union in [runtime.ts](../packages/core/src/runtime.ts)
  (`run.started/completed/failed/cancelled/denied/limit_reached`,
  `model.text/reasoning/…`, `tool.proposed/decision/started/completed/failed`,
  `context.*`, `skill.*`, `docs.*`). `RunResult` carries
  `status/finalText/events/modelSteps/toolCalls/canonicalDelta`.
- Approvals: `ApprovalChannel.request/requestStructured` with
  `ApprovalDescriptor` and `ApprovalResponse` (`allow-once`/`allow-session`/
  `deny`+feedback) in [policy.ts](../packages/core/src/policy.ts). The TUI
  builds one per submission via `createApprovalChannel` ([run.ts](../apps/cli/src/run.ts),
  line 734) with preview callbacks; cancellation resolves the pending question
  `null` (deny) and aborts the run signal.
- Interactive UI: [app.tsx](../apps/cli/src/interactive/app.tsx) `submitPrompt`
  (line 1659) creates an `AbortController`, calls
  `sessionPersistence.prepareRun`, branches on engine (line 1741), streams
  `RunEvent`/`CodexOutputEvent` into UI state, and records the run afterwards.

### Codex engine

- Command path: `runCodexTask` in [codex-command.ts](../apps/cli/src/codex-command.ts)
  (line 280). Transport: `CodexAppServerClient.connect` spawns
  `codex app-server --listen stdio://` (override `FORGE_CODEX_PATH`) and speaks
  line-delimited JSON-RPC over stdio
  ([client.ts](../packages/codex-app-server/src/client.ts), line 92). No TTY is
  required; it runs identically inside a Node child process.
- Authentication: ChatGPT subscription (`account/read` must return
  `account.type === "chatgpt"`), login via `account/login/start`
  (browser or device-code), logout via `account/logout`. API-key providers
  (`openai-api`, `deepseek`) go through `AuthenticationManager` instead.
- Execution: `thread/start` with `approvalPolicy` `on-request|never`, sandbox
  `workspace-write|read-only` mapped from the Forge permission profile,
  `ephemeral: true`, then `turn/start`; cancellation is `turn/interrupt`.
- Approvals arrive as server requests
  (`item/commandExecution/requestApproval`,
  `item/fileChange/requestApproval`) answered `{decision: "accept"|"decline"}`;
  Forge declines by default when no interactive confirm is available.
- Events: notifications (`item/agentMessage/delta`,
  `item/reasoning/summaryTextDelta`, `item/started`, `item/completed`,
  warnings) are projected to `CodexOutputEvent`
  (`system/reasoning/answer/tool/warning/login`). Codex runs are recorded into
  the Forge session with `tracePersisted: false` (no JSONL trace exists for
  Codex turns; the UI synthesizes a minimal `RunResult`).
- Codex does not use Forge tools, Skills, plugins, or policy. Do not present
  Forge plugin tools as Codex capabilities.

### Engine selection and continuation

- The engine is part of the persisted model selection
  (`engine: "forge" | "codex"`, `activeOptions.engine`, app.tsx line 1289);
  `forge run --engine codex` selects it non-interactively. The TUI may switch
  engines between runs through the model picker; an active run is never
  switched.
- Both engines consume the same in-memory/persisted Forge conversation.
  Switching to Codex serializes the canonical history into the turn text
  wrapper (`codexPrompt`, codex-command.ts line 437); Codex threads are
  ephemeral, so nothing else carries over. Provider continuations, reasoning
  traces, and tool-call history do not transfer across engines, and approval
  authority is never restored from history.

## 3. Persistence and configuration baseline

- Forge home: `$FORGE_HOME` env or `~/.forge`
  ([loader.ts](../packages/config/src/loader.ts), line 315). Workspace
  resolution: canonical cwd, nearest ancestor `.git` becomes
  `workspaceRoot`, otherwise the starting directory. `workingDirectory` and
  `workspaceRoot` are distinct fields — the desktop must preserve this split.
- Sessions: `FileSessionStore` writes `$FORGE_HOME/sessions/<sessionId>.json`,
  schema version 3, zod-validated, secret-redacted, atomic (temp file +
  rename), mode `0o700`, hard byte limit with no partial overwrite
  ([session-store.ts](../packages/persistence/src/session-store.ts)).
- Traces: `FileTraceStore` appends `$FORGE_HOME/runs/<runId>.jsonl`, redacted
  ([trace-store.ts](../packages/persistence/src/trace-store.ts)). Resume
  migrates structured history from traces when the snapshot predates it.
- No cross-process locking exists today. D06 must add the minimal conflict/
  busy rejection described in the contract; the desktop must not open a
  session another client is actively running.
- Plugins are loaded at runtime by dynamic `import(pathToFileURL(entry))`
  from `$FORGE_HOME/plugins/<name>/plugin.json` (user scope) and
  `<workspaceRoot>/.forge/plugins/` (project scope, trust-gated)
  ([host.ts](../packages/plugin-api/src/host.ts), line 181). Verified live:
  the `web-tools` example plugin loads under Electron's Node and registers
  `web_search`/`web_fetch`.
- Builtin resources (Skills, product docs) are discovered relative to the
  module URL: `<module>/../resources/skills|docs` in packaged layout,
  `<module>/../../resources/...` in the repo
  ([catalog.ts](../packages/resources/src/catalog.ts),
  [docs.ts](../packages/resources/src/docs.ts)). Desktop packaging must keep
  `resources/` adjacent to the agent bundle (see section 5).

## 4. Dependency and compatibility matrix

Runtime dependencies (installed versions, Node engines):

| Dependency | Version | engines.node | Desktop relevance |
| --- | --- | --- | --- |
| commander | 15.0.0 | ≥22.12.0 | CLI-only; not needed by desktop |
| ink / react | 7.1.1 / 19.2.8 | ≥22 / — | TUI-only for ink; React 19.2.8 shared with desktop renderer |
| undici | 7.29.0 | ≥20.18.1 | HTTP dispatcher inside providers |
| zod | 4.4.3 | — | validation; reuse for IPC message schemas |
| ai / @ai-sdk/openai / @ai-sdk/deepseek | 7.0.66 / 4.0.43 / 3.0.28 | ≥22 | provider adapters (native engine) |

All engines constraints are satisfied by Node ≥22.12; the binding constraint
is the repository's own `node >=24`. `node:` builtins used across the repo:
`path`, `os`, `url`, `crypto`, `child_process`, `fs`, `stream`, `readline`,
`events`, `util`, `net`, `http` — all stable long before Node 22; no
version-fragile API was found.

### Electron verification (executed, offline)

| Check | Command | Result |
| --- | --- | --- |
| Bundled runtime | `ELECTRON_RUN_AS_NODE=1 electron -e "console.log(process.versions)"` | Electron **44.2.0** → Node **24.20.0**, Chromium 152.0.7977.76, V8 15.2, darwin-arm64 |
| Forge CLI under Electron Node | `ELECTRON_RUN_AS_NODE=1 electron apps/cli/dist/index.js --version / --help` | `0.3.4`; full help rendered |
| Core + persistence under Electron Node | fake-adapter `runAgent` turn + `FileSessionStore` save/load + `JsonlTraceWriter`/`FileTraceStore` round-trip (9 events) | `status:"completed"`, session reloaded, identical to system Node 24.18.0 |
| Dynamic plugin loading | `loadPluginHost` with the `web-tools` example plugin under Electron Node | tools `web_search`, `web_fetch` registered, no warnings |
| Builtin resources | `discoverSkillCatalog` + `createForgeDocsTools` + a real docs search under Electron Node | 2 builtin Skills found; `search_forge_docs` returned results |

Selection: **Electron 44.x** (start at 44.2.0). Its bundled Node 24.20.0
satisfies `node >=24` and the ≥22.12 engine floors of every runtime
dependency, and the whole native-engine core runs on it. Electron 44 requires
**macOS 13 (Ventura) or later** (macOS 12 support was removed). electron-vite
5.x is the selected build tooling per the contract; the concrete desktop
scaffold is D02 scope.

## 5. Desktop platform, process, and distribution decisions (D01-owned)

| Decision | Selection | Basis |
| --- | --- | --- |
| Container | Electron 44.2.0 (44.x line) | Verified Node 24.20.0; macOS 13+; supported stable major |
| Minimum OS / CPU | macOS 13 Ventura+; arm64 and x64 builds (universal optional) | Electron 44 platform floor; build per-arch first, add universal only if size is acceptable |
| Agent process | One Electron `utilityProcess` per app instance hosting the agent entry | Node-compatible runtime, MessagePort IPC, owned lifecycle; no parallel runs, so one process suffices. `child_process.fork` remains a documented fallback if a D05 blocker appears |
| Transport | MessagePort pair; JSON messages validated with zod, built on `RunEvent`/`RunResult`/approval descriptors plus explicit `sessionId`/`runId`/`requestId` and sequence numbers | Contract requires validated typed messages; no stdout protocol; renderer never receives credentials or raw Node access |
| Window close / app exit | Closing the window during an active run prompts (stop-and-close default). Quitting the app always cancels the active run and terminates the Agent process (SIGTERM, then SIGKILL after a short grace). Hiding a window never implies execution stopped; background continuation is not promised in v1 | Contract section 5/6-E; no silent background execution |
| Cross-engine continuation | Engine switch allowed only between runs. Continuation carries the canonical text history only (native: conversation; Codex: JSON wrapper). Provider continuation, reasoning, tool history, and approval authority never transfer; UI labels this explicitly | Verified current TUI behavior; contract forbids promising lossless switching |
| Packaging tool | electron-builder (DMG/zip targets, arm64+x64) after electron-vite build | Mature offline macOS packaging; Electron Forge pipeline explicitly not maintained (contract) |
| Distribution | Local, unsigned DMG/zip artifacts for development smoke; signing/notarization/updates deferred to D13 and require an Apple Developer identity (unknown, external cost) | Tasks file forbids publication without permission |
| Packaged layout | Agent bundle + `resources/` (skills, docs) shipped outside ASAR (extraResources/asarUnpack) so `import.meta.url` discovery and dynamic plugin `import()` keep working; user plugins always live in `$FORGE_HOME`/workspace, never in ASAR | Verified resource discovery paths and plugin dynamic import; Electron cannot `import()` ESM from inside ASAR |
| Diff rendering | `react-diff-view` 3.3.3 locked behind a replaceable `DiffViewer` component | Sample validation below |

## 6. react-diff-view validation (executed, offline)

`react-diff-view` 3.3.3 (peer `react >=16.14`, works with the shared React
19.2.8; `gitdiff-parser` + `diff-match-patch` underneath) was validated with
real `git diff` output rendered via `react-dom/server`:

| Sample | Parsed/rendered result | Parse + render time |
| --- | --- | --- |
| 2,000-line file, 2 edits in the middle (2 hunks) | correct rows/hunks/line numbers | <5 ms |
| 10 modified files in one patch | 10 files, 10 hunks, 40 ins/20 del/40 ctx gutters (unified) | 0.1 + 0.8 ms |
| Chinese path `中文目录/测试文件.md`, raw UTF-8 patch | path and CJK content render correctly | — |
| Chinese path, git default `core.quotepath=true` octal quoting | path stays octal-escaped (`\344\270\255…`) — **not decoded** | — |
| Large change: 3,000 added lines (13 files total, 3,024 ins / 13 del / 35 ctx) | row counts match git output exactly in unified and split views | parse 1.1 ms; static render 80–110 ms (~0.8 MB HTML) |

Conclusions: lock react-diff-view for v1 behind a replaceable `DiffViewer`.
Requirements carried into D09: generate diffs with `git -c core.quotepath=false
diff` (or decode quoted headers) so Chinese paths survive; use `hunks`
collapsing/virtualization for very large diffs; unified and split both work.

## 7. Unknowns, limits, and next dependencies

- **Live providers**: nothing here tests real DeepSeek/OpenAI/Codex service
  behavior; D07/D08 cover that with explicit authorization.
- **Signing/notarization/updates**: deferred to D13; requires an Apple
  Developer identity (external cost, unresolved).
- **GUI-launched environment**: PATH, `FORGE_HOME`, `FORGE_CODEX_PATH`, and
  proxies differ when launched from Finder; D13 must verify effective values,
  not assume the development shell.
- **electron-builder + Electron 44**: version compatibility must be confirmed
  at D02 packaging time (electron-builder moves fast; if it lags, `@electron/
  packager` or manual zip is the fallback for smoke artifacts).
- **pdfjs-dist / papaparse / Readability / jsdom / i18next / Zustand / Shiki**:
  versions are D10/D11/D03 scope per the contract and are not selected here.
- **Multiple concurrent desktop clients** (desktop + TUI on one session):
  unsolved by design until D06 adds busy rejection; the desktop must surface
  the error instead of overwriting.
- Scratch verification artifacts (Electron install, diff fixtures) were
  created under `/tmp/d01-verify` and are ephemeral; the commands in this
  document reproduce them.
