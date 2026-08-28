> Forge 可以创建插件。让连接的模型针对你的场景编写插件时，请把本文作为约束和参考。

# 插件开发指南

English · 中文目录

Forge 0.3.3 不依赖插件。插件是可选的进程内 JavaScript module，可以注册模型调用工具和显式本地命令、贡献指令、观察不可变 run event，或让策略更严格。实现中的类型、schema 和 host 才是最终合约：types.ts、schema.ts、host.ts。

## 快速开始

在 `$FORGE_HOME/plugins/count-text/`（通常是 `~/.forge/plugins/count-text/`）创建：

```text
count-text/
|-- plugin.json
`-- index.mjs
```

`plugin.json`：

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

`index.mjs` 的 activation function 使用 `api.z` 定义有界 schema，并通过 `api.registerTool` 注册。工具应在 `execute` 内再次 `safeParse`，对成功和失败都返回结构化结果，不泄漏 secret：

```js
export default function activate(api) {
  const inputSchema = api.z.object({ text: api.z.string().max(10000) }).strict();
  api.registerTool({
    name: "count_text",
    description: "Count Unicode characters in supplied text.",
    risk: "read",
    inputSchema,
    execute: async (input) => {
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) return { ok: false, error: {
        code: "invalid_input", message: "Invalid input for count_text.", retryable: false
      }};
      return { ok: true, output: { characters: Array.from(parsed.data.text).length }, truncated: false };
    }
  });
}
```

在用户配置中启用：

```json
{ "schemaVersion": 1, "plugins": { "enabled": ["count-text"] } }
```

然后运行 `forge plugins list` 和 `forge`。蓝色启动 frame 会列出 user plugin、trusted/skipped 项目插件，以及内置、用户和项目 Skills；列表只读 manifest/metadata，不提前 import entry 或 Skill 正文。

## 位置、启用与信任

| 范围 | 位置 | 如何可加载 |
| --- | --- | --- |
| User | `$FORGE_HOME/plugins/<name>/` | 加入 user `plugins.enabled` |
| Project | `<workspace>/.forge/plugins/<name>/` | 对规范 workspace 执行 `forge plugins trust` |

项目配置不能设置 `plugins.enabled`；用户配置不能静默信任项目代码。trust 存在仓库外的 `$FORGE_HOME/plugin-trust.json`，key 是规范 workspace path。

```bash
forge plugins list
forge plugins trust
forge plugins trust --yes
forge plugins untrust
```

交互 session 中进入 `/plugins`，检查版本和 capability，按 `t` 后按 `y` 确认；按 `u` 撤销。header 立即更新，新信任的插件在下一次 native Forge Engine task 加载，无需重启 TUI。发现过程不扫描任意祖先、嵌套 plugin 目录或 `node_modules`，也不安装 package 或运行 lifecycle script。

## 插件结构

```text
my-plugin/
|-- plugin.json          # 声明 metadata，trust/import 前读取
|-- index.mjs            # activation function
|-- README.md            # 推荐的安装和安全说明
`-- test/                # 可选的插件测试
```

Entry 可以 import 同目录 `.js`/`.mjs` 文件。Forge 不安装依赖；使用第三方 package 的共享插件必须记录安装方法，不得依赖 package-manager hook 自动执行。

## Manifest v1

Manifest 是 strict 的，未知 key 拒绝：

| 字段 | 要求 |
| --- | --- |
| `schemaVersion` | 数字 `1` |
| `apiVersion` | 字符串 `"1"` |
| `name` | 小写 kebab-case，1–64 字符，且等于目录名 |
| `version` | 非空版本字符串 |
| `entry` | 位于插件目录内的相对 `.js`/`.mjs`/`.cjs` 路径 |
| `capabilities` | entry 计划使用的 capability 数组 |

