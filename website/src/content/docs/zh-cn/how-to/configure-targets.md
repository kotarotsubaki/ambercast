---
title: 配置目标环境
description: 配置 ambercast 测试运行的目标环境，包括基础 URL、自愈重放隔离及密钥注入源。
---

您可以通过配置文件定义测试运行的目标环境（targets）。若项目中存在配置文件，必须指定字符串类型的 `$schema`。

## 前提条件 {#prerequisites}

- 若存在配置文件，必须包含字符串类型的 `$schema`。

## 操作步骤 {#steps}

1. 写入 `{"$schema":"https://kotarotsubaki.github.io/ambercast/schemas/config.schema.json","targets":{"staging":{"baseUrl":"https://staging.example.test","browser":"chromium"},"admin":{"baseUrl":"https://admin.example.test","browser":"chromium"}},"defaultTarget":"staging"}`。这是已发布的配置 Schema URL；`targets` 与 `defaultTarget` 符合受支持的配置结构。
2. 仅向一次性目标环境添加 `"healReplayIsolation":"idempotent"`。受支持的隔离值为 `idempotent` 与 `stateful`；`healReplayIsolation` 的默认值为 `stateful`。
3. 当密钥可能需要在 `baseUrl` 之外填入时，添加 `"secretSinkOrigins":{"{{secrets.password}}":["https://login.example.test","https://admin.example.test"]}`。`secretSinkOrigins` 会将每个密钥引用映射至其允许的源数组；配置该映射将替换默认的源策略（基于 `baseUrl` 的源），且每个源都会进行规范化。

## 验证 {#verification}

- 运行 `npx ambercast check --target staging --list`；预期退出码为 `0` 并输出 `listed` 结果，且无需检查工件。

## 相关链接 {#related}

链接：[配置](/ambercast/zh-cn/reference/configuration/)、[ambercast check](/ambercast/zh-cn/reference/cli/check/)、[ambercast heal](/ambercast/zh-cn/reference/cli/heal/)、[计划中的机密](/ambercast/zh-cn/spec/secrets/)、[UI 变更后的测试自愈](/ambercast/zh-cn/tutorials/repair-your-first-drift/)。
