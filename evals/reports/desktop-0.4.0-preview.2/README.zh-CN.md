# Desktop 0.4.0 Preview 2 发布记录

[English](README.md) · [发布报告目录](../README.md)

## 准备阶段

尚未公开发布。本记录区分已合并应用的检查、新的不可变标签打包，以及公开下载核验。

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

## 验证边界

Windows 安装包未签名；macOS DMG 未签名、未公证。Runner 启动检查不能证明 Intel 实机、
macOS 13、Gatekeeper／SmartScreen、VoiceOver、所有 IME 路径、真实 Codex／模型登录，
也不代表完整产品验收。完整两轮验收与独立用户测试仍未完成，旧失败证据保留。
Telegram 暂缓；CLI/npm 发布独立，不属于本次桌面版发布。
