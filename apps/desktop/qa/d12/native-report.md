# 检查报告

## 1. sum.js
把 `a - b` 改为 `a + b`。最终内容：`export function add(a, b) { return a + b; }`（含末尾换行）。

## 2. CSV
input.csv 保留 ID 001/002；output.csv 内容为 id,amount / 001,10 / 002,20 / TOTAL,30。

## 3. Web 检查
- 搜索“Mozilla Readability”（DuckDuckGo，2026-09-11 05:49 UTC）：仅得搜索摘要（snippet-only），未抓取网页正文；结果列表被截断。
- 抓取 https://example.com/ 成功：HTTP 200，text/html，未截断，正文为示例域名说明文本。
- 读取失败：无。局限：该抓取无法做文章抽取，且不执行 JavaScript。

## 来源
- 搜索摘要（snippet-only，未读正文）：https://github.com/mozilla/readability ；https://www.npmjs.com/package/@mozilla/readability
- 已抓取正文（2026-09-11 05:49 UTC，无发布日期）：https://example.com/
