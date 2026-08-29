# 路线图

[English](../ROADMAP.md) · [中文目录](README.md)

## 当前 milestone

**Milestone 13：长会话效率与用户控制已在 v0.3.3 开发分支实现至 13.5。** 当前包括版本化 contract、prompt-cache 可观测性、压力驱动 context、有作用域的 session permission、TUI 内更新体验和离线 release matrix。自动 compact 仍为 opt-in；这不是 v0.3.3 已发布声明。

## 工作规则

- 完成一个 milestone 后再扩展下一个。
- 每个 milestone 都必须产生可运行行为。
- 是否完成由验收标准决定，而不是写了多少文件。
- 默认测试套件不依赖付费模型调用。
- 只有 milestone 需要时才新增 workspace package。
- 实现证明计划错误时更新本文。
- 以 [v0.1 验收与评测](V0.1_SPEC.md) 作为 release contract。

## Milestone 0：项目基础（已完成）

建立最小、可运行、易测试的 pnpm monorepo：Node.js 24、pnpm 11.18.0、`apps/cli`、`packages/core`、仅 ESM 的严格 TypeScript project references、`tsc -b`、Biome、Vitest、Commander CLI 和 CI。验收包括 clean checkout 安装、`pnpm forge --version/--help`、`pnpm build/check/test` 和 core 不依赖 CLI。

## Milestone 1：DeepSeek 对话（已完成）

加入 `packages/model-deepseek`、Vercel AI SDK、`DEEPSEEK_API_KEY` 解析、默认 `deepseek-v4-flash`、显式 thinking、单轮 streaming adapter、`forge ask`、独立 text/reasoning event、token/provider metadata、可读错误和 Ctrl+C 取消。缺 key 必须以退出码 `2` 结束且不泄漏 secret；默认测试不发付费请求。

## Milestone 2：Workspace 与只读工具（已完成）

加入 `packages/tools`、规范 workspace/cwd、`list_files`/`read_file`/`search`、路径和 symlink 校验、workspace 外拒绝、输出限制及 AI SDK schema translation。工具失败必须是结构化 result，模型 tool call 不能通过 AI SDK 的直接 execute callback 绕过 Forge。

## Milestone 3：Native Agent loop 与策略基础（已完成）

运行时在 core 内控制多步循环、tool result 和可恢复失败，保留 DeepSeek continuation，设置默认 12 model steps/40 tool calls，支持取消、`allow/confirm/deny` policy、无审批 channel 时拒绝，以及完整退出码映射。Fake-model 测试覆盖 completed、failed、cancelled、denied、limit-reached 和 thinking tool round trip。

## Milestone 4：安全 coding vertical slice（已完成）

实现结构化 patch、精确 diff、首次写入审批、仅当前 run 的写入范围、`spawn`/`shell:false` 的 `run_command`、60 秒 timeout、65536 bytes 输出限制、取消和超时进程终止、不覆盖已有用户修改、`validation-bug` fixture、端到端测试和失败验证后的纠正恢复测试。验收要求 fixture 从检查到通过验证完整完成，shell 表达式及 workspace 外文件操作被拒绝。

## Milestone 4.5：交互式 CLI（已完成）

无 subcommand 时进入交互 session，跨 prompt 保留 conversation，按 run 明确审批和 patch 范围，提供 `/help`、`/clear`、`/exit`，Ctrl+C 取消但保留 session，第二次 Ctrl+C/EOF 正常退出，并提供 `forge` 全局 link。退出或取消不能遗留 model request 或 child process。

## Milestone 4.6：交互 TUI 与上下文引用（已完成）

使用 Ink 作为 `apps/cli` renderer，实现多行编辑、Enter/Shift+Enter/Ctrl+J、`/` 命令菜单、统一 command registry、`@` 有界 fuzzy 文件 picker、结构化 workspace-relative mention、running/streaming/cancel/approval 状态和精确 diff panel。UI 不依赖 paid model；runtime/tools 不 import React/Ink。详细交互合约见[交互式 CLI UI](CLI_UI.md)。

## Milestone 5：配置、指令与 permission profile（已完成）

加入 `packages/config`、`FORGE_HOME`（默认 `~/.forge/`）、版本化 Zod schema、用户和项目 `.forge/config.json`、带 provenance 的合并、`forge config show/validate`、用户/项目 `AGENTS.md` 分层发现和 size limit、`safe`/`workspace-write` profile（`full-access` 延后）。验收要求错误带 source path、值和来源可查看、指令顺序确定、项目不能削弱 policy，并且从子目录启动与 root 的 workspace 配置相同。

