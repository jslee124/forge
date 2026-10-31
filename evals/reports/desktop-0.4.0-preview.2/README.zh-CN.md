# Desktop 0.4.0 Preview 2 发布记录

[English](README.md) · [发布报告目录](../README.md)

## 准备阶段

已公开发布为预览版，公开下载检查通过。本记录区分已合并应用的检查、新的不可变标签打包，以及公开下载核验。

- 应用合并：PR #9，main `7caf490`；候选源码 `da55e29`。
- 候选源码 CI：[41052172854](https://github.com/jslee124/forge/actions/runs/41052172854) 通过，覆盖 Windows x64 打包、打包启动、NSIS 安装／启动／卸载，以及 macOS arm64/x64 打包与 runner 上启动。
- 合并 CI：[41188036903](https://github.com/jslee124/forge/actions/runs/41188036903) 通过。
- 本地应用检查：877 项测试通过（6 项按需测试跳过）、223 项确定性检查、源码／文档检查和 npm 打包安装验证通过。
- 上述 CI 产物的身份为 `.ci.41052172854`，不会改名充当 Preview 2 安装包。
- 上述本地 arm64 候选通过隔离目录下打包启动检查和 ZIP 完整性检查；不代表下载 DMG 后的安装验收。
- 较早 `c86c983` 的 Windows 失败保留在 [41051083907](https://github.com/jslee124/forge/actions/runs/41051083907)；`da55e29` 修复链接记录文件处理后才通过检查。

## 发布要求

新标签 `desktop-0.4.0-preview.2` 必须指向经过检查的发布源码。
准确标签的 CI 需以该身份重新生成 Windows x64 与 macOS arm64/x64 产物，完成发布检查、
安装与启动检查，汇总 EXE、两个 DMG 并核对 SHA-256。上传文件名、大小及可用的远端摘要
与五个预期文件一致前，保持为非公开草稿。

## 发布与公开下载核验（2026-10-31）

- [desktop-0.4.0-preview.2](https://github.com/jslee124/forge/releases/tag/desktop-0.4.0-preview.2) 于 2026-10-31T09:40:16Z 发布，为非草稿预览版；稳定 Latest 仍为 `v0.4.0`。
- 不可变源码：`f1b8a7489bc2c7266b35a9d67de00b7b76f97a3b`。PR #10 在 [PR CI](https://github.com/jslee124/forge/actions/runs/41188781435) 通过后合并；[准确 main CI](https://github.com/jslee124/forge/actions/runs/41189226422) 通过。
- [标签发布 CI](https://github.com/jslee124/forge/actions/runs/41189244124) 五个 job 均通过，覆盖发布检查、Windows x64 打包与 NSIS 安装／启动／卸载、macOS arm64/x64 打包及 runner 启动、不可变源码核验、产物汇总和草稿上传校验。
- 五个公开文件均已独立下载；文件名、字节大小、SHA-256、平台／版本清单、GitHub 摘要和双语正文全部一致。完整已审阅数据见 [publication.json](publication.json)。
- 公开 Apple Silicon DMG 已只读挂载，复制到隔离临时目录并使用隔离 home 启动；打包启动检查退出码为 0，内嵌版本为 `0.4.0-preview.2`，镜像已卸载。没有替换现有应用；这不代表 Gatekeeper／隔离属性验收。

## 验证边界

Windows 安装包未签名；macOS DMG 未签名、未公证。Runner 启动检查不能证明 Intel 实机、
macOS 13、Gatekeeper／SmartScreen、VoiceOver、所有 IME 路径、真实 Codex／模型登录，
也不代表完整产品验收。完整两轮验收与独立用户测试仍未完成，旧失败证据保留。
Telegram 暂缓；CLI/npm 发布独立，不属于本次桌面版发布。
