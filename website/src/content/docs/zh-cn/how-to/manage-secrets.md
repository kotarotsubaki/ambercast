---
title: 管理机密
description: 遵循安全编写路径在测试提示词中管理与使用机密引用。
---

本文介绍在测试提示词中管理机密的安全编写路径。机密引用 `{{secrets.a.b}}` 从环境变量 `AMBERCAST_SECRET_A_B` 解析。

## 前提条件 {#prerequisites}

- 机密引用 `{{secrets.a.b}}` 从 `AMBERCAST_SECRET_A_B` 解析。

## 操作步骤 {#steps}

1. 在单独的非代码提示词行中精确写入 `@ambercast-secret {{secrets.password}}`。授权解析器会接受完整匹配的行，并排除代码块、缩进代码和行内代码。一行授权仅授权一次使用；同一机密需要多次使用时，每次使用都重复一行。例如，先登录、登出后再次登录。

   ```
   @ambercast-secret {{secrets.password}}
   ...sign in, then sign out...
   @ambercast-secret {{secrets.password}}
   ```
2. 在首次执行 `npx ambercast generate tests/ambercast/<name>.test.md` 之前，请由人工或经批准的扫描工具确认整个提示词在 SecretRef 授权之外不包含任何明文机密。随后，`generate` 会在执行明文机密检查之前将其 AI 提供商上下文中的规范化提示词发送出去；该检查无法保护已在提示词中发送的机密。
3. 在命令环境中设置 `AMBERCAST_SECRET_PASSWORD`，然后运行 `npx ambercast generate tests/ambercast/<name>.test.md`。随后，生成阶段会授权提示词 grant，但不会构建机密提供商，也不会解析其值。
4. 若填充操作不在 `baseUrl`，请按照 [配置目标环境](/ambercast/zh-cn/how-to/configure-targets/) 配置额外源。缺失的映射默认回退至 base-URL 源。

## 验证 {#verification}

- 生成完成后，请在命令环境中保留该变量的情况下，针对安全目标运行 `npx ambercast run tests/ambercast/<name>.test.md`。运行阶段会构建环境机密提供商；只有在实时源通过其 sink-policy 检查后，`fill-secret` 才会解析该命名变量。
- `npx ambercast generate --json tests/ambercast/<name>.test.md` 不得返回 `SECRET_LITERAL_REJECTED`。该拒绝逻辑会在持久化或报告序列化之前检查来自提供商的生成 JSON；它保护的是生成的响应，而非已发送给提供商的提示词。

## 相关链接 {#related}

链接：[计划中的机密](/ambercast/zh-cn/spec/secrets/)、[环境变量](/ambercast/zh-cn/reference/environment-variables/)、[配置](/ambercast/zh-cn/reference/configuration/)、[错误代码](/ambercast/zh-cn/reference/error-codes/)。