## Milestone 6：结构化 trace、会话与 resume（已完成）

定义 versioned run event，从同一 event stream 渲染终端并写 JSONL；持久化 session snapshot，区分 session/run ID，只保存完成对话，typed provider reasoning，脱敏 credential，提供 `forge inspect`、`forge resume`、`--last` 和 workspace-scoped `/resume`。恢复重新加载配置/指令，绝不恢复旧审批、continuation 或未完成工具调用。详细合约见[持久化会话](SESSIONS.md)。

## Milestone 7：评测与首个 release（已完成）

保留规范 fixture，增加至少两个任务和 hidden grader；默认 suite 使用 fake model；付费 DeepSeek 试验显式 opt-in；多次运行记录 model/settings、通过率、耗时、步骤、工具调用和 token；加入 terminal demo、README setup/results/limitations、许可证、model ID 复核并打 `v0.1` tag。所有 v0.1 gate 见 [V0.1_SPEC](V0.1_SPEC.md)。

## Milestone 8：受信任插件 API（v0.2，已完成）

定义 versioned manifest/API，发现 user plugin、portable project Skill 和 `.forge/plugins` 项目插件；注册 tools/commands，暴露 immutable event，提供 prompt/policy hook，项目插件先 trust，并禁止削弱 core policy。Forge 无插件也必须正常工作；plugin tool 走与内置工具相同的 policy/trace pipeline。详细合约见[插件指南](PLUGINS.md)。

## Milestone 9：OpenAI 认证扩展（已完成）

重新检查官方文档和条款，泛化 authentication manager，保留 DeepSeek API key，加入 OpenAI API key，通过适当公开/授权集成提供 ChatGPT 登录，支持 browser/headless flow，将 credential storage/refresh 交给 Codex App Server，提供 `forge auth status/logout`、Codex model/reasoning discovery、`forge codex`、`--engine codex`、`/model`、`/login`、掩码 API key 输入和 owner-only 文件。验收要求不读取其他应用 credential file，清晰区分 API key/订阅，refresh 并发安全，且上游变化给出可操作错误。

## Milestone 10：有预算的上下文管理（已完成，默认仍 opt-in）

目标是在不隐藏丢失上下文、不改变指令优先级和不提前引入 retrieval 的情况下让长 session 可预测。

### 10.1 预算与可观察性

provider/model capability 与 runtime limits 分开；提供保守 token estimator；为 output、instructions、tool schema、当前 request、history 和 continuation 分配预算；只扣除 `max(output, buffer)` 一次；发出 versioned context event；`forge inspect` 展示 estimate/provider usage/保留/省略；native request 和 Codex wrapper 都计预算；可能超 window 前预警。

### 10.2 安全 conversation compaction

checkpoint 与 canonical session transcript 分离；可用时支持 adapter-owned opaque compaction，否则使用 Forge inspectable checkpoint；保留当前指令、当前请求和 recent serialized tail，只压缩完成 turn prefix；summary 是 untrusted memory，不能携带审批、验证证据或权限；记录 strategy、provenance、hash、model、token 和时间；失败/取消/无效 summary 可预测地 fallback；提供 `/context`、`/compact --dry-run` 和手动 `/compact`，自动默认需等待 gate。

### 10.3 Run 内压力

每步前重新检查预算，统计 continuation/tool call/result，压缩旧 tool output，使用有界 result、定向重读和 measured tool set；仅在无 assistant output/副作用的 provider-classified clean overflow 时恢复一次；检测 compaction thrashing；不能安全缩减时以带具体 context reason 的 `limit_reached` 停止；provider-specific 行为只能在 adapter capability/feature flag 下启用。

### 10.4 评测与默认 rollout

增加 long-session、recall、指令变化、tool-result pressure、resume 和 hostile history fixture；测量任务成功、tokens、估算误差、延迟、压缩和 summary regeneration；比较 `off`/`warn`/`compact`；在 automatic compaction 默认前定义 threshold；semantic/vector retrieval 保持延后。中文详细设计见[上下文管理](CONTEXT_MANAGEMENT.md)。

## Milestone 11：OpenAI-compatible provider routes（已完成）

目标是支持 gateway 和 self-hosted server，同时让 credential destination 始终由用户控制。已实现：用户级 Chat Completions/Responses route profile；禁止仓库定义 route；除 canonical loopback 外要求 HTTPS；显式 bearer/no-auth；stored credential 绑定规范 endpoint；有界且不跟随 redirect 的 model discovery 和手动 fallback；可选 reasoning metadata（不付费 probe）；`@forge/model-compat`；将 route capability 接入 context、图片、`/model`、`/effort`；区分 explicit `none` 与 provider default；在 stateless continuation 中保留可 replay reasoning metadata；credential-redacted provider error；TUI 中分离 model/effort；bearer、无认证、缺 key 和 no-downgrade 测试。