支持的 capability：`tools:register`、`commands:register`、`prompt:contribute`、`subagents:register`、`events:observe`、`policy:restrict`、`network:access`。未声明的 registration method 会拒绝；`network` risk 工具还必须声明 `network:access`。Capability 是 review/API gate，不是 OS sandbox；可信 JavaScript 在 activation 中仍能直接调用 Node.js。

## Activation 与 API

Entry 导出 default 或命名 `activate` 函数，可同步或异步，Forge 会在 run 前等待：

```js
export async function activate(api) {
  // 在这里注册扩展点
}
```

冻结的 `api` 包含：`api.apiVersion`、Forge 的 `api.z`、`api.registerTool`、`api.registerCommand`、`api.registerSubagent`、`api.contributePrompt`、`api.observeRunEvents`、`api.restrictPolicy`。内置和加载插件之间的 registration name 必须唯一。Activation 只做 setup，不应因为 Forge 启动就产生意外写入、网络请求或长时间工作。

## 自定义工具

工具合约是 provider-neutral 的：

```ts
interface ForgeTool {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  risk: "read" | "write" | "process" | "network" | "model";
  execute(input: unknown, context: ToolContext): Promise<ToolResult>;
}
```

名称使用 lower snake case，匹配 `^[a-z][a-z0-9_]{0,63}$`。description/schema description 会发给模型，需说明何时调用并限制输入。

| Risk | 用途 | 默认策略 |
| --- | --- | --- |
| `read` | workspace 内、无副作用检查 | Allow |
| `write` | workspace 文件变化 | `safe` 首次 Confirm；`workspace-write` Allow |
| `process` | 启动任意子进程 | 每次 Confirm |
| `network` | 向外部服务发送或抓取数据 | 每次 Confirm |
| `model` | 启动额外的委派模型运行 | 每次 Confirm |

不能因为动作不修改仓库就把 network/process 标成 read。每个 plugin tool 都走：

```text
model proposal -> schema validation -> core policy
-> stricter plugin hooks -> approval -> execute
-> structured RunEvents -> redacted trace/observers -> tool result
```

`ToolContext` 包含规范 workspace root/cwd、`AbortSignal` 和 `maxOutputBytes`、`maxEntries`、`commandTimeoutMs` 等严格 limits。及时响应取消，让配置限制优先于插件默认。使用 `invalid_input`、`cancelled`、`io_error`、`output_limit`、`timed_out` 等已有 error code；错误不能包含 credential、authorization header 或私有 response body。

## 其他扩展点

### Subagents

`api.registerSubagent()` 是声明式 API：插件只定义角色名、parent tool 名、
instructions、允许的 child tools 和更严格 limits，不会获得 credential、
model adapter、runtime、policy 或 trace writer。

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

Manifest 必须声明 `subagents:register`。角色名使用 kebab-case，tool 名使用
lower snake case，并与内置/插件工具共享名称空间。instructions 必填且最多
16 KiB；最多选择 32 个不重复、已经注册的非 subagent 工具；单个 child
最多 8 model steps 和 20 tool calls。

宿主生成的工具接收 `{ task: string }`，属于 `model` risk，每次委派都需审批。
Forge 创建新 adapter 和隔离对话，继承项目指令、workspace、context 设置、
cancel、approval channel，以及 core + plugin restrictions 后的有效 policy，
并且只暴露声明的工具。Child 永远看不到 subagent tools，因此不能递归委派。

每个 parent run 最多启动四个 child；所有 child 还共享与 parent 配置
`maxSteps`/`maxToolCalls` 相等的预算，插件 limits 只能进一步收紧。返回值受
`maxToolOutputBytes` 约束。启用 trace 时，每个 child 使用独立 run trace，
envelope 包含 `parentRunId`/`subagentName`；parent tool result 包含 child
`runId`、status、step/tool 计数和 final text。

示例见 `examples/plugins/code-review-subagent`。

### Commands

Command 是显式的 trusted-code entry point，不是 model tool call：

```js
api.registerCommand({
  name: "hello",
  description: "Print a local greeting.",
  execute: async ({ args, write }) => { write(`hello ${args.join(" ") || "world"}\n`); return 0; }
});
```

