# 交互式 CLI UI

[English](../CLI_UI.md) · [中文目录](README.md)

## 状态

本文描述已实现的 Milestone 4.6 终端体验。Ink 提供交互式 renderer；非交互命令和 Forge 自有 runtime 保持原有边界。

## 目标

交互 CLI 应让常见 coding-agent 操作可发现，同时不把 agent loop、工具或策略决策移出 Forge core。UI 包括：

- 多行 prompt editor；
- 可发现的斜杠命令补全；
- `@` workspace 文件补全；
- 清晰区分 reasoning、答案、工具活动和 run 状态；
- 终端原生 Markdown（标题、列表、引用、链接、行内代码、强调、代码块）；
- 文件写入审批前的可读 diff 审查；
- 仅用键盘操作和可预测取消；
- 蓝色 Forge frame 内的启动能力摘要。

Ink 只负责交互 renderer，Commander 负责进程级命令解析；React/Ink 留在 `apps/cli`，`@forge/core` 不依赖终端框架。Forge 使用 full-frame Ink 更新，避免 resize 后留下旧行。

## 启动能力摘要

首个 prompt 前，蓝色 frame 列出启用的 user plugin、标记为 `trusted` 或 `untrusted, skipped` 的项目插件，以及发现的内置、用户和项目 Skills。这里只读取 manifest 和 Skill metadata，不为显示名称而 import 项目插件；实际 plugin activation 只发生在 native Forge Engine run。Native run 会发布有界 Skill catalog 并延迟加载匹配正文，显式 `$skill-name` 保留为 override。Codex Engine 有独立工具 runtime，因此列表描述的是 Forge 资源，不是 Codex 工具。

`/plugins` 打开 metadata-only 审查面板，显示项目插件版本、capability 和当前 workspace trust。信任需要在进程内权限警告后再次按 `y` 确认；同一面板可撤销。决定成功后立即刷新启动 frame，但插件 activation 延迟到下一次 native Forge Engine 任务。

## 交互状态

```text
editing
 |-- "/" --> selecting_command -- execute/insert --> editing
 |-- "@" --> selecting_file ---- insert ---------> editing
 `-- submit --> running --> awaiting_approval --> running --> editing
                    `---------------- completed ------------^
```

只有当前状态消费键盘。Ctrl+C 先关闭补全菜单，再取消运行；Forge 空闲时保留原有的显式退出行为。

## Prompt editor

- 没有补全或审批菜单占用 Enter 时，非空 prompt 提交。
- Shift+Enter 插入换行不提交；Meta+Enter（`ESC+Enter`）等价。
- 老终端无法区分 Shift+Enter 时，Ctrl+J 作为可移植换行 fallback；footer 应显示当前可用快捷键。
- 已知兼容终端（如 VS Code、Ghostty）直接启用 enhanced keyboard protocol，其他终端使用 Ctrl+J 或 Meta+Enter。
- 组装 user message 时原样保留换行。
- 左右移动、退格、删除、Home/End、粘贴、Unicode 和 resize 不能破坏 buffer 或显示。
- 补全菜单打开时上下移动选项；菜单关闭时未来可用于 prompt history，但不是 Milestone 4.6 要求。
- Shift+Tab 在当前模型支持的 thinking-effort 等级间循环。

## 斜杠命令补全

当 `/` 是首个非空白字符时打开命令列表，后续字符按命令名过滤。同一个 registry 同时驱动补全和 `/help`，避免两处漂移。当前包括 `/help`、`/new`、`/clear`、`/context`、`/compact`、`/plugins`、`/login`、`/logout`、`/model`、`/delete-model`、`/effort`、`/resume` 和 `/exit`。

`/model` 打开键盘 picker，发现当前 ChatGPT/Codex models、配置的 API providers，并按 model 而非 effort 重复显示；`/effort` 是独立的 model-specific picker，`/effort <level>` 可直接设置支持的等级，两者原子保存。`/logout` 移除选定的保存 credential，但不假装能取消父 shell 的环境变量。`/delete-model` 只显示用户配置的 provider model，需要确认，且不能删除当前 active model。

`/login` 总是列出已配置的第三方 route，包括完整 Base URL、API type、认证模式、状态和 model 数量。route 管理可以添加/恢复 model、删除 model、logout 或 remove provider；删除 model 不删除 route/credential，logout 保留 signed-out route，remove provider 是单独的确认操作且不能移除 active provider。