验收要求 loopback OpenAI-compatible server 可以通过 bearer 和 no-auth route 完成 compiled CLI 请求；项目不能定义或重定向 route；endpoint 变化不能复用旧 key；大型 model catalog 可搜索；context/output capacity 与 reasoning gears 到达既有 UI；build、format、typecheck 和无付费请求的全量 suite 通过。

## Milestone 12：模型可自动调用的 Skill 与版本化产品知识（v0.3.1 / v0.3.2 热修复）

目标是让 Forge 识别任务何时需要专门指令或产品文档，只加载匹配且有界的资源，然后继续经过既有 model/tool/policy/trace loop。首批完整 vertical slice 是创建 Forge 插件，以及回答与当前安装版本一致的 Forge 产品问题。

本 milestone 扩展 portable Skill 约定，但不会把 Skill 变成可执行插件。内置、用户和项目 Skill 默认都允许模型自动调用。仓库 Skill 内容仍是不可信 prompt input：选择 Skill 不授予 capability、审批、文件系统访问、网络访问或权限变更；由此产生的每个工具动作仍必须经过正常 policy、approval、execution、event 和 trace pipeline。

### 12.1 资源模型、发现与优先级

- [x] 建立独立资源边界，不用 executable plugin activation 承载非执行型 Skill 和文档
- [x] 解析有大小限制的 `SKILL.md` YAML frontmatter，要求合法 `name` 和面向任务的 `description`，正文延迟加载
- [x] 用 typed descriptor 表示 `builtin`、`user`、`project` 来源、canonical path、内容大小、模型调用状态和诊断
- [x] 发现内置 Skill、用户 Skill 和项目 `.agents/skills/<name>/SKILL.md`，发现过程不执行仓库代码
- [x] 内置、用户和项目 Skill 默认都对模型可见且可自动调用；`disable-model-invocation: true` 将单个 Skill 改为仅显式调用
- [x] 保留 `$skill-name` 作为确定性 override 和兼容路径
- [x] 名称冲突按 `显式选择 > project > user > builtin` 确定解析，报告被遮蔽来源并记录最终来源
- [x] 初始模型请求只放转义后的 `name`、`description`、来源和稳定标识，不注入所有 Skill 正文
- [x] 在任何付费 provider request 前执行单文件、catalog、description 和总 instruction budget

验收标准：

- 合法项目 Skill 无需单独 trust 或显式 `$name` 就能被模型自动调用。
- 项目 Skill 仅按数据解析，发现期间绝不 import 或执行。
- 自动路由可能选择其他资源时，显式 `$name` 仍选择预期 Skill。
- metadata 非法、名称冲突和大小超限都产生有界且带来源的诊断。
- 大量 Skill 只给首个请求增加有界 catalog metadata。

### 12.2 安全延迟加载与 runtime 集成

- [x] 增加 host-owned `load_skill` read tool，只接受 catalog identifier，不接受模型生成的任意路径
- [x] canonicalize 每个资源 root 和 target，拒绝 traversal、逃逸 symlink、非普通文件、身份变化和已登记 root 外文件
- [x] 返回有界内容、来源、base directory 和截断状态，让相对引用被显式解析
- [x] 保持 workspace `read_file` 只能访问所选 workspace，不为已安装 Forge 资源或任意用户文件放宽边界
- [x] 当请求匹配 Skill description 时要求模型先加载 Skill；explicit-only Skill 只能由用户选择
- [x] 每个 run 限制 Skill 加载次数，并去重重复加载
- [x] 资源结果进入 conversation 后重新做 context preflight；mandatory context 放不下时在 provider request 前失败
- [x] 发出结构化 discovery、automatic-selection、explicit-selection、load、rejection 和 truncation event，不记录隐藏思维链

验收标准：

- “创建一个 Forge 插件”可以让 native model loop 在用户不点名时加载 plugin authoring Skill。
- 恶意 Skill 无法通过 `load_skill` 读取登记 root 外内容，也无法用指令削弱当前 approval policy。
- Skill 可以建议动作，但 write、process、network 动作都不能绕过既有 policy/approval path。
- `forge inspect` 能指出选择了哪个 Skill、为何具备调用资格、来源以及是否截断。

### 12.3 内置 Forge 插件开发 Skill

