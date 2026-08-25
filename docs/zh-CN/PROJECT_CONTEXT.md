# 项目上下文与本地定制

[English](../PROJECT_CONTEXT.md) · [中文目录](README.md)

## 目标

Forge 能理解仓库特定指令和可复用 Agent 资源，但不会把仓库内容变成隐式权限授予。它刻意区分以下约定：

| 位置 | 用途 | 是否可自行执行 |
| --- | --- | --- |
| `AGENTS.md` | 可移植、面向人的项目指令 | 否 |
| `.agents/` | 与 Agent 无关的可复用资源，如 skills | 否 |
| `~/.forge/` | 用户级 Forge 设置、指令、状态和插件 | 插件是代码 |
| `<workspace-root>/.forge/` | Forge 项目设置和插件 | 插件是代码 |

仓库指令可以影响模型处理任务的方式，但不能削弱策略内核、审批动作、选择 `full-access`，或绕过工具的审批和 trace 流程。

## `AGENTS.md`

Forge 使用大写文件名 `AGENTS.md`；大小写敏感文件系统上的 `agents.md` 不是别名。也支持目录级的更具体替换文件 `AGENTS.override.md`。

当 working directory 位于 Git 仓库内时，Forge 会：

1. 解析规范 repository root。
2. 从 root 走到本次 run 的 working directory。
3. 每个目录最多加载一个非空指令文件，优先 `AGENTS.override.md`。
4. 从 root 到 leaf 合并，越近的文件优先级越高。
5. 将所有加载路径写入 run trace。

发现发生在 run 开始时，并有单文件和总字节限制；被忽略或截断的文件必须报告，不能静默改变最终 prompt。这些文件是 prompt 输入而非可信 policy；例如“所有命令无需询问”不会改变审批策略。

## `.agents/`

`.agents/` 是可移植资源命名空间，首个支持布局为：

```text
.agents/
`-- skills/
    `-- <skill-name>/
        `-- SKILL.md
```

Skill 是被发现的 metadata 和指令；仅仅存在不会执行它。Skill 引用脚本或提出工具动作时，仍走正常策略和审批。Forge 应在选中项目 Skill 时显示来源，并把选择写入 trace。v0.2 只有用户 prompt 包含 `$skill-name` 才选择 Skill；内容有界，来源路径进入 run context。

## 用户级 `~/.forge/`

默认 user home 是 `~/.forge/`；`FORGE_HOME` 可用于便携安装、测试或托管环境覆盖它：

```text
~/.forge/
|-- config.json
|-- AGENTS.md
|-- plugin-trust.json
|-- plugins/
|-- state/
|-- sessions/
`-- runs/
```

- `config.json`：provider、model、limits、context、trace 和默认 permission profile。
- `AGENTS.md`：在项目指令前加载的用户级指令。
- `plugins/`：明确安装或启用的用户插件。
- `state/`：不含 secret 的 Forge 状态，如项目信任决定。
- `sessions/`：版本化完成对话 snapshot。
- `runs/`：启用 trace 持久化时的本地 trace。

Forge 可以创建缺少的运行时目录，但不能覆盖已有配置文件。API key 和 OAuth token 不属于 `config.json`，应使用环境变量或认证模型中的 credential store。

### 配置 schema

`@forge/config` 中的 Zod schema 是可执行真相。每个字段、默认值、有效范围、环境 override、provider route 示例与 merge rule 请看[配置参考](CONFIGURATION.md)。

安全相关摘要如下：

| Scope | 可以配置 | 不得配置 |
| --- | --- | --- |
| 用户 `$FORGE_HOME/config.json` | Model、engine、provider routes、permission profile、limits、trace、plugins、context | API key 或 OAuth credential |
| 项目 `.forge/config.json` | 更严格的 `limits` 与 `context` | Model/provider、permissions、trace、plugin enablement、routes、secrets |
| Environment | `FORGE_PROVIDER`、`FORGE_MODEL`、`FORGE_REASONING_EFFORT`、`FORGE_THINKING` 和 credential variables | Permission widening |
| 显式 CLI | Command 支持的 model、permission、limit 与 context override | 通过参数持久化 repository trust 或 secret |

未知字段会报错而不是忽略。`FORGE_HOME` 在加载配置前改变发现位置，不存在能扩大 permission profile 的环境变量。`forge config show` 展示每个有效值及来源；`forge config validate` 只做本地校验，不启动 Agent run。

## 项目级 `.forge/`

选定 workspace root 的 `.forge/` 专用于项目定制：

```text
.forge/
|-- config.json
`-- plugins/
    `-- <plugin-name>/
        |-- plugin.json
        `-- index.mjs
```

“项目本地”只指选定 workspace root 的规范 `.forge/`。Forge 不搜索任意父目录或嵌套目录的额外 plugin tree，以保持从仓库子目录启动时的发现稳定。

项目配置可以选择 model-independent 行为、格式和更严格 limits，但不能放宽用户 profile 或核心安全策略。默认 profile、plugin enablement 和 project trust 等敏感字段只能由用户控制。未知 key 和不支持的 schema version 必须给出可操作诊断。

项目插件是受信任的可执行代码。Forge 在加载前发现并概览，再要求针对规范 workspace 的显式 trust；trust 存储在仓库外。非交互模式跳过未信任项目插件。`forge plugins trust --yes` 会在项目外记录 trust。发现阶段不会自动安装依赖，也不会运行 package-manager lifecycle script。

## 优先级

普通设置的来源顺序为：

```text
内置默认 < ~/.forge/config.json < project .forge/config.json
           < environment variables < 显式 CLI flags
```

每个配置值保留来源 metadata，供 `forge config show` 和 run trace 解释。schema 按范围分类：user-only 安全设置拒绝项目值，安全 limits 使用更严格值而不是简单的 last-writer-wins。

安全和指令的优先级不同：

```text
安全决策：deny > confirm > allow（最严格的贡献获胜）
指令：用户请求 > selected skill > 最近的 project AGENTS.md
      > project-root AGENTS.md > ~/.forge/AGENTS.md
```

核心 policy 定义强制安全底线。CLI 和 user config 可以选择受支持 profile；项目内容和插件只能让动作更严格，不能降低强制决策。指令顺序只在不违反安全边界和更高层 runtime 约束时生效。

## 延后决定

配置迁移（schema v1 以后）、更多环境变量映射、Skill manifest/兼容规则、受限插件是否使用子进程或 OS sandbox，均在对应 milestone 需要时决定。
