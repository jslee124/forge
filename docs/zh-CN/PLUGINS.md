> Forge 可以创建插件。让连接的模型针对你的场景编写插件时，请把本文作为约束和参考。

# 插件开发指南

[English](../PLUGINS.md) · [中文目录](README.md)

Forge v0.2 不依赖插件。插件是可选的进程内 JavaScript module，可以注册模型调用工具和显式本地命令、贡献指令、观察不可变 run event，或让策略更严格。实现中的类型、schema 和 host 才是最终合约：[types.ts](../../packages/plugin-api/src/types.ts)、[schema.ts](../../packages/plugin-api/src/schema.ts)、[host.ts](../../packages/plugin-api/src/host.ts)。

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

然后运行 `forge plugins list` 和 `forge`。蓝色启动 frame 会列出 user plugin、trusted/skipped 项目插件和项目 Skills；列表只读 manifest/metadata，不提前 import entry。

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

支持的 capability：`tools:register`、`commands:register`、`prompt:contribute`、`events:observe`、`policy:restrict`、`network:access`。未声明的 registration method 会拒绝；`network` risk 工具还必须声明 `network:access`。Capability 是 review/API gate，不是 OS sandbox；可信 JavaScript 在 activation 中仍能直接调用 Node.js。

## Activation 与 API

Entry 导出 default 或命名 `activate` 函数，可同步或异步，Forge 会在 run 前等待：

```js
export async function activate(api) {
  // 在这里注册扩展点
}
```

冻结的 `api` 包含：`api.apiVersion`、Forge 的 `api.z`、`api.registerTool`、`api.registerCommand`、`api.contributePrompt`、`api.observeRunEvents`、`api.restrictPolicy`。内置和加载插件之间的 registration name 必须唯一。Activation 只做 setup，不应因为 Forge 启动就产生意外写入、网络请求或长时间工作。

## 自定义工具

工具合约是 provider-neutral 的：

```ts
interface ForgeTool {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  risk: "read" | "write" | "process" | "network";
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

不能因为动作不修改仓库就把 network/process 标成 read。每个 plugin tool 都走：

```text
model proposal -> schema validation -> core policy
-> stricter plugin hooks -> approval -> execute
-> structured RunEvents -> redacted trace/observers -> tool result
```

`ToolContext` 包含规范 workspace root/cwd、`AbortSignal` 和 `maxOutputBytes`、`maxEntries`、`commandTimeoutMs` 等严格 limits。及时响应取消，让配置限制优先于插件默认。使用 `invalid_input`、`cancelled`、`io_error`、`output_limit`、`timed_out` 等已有 error code；错误不能包含 credential、authorization header 或私有 response body。

## 其他扩展点

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

Native Forge Engine 对每个 prompt：校验配置；加载有界 user/project 指令；发现并按 `$skill-name` 选择 Skill；发现 manifest；排除 disabled user plugin 和 untrusted project plugin；解析目录内 entry 并 import；activation 后校验 registration/capability/name conflict；收集有界 prompt contribution；构造 model request 和 tool registry；最后让每个工具经过 policy、审批、执行、event 和 trace。

交互启动 frame 只做到 metadata discovery；真正 import/activation 只在 Forge Engine 开始 run 时发生。Codex Engine 由 Codex App Server 拥有自己的 runtime，不加载 Forge plugin。

## Portable Skills 的区别

Forge 只在 `<workspace-root>/.agents/skills/<skill-name>/SKILL.md` 发现 Markdown Skill。Skill 是指导而不是可执行插件；发现不会执行；只有 prompt 明确包含 `$skill-name` 才加入 run，内容最多 32 KiB 且记录路径。Skill 描述的脚本和动作仍需正常的 model tool、policy、approval 和 trace。

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

[`examples/plugins/web-tools`](../../examples/plugins/web-tools) 是无依赖的插件测试示例，注册 `web_search`（有 `BRAVE_SEARCH_API_KEY` 时使用 Brave，否则使用 DuckDuckGo 非 JS HTML）和 `web_fetch`（提取有界的公开 HTTP(S) 文本）。两者都是 `network` risk，每次调用需审批；共享 HTTP transport 遵循 `HTTP_PROXY`、`HTTPS_PROXY` 和 `NO_PROXY`。示例检查 redirect、local/private/reserved 地址、端口、MIME、时间、下载量、字符数和输出大小，但这些不是网络 sandbox，配置的 proxy 也属于 trust boundary。

## 给模型作者的步骤

写插件前阅读全文和当前 types/schema/host；按用户意图选择 user/project scope；只声明最小 capability；优先 plain ESM、`api.z` 和无依赖实现；在 execute 内再次校验；选择诚实 risk 并限制所有输入输出；activation 不做意外副作用；用 fake I/O 写确定性测试；运行 format、typecheck、目标测试和全量测试；记录安装方式、环境变量、外发数据、安全控制和限制，不声称有 sandbox。

交付前检查目录名等于 manifest name、版本受支持、entry 留在插件目录、使用的 API/capability 已声明、名称不冲突、错误无 secret、输出大小在序列化后测量、trust 前不执行项目代码，并在文档中区分 discovery、enablement、trust、activation 和 tool-call approval。

## 安全边界与限制

加载插件会执行拥有 Forge 进程完整权限的本地代码；它可以直接 import Node、读任意文件、启动进程或联网。Forge 只在支持的 API 边界执行：trust 前不 import 项目 entry；校验 manifest/API/capability/name/schema；model 调用的 plugin tool 走 core policy/approval；network/process/相关 write 需确认；policy hook 只能更严格；prompt/Skill 有界且带来源；observer input clone/freeze/脱敏。

这些保证不隔离恶意 trusted entry，强隔离需要受限进程或 OS sandbox。v0.2 没有插件安装器、依赖解析器、registry、hot reload、TypeScript entry 编译、custom interactive UI、provider registration、隔离进程或可强制执行的 filesystem/network capability；plugin command 只通过 `forge plugins run` 执行，不自动成为交互 slash command。