- [x] 随 CLI package 发布版本匹配的 `forge-plugin-creator` Skill
- [x] 覆盖插件创建、修改、验证、capability、lifecycle、trust、加载、tool、command、observer、prompt hook、policy hook 和插件测试请求
- [x] Skill 保存工作流，当前 API 事实保存在随包文档或生成 reference 中，避免把整本手册重复放进 prompt
- [x] 提供使用当前 plugin API version 和 package layout 的最小 manifest、entry 和 test template
- [x] 生成代码前要求检查有效 manifest schema、TypeScript types 和最接近的维护中 example
- [x] 保持非执行型 Skill 与拥有本地进程权限的受信任 in-process plugin code 之间的区别
- [x] 报告完成前验证生成的 plugin name、entry、capability、reserved tool name 和项目 trust 行为
- [x] 无付费调用地运行 build、typecheck、focused plugin test 和文档检查

验收标准：

- 用户使用普通语言请求小型 Forge 插件时，能得到当前 manifest、实现、测试和 activation 指引。
- 生成示例不绕过 plugin trust、capability validation、policy、approval 或 trace。
- 内置 Skill 和 template 被打入 CLI package，并与 runtime plugin API version 一致。

### 12.4 版本化 Forge 文档检索

- [x] 将产品问答所需的 canonical English 文档及持续维护的中文镜像随 CLI release 打包
- [x] 生成确定性 index，包含 Forge version、locale、document identifier、title、heading、keyword、path 和 content hash
- [x] 按 Markdown heading 分块并先用有界 lexical ranking；evaluation 证明必要前不引入 embedding/vector 基础设施
- [x] 增加返回有界排序结果的 `search_forge_docs`，以及读取 allowlisted 文档或 section 的 `read_forge_doc`
- [x] 优先用户当前 locale，缺少镜像时回退 canonical English，并明确标记而不是静默混合翻译
- [x] 增加内置 `forge-product-help` Skill，覆盖安装、配置、provider、model、认证、插件、Skill、session、context、trace、安全、release 和 troubleshooting
- [x] 回答易变化或与具体实现相关的 Forge 产品问题前必须查询文档，并区分文档事实、仓库检查、推断和不支持行为
- [x] 返回适合 terminal 和 trace 的稳定 document/section reference，不暴露任意 package path
- [x] package build 时验证 index path、hash、本地 Markdown link 以及 index version 与 `FORGE_VERSION` 一致

验收标准：

- 询问“项目配置是否能选择 provider”时，会查询随包文档并依据当前安装版本回答。
- 中文产品问题优先使用维护中的中文页；缺少镜像时明确回退英文。
- 文档工具不能读取任意 workspace、home、credential 或 package 文件。
- 产品回答展示所用 document/section，文档无法确认时明确说明。

### 12.5 CLI 发现与控制界面

- [x] 扩展启动资源报告，但不 import executable project plugin，也不急切读取 Skill 正文
- [x] 增加 `forge resources list` 和交互 `/resources`，展示来源、描述、自动/仅显式状态、遮蔽关系和诊断
- [x] `/plugins` 继续专注 executable plugin，通过清晰入口关联 Skills/resources，而不混淆两套生命周期
- [x] 用简洁 run event 展示自动 Skill 选择和文档查询，不暴露私有推理
- [x] 提供用户级配置以禁用某个自动 Skill，同时保持“项目 Skill 默认允许模型自动调用”的默认值
- [x] non-interactive 行为保持确定性，输出可操作 warning，不弹 trust 或选择 prompt

验收标准：

- 用户可在付费 run 前发现某个 Skill 为什么能或不能被模型自动调用。
- UI 能区分 builtin、user、project resource，且不会把 Skill 呈现成已经执行的 plugin code。
- 禁用一个自动 Skill 不会禁用其显式选择，也不会修改仓库文件。

### 12.6 评测、兼容与 release gate

- [x] 用 scripted fake model 覆盖匹配、不匹配、歧义、显式、禁用、冲突、重复加载和超预算 Skill
- [x] 加入尝试 prompt injection、权限放宽、任意路径读取、secret 访问和未审批命令的对抗性项目 Skill
- [x] 增加 plugin API、配置、认证、session、context、安全和故意未知项的产品问答 fixture
- [x] 测量 selection precision/recall、不必要资源加载、首轮 catalog token、已加载资源 token、回答引用准确率、延迟和任务完成率
- [x] 默认测试保持确定性和离线；live provider quality trial 必须显式 opt-in
- [x] 兼容资源 event 出现前创建的 session/trace，并保留旧 `$name` 流程
- [x] 验证 packed artifact 包含 Skill、template、docs 和 index，且不包含开发期或 secret 文件
- [x] 为 `0.3.2` 运行 `pnpm build`、`pnpm check`、`pnpm test`、`pnpm check:docs`、确定性 evaluation、package verification 和版本一致性检查