用 `forge plugins run hello [args...]` 执行。Command 因用户直接调用而绕过 model-tool approval，但仍拥有受信任插件的完整进程权限。

### Prompt contribution

`api.contributePrompt(hook)` 收到包含当前 prompt、规范 workspace root 和 cwd 的 immutable snapshot。返回字符串最多 32 KiB，标记 manifest path，加入 instruction context 并记录 provenance；不需要贡献时返回 `undefined`。用户 prompt 是不可信数据，prompt hook 不能暗中作为 command runner。

### Run-event observer

`api.observeRunEvents(observer)` 收到每个 `RunEvent` 的深冻结 structured clone，不能修改 runtime history。observer 失败只产生 warning，不替换 run result 或 trace；配置 secret 会在送给 observer 前脱敏。

### Policy restriction

`api.restrictPolicy(hook)` 收到 tool、call 和 validated input 的 frozen snapshot，只能返回：

```js
{ kind: "confirm", reason: "..." }
{ kind: "deny", reason: "..." }
undefined
```

决策合并为 `deny > confirm > allow`；插件不能把 core confirmation/denial 变为 allow。

## 发现与 run 生命周期

Native Forge Engine 对每个 prompt：校验配置；加载有界 user/project 指令；发现内置、用户和项目 Skill metadata、处理冲突并保留 `$skill-name` override；发现 manifest；排除 disabled user plugin 和 untrusted project plugin；解析目录内 entry 并 import；activation 后校验 registration/capability/name conflict；收集有界 prompt contribution；构造 model request 和 tool registry；最后让每个工具经过 policy、审批、执行、event 和 trace。

交互启动 frame 只做到 metadata discovery；真正 import/activation 只在 Forge Engine 开始 run 时发生。Codex Engine 由 Codex App Server 拥有自己的 runtime，不加载 Forge plugin。

## Portable Skills 的区别

Forge 在随包内置目录、`$FORGE_HOME/skills/<skill-name>/SKILL.md` 和 `<workspace-root>/.agents/skills/<skill-name>/SKILL.md` 发现 Markdown Skill。每个文件用有界 YAML frontmatter 声明与目录匹配的 `name`、面向任务的 `description`，可用 `disable-model-invocation: true` 设为仅显式调用。

首个模型请求只包含有预算上限的 `id`、`name`、`description` 和 `source`；正文由宿主 `load_skill` 工具按登记的不透明 ID 延迟加载。工具限制并去重加载，重新校验 canonical path 与文件身份，拒绝 symlink 和登记 root 外文件。名称冲突按 `project > user > builtin` 解析，显式 `$skill-name` 覆盖自动路由。选择、加载、拒绝和截断都会进入 trace，并可由 `forge inspect` 查看。Skill 描述的动作仍需正常 model tool、policy、approval 和 trace；选择 Skill 不等于信任项目 plugin，也不会扩大 workspace `read_file`。

## 测试插件

测试不能依赖付费模型或真实外部服务，应使用 fake transport，并尽量通过真实 host/policy boundary：

```bash
forge plugins list
pnpm typecheck
pnpm test
pnpm check
```

项目插件先 inspect manifest，再显式 `forge plugins trust`，用最小安全任务运行，最后 `forge plugins untrust`。用户插件测试可将 `FORGE_HOME` 指向临时目录且只启用该插件。至少覆盖 manifest discovery（不 import entry）、activation/名称/capability、输入和取消、output/entry/timeout limits、相关 policy、secret 脱敏，以及无需 live network 的可恢复 provider failure。

## Web tools 示例

