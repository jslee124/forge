# Forge v0.3.4 Milestone 15 release gates

[English](M15_RELEASE_GATES.md)

证据日期：2026-08-31
精确候选提交：`f92ebb45c94768fa47d2832ac9de7751566d1470`

## 证据边界

候选提交在隔离的 clean checkout 中完成检查。源 checkout 中未提交的 Roadmap
状态修改没有进入验证环境，最后的 `git diff --check` 与 `git status --short`
均为 clean。

本证据覆盖 Milestone 15 实现、offline contract 与用户在真实 Ghostty 中执行的
smoke，不代表 exact-commit live-provider 结果、版本号提升、合并到 `main`、tag、
发布或公网安装。
此前经授权执行的 DeepSeek trial 仍属于被忽略的 `evals/artifacts/` 开发证据，
本报告不会把它提升为 release evidence。

## Exact-candidate 矩阵

| Gate | 结果 |
| --- | --- |
| `CI=true pnpm install --frozen-lockfile` | 基于已提交 lockfile 通过 |
| `CI=true pnpm check` | 通过；245 个文件，另有两条不影响通过的 Biome info |
| `CI=true pnpm test` | 通过；58 个文件、360 个测试 |
| `CI=true pnpm eval:deterministic` | 通过；13 个文件、71 个测试 |
| `CI=true pnpm check:docs` | 通过；102 份 Markdown、454 个本地引用 |
| `CI=true pnpm package:verify` | 通过；clean install 包大小 337,200 bytes |
| `git diff --check` | 通过 |
| `git status --short` | Clean |
| 真实 Ghostty exit/resume smoke | 通过；用户于 2026-08-31 观察确认 |

Package verification 仍报告 `@jslee124/forge@0.3.3`，因为这里记录的是
Milestone 15 实现证据，并不授权执行 v0.3.4 version 或 release workflow。

## Ghostty smoke

用户在真实 Ghostty 应用中运行 Forge、完成 provider turn、退出多个 interactive
session，并用 `pnpm forge resume --last` 恢复最近会话。恢复后的 canonical exchange
与 Manual context selector 均正确渲染；用户提供的终端记录中没有出现
`MaxListenersExceededWarning`、键盘回归或可见 reflow 回归。

结合 repeated mocked lifecycle regression，Milestone 15 验收清单现已关闭。这不授权
也不表示已经发布 v0.3.4。