Release criteria：

- 插件创建和产品问答 vertical slice 通过 compiled CLI 的确定性端到端测试。
- 项目 Skill 默认允许模型自动调用，但对抗性 Skill 无法扩大 capability 或绕过 policy/approval。
- 资源选择与读取有界、来源可见、可 inspect，并计入 context budget。
- 干净打包的 `0.3.2` CLI 能依据自身版本匹配文档答疑，并能 scaffold 与随包 API 匹配的插件。
- release claim 不会把 model-invocable Skill 描述成受信任 executable code，也不声称 Forge 尚未提供的 OS sandboxing。

## Milestone 13：长会话效率与用户控制（v0.3.3，计划中）

目标：让用户在长时间 coding session 中持续使用 Forge，同时看得见 context 压力，减少重复审批打断，以不干扰工作的方式获知新版本，并能测量和改进 provider prompt cache。Milestone 10 已提供 context budget 和 checkpoint 底座；Milestone 13 要把这套底座变成可发现、受评测 gate 约束的默认体验。架构、UI flow、建议 TypeScript contract、模块映射、测试矩阵与分阶段交付顺序详见 [v0.3.3 详细实现方案](V0.3.3_IMPLEMENTATION_PLAN.md)。

本 milestone 不会加入持久化的无限制权限，不会静默运行包管理器更新，不会删除规范 conversation transcript，不会对不报告 cache 的 endpoint 声称支持，也不会把 extractive checkpoint 当作生产质量的 semantic memory。尚未实现的计划行为在通过 release gate 前保持未勾选。

### 13.0 跨功能 contract 与基线

- [x] 为 v0.3.2 记录可复现基线：长会话任务完成率、context estimate、provider input usage、cache read/write token、审批次数、等待审批时间、压缩次数，以及启动/更新检查延迟
- [x] 为 context pressure、cache observation、scoped approval decision 和 update availability 增加 versioned、provider-neutral runtime event
- [x] Policy 与 context decision 归 `@forge/core`；规范 transcript 与 checkpoint 完整性归 persistence；终端布局、交互菜单和通知 dismiss 归 `apps/cli`
- [x] 为 native compaction 与 prompt-cache control 增加 adapter capability descriptor，避免 core 按 provider 名称分支
- [x] Trace 可以保存 hash、token count、scope identifier 和 provenance，但不能保存原始 credential、隐藏 reasoning、provider cache 内容或未脱敏的敏感 command input
- [x] 兼容现有 `safe`、`workspace-write` 配置，以及 session-v2 snapshot 和旧 trace event

验收标准：

- Trace reader 能区分 unavailable metric 与真实的零值。
- Offline fake adapter 不发起付费 provider 请求即可覆盖所有新增 event 和 decision state。
- 项目配置、instruction、Skill 和 plugin 无法开启更弱的 permission mode、持久化 grant、关闭用户要求的 context guard，或选择 update destination。

### 13.1 Prompt cache 可观测性与稳定 request prefix

- [x] 在 run summary 和 `forge inspect` 中增加每 step 与聚合的 input、cache-read、cache-write、uncached-input 和 cache-hit-ratio 指标
- [x] 只在 provider 返回数据时报告 cache metric；未知值显示 unavailable，不能推断为 miss
- [x] 计算脱敏的 stable-prefix、instruction、resource-catalog 和 tool-schema hash，让本地 trace 能解释可能的失效原因，同时避免重复持久化 prompt 正文
- [x] 把 request composition 重构为确定性的 stable prefix 加动态 turn 内容：core contract、当前仓库 instruction、稳定 Skill metadata 和稳定 tool definition 位于 selected Skill 正文、per-turn plugin contribution、checkpoint memory、conversation 和当前 request 之前
- [x] Instruction、tool、JSON schema 和 provider option 的语义未变化时，保持 byte-for-byte 稳定顺序
- [x] 明确定义失效条件：provider/model 变化、instruction 内容或顺序变化、Forge prompt-schema version、启用的 resource/plugin、tool schema 和 compaction checkpoint generation
- [x] 增加 automatic caching、keyed caching、explicit breakpoint 或 unsupported caching 的 provider capability；只有 adapter 与 endpoint 明确支持时才传递稳定的 session/workspace cache key
- [x] 保留可 replay 的 provider continuation，并以 append-only 方式加入 tool result，避免 tool loop 无意义地重写早期可缓存 prefix
- [x] 默认保持 advertised tool set 稳定；把 dynamic allowed-tool subset 与删除/重排 tool definition 分开评测

