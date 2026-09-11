# 搜索与网页读取插件

[English](README.md)

这是可选的 Forge 引擎插件，通过普通插件 API 注册 `web_search`、`web_fetch`
和报告提示。两种权限配置下每次联网都需要审批，不会默认启用。

## 安装与配置

桌面应用打开 **设置 → 联网研究**，先安装随应用提供的插件，再显式启用。
安装仅复制本地应用内的版本到 `$FORGE_HOME/plugins/web-tools`，不会下载代码、
覆盖已有插件或自动启用。启用修改共享的 Forge 用户配置，因此也作用于 TUI。
项目 `.forge/config.json` 不能配置插件启用列表。

源码用户先安装锁定依赖，再生成包含 Readability 0.6.0、jsdom 26.1.0、运行依赖及
许可证的完整分发目录：

```bash
CI=true pnpm install --frozen-lockfile
node scripts/build-web-plugin.mjs
mkdir -p "${FORGE_HOME:-$HOME/.forge}/plugins"
cp -R apps/desktop/out/web-tools "${FORGE_HOME:-$HOME/.forge}/plugins/web-tools"
```

仅复制到不存在的目标目录。旧版或自定义安装需自行保留或移走。必须复制整个目录，
包含 `node_modules`，不能只复制入口。桌面构建将同一目录打包在 ASAR 外。
在用户配置中显式启用：

```json
{
  "schemaVersion": 1,
  "plugins": { "enabled": ["web-tools"] }
}
```

服务选择保存在插件目录的 `settings.json`，例如 `{ "provider": "duckduckgo" }`。
可选值为 `auto`、`brave`、`duckduckgo`。这是工具输入的默认值；显式工具输入可以
选择其他服务，工具结果会记录请求选择和实际服务。

Auto 在 `BRAVE_SEARCH_API_KEY` 存在时选择 Brave，否则选择 DuckDuckGo HTML，
不是请求失败后切换。Brave 缺少密钥会明确报错。密钥须在启动 Agent 的环境中设置，
插件不会保存或返回密钥，界面只显示是否存在。GUI 启动的环境可能与终端不同。

CLI 与桌面 Agent 共用 HTTP 代理初始化，支持 `HTTP_PROXY`、`HTTPS_PROXY`、
`NO_PROXY` 及小写别名。只支持 HTTP/HTTPS 代理地址，不支持 SOCKS 地址。

## 读取边界与报告

只把受控请求已经下载的 HTML 交给 `new JSDOM`，禁用脚本与远程资源加载，
不调用解析器联网入口或启动浏览器。Readability 提取文章；列表页、JavaScript
空壳页面或提取失败回退到基本文本，并明确说明限制。返回有界文本，不渲染原始 HTML。
静态提取不能证明动态内容已被读取。

读取结果包含请求/最终 URL、访问时间、可获得的发布时间、提取方法和阅读范围。
工具结果的 `truncated` 标记覆盖下载量、字符数和序列化输出上限。
搜索结果标记为 `search-snippets`，不能当作已读正文。读取失败仍是错误，
运行活动及历史中的调用参数保留请求 URL。

请求仅允许标准端口的 HTTP(S)，拒绝 URL 内凭据、本地地址、私网及保留地址；
直接连接前检查 DNS，每次重定向重新检查目的地。显式代理自行解析域名，
`NO_PROXY` 目标保留直接 DNS 检查。最多五次网页重定向、1 MiB 下载、50,000
请求字符，工具输出上限优先。响应及正文读取都有超时，Brave 凭据不能跨站转发。
域名检查不是网络沙箱，不能完全消除 DNS 重绑定；显式代理属于信任边界。

可以要求生成带来源的 Markdown 报告，并用普通工作空间写入工具保存 `.md` 文件。
原有 Markdown 预览和另存为用于检查与导出，不新增报告专用执行通道。
插件提示要求事实旁附实际查询/读取过的来源链接，区分搜索摘要、已读正文、截断和失败，
列出来源访问时间及阅读限制。这是模型写作指导，不是自动事实核验或引用验证器，
仍需检查证据。网页内容不能授权执行。

Codex 使用自己的工具和沙箱，此插件不会为 Codex 伪造来源字段或保证能力相同。
当前离线、打包及真实服务证据见
[D11 验收记录](https://github.com/jslee124/forge/blob/main/docs/zh-CN/DESKTOP_APP_TASKS.md)。
