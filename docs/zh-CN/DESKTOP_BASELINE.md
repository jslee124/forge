# Forge 桌面端 D01 基线与技术验证

[English](../DESKTOP_BASELINE.md) · [设计契约](DESKTOP_APP_PLAN.md) · [任务清单](DESKTOP_APP_TASKS.md)

## 状态与用途

本文为 `current-development`，于 2026-09-06 作为 D01 交付物记录。它汇总已验证
的基线、已选定的技术决策以及标注的未知项。它不是已发布行为、打包产品帮助，
也不是在线服务证据。以下每项检查都在第 1 节记录的确切 checkout 上执行；代码
变更后请在依赖结论前重新运行命令。

## 1. 已验证的 checkout 与工具链基线

| 项目 | 值 |
| --- | --- |
| 提交 | `5bbcd15f3557b507f08713985c769d423198457d`（分支 `dev`，工作区干净） |
| Node.js（开发环境） | v24.18.0 |
| pnpm | 11.18.0（`packageManager` 固定） |
| 仓库引擎要求 | `node >=24`（根 [package.json](../../package.json)） |
| TypeScript | 7.0.2（`tsc -b` 项目引用） |
| Lint/格式化 | Biome 2.5.8 |
| 测试框架 | Vitest 4.1.10 |
| 打包器（CLI npm 包） | esbuild 0.28.2 |

当前提交下的离线测试基线：`CI=true pnpm build && CI=true pnpm exec vitest run`
→ **58 个测试文件、360 个测试全部通过**（约 9 秒）。`CI=true pnpm check`
通过（Biome + 类型检查 + 发布路由校验）。

工作区：`apps/cli`、11 个私有 `@forge/*` 包（`auth`、`codex-app-server`、
`config`、`core`、`model-compat`、`model-deepseek`、`model-openai`、
`persistence`、`plugin-api`、`resources`、`tools`）以及 `evals`。所有
`@forge/*` 包保持私有；桌面端沿用。

## 2. TUI 引擎路径（对照源码验证）

两个引擎接入同一个交互式提交流程，并共享同一条规范会话：

### 原生 Forge 引擎

- CLI 入口：[program.ts](../../apps/cli/src/program.ts) 定义 `ask`、`run`
  （`--engine forge|codex`）、`codex`、`auth`、`models`、`config`、
  `inspect`、`resume`、`plugins`、`resources`。
- 装配：[run.ts](../../apps/cli/src/run.ts) 的 `runTask`（118 行）加载
  配置/指令/Skill/插件宿主，构建模型适配器，解析工作区，然后携带
  `RunDependencies`（可注入 env/cwd/流/信号/审批通道与存储/会话/检查点）
  调用 `@forge/core` 的 `runAgent`。它已经依赖注入且与终端无关——
  `renderEventsToOutput: false` 加注入 `onEvent` 即为无 Ink 路径；
  放入子进程无需重写。
- 事件：[runtime.ts](../../packages/core/src/runtime.ts) 的 `RunEvent` 联合
  （`run.started/completed/failed/cancelled/denied/limit_reached`、
  `model.text/reasoning/…`、`tool.proposed/decision/started/completed/failed`、
  `context.*`、`skill.*`、`docs.*`）。`RunResult` 携带
  `status/finalText/events/modelSteps/toolCalls/canonicalDelta`。
- 审批：[policy.ts](../../packages/core/src/policy.ts) 的
  `ApprovalChannel.request/requestStructured`，配 `ApprovalDescriptor` 与
  `ApprovalResponse`（`allow-once`/`allow-session`/`deny`+反馈）。TUI 每次提交
  通过 `createApprovalChannel`（[run.ts](../../apps/cli/src/run.ts) 734 行）
  构建通道并挂预览回调；取消时待决审批解析为 `null`（拒绝）并中止运行信号。
- 交互界面：[app.tsx](../../apps/cli/src/interactive/app.tsx) 的
  `submitPrompt`（1659 行）创建 `AbortController`、调用
  `sessionPersistence.prepareRun`、按引擎分支（1741 行）、把
  `RunEvent`/`CodexOutputEvent` 流入界面状态，并在结束后记录运行。

### Codex 引擎