验收标准：

- 未改变 prefix 的确定性 tool loop 在每个 step 得到相同的本地 prefix hash。
- 改变任一 invalidation input 会改变相应 hash 并记录原因；只改变 user request 不会使 stable prefix 失效。
- 会报告 cached token 的 provider 能展示正确的 per-run ratio；不报告的 provider 保持可用并显示 `unavailable`。
- Compaction 会有意开始新的 cache prefix，在 provider 真正报告前不声称 cache hit。

### 13.2 按压力自动 compact 与 context 控制

- [x] 将 idle 和 next-request pressure ratio 定义为 projected input token 除以 available input token；available input 已经只扣除一次 effective output/safety reserve
- [x] Projected numerator 包含 instruction、Skill/resource metadata、tool schema、active checkpoint、retained conversation、输入框草稿和附件图片估算；保守或不可用估算用 `~` 或 `?` 表示，避免伪精确
- [x] 在输入框附近常驻 context indicator，用分段圆环与精确百分比表示：`○`、`◔`、`◑`、`◕`、`●`，并采用 normal、elevated、warning、critical 的语义颜色
- [x] 展示 `context · warn`、`context · auto`、`compact soon`、`compacting`、`compacted` 和 `auto paused` 状态；窄终端逐步隐藏 label，但保留 percentage
- [x] 将输入区 footer 拆为 model/context 状态行与快捷键行，避免新增 indicator 让已有输入控制难以阅读
- [x] 将 `/context` 从只读状态面板升级为交互控制面板，展示 pressure breakdown、mode、strategy、recent-tail budget、last compaction，并提供 `/compact` preview、立即 compact、仅当前 session 启用和保存为用户默认值
- [x] `warn` 首次跨过配置的 activation threshold 时，显示一次非阻塞提示，提供 compact once、当前 session 开启 auto 或 dismiss；用户不应为了发现自动 compact 而编辑 JSON
- [x] Session-only auto mode 只保存在 runtime state；只有用户明确操作后才把默认值写入仓库外的 user-level config
- [x] 初始触发依据通过评测调整的 pressure threshold，而不是单纯 message count；先以 75-80% projected pressure 作为实验值，只压缩 completed history 或可安全 projection 的 continuation state
- [x] 分阶段回收 context：先限制或替换陈旧且已完成的 tool output；adapter 声明支持时使用 provider-native opaque compaction；否则生成经过校验的 Forge summary 并保留近期 verbatim tail
- [x] 当前 deterministic extractive summary 保留为安全 fallback 和测试 oracle，但不能作为默认启用自动 compact 的质量依据
- [x] 持久化 strategy、source/tail hash、token estimate、model、生成时间、safety label，以及 summary generation 是否产生 provider usage
- [x] 取消、输出无效、反复失败或回收收益过低时暂停 auto compaction；初始把低于 8,000 token 或 projected input 20% 两者较大值的回收视为低收益，再根据评测调整
- [x] 展示简洁结果，例如 `Context compacted · 86K -> 34K`、strategy、保留的 recent turn，以及单独测得的 generation usage

验收标准：

- 新用户可以完全通过 TUI 发现并启用 auto compaction。
- 常驻 indicator 与 `/context` 面板使用同一份 snapshot，不会把 history-only estimate 标记成完整 context-window usage。
- 代表性长会话在发生 provider hard overflow 前触发 auto compaction，但不会每 turn 压缩或无进展循环。
- 显式目标、约束、已修改文件、未解决工作和历史 verification provenance 能通过 compaction fixture 与 resume 保留下来。
- Checkpoint 不会恢复 approval、trust、permission profile、当前 verification status、pending tool call 或 secret material。

### 13.3 有作用域的 permission grant 与审批 UX