只有 `/models` 返回受认可且有界的 capability metadata 时，model setup 才预填 reasoning levels，并标记 discovered 或 manual。没有 metadata 时 Enter 保留 provider default；Forge 不把缺失 metadata 猜成无 reasoning model，也不发起付费探测。

- Up/Down 改变高亮命令。
- Enter 执行高亮命令。
- Tab 补全名称但不执行。
- Escape 关闭菜单且不改输入。
- 普通句子或路径中间的 `/` 不打开命令菜单。

## Workspace 文件引用

输入 `@` 会列出选定 workspace 下的有界文件。当前 token 后的文字按相对路径做不区分大小写的 fuzzy matching：

- 候选是 workspace-relative，显示分隔符固定为 `/`；
- `.git`、依赖目录、build output 和规范 workspace 外路径排除；
- 最多显示 10 个候选，并提示是否还有更多；
- 上下移动，Enter/Tab 插入，Escape 关闭；
- 插入可见 mention，同时在 editor state 保留结构化 `{ path }`，有空格的路径不依赖重新解析展示文字；
- 发现只读、有界、可取消，不会为每个按键调用模型或外部 shell。

提交时 Forge 发送用户文字和 workspace-relative path 列表。mention 不会自动注入完整文件内容；模型需要内容时，仍通过正常 policy/trace 的 `read_file` 获取。

## 粘贴图片附件

当 bracketed paste 或终端拖放以绝对图片路径开始时，Forge 从文字移除路径并显示紧凑的 `[Image #N] filename`。支持 OS/终端把截图放到临时目录的场景；引号路径、shell-escaped 空格和 `file://` 都接受。文字 composer 为空时按 Backspace 移除最近附件。

这是明确的用户动作，因此附件可以在 workspace 外；Forge 不扫描普通 prompt 中的路径，也不会扩大模型文件工具的 workspace 边界。当前模型必须支持 image input。

## Diff 审查

文件写入审批前必须在独立面板展示精确变更：操作和路径（create/modify/delete）、文件摘要和行数、带新旧行号的 unified diff、带 `+/-` 的新增/删除行、清晰的 file/hunk header、已知文件类型的语法高亮，以及触达安全显示限制时的截断说明。

审批不能只依赖颜色；`--no-color`、无色终端和色觉差异都必须保留 `+/-`、header 和行号。超过安全审查限制的 diff 不可审批，不能把未展示的部分默认为已审查。控制项要说明范围：首次 workspace 写入的审批只覆盖本次 run 的后续 workspace 写入，进程命令仍需单独审批。

网络工具审批使用专用面板，展示注册工具名和将发送到外部的有界 URL 或搜索词；plugin secret 和任意 input object 不渲染为预览。

## 登录面板

浏览器登录是独立面板，不是 transcript 文本。Codex auth surface 以带独立地址字段的结构化 `login` event 报告 URL，因此 UI 不需要从文本块重新解析。

登录 URL 通常比终端宽很多。面板使用单个 OSC 8 hyperlink，使 Ink 换行后完整 URL 仍可点击；不支持的终端仍显示完整可复制地址。escape sequence 不计入显示宽度，否则边框会错位。

## Rendering 边界

CLI 可以把 runtime event 变成 message block、tool activity row、status indicator 和 diff panel，但不能从展示状态推断成功，也不能解析之前渲染的终端文本。Core event 和审批请求是 source of truth；交互与非交互命令继续共享 Forge runtime、workspace 校验、policy gateway 和工具执行。

模型 Markdown 是有界的终端子集，不是 HTML。流式输出中的不完整结构必须可渲染，且应在样式化前移除模型提供的 ANSI 控制序列。

## 测试策略

确定性 UI 测试应覆盖斜杠菜单、文件过滤和 workspace escape、结构化 mention、Enter/Shift+Enter/Meta+Enter/Ctrl+J、多行/粘贴/Unicode/resize/取消、editing/completion/running/approval 状态、插件/Skill 启动列表和 trust label，以及 create/modify、多 hunk、无色、截断和审批范围的 diff。UI 测试不应发起付费请求；组件测试使用脚本化输入和 event，另用小型 pseudo-terminal 集成测试验证代表性终端的按键序列。
