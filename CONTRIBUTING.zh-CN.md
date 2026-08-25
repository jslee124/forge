# 为 Forge 贡献

[English](CONTRIBUTING.md) · [中文文档目录](docs/zh-CN/README.md)

Forge 是用于学习 coding-agent 工程的项目，但改动仍按生产级标准验收：实现最小而完整的行为，明确安全边界，提供确定性测试，并让证据与结论一致。

## 开始之前

- 阅读[快速上手](docs/zh-CN/GETTING_STARTED.md)，亲自运行一次 checkout。
- 修改 tools、审批、plugins、credentials、persistence、网络或委派模型运行前，阅读[安全模型](docs/zh-CN/SECURITY.md)。
- 查看[路线图](docs/zh-CN/ROADMAP.md)，区分已完成验收标准与 deferred scope。
- 修 bug 时保留最小复现和第一条可操作错误。
- 加 feature 时先定义用户可见结果和验证方法，再考虑新 abstraction 或 dependency。

## 开发环境

```bash
git clone https://github.com/jslee124/forge.git
cd forge
pnpm install --frozen-lockfile
pnpm build
pnpm check
pnpm test
```

要求 Node.js 24 或更高版本、pnpm 11.18.0。根目录是私有 ESM pnpm workspace，使用 TypeScript project references。

默认 build、check、test 和 deterministic evaluation 不会产生付费模型请求。不要在测试 fixture 或已提交配置中使用真实 API key。

## 仓库地图

```text
apps/cli/                 Commander commands、Ink UI、provider assembly
packages/core/            Agent loop、events、context、policy contracts
packages/tools/           有边界的 workspace 与结构化 process tools
packages/config/          Schema、merge rules、provenance、instructions
packages/auth/            API-key resolution 与 owner-only file store
packages/persistence/     Session snapshots、JSONL traces、redaction
packages/plugin-api/      Plugin discovery、trust、host 与 API v1
packages/model-*/         Provider 与 protocol adapters
packages/codex-app-server Codex JSON-RPC 与 account boundary
fixtures/                 Integration/evaluation 使用的小型仓库
evals/                    Manifests、external graders、runners、reports
examples/plugins/         可选扩展示例，不是 core defaults
docs/                     English 规范指南与中文入口
```

依赖方向很重要。CLI 可以组装 packages，但 core 不能 import terminal renderer、具体 provider implementation 或 plugin implementation。Provider 负责 protocol translation；core 负责 multi-step loop、policy、limits、lifecycle 与 events。

## 改动流程

1. 从一个聚焦问题开始，找出当前调用路径。
2. 添加或更新能证明失败/验收标准的确定性测试。
3. 在真正拥有该行为的 package 中实现最小完整改动。
4. 在失败路径中保留结构化 error、cancellation、limits、policy decision 和 trace evidence。
5. 更新受影响的用户指南、示例和中文入口。
6. 迭代时运行 focused test，完成后运行对应仓库 gates。
7. 检查 diff 是否混入 generated files、secret、过时结论、安全边界扩大或无关改动。

不要仅为证明 fake adapter/mock transport 可以覆盖的逻辑而发起 live provider 调用。如果问题本身就是 provider 行为，应标明付费/远程调用并要求显式 opt-in，记录 model、日期和 limits，同时保留失败证据。

## 验证矩阵

| 改动 | 最低验证 |
| --- | --- |
| 仅文档 | `pnpm check:docs`、`git diff --check` |
| TypeScript 实现 | Focused test、`pnpm build`、`pnpm check`、`pnpm test` |
| 配置或 CLI flags | 上述命令，再加 `pnpm forge --help`、`pnpm forge config validate` 和相关 command help |
| Tool、policy、plugin 或安全边界 | 上述命令，再加 negative/denial 与 cancellation coverage |
| Evaluation harness | `pnpm eval:deterministic`；live trial 仅在显式 provider opt-in 下运行 |
| Terminal UI | Focused Ink render/interaction tests，再运行完整 build/check/test |

