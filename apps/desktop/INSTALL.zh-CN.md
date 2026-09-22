# Forge Desktop 本地安装

[English](INSTALL.md) · [D13 开发验收](d13-qa.md)

当前桌面本地产物版本 0.3.4，Electron 44.2.0，electron-builder 26.15.3。
配置最低 macOS 13.0；不代表各系统版本都已实测。Apple Silicon 选择 arm64，Intel 选择 x64。
桌面应用是私有工作区应用，与公开 CLI npm 包分别验证。

## 开发与构建

仓库根目录使用 Node 24+ 和 package.json 固定的 pnpm：

```sh
CI=true pnpm install --frozen-lockfile
CI=true pnpm check
pnpm desktop:dev
CI=true FORGE_DESKTOP_BUILD_TAG=desktop-0.3.4-preview.2 pnpm desktop:package
```

打包命令构建主进程、Agent、preload、界面及锁定依赖的联网插件，输出双架构 DMG/ZIP
到 `apps/desktop/release/`。默认关闭证书自动发现和发布。可能下载对应架构的 Electron
与 DMG 工具。跨架构构建不要指定本机 electronDist，否则文件名可能与二进制架构不一致。
保留 pnpm 依赖发布时间保护。运行桌面应用不需要全局安装 Forge CLI。

## 安装与退出

打开对应 DMG，将 Forge Desktop.app 复制到 Applications 后推出镜像；或解压 ZIP 后移动应用。
替换前退出旧应用，可保留上一份本地产物以便回退。本地产物没有 Developer ID 签名或公证，
macOS 可能拦截；检查来源和校验和后，对可信本地构建使用系统明确的“仍要打开”入口，
不要全局关闭 Gatekeeper。[Preview 2](https://github.com/jslee124/forge/releases/tag/desktop-0.3.4-preview.2) 已作为未签名、未公证的预览版发布。

从 Applications 启动。关闭最后一个窗口会退出应用并停止 Agent，不会转入后台工作。
取消或退出不会回滚已经发生的文件修改。重新打开历史任务继续工作。
卸载应用不会删除 Forge 配置、凭据、会话和工作区；普通更新不要删除这些数据。

## 配置、认证与网络

Agent 读取共享 Forge 配置和凭据，默认目录为 `~/.forge`，可用 FORGE_HOME 覆盖。
Finder/LaunchServices 不读取交互 shell 配置；应用继承启动环境，不自动导入终端 PATH、
代理变量或系统代理设置。例如显式启动：

```sh
open -n --env "FORGE_HOME=$HOME/.forge" \
  --env "FORGE_CODEX_PATH=/absolute/path/to/codex" \
  "/Applications/Forge Desktop.app"
```

将 Codex 路径替换为实际安装路径。Codex 不随应用提供；GUI PATH 缺少 Homebrew 目录时，
可指定 FORGE_CODEX_PATH。Forge 模型凭据与 Codex ChatGPT 登录分别管理；前者不能代替后者。
Codex 进程读取自身认证，桌面登录入口可打开浏览器认证流程。不可用或未登录会明确显示，
不会自动切换到另一个引擎。

原生联网请求从启动环境读取 HTTP_PROXY/HTTPS_PROXY 及 NO_PROXY，也支持小写形式且小写优先。
避免将凭据写入共享启动脚本。安装验收使用无代理启动，不能代替你的代理连通性验证，
也不能验证 Codex 独立网络栈。

设置中先安装随应用提供的 web-tools，再明确启用。原生网络调用仍需审批。
Brave 需要 Agent 环境中的 BRAVE_SEARCH_API_KEY；Auto 没有密钥时选择 DuckDuckGo，
请求失败不会静默切换服务。Codex 使用自己的工具。

## 文件、PDF 与验证

选择工作区或让新任务创建工作区。导入是复制，冲突需明确选择；预览路径相对工作区。
PDF 使用随包的 worker、CMaps、标准字体和 WASM；没有 OCR。安装验收只覆盖简单文字 PDF，
不代表所有字体、加密或复杂格式已验证。

打包后在 `apps/desktop` 执行：

```sh
node scripts/acceptance-installed.mjs release/forge-desktop-0.3.4-arm64.dmg
node scripts/acceptance-installed.mjs release/forge-desktop-0.3.4-arm64.zip
```

另一架构使用 x64 文件名。脚本只读挂载 DMG 或解压 ZIP，复制到临时 Applications，
经 LaunchServices 使用精简 PATH、空代理和隔离 FORGE_HOME 启动，检查服务/PDF/认证状态，
等待应用退出并确认 Agent PID 消失。证据写入 `qa/d13`，临时安装和数据自动清理。
它不调用模型或替用户登录。

更新服务使用官方桌面 GitHub Releases，提供校验后的下载与手动替换。尚未配置 Developer ID 签名、公证或自动替换。
CLI npm 打包验证不等于桌面分发验证。

## 版本检查与手动更新

带有更新功能的构建在启动后后台检查官方桌面发布，不自动下载。设置 → 版本与更新可查看完整版本、切换稳定/预览通道、手动检查或关闭启动检查；预览通道也接受更新的稳定版，不会自动降级。

设置旁点击「下载更新」，下载与 SHA-256 校验成功后显示「打开安装器」。取消下载会保留更新提示，失败可重试。打开前再次校验受管文件，并说明：保存工作、退出旧版 Forge，再拖入 Applications 替换。打开 DMG 不会自动退出或安装，现有草稿与活动任务退出保护仍生效。

旧版本首次需要手动安装带此功能的构建。`desktop-0.3.4-preview.2` 是[已发布预览版](https://github.com/jslee124/forge/releases/tag/desktop-0.3.4-preview.2)的完整身份；完整身份缺失会明确显示，不能由 `0.3.4` 猜测预览序号。打包要求显式身份，并生成 `desktop-build.json` 与 `SHA256SUMS`。

更新网络使用 Chromium 系统代理，不使用模型提供商凭据。API 限流、超时或代理错误不表示已是最新。SHA-256 不等于 Apple 签名或公证；不会自动移除 quarantine 或绕过 Gatekeeper。验证详情见[更新 QA](update-qa.zh-CN.md)。