- 命令路径：[codex-command.ts](../../apps/cli/src/codex-command.ts) 的
  `runCodexTask`（280 行）。传输：`CodexAppServerClient.connect` 启动
  `codex app-server --listen stdio://`（可用 `FORGE_CODEX_PATH` 覆盖），
  通过 stdio 进行按行分隔的 JSON-RPC 通信
  （[client.ts](../../packages/codex-app-server/src/client.ts) 92 行）。
  不依赖 TTY；在 Node 子进程内行为一致。
- 认证：ChatGPT 订阅（`account/read` 必须返回
  `account.type === "chatgpt"`），经 `account/login/start` 登录（浏览器或
  设备码），`account/logout` 登出。API-key 提供方（`openai-api`、
  `deepseek`）走 `AuthenticationManager`。
- 执行：`thread/start` 携带 `approvalPolicy` `on-request|never`、按 Forge
  权限档映射的 sandbox `workspace-write|read-only`、`ephemeral: true`，随后
  `turn/start`；取消是 `turn/interrupt`。
- 审批以服务端请求形式到达（`item/commandExecution/requestApproval`、
  `item/fileChange/requestApproval`），应答 `{decision: "accept"|"decline"}`；
  无交互确认时 Forge 默认拒绝。
- 事件：通知（`item/agentMessage/delta`、
  `item/reasoning/summaryTextDelta`、`item/started`、`item/completed`、
  警告）投影为 `CodexOutputEvent`（`system/reasoning/answer/tool/warning/
  login`）。Codex 运行记入 Forge 会话且 `tracePersisted: false`（Codex 回合
  没有 JSONL 运行迹；界面合成最小 `RunResult`）。
- Codex 不使用 Forge 工具、Skill、插件或策略。不得把 Forge 插件工具宣称为
  Codex 能力。

### 引擎选择与续接

- 引擎属于持久化模型选择的一部分（`engine: "forge" | "codex"`、
  `activeOptions.engine`，app.tsx 1289 行）；`forge run --engine codex`
  可非交互选择。TUI 可在运行之间经模型选择器切换引擎；活动运行永不切换。
- 两个引擎消费同一份内存/持久化 Forge 会话。切到 Codex 时把规范历史序列化
  进回合文本包装（`codexPrompt`，codex-command.ts 437 行）；Codex 线程是
  临时性的，其余状态均不随行。Provider 续接、推理痕迹与工具调用历史不跨
  引擎迁移，审批授权也绝不从历史恢复。

## 3. 持久化与配置基线

- Forge home：`$FORGE_HOME` 环境变量或 `~/.forge`
  （[loader.ts](../../packages/config/src/loader.ts) 315 行）。工作区解析：
  规范化 cwd，最近祖先 `.git` 成为 `workspaceRoot`，否则为起始目录。
  `workingDirectory` 与 `workspaceRoot` 是不同字段——桌面端必须保留这一区分。
- 会话：`FileSessionStore` 写 `$FORGE_HOME/sessions/<sessionId>.json`，
  schema 版本 3，zod 校验，密钥脱敏，原子写（临时文件 + rename），
  权限 `0o700`，有硬字节上限且不发生部分覆盖
  （[session-store.ts](../../packages/persistence/src/session-store.ts)）。
- 运行迹：`FileTraceStore` 追加 `$FORGE_HOME/runs/<runId>.jsonl`，已脱敏
  （[trace-store.ts](../../packages/persistence/src/trace-store.ts)）。恢复
  时若快照较旧会从运行迹迁移结构化历史。
- 目前没有跨进程锁。D06 必须按契约加入最小冲突/占用拒绝；桌面端不得打开
  另一客户端正在运行的会话。
- 插件在运行时通过动态 `import(pathToFileURL(entry))` 从
  `$FORGE_HOME/plugins/<name>/plugin.json`（用户域）与
  `<workspaceRoot>/.forge/plugins/`（项目域，需信任）加载
  （[host.ts](../../packages/plugin-api/src/host.ts) 181 行）。已实测：
  `web-tools` 示例插件在 Electron 的 Node 下加载并注册
  `web_search`/`web_fetch`。