- [x] 将 boolean approval response 替换为结构化 decision：allow once、在当前 session 允许一个明确展示的 scope，或 deny 并可附带 user feedback
- [x] 为 workspace write、精确 command 加 arguments/cwd/timeout ceiling、network tool 加 destination host、具名 delegated-model tool 定义规范化且可 inspect 的 scope；不得使用 shell string、未解析 glob 或模型生成的描述作为 grant identity
- [x] Host 根据已校验 input 为每个 proposed tool action 派生结构化 approval descriptor，包含 effect、resource/destination、risk flag、preview 和 core 允许 UI 展示的 scope；plugin 不能编写 allowed scope
- [x] TUI 使用编号选项展示 allow once、当前 session 允许同类操作和 deny；用户选择前必须准确看到 session grant 覆盖什么
- [x] 增加 `/permissions`，展示 effective profile、配置 provenance、active session grant、使用次数和 revoke 控制
- [x] Grant 默认限制在当前 canonical workspace 与 session；不得通过 `/resume` 恢复，也不得写入项目文件、session snapshot、prompt、summary、Skill 或 plugin event
- [x] 即使较宽的 session scope 原本可以匹配，destructive、credential-sensitive、publish/install、广泛 external-side-effect 或 policy 指定的 action 仍必须重新确认
- [x] Deny-with-feedback 可以把有界 user guidance 作为 denial result 返回当前 run，但不能把 guidance 解释成 approval
- [x] 在 core 与 plugin policy hook 之间继续保持 `deny > confirm > allow`，并区分 trusted plugin code 与 model-tool approval

验收标准：

- 正常 inspect-edit-test 流程可以授权一个清晰展示的窄 scope，并在无需为每个相同行为重复提示的情况下完成。
- Command argument、cwd、destination host、canonical workspace、risk classification 变化，或 timeout 超过 grant ceiling 时都会产生新的 decision。
- Session grant 在退出与 resume 后消失；trace 记录 scope identifier 和 decision，但不记录可 replay 的 authority。
- 恶意 instruction、Skill、checkpoint、tool result 或 plugin policy hook 无法伪造或扩大 grant。

### 13.4 TUI 内更新体验

- [x] 重构现有 rate-limited update check，使其发布结构化 cached、refreshing、available、current、failed 和 disabled 状态，而不是在 Ink tree 外写 startup notice
- [x] 保留非阻塞启动、24 小时检查间隔、有界 network timeout、`CI` 行为和 `FORGE_DISABLE_UPDATE_CHECK=1`
- [x] 启动后才发现的新版本可以更新当前 TUI，但不能进入 transcript 或 model context
- [x] 渲染紧凑 update banner，包含 current/latest version、`forge update` 指引、release-notes destination、dismiss-this-version，以及可访问的窄终端布局
- [x] 一个 available version 被 dismiss 后最多只强提示一次；显式 `forge update check` 仍保持权威且可重复执行
- [x] 推荐或执行包管理器命令前检测受支持的 installation provenance；无法识别时只报告新版本与文档，不猜测 installer
- [x] 安装保持显式操作，使用 argument-array process execution，说明当前进程仍运行旧版本，并要求 restart
- [x] 验证 check、dismiss、安装失败、安装成功和 restart 都不会修改 `FORGE_HOME` 中的 credential、config、session、trace、plugin 或其他用户数据

验收标准：

- Fake registry 的新结果可以出现在已经运行的 TUI 中，不破坏 editor、approval input、streaming output 或 scrollback。
- Offline、timeout、畸形 registry data、CI 与 disabled check 保持静默或有界，不会阻塞 interactive startup。
- npm/pnpm 或其他明确支持的 provenance 得到正确安全指引；未知 provenance 不会触发自动 global install。
- Update UI 与 compiled `forge update` 对 current version、target version 和 restart requirement 的描述一致。

### 13.5 评测矩阵与 release gate

- [x] 增加确定性长会话 fixture，覆盖 constraint recall、edited-file tracking、unresolved work、instruction 变化、tool-output pressure、反复 compact、取消、resume 和恶意历史 approval claim
- [x] 增加 permission fixture，覆盖 exact-match reuse、near-match rejection、workspace 变化、symlink/canonical-path 变化、destructive action、revoke、deny-with-feedback、plugin、network destination 和 subagent
- [x] 增加 cache fixture，覆盖 stable prefix、每种 invalidation input、unavailable usage、tool continuation、compaction boundary 和聚合计算；不得断言 endpoint 未声明的 provider support
- [x] 增加 update fixture，覆盖 cached/fresh result、late async delivery、dismissal、畸形 semver、timeout、disabled/CI mode、install provenance、安装失败和受保护的 `FORGE_HOME` 数据
- [x] 在代表性的窄/宽终端宽度渲染 editor/footer、context control、approval panel 和 update banner；保留现有 Enter/newline/Ctrl+C 行为与可读的语义颜色
- [x] 在相同任务上比较 `warn` 与 session/default `compact` mode，记录 task success、constraint retention、压缩前后 token、reclamation、latency、cache read/write、compaction count 和 no-progress pause
- [x] Live provider trial 只能显式 opt-in；报告必须有界且脱敏，默认 suite 永远不发起付费调用
- [x] 更新中英文 context、configuration、security、session、CLI UI、releasing、troubleshooting 和 product 文档，使其匹配真实实现并诚实标注 provider-specific limit
- [x] 为 `0.3.3` 运行 build、format/lint、typecheck、完整 offline test、文档/link 检查、确定性 evaluation、packed-artifact verification、installed CLI smoke test 和版本一致性检查

