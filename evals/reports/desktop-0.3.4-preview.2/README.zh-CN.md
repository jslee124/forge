# Desktop 0.3.4 Preview 2 发布记录

于 2026-09-23（北京时间）公开发布为 GitHub 预览版：[Preview 2](https://github.com/jslee124/forge/releases/tag/desktop-0.3.4-preview.2)。见[机器可读记录](release.json)及 [English](README.md)。

- 标签指向源码提交 `6f57f6ad3d5f15e71cbfbdf227f1044f04e58e47`；[该提交的远程 CI 通过](https://github.com/jslee124/forge/actions/runs/35700681711)。
- 本地检查及完整测试通过：491 项通过，6 项可选测试跳过。
- 两种架构均包含完整预览版本身份，主进程 bundle 与构建输出一致；四个安装产物的本地校验通过。
- 六个远端文件的大小及 SHA-256 与本地一致。六个公开下载地址的 HEAD 请求均返回 HTTP 200；Intel DMG 首次 TLS 失败后重试通过。公开校验清单及构建身份文件已下载并逐字节比对一致；发布后没有重新下载完整安装包。
- 已公开、非草稿，标记为预览版。稳定 latest 仍为 `v0.3.4`，没有触发 npm 发布。

安装包未签名、未公证。Preview 1 用户需要手动升级一次才能获得更新功能。受 API 配额及网络影响，完整的真实未认证 GitHub 更新检查仍未验证成功；发布与公开下载验证不能替代这项验收。本次不宣称 Applications 替换、Intel/Rosetta 运行或 macOS 13 真机验收。此前实现验收保留在[更新 QA](../../../apps/desktop/update-qa.zh-CN.md)。