- 内置资源（Skill、产品文档）相对模块 URL 发现：打包布局为
  `<module>/../resources/skills|docs`，仓库布局为
  `<module>/../../resources/...`
  （[catalog.ts](../../packages/resources/src/catalog.ts)、
  [docs.ts](../../packages/resources/src/docs.ts)）。桌面打包必须让
  `resources/` 与 agent 包相邻（见第 5 节）。

## 4. 依赖与兼容性矩阵

运行时依赖（已装版本，Node engines）：

| 依赖 | 版本 | engines.node | 桌面相关性 |
| --- | --- | --- | --- |
| commander | 15.0.0 | ≥22.12.0 | 仅 CLI；桌面不需要 |
| ink / react | 7.1.1 / 19.2.8 | ≥22 / — | ink 仅 TUI；React 19.2.8 与桌面渲染层共用 |
| undici | 7.29.0 | ≥20.18.1 | 提供方内部的 HTTP 调度 |
| zod | 4.4.3 | — | 校验；IPC 消息 schema 复用 |
| ai / @ai-sdk/openai / @ai-sdk/deepseek | 7.0.66 / 4.0.43 / 3.0.35 | ≥22 | 原生引擎的提供方适配器 |

所有 engines 约束在 Node ≥22.12 即满足；真正的约束是仓库自身的
`node >=24`。仓库使用的 `node:` 内建模块：`path`、`os`、`url`、`crypto`、
`child_process`、`fs`、`stream`、`readline`、`events`、`util`、`net`、
`http`——全部远早于 Node 22 稳定；未发现版本脆弱 API。

### Electron 验证（已执行，离线）

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 内置运行时 | `ELECTRON_RUN_AS_NODE=1 electron -e "console.log(process.versions)"` | Electron **44.2.0** → Node **24.20.0**、Chromium 152.0.7977.76、V8 15.2、darwin-arm64 |
| Electron Node 下跑 Forge CLI | `ELECTRON_RUN_AS_NODE=1 electron apps/cli/dist/index.js --version / --help` | `0.3.4`；完整帮助正常 |
| Electron Node 下核心+持久化 | 假适配器 `runAgent` 回合 + `FileSessionStore` 保存/加载 + `JsonlTraceWriter`/`FileTraceStore` 往返（9 个事件） | `status:"completed"`、会话重载成功；与系统 Node 24.18.0 完全一致 |
| 动态插件加载 | Electron Node 下 `loadPluginHost` 加载 `web-tools` 示例插件 | 注册 `web_search`、`web_fetch`，无警告 |
| 内置资源 | Electron Node 下 `discoverSkillCatalog` + `createForgeDocsTools` + 真实 docs 搜索 | 找到 2 个内置 Skill；`search_forge_docs` 返回结果 |

选型：**Electron 44.x**（自 44.2.0 起）。其内置 Node 24.20.0 满足
`node >=24` 及所有运行时依赖的 ≥22.12 engines 下限，原生引擎核心在其中
完整运行。Electron 44 要求 **macOS 13（Ventura）或更高**（已移除 macOS 12
支持）。按契约选定 electron-vite 5.x 作为构建工具；具体桌面脚手架属 D02。

## 5. 桌面平台、进程与分发决策（D01 负责）