Release criteria：

- 所有对 v0.3.3 声称的未勾选项都已实现，或明确移出本次 release；计划文字不会被呈现成已交付行为。
- Auto compaction 在显式目标、约束、edited-file tracking、unresolved work、安全和 resume 的确定性 fixture 中没有回归，live quality report 也满足默认 rollout 前记录的 threshold。
- Context indicator 保持响应与语义真实；用户无需修改项目文件即可启用、观察、暂停和撤销 auto compaction。
- Scoped grant 在代表性 coding flow 中显著减少重复审批，同时所有 near-match 与 high-risk fixture 仍按设计重新提示或拒绝。
- Cache report 算术正确且明确 provider 能力；release 不作 universal hit-rate 承诺。
- Update discovery 非阻塞、理解安装来源、保持显式操作，并证明不会修改已有 `FORGE_HOME` 用户数据。
- 发布前，干净打包的 `0.3.3` 行为、文档、`FORGE_VERSION`、package manifest、tag 和公开安装 smoke expectation 保持一致。

### 13.6 建议交付顺序

1. 先交付 event schema、baseline report、cache telemetry 和 stable-prefix hashing，不改变默认行为。
2. 通过兼容现有 policy 的 adapter 交付 structured approval response、scope matching、`/permissions` 与 TUI choice。
3. 交付常驻 context 圆环与交互 `/context` control，再加入按压力 compact 和 quality/no-progress gate。
4. 将 structured update service、live TUI banner、dismissal 和 install provenance 作为隔离的 vertical slice 交付。
5. 运行跨功能矩阵：compaction 可预测地使 cache 失效；update UI 不抢占 approval/editor input；resume 恢复 context checkpoint 但不恢复 grant。
6. 只有记录的 evaluation gate 通过后才把默认从 `warn` 改为自动 compact；否则发布可发现的 session opt-in，并诚实保留默认值。

## Milestone 14：结构化 Session History 与忠实 Resume（已完成）

目标：跨已完成工具交换保存完整、provider-neutral、模型可见的 conversation，使 resume
后的模型能够利用之前的调用、输出与失败，同时不恢复 authority 或未完成执行。详细 contract、
migration、provider mapping、安全规则、测试矩阵和交付顺序见[结构化 Session History 与
Resume 实现方案](STRUCTURED_SESSION_HISTORY_IMPLEMENTATION_PLAN.md)。

- [x] 在 `@forge/core` 增加 canonical user、assistant、tool-call 与配对 tool-result content block
- [x] 在模型可见 runtime commit boundary 直接构建 canonical delta，而不是从 UI event 推导正常写入
- [x] 增加严格 session schema v3、checkpoint v2 和无损 v1/v2 migration；trace 工具历史补回必须 all-or-nothing
- [x] 为 OpenAI、DeepSeek、compatible Responses、compatible Chat Completions 和 Codex App Server 投影 canonical history
- [x] 保持 trace-first UI replay；trace 缺失时提供 structured canonical fallback，且不重复 final answer
- [x] 让 context selection、compaction、hash 与 cache diagnostic 保持闭合 tool-call/result 边界
- [x] 验证脱敏、fresh approval、无 dangling call、跨 provider fallback、旧 session 可读与中断写恢复
- [x] 在同一实现中更新 current-product 中英文与 packaged docs

验收标准：

- Resume 后模型获得与等价未中断 session 相同的 portable completed tool history。
- Snapshot、migration、compaction 与 provider projection 都不能产生 orphan result、dangling call、恢复审批或可执行 pending state。
- Trace 缺失只降低展示细节，不删除 canonical structured history，也不阻止安全续聊。
- 所有 native provider 与 Codex Engine 通过 offline projection/resume contract；live provider 仍只能显式 opt-in。

## 后续扩展

后续方向包括更多评测和 grader、Anthropic Messages/Gemini 等 native protocol、窄的 workspace 外审批、明确警告的 `full-access`、可选 shell language、LangChain/LangGraph 对比、HTTP/SSE、SQLite session/run index、session branch/跨机同步、经 context evaluation 证明有价值的 semantic retrieval、MCP 和更强的进程隔离。它们不是当前 v0.2 的完成条件。
