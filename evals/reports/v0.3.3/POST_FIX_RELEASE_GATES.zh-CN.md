# Forge v0.3.3 修复后发布门禁

[English](POST_FIX_RELEASE_GATES.md)

证据日期：2026-08-30
候选基础 commit：`782de378716961c34bce630a90038d8a383612a9`

## 证据边界

本报告记录修复 approval UI 时序测试并补充 release documentation 后的本地
release-candidate 工作树。这些变更必须先 commit、push，并在 Linux CI 上验证通过，
才能把本证据关联到不可变 release tag。

单独记录的[真实 provider resume smoke](LIVE_PROVIDER_RESUME_SMOKE.zh-CN.md) 已覆盖
native DeepSeek 和 Luna Codex Engine resume。没有调用 OpenAI API，也没有执行 branch
merge、tag 创建、push、npm publish 或发布后的公开安装验证。

## 已解决的修复前问题

- Session persistence 会在替换先前有效文件前，拒绝超过持久化大小上限的脱敏
  snapshot。
- Failed/cancelled run 会保留有界、无权限语义的 outcome；未返回给模型的已完成或
  失败工具副作用会被明确提示，但不会伪造 canonical tool pair。
- Process approval 会检查 executable basename 并保守处理常见 wrapper，避免
  destructive command 获得可复用 session approval。
- Canonical tool-call pairing 按 run 与 step 限定，不同 run 可以安全复用 provider
  wire ID。
- Publish workflow 会把 stable 版本路由到 `latest`，prerelease 路由到 `next`。
- Approval preview 测试等待可观察 UI 状态，不再假设固定 30 ms 后状态必然可用。
- Provider protocol SDK 使用实际测试过的精确版本，防止公开 artifact 漂移到依赖
  尚未存在于 npm registry 的上游 patch。

## 当前本地矩阵

所有文档和测试修改完成后，会在这里记录该工作树的最终结果：

| 门禁 | 结果 |
| --- | --- |
| `CI=true pnpm check` | 通过；231 个文件，另有 2 条不导致失败的 Biome information notice |
| `CI=true pnpm check:docs` | 通过；100 个 Markdown 与 432 个本地引用 |
| `CI=true pnpm test` | 通过；56 个文件、350 个测试 |
| `CI=true pnpm eval:deterministic` | 通过；12 个文件、69 个测试 |
| `CI=true pnpm package:verify` | 通过；干净安装 package 大小为 331,604 bytes |
| `CI=true pnpm release:verify-tag -- v0.3.3` | 通过；所有 package 与 runtime version 一致 |
| `pnpm audit --prod --audit-level low` | 通过；无已知漏洞 |
| `git diff --check` | 通过 |

第一次 clean-package 尝试发现 `@ai-sdk/deepseek@^3.0.28` 会选择上游
`3.0.37`，而该版本声明了尚未发布的 `@ai-sdk/provider@4.0.9`。Forge 现在为
`@ai-sdk/deepseek`、`@ai-sdk/openai` 和 `ai` 发布实际验证过的精确版本；随后使用
隔离 npm cache 重跑 clean install 并通过。

## Stable 发布仍需外部证据的条件

1. Commit 并 push 候选变更，取得 exact commit 的绿色 Linux CI。
2. 如果 stable release 声明包含 compatible route 的真实行为，另行取得授权并运行
   compatible-route smoke。由于没有 API key，native OpenAI API 保持明确未测试。
3. 将审查后的候选版本合入 `main`，并在准确的 merge commit 上重跑矩阵。
4. 只有前述条件全部通过后，才创建不可变 annotated tag。
5. Trusted publishing 完成后，验证 npm dist-tag、公开 clean install、bundled
   Skills/docs 与 update behavior。

在这些外部条件完成前，本工作树只是离线 release candidate，不能描述为已经发布或
经过真实 provider 验证的 stable release。