`examples/plugins/web-tools` 是无依赖的插件测试示例，注册 `web_search`（有 `BRAVE_SEARCH_API_KEY` 时使用 Brave，否则使用 DuckDuckGo 非 JS HTML）和 `web_fetch`（提取有界的公开 HTTP(S) 文本）。两者都是 `network` risk，每次调用需审批；共享 HTTP transport 遵循 `HTTP_PROXY`、`HTTPS_PROXY` 和 `NO_PROXY`。示例检查 redirect、local/private/reserved 地址、端口、MIME、时间、下载量、字符数和输出大小，但这些不是网络 sandbox，配置的 proxy 也属于 trust boundary。

## MCP、to-dos 与 subagents

| 能力 | 当前插件 API | 示例或限制 |
| --- | --- | --- |
| MCP server tools | 可以，但协议与生命周期有限 | `mcp-stdio` 为一个配置的 stdio server 注册需审批的 `process` risk list/call bridge。 |
| 轻量 to-dos | 可以 | `todos` 注册内存工具和有界 prompt contribution；目前没有持久化和自定义 TUI panel。 |
| 宿主管理的 subagents | 可以 | `code-review-subagent` 声明只读 child 角色；Forge 持有 adapter、policy、budget、cancel 和关联 trace。 |

MCP 示例固定演示基于 session、newline-delimited stdio 的 `2025-11-25`
协议版本，只证明现有插件能够桥接 MCP tools，不代表 Forge 已具备完整 MCP host。
Streamable HTTP、当前无握手协议、server reuse、prompts/resources/roots、
sampling、tasks 和 lifecycle disposal 需要一等 host 或扩展后的插件合约。

Subagent 当前继承 parent model；插件不能选择不同 provider/model、传入 parent
conversation、把 child 保存为可独立 resume 的 session、在专用 TUI panel
流式显示 child delta，或开启嵌套委派。这些仍是明确的宿主限制，插件不应
通过直接调用 provider 或递归启动 Forge CLI 来模拟。

## 给模型作者的步骤

写插件前阅读全文和当前 types/schema/host；按用户意图选择 user/project scope；只声明最小 capability；优先 plain ESM、`api.z` 和无依赖实现；在 execute 内再次校验；选择诚实 risk 并限制所有输入输出；activation 不做意外副作用；用 fake I/O 写确定性测试；运行 format、typecheck、目标测试和全量测试；记录安装方式、环境变量、外发数据、安全控制和限制，不声称有 sandbox。

交付前检查目录名等于 manifest name、版本受支持、entry 留在插件目录、使用的 API/capability 已声明、名称不冲突、错误无 secret、输出大小在序列化后测量、trust 前不执行项目代码，并在文档中区分 discovery、enablement、trust、activation 和 tool-call approval。

## 安全边界与限制

加载插件会执行拥有 Forge 进程完整权限的本地代码；它可以直接 import Node、读任意文件、启动进程或联网。Forge 只在支持的 API 边界执行：trust 前不 import 项目 entry；校验 manifest/API/capability/name/schema；model 调用的 plugin tool 走 core policy/approval；model/network/process/相关 write 需确认；policy hook 只能更严格；prompt/Skill 有界且带来源；observer input clone/freeze/脱敏。

这些保证不隔离恶意 trusted entry，强隔离需要受限进程或 OS sandbox。Forge 0.3.3 没有插件安装器、依赖解析器、registry、hot reload、TypeScript entry 编译、custom interactive UI、provider registration、隔离进程或可强制执行的 filesystem/network capability；plugin command 只通过 `forge plugins run` 执行，不自动成为交互 slash command。

## Skills 与产品文档属于资源

Skills 是从内置、用户和项目作用域发现的不可执行、不可信指令资源。`forge plugins list` 只报告可执行插件；`forge resources list` 报告 Skill 来源、调用状态、冲突遮蔽与诊断。交互式入口分别是 `/plugins` 与 `/resources`。

内置 `forge-product-help` Skill 要求在回答实现相关产品问题前先检索文档。`search_forge_docs` 和 `read_forge_doc` 使用与版本匹配的打包白名单及稳定的 `forge-doc:<version>:<locale>:<document>#<section>` 引用；它们拒绝文件系统路径，也不继承 `read_file` 权限。
