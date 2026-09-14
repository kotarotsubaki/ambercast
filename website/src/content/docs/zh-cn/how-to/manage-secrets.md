---
title: 管理机密
description: 安全地批准生成的机密名称，并从环境变量解析其值。
---

Ambercast 在生成 Plan 时发现候选机密名称。你可通过交互式同意提示批准这些名称，或为非交互式使用预先填充配置许可列表；机密值始终保留在提示词和产物之外。

## 前提条件 {#prerequisites}

- 不需要已有的 `ambercast.config.json` 文件。当已批准的同意需要持久化许可列表而配置文件不存在时，Ambercast 会自动创建该文件。

## 操作步骤 {#steps}

1. 在提示词中描述用户结果，不要包含授权行或机密值。

   ```markdown
   # Sign in

   Sign in as the configured test user and verify that the dashboard heading is visible.
   ```
2. 运行 `npx ambercast generate tests/ambercast/<name>.test.md`。生成首先创建候选 Plan，并列出任何新提出的机密名称。在交互式终端中，逐一审查名称，只批准适用于该测试的名称。
3. 对于 CI 或其他非交互环境，请在生成前添加已审查的名称：

   ```json
   {
     "$schema": "https://kotarotsubaki.github.io/ambercast/schemas/config.schema.json",
     "secrets": { "allow": ["password"] }
   }
   ```

   空的 `secrets.allow` 要求逐个同意名称。值 `"*"` 会无需逐名审查地接受 AI 提出的任何名称；它会移除批准边界，只有在理解这一点时才应使用。如果它已经是 `"*"`，批准同意不会写入许可列表更新。

   记录已批准的名称时，Ambercast 会执行排他更新，然后在合并前重新读取并验证当前磁盘上的配置；不会覆盖在运行早期取得的配置快照。现有 `secrets.allow` 名称会去重并保留原有顺序。新批准的名称会先去重、排除已存在的名称，再按字母顺序排序并追加。
4. 仅在命令环境中设置相应的值。运行时，`{{secrets.a.b}}` 从 `AMBERCAST_SECRET_A_B` 解析：点号变为下划线，各段转为大写。若填充操作不在 `baseUrl`，请按照 [配置目标环境](/ambercast/zh-cn/how-to/configure-targets/) 配置额外源。

## 验证 {#verification}

- 在同意或添加许可列表条目后，生成会持久化 Plan；新接受的名称也会记录在 `secrets.allow` 中。
- 对于一次生成批次，Ambercast 会将所有新批准的名称一次性提交到许可列表，然后才写入任何候选项的 Plan 或 Grounding 文件。这些是独立操作，而非一个事务：如果在许可列表提交成功后发生中断或失败，即使部分或全部候选项的 Plan 和 Grounding 文件尚未写入，许可列表更新仍会保留在磁盘上。这是已知且可接受的状态：`secrets.allow` 可能领先于实际生成的产物。重新运行 `generate` 即可恢复；它会继续使用已经在许可列表中的名称。
- 若拒绝同意，或在非交互式终端中无法请求同意，生成会以 `SECRET_CONSENT_REQUIRED` 失败，且不会写入候选产物。将已审查的名称添加到 `secrets.allow` 后重新生成。
- 在命令环境中仍保留所需的 `AMBERCAST_SECRET_<NAME>` 变量，在安全目标上运行 `npx ambercast run --resolve tests/ambercast/<name>.test.md`。只有实时源通过 sink-policy 检查后，`fill-secret` 才会解析该命名变量。

## 相关链接 {#related}

链接：[计划中的机密](/ambercast/zh-cn/spec/secrets/)、[环境变量](/ambercast/zh-cn/reference/environment-variables/)、[配置](/ambercast/zh-cn/reference/configuration/)、[错误代码](/ambercast/zh-cn/reference/error-codes/)。
