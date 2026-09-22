# 桌面更新验收 — 2026-09-22

[English](update-qa.md) · [更新计划](UPDATE_PLAN.zh-CN.md) · [安装说明](INSTALL.zh-CN.md)

U01—U04 的实现与受控验收已在本地完成。本记录不代表发布、替换已安装应用、签名/公证或 Intel 真机验收。

## 实现与自动检查

- `FORGE_DESKTOP_BUILD_TAG` 提供完整构建身份，缺失时明确显示，打包要求显式身份。本地产物身份为 `desktop-0.3.4-preview.2`，文件名版本为 `0.3.4`；本次未发布该版本。
- 固定官方源、稳定/预览语义版本排序、有界分页、运行进程架构匹配；提供下载入口前必须存在准确资产与唯一校验值。
- 主进程服务及严格 IPC 实现检查、下载、取消、校验、打开和偏好；独立 Chromium 会话在每次重定向请求发出前校验目标。渲染进程不提供 URL/路径，更新状态不进入模型上下文。
- 22 项专项测试通过，覆盖 CLI/草稿/非法标签排除、同版/旧版、后续分页和页数边界、x64/Rosetta 选择、校验清单错误、跳转域名/次数、无凭据请求、限流、超时、取消、重复点击、ENOSPC、大小限制、缓存篡改、符号链接替换及偏好持久化。
- 桌面测试 97 项通过，6 项可选真实提供商测试跳过。根级 `pnpm check` 通过，保留已有 4 项警告及 18 项提示。确定性评估 71 项通过，CLI 打包安装验证通过，后者不等于桌面安装验收。
- 桌面生产构建、arm64/x64 DMG/ZIP 打包通过，脚本生成 `SHA256SUMS` 和 `desktop-build.json`，四个产物的摘要复验通过，记录于[本地构建清单](design/update-validation/local-build.json)。已检查两种可执行文件架构、包内完整身份及与最终构建一致的主进程文件。arm64 解包应用的 `--desktop-smoke` 通过，生成[设置截图](design/update-validation/packaged-arm64-settings.png)，完成 Agent 资源/preload 检查与正常退出；过程中有不影响通过的 Electron Helper 沙箱警告。这是解包应用 smoke，不是 Applications 替换或 Intel/Rosetta 运行验收。

## 界面证据

Electron 截图覆盖 8 种状态 × 2 种语言 × 2 种主题，以及 4 个折叠侧栏的 720×600 窗口场景。断言检查横向溢出、控件焦点、发行说明纯文本呈现与折叠按钮无障碍名称。更新后的脚本还验证未发送草稿在更新状态切换和设置导航后保留，原有退出保护仍拦截 unload。该过程使用离线界面夹具，不调用模型。

[结果清单](design/update-validation/results.json)与代表截图：[英文浅色](design/update-validation/light-en-available.png)、[中文深色下载](design/update-validation/dark-zh-CN-downloading.png)、[折叠窄屏](design/update-validation/light-en-collapsed.png)、[已校验安装器](design/update-validation/dark-zh-CN-verified.png)。

## 真实下载与 DMG 打开

[机器可读证据](design/update-validation/live-download.json)使用受控当前身份 `0.3.4-preview.0`，仅用于选中已存在的官方 `desktop-0.3.4-preview.1`。发布列表使用通过 `gh api` 刚读取的官方元数据快照；校验清单与安装器由实际 Electron 更新网络实现通过 HTTPS 下载，不使用提供商凭据。

- 目标版本：`0.3.4-preview.1`；进程与资产架构：arm64。
- 来源：[官方 arm64 DMG](https://github.com/jslee124/forge/releases/download/desktop-0.3.4-preview.1/forge-desktop-0.3.4-arm64.dmg)。
- SHA-256：`1713e0f0ff5355b0af35bd97f22ab9b94bbcb03480ca98622ba0bec6993b3ca5`。
- 下载、大小检查、摘要校验、打开前再次校验及 `shell.openPath` 全部成功；打开后验收进程仍在运行。`hdiutil info` 确认镜像挂载到 `/Volumes/Forge Desktop 0.3.4-arm64`。
- 未向 Applications 复制应用，未关闭/替换旧 Forge，未改变 quarantine 或签名配置。

初次真实未认证 Release API 在当前代理下返回 HTTP 403，直连重试超时；代理还中断了 GitHub 资产 CDN 连接（curl 独立复现）。最终资产验收使用**仅测试进程生效**的 `--no-proxy-server` 与官方元数据夹具完成。产品仍采用正常系统代理并报告错误，没有增加自动绕过逻辑。因此已获得真实资产下载/打开证据，**尚未获得完整的真实未认证 Release API 检查成功证据**。

真实传输还发现 Electron `fetch` 在手动重定向模式下取消请求。现改为独立会话加请求发送前的跳转守卫，新增回归测试并完成真实下载验证。

## 复现

在仓库根目录执行：

```sh
CI=true pnpm exec vitest run apps/desktop/src/main/update-service.test.ts apps/desktop/src/main/update-network.test.ts
CI=true pnpm check
CI=true pnpm check:docs
CI=true FORGE_DESKTOP_BUILD_TAG=desktop-0.3.4-preview.2 pnpm desktop:package
CI=true FORGE_HOME=/private/tmp/forge-update-ui-home apps/desktop/node_modules/.bin/electron apps/desktop --desktop-update-ui
```

界面脚本在 Electron 临时目录的 `forge-update-ui` 下生成 36 张 PNG 与 `results.json`，不调用模型。显式真实验收会打开 DMG：

```sh
pnpm exec esbuild apps/desktop/scripts/update-live-acceptance.mjs --bundle --platform=node --format=esm --external:electron --outfile=/private/tmp/forge-update-live-acceptance.mjs
apps/desktop/node_modules/.bin/electron /private/tmp/forge-update-live-acceptance.mjs --live
```

网络故障诊断时，`--release-fixture /absolute/path/releases.json` 仅替换发布列表输入，`--no-proxy-server` 仅作用于测试进程；两者均不修改产品更新器。验收后检查/推出挂载镜像，测试保留其临时下载文件和证据。

## 真实 API 再次验证

使用不带元数据夹具的 Electron 更新服务重新验证，默认网络以及带测试进程 `--no-proxy-server` 参数的重试均返回 HTTP 403，`x-ratelimit-remaining: 0`。GitHub 报告的配额重置时间相同：北京时间 2026-09-22 15:54:14。两次均未进入校验清单读取，未下载 DMG、未打开安装器。当前明确受 API 配额限制，完整真实 API 枚举成功仍未获得验证。详见[重试证据](design/update-validation/live-check-retry.json)。
