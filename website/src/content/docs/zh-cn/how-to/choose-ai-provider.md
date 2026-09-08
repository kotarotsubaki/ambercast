---
title: 选择 AI 提供商
description: 配置 ambercast 使用固定的 AI 提供商或使用自动探测。
---

ambercast 允许您根据对结果复现性或可用性的不同需求，选择 `claude`、`codex` 作为固定的 AI 提供商，或者使用 `auto` 模式进行探测。您可以通过配置文件指定默认项，也可以借助环境变量与命令行选项随时进行覆盖。

## 前提条件 {#prerequisites}

配置项 `ai.provider` 接受 `claude`、`codex` 或 `auto`，其默认值为 `auto`。

## 操作步骤 {#steps}

1. 在既未设置 `AMBERCAST_AI_PROVIDER` 也未传入 `--ai` 的情况下，在 `ambercast.config.json` 中配置如下内容，以固定使用可复现的提供商；若当前可用的是 Codex，可将 `claude` 替换为 `codex`：

```bash
npx ambercast generate --ai codex
```

   该 URL 为官方发布的配置 Schema 地址。环境变量的优先级高于配置文件，而 `--ai` 命令行选项则会覆盖已解析的配置。

2. 在未设置上述任何覆盖项时，若相比固定单一提供商更看重可用性，您可以省略 `ai.provider` 配置项以使用 `auto`。解析流程会先探测 Claude，再探测 Codex，并返回第一个可用的提供商。

3. 运行带有 `--ai` 选项的生成命令：



   命令行覆盖仅接受 `claude` 与 `codex`；若传入无效的提供商文本，程序将退出并返回状态码 `2`。

## 验证 {#verification}

运行 `npx ambercast generate --list` 仅用于确认 prompt 的选取，该命令会在解析提供商之前直接返回。若要验证实际选取的提供商，请执行一次全新的生成、针对已过期内容的生成，或添加 `--force` 选项执行生成，以确保流程进入实际的 AI 执行阶段。

## 相关参考 {#related}

- [配置](/ambercast/zh-cn/reference/configuration/)
- [环境变量](/ambercast/zh-cn/reference/environment-variables/)
- [ambercast generate](/ambercast/zh-cn/reference/cli/generate/)