常用根命令：

```bash
pnpm build
pnpm check
pnpm check:docs
pnpm test
pnpm eval:deterministic
pnpm forge --help
```

非交互环境中 pnpm 需要重建 dependencies 时，使用 `CI=true pnpm install --frozen-lockfile`。

## 安全不变量

贡献不能意外削弱以下边界：

- 每个 model-proposed tool action 都要先 validation、policy evaluation 和 record，再执行。
- 内置 file tools 在解析 symlink 后仍必须位于规范 workspace 内。
- 进程命令保持结构化 `program + args[]`、`shell: false`、timeout、cancellation 与 bounded output。
- 缺少 approval channel 时 fail closed。
- 项目配置、instructions、Skills 与 plugin policy hooks 不能扩大用户 permission boundary。
- 明确信任规范 workspace 前，不 import 项目 plugin 代码。
- Plugin capabilities 和审批不能描述成 OS isolation。
- Credential 不能进入 prompt、event、trace、error、example 或 repository file。
- Resume 恢复 completed conversation，不恢复旧审批或待执行状态。
- Checkpoint 是 derived untrusted memory；规范 transcript 和 fresh instructions 仍是权威。
- Forge 只展示 provider 实际暴露的 reasoning，不编造隐藏 chain of thought。

如果改动有意修改其中一条，必须同步更新安全文档并增加明确、可 review 的 acceptance test。

## Tests 与 fixtures

- Runtime state 和 recovery 优先使用 deterministic fake model。
- Auth 与 provider protocol 优先使用 fake HTTP/App Server transport。
- File tools 使用临时 workspace；相关时覆盖 traversal、symlink、concurrent edit、truncation 与 cancellation。
- Fixture defect 应小而语义明确；reference fix 前 visible test 和 external grader 都应失败，修复后都通过。
- 模型文字声称成功不是证据；要检查 terminal run status 和 fixture/grader 结果。
- 不要为了让失败 live trial 通过而放宽 evaluation approval。

## 文档风格

- 先说明读者能完成什么，再说明边界和命令。
- 命令必须注明执行目录，并区分 `pnpm forge` 与全局链接的 `forge`。
- 明确区分 implemented behavior、opt-in behavior、example、plan 和历史 release contract。
- 区分 API-key access 与 ChatGPT subscription，也区分 Forge Engine 与 Codex Engine。
- 除非 core 已实现，否则 `web_search`、`web_fetch`、MCP、to-dos 与 subagents 都应标为可选 plugin 示例。
- 同一改动中更新 English 规范页面和对应中文导航/翻译。
- 运行 `pnpm check:docs`，防止 relative file、fragment 与本地 image link 漂移。

## Pull request checklist

- [ ] 改动只有一个明确的用户可见或架构结果。
- [ ] Tests 覆盖成功路径和重要失败/拒绝路径。
- [ ] 代码变化时 `pnpm build`、`pnpm check`、`pnpm test` 全部通过。
- [ ] `pnpm check:docs` 与 `git diff --check` 通过。
- [ ] 未包含真实 credential、私有 trace、generated artifact 或无关 workspace 改动。
- [ ] 文档描述当前真实行为和诚实限制。
- [ ] 付费/远程验证如有发生，已经显式说明，且没有替代确定性 coverage。

## 报告安全问题

不要在公开 issue 中发布 API key、OAuth data、私有仓库内容或未脱敏 run trace。请提供最小且经过清理的复现，并指出受影响边界。在私有报告渠道发布前，不要分享会暴露其他用户数据或系统的 exploit detail。

Forge 不是操作系统 sandbox。若报告内容是获批进程或受信任 plugin 具有用户级权限，应区分这个已记录限制，与真正绕过 Forge workspace、policy、trust 或 redaction control 的问题。