| 决策 | 选型 | 依据 |
| --- | --- | --- |
| 容器 | Electron 44.2.0（44.x 线） | 已验证 Node 24.20.0；macOS 13+；受支持的稳定大版本 |
| 最低系统/CPU | macOS 13 Ventura+；arm64 与 x64 分别构建（universal 可选） | Electron 44 平台下限；先分架构构建，体积可接受再考虑 universal |
| Agent 进程 | 每应用实例一个 Electron `utilityProcess` 承载 agent 入口 | Node 兼容运行时、MessagePort IPC、生命周期可控；无并行运行，单进程足够。若 D05 遇到阻塞，`child_process.fork` 为已记录回退 |
| 传输 | MessagePort 对；JSON 消息经 zod 校验，基于 `RunEvent`/`RunResult`/审批描述符，附带 `sessionId`/`runId`/`requestId` 与序号 | 契约要求校验过的类型化消息；不用 stdout 协议；渲染层不接触凭据或裸 Node 访问 |
| 关窗/退出 | 活动运行中关窗先确认（默认停止并关闭）。退出应用总是取消活动运行并终止 Agent 进程（SIGTERM，短暂宽限后 SIGKILL）。隐藏窗口绝不代表执行已停止；v1 不承诺后台继续 | 契约第 5/6-E 节；不做静默后台执行 |
| 跨引擎续接 | 仅允许在运行之间切换引擎。续接只携带规范文本历史（原生：会话；Codex：JSON 包装）。Provider 续接、推理、工具历史与审批授权一律不随行；界面明确标注 | 已验证的当前 TUI 行为；契约禁止承诺无损切换 |
| 打包工具 | electron-vite 构建后用 electron-builder（DMG/zip 目标，arm64+x64） | 成熟的离线 macOS 打包；契约明确不维护 Electron Forge 流水线 |
| 分发 | 本地未签名 DMG/zip 用于开发冒烟；签名/公证/更新推迟到 D13，需要 Apple 开发者身份（未知，外部成本） | 任务清单禁止未经许可发布 |
| 打包布局 | Agent 包 + `resources/`（skills、docs）放在 ASAR 之外（extraResources/asarUnpack），保证 `import.meta.url` 发现与动态插件 `import()` 可用；用户插件始终位于 `$FORGE_HOME`/工作区，绝不进 ASAR | 已验证资源发现路径与插件动态导入；Electron 无法从 ASAR 内 `import()` ESM |
| 差异渲染 | `react-diff-view` 3.3.3 锁定在可替换的 `DiffViewer` 组件之后 | 见下方样例验证 |

## 6. react-diff-view 验证（已执行，离线）

`react-diff-view` 3.3.3（peer `react >=16.14`，与共用 React 19.2.8 兼容；
底层 `gitdiff-parser` + `diff-match-patch`）用真实 `git diff` 输出经
`react-dom/server` 渲染验证：

| 样例 | 解析/渲染结果 | 解析 + 渲染耗时 |
| --- | --- | --- |
| 2000 行文件中部 2 处修改（2 个 hunk） | 行/hunk/行号全部正确 | <5 ms |
| 单个 patch 内 10 个修改文件 | 10 文件、10 hunk、40 增/20 删/40 上下文（unified） | 0.1 + 0.8 ms |
| 中文路径 `中文目录/测试文件.md`，原始 UTF-8 patch | 路径与中文内容渲染正确 | — |
| 中文路径，git 默认 `core.quotepath=true` 八进制转义 | 路径保持八进制转义（`\344\270\255…`）——**未被解码** | — |
| 大变更：新增 3000 行（共 13 文件，3024 增 / 13 删 / 35 上下文） | unified 与 split 视图行数与 git 输出精确一致 | 解析 1.1 ms；静态渲染 80–110 ms（约 0.8 MB HTML） |

结论：v1 锁定 react-diff-view，置于可替换 `DiffViewer` 之后。带入 D09 的
要求：用 `git -c core.quotepath=false diff` 生成差异（或自行解码转义头），
中文路径才不丢失；超大 diff 用 hunk 折叠/虚拟化；unified 与 split 均可用。

## 7. 未知项、限制与后续依赖

- **在线提供方**：本文不测试真实 DeepSeek/OpenAI/Codex 服务行为；D07/D08
  在明确授权下覆盖。
- **签名/公证/更新**：推迟到 D13；需要 Apple 开发者身份（外部成本，未决）。
- **GUI 启动环境**：从 Finder 启动时 PATH、`FORGE_HOME`、
  `FORGE_CODEX_PATH` 与代理与开发 shell 不同；D13 必须验证有效值而非假设。
- **electron-builder + Electron 44**：D02 打包时需确认版本兼容（
  electron-builder 迭代快；若滞后，冒烟产物可用 `@electron/packager` 或
  手动 zip 兜底）。
- **pdfjs-dist / papaparse / Readability / jsdom / i18next / Zustand /
  Shiki**：按契约分属 D10/D11/D03，本文不选定。
- **多桌面客户端并发**（桌面 + TUI 同会话）：在 D06 加入占用拒绝前按设计
  不解决；桌面端必须报错而不是覆盖。
- 验证用临时产物（Electron 安装、diff 样例）位于 `/tmp/d01-verify`，属
  临时文件；按本文命令可复现。
