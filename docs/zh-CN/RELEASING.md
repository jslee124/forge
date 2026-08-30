# npm 发布指南

[English](../RELEASING.md) · [中文文档目录](README.md)

Forge 保持内部实现 package 私有，只发布一个面向用户的
`@jslee124/forge`。生成物包含 CLI、已 bundle 的 `@forge/*` workspace
实现，以及经过审核且版本匹配的内置 Skill 资源；第三方库仍是普通 npm
runtime dependencies。插件 SDK 暂不作为独立 package 发布。

## 分发合约

- 安装：`npm install --global @jslee124/forge`
- 命令：`forge`
- 稳定 npm tag：`latest`
- 预发布 npm tag：`next`
- Runtime：Node.js 24 或更高版本
- 生成目录：`dist/npm/forge`

源码中的 `apps/cli` 继续保持 private。`pnpm build:package` 只在被忽略的
`dist/npm/forge` 中生成公共 manifest 和 bundle，避免开发文件意外进入
registry。

## 准备 release

从干净 checkout 开始，并选择 SemVer：

```bash
pnpm version:set 0.3.0
pnpm install --frozen-lockfile
pnpm check
pnpm check:docs
pnpm test
pnpm eval:deterministic
pnpm package:verify
pnpm release:verify-tag v0.3.0
```

`package:verify` 会构建公共产物、检查 tarball、在全新临时 prefix 中禁用
lifecycle scripts 后安装，核对内置 Skill/reference/template allowlist 与
API version，并验证 `forge --version`、`forge --help` 和 `forge config validate`。

打 tag 前必须检查 pack 内容和 release notes。API key、auth 文件、本地
trace、`.env` 以及未经脱敏审核的 evaluation artifact 都不能发布。

## 首次发布到 npm

npm 账号或组织必须拥有 `@jslee124` scope，并启用 2FA。npm package 存在后
才能配置 trusted publisher，因此先用经过审核的预发布版本（例如
`0.3.0-bootstrap.0`）和非稳定 dist-tag 创建 package，再把仓库中的
`publish.yml` 配置为 GitHub Actions trusted publisher。bootstrap 版本不要
放入 `latest`。

trusted publishing 配置完成后，稳定版本只由 tag workflow 发布。它使用
OIDC，不保存长期 npm token，并在所有 release gate 通过后发布生成 package。

## 发布稳定版本

提交版本、release notes 和构建输入，然后创建不可移动的 annotated tag：

```bash
git tag -a v0.3.0 -m "Forge v0.3.0"
git push origin v0.3.0
```

`Publish npm package` workflow 会先确认 Git tag、根版本、私有 workspace
版本、runtime 版本和生成 npm package 完全一致，然后使用显式 dist-tag 发布。
稳定语义版本路由到 `latest`；带 prerelease component 的版本路由到 `next`。

不要移动已经发布的 Git tag，也不要复用 npm 版本。错误 release 应通过新的
patch 版本修复，并保留旧版本供用户回滚。

## 用户更新

用户可以显式检查或安装更新：

```bash
forge update check
forge update
forge update 0.3.3
```

交互启动在 Ink 内发布 cached、refreshing、available、current、failed 或 disabled 状态，并最多每 24 小时刷新一次 npm metadata；晚到结果不会进入对话历史。启动永不安装更新，`/update-dismiss` 只 dismiss 当前版本。`FORGE_DISABLE_UPDATE_CHECK=1` 可关闭启动检查。显式命令仍可重复，会先解析精确 SemVer；只有识别 npm/pnpm 全局安装来源后才用 argument array 与 `--ignore-scripts` 安装，未知来源只报告版本和 release notes。成功后仍需 restart。
