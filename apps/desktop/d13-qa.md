# D13 local installation acceptance — 2026-09-13

[English installation guide](INSTALL.md) · [中文安装指南](INSTALL.zh-CN.md)

Development handoff for Forge Desktop 0.3.4, based on commit
`d9d53088e71dd3808a8d66fd6f532ec8492de8d7` plus the D13 working-tree changes.
This is not a public release or Developer ID notarization record.

## Changes and boundaries / 变更与边界

Desktop build now compiles shared workspace packages before Electron bundling, avoiding stale
shared dist code. The PDF worker is explicitly included outside ASAR and selected from the
configured resource directory in both main and Agent tool code. Installed PDF extraction
previously failed looking for a missing worker next to a bundled chunk; the installation probe
caught this and the repaired application now extracts text and renders its canvas.
The package command disables certificate auto-discovery and publication.

桌面构建先编译共享包，避免打入旧 dist；PDF worker 随包放在 ASAR 外，并由共享工具显式定位。
安装探针发现并修复了正文提取找不到 worker 的缺陷。默认打包关闭证书自动发现与发布。

## Evidence classes / 证据类别

The installed probe uses a temporary Applications directory and isolated FORGE_HOME. It mounts
DMG read-only (then ejects it), or extracts ZIP, and launches the copied application through
macOS LaunchServices (`open -n -W`). It does not run the source checkout or depend on terminal
PATH. PATH is explicitly `/usr/bin:/bin:/usr/sbin:/sbin`; upper/lowercase HTTP(S) proxies are empty.
The application confirms that its resolved Forge home matches the supplied isolated directory.
This is a controlled GUI-launch environment, not an observation of every user's Finder defaults.

Checks: real utility-process startup/resource discovery, saved fixture resume, Chinese workspace,
bundled web plugin installation and enabling, packaged PDF data files, text extraction, actual
PDF canvas without a UI error, authentication status and shutdown. The harness confirms the Agent
PID is gone after application exit. Screenshots are offline fixtures and do not represent model
execution. Plugin installation/enabling is not a fresh live search request. Codex reports
`unavailable` with this PATH; installed authenticated Codex/login and live provider calls are not
claimed. D12's separately dated live engine evidence remains in its own record.

使用临时安装目录和隔离 FORGE_HOME，经 LaunchServices 启动，明确设置精简 PATH 和空代理。
验收真实 Agent/资源、中文工作区、已保存样例恢复、插件安装启用、PDF 资源/正文/画布及退出。
进程退出后确认 Agent PID 消失。此环境下 Codex 为 unavailable；不冒充安装后登录成功或
模型调用。真实搜索、代理联网、每个用户的 Finder 默认环境需要各自证据。

## Platform and distribution / 平台与分发

Host: macOS 26.6.2 (25G83), Apple Silicon arm64. Configured minimum macOS: 13.0.
Electron: 44.2.0; bundled Node: see each installed.json; electron-builder: 26.15.3;
PDF.js: 6.3.289. Separate arm64 and x64 runtime downloads are used. The executable architecture
must match its artifact filename; a host-only electronDist override is unsuitable for dual builds.
Rosetta x64 runs on this host are not Intel hardware validation. macOS 13 itself is not tested here.

主机为 macOS 26.6.2 arm64；最低 13.0 为配置值，未在该系统实测。
x64 的 Rosetta 运行不等于 Intel 实机验收。两架构分别使用对应 Electron 运行时。

No Developer ID identity, signing credential, notarization request, public upload, GitHub release,
npm publish or updater feed is used. Electron's existing/ad-hoc signatures are not a Developer ID
signature. Gatekeeper behavior on a quarantined internet download is unverified. Local outputs
remain ignored under `release/`; evidence/checksums are checked-in candidates under `qa/d13/`.
No changes were committed. Installer archives do not imply an automatic update service.

未使用开发者签名身份、公证、公开上传、GitHub Release、npm 发布或更新服务。
本地/临时签名不等于 Developer ID；互联网下载后的隔离与 Gatekeeper 行为未验证。
安装产物保留在 git 忽略的 release 目录，证据与校验和位于 qa/d13。本次未提交。

## Reproduction

```sh
CI=true pnpm desktop:package
# In apps/desktop, run each of the four artifact filenames:
node scripts/acceptance-installed.mjs release/forge-desktop-0.3.4-arm64.dmg
```

Focused regression set: agent-process, file-service, application, codex, read-document:
5 files / 39 tests passed. Deterministic evaluation: 13 files / 71 tests passed.
Final static/docs/CLI packed-install outcomes and per-artifact installation results follow below.

Codesign inspection: arm64 executable retains an ad-hoc linker signature (no TeamIdentifier,
no sealed resources); x64 application reports not signed. No Developer ID signature exists.
[Artifact checksums and sizes](qa/d13/artifacts.json) identify the final four archives;
[executable inspection](qa/d13/architectures.txt) confirms arm64 and x86_64 respectively.

## Final results / 最终结果

| Artifact | Installed execution | Evidence |
| --- | --- | --- |
| arm64 DMG | Passed, native arm64 | [record](qa/d13/forge-desktop-0.3.4-arm64.dmg/installed.json) |
| arm64 ZIP | Passed, native arm64 | [record](qa/d13/forge-desktop-0.3.4-arm64.zip/installed.json) |
| x64 DMG | Passed, x64 under Rosetta on arm64 | [record](qa/d13/forge-desktop-0.3.4-x64.dmg/installed.json) |
| x64 ZIP | Passed, x64 under Rosetta on arm64 | [record](qa/d13/forge-desktop-0.3.4-x64.zip/installed.json) |

All four report Electron 44.2.0 / Node 24.20.0, installed resources/plugin/PDF success,
isolated home match, proxy-free restricted PATH, Codex unavailable, zero model calls,
and Agent exited. Each evidence directory also contains its actual PDF screenshot.
PDF screenshots were visually checked. The app-directory probe is intermediate evidence;
the four archive records above are the final installation evidence.

四个最终产物均通过：arm64 为原生运行，x64 为 Rosetta。记录和 PDF 截图分别保存。
Agent、插件安装启用、PDF 正文和画布、中文工作区、会话恢复、隔离目录与退出均符合预期。
没有把 Codex 不可用状态当作登录成功，也没有把本轮离线样例当作真实模型运行。

`CI=true pnpm check` passed (two pre-existing informational lint notices).
`CI=true pnpm check:docs` passed. Focused: 39 tests; deterministic: 71 tests.
`CI=true pnpm package:verify` passed a real CLI packed install (341335 bytes), separate from
these desktop results. No package publication occurred. `git diff --check` passed.

D13 is complete for the authorized local unsigned artifact/handoff scope. Remaining release
work requires a separate task: Developer ID identity and entitlements review, signing and
notarization, Intel hardware/macOS 13 tests, quarantined-download Gatekeeper checks, installed
login/live provider/proxy scenarios, distribution and update policy. No permission is inferred
for those external release actions.

D13 的本地未签名产物与交接范围已完成。后续发布任务仍需开发者身份与权限审核、签名公证、
Intel/macOS 13 实测、下载隔离行为、安装后登录/真实模型/代理场景、分发与更新策略。
