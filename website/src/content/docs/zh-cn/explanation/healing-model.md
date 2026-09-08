---
title: 自愈模型
description: 解释受限递进与人工控制如何规范自愈行为。
---

ambercast 的自愈模型围绕受限递进与人工控制展开。在实际修复工作开启之前，系统通过安全前置条件对自愈行为施加约束：选定目标必须具备幂等隔离，且在 CI 环境中需要获得明确权限，从而在浏览器或提供商（provider）启动工作之前确立严格的安全边界。

## 安全的前提条件 {#safe-precondition}

自愈在进入实际修复工作之前必须满足严格的约束。所选定的目标必须解析出 `healReplayIsolation: "idempotent"`；若针对非幂等目标执行自愈，在浏览器或提供商的工作开始之前就会被拒绝。在配置边界处，系统允许将其配置为 `idempotent` 或 `stateful`，但加载配置时会提供保守的 `stateful` 默认值。

运行环境同样存在明确的前置控制。在持续集成（CI）环境中，真正的自愈尝试会被拒绝，除非启用了 `ci.heal`。列表模式（list mode）则会绕过该拒绝机制，因为该模式不会产生主要效果。

相关链接：[ambercast heal](/ambercast/zh-cn/reference/cli/heal/#preconditions)、[配置](/ambercast/zh-cn/reference/configuration/#targets)、[CI 中的确定性](/ambercast/zh-cn/explanation/determinism-in-ci/#heal-refusal)

## 三阶段递进 {#three-stages}

自愈的修复过程遵循从已缓存证据到更大范围重新生成的阶梯式递进顺序。在发起修复之前，自愈首先测量仅使用缓存的重放基线（cache-only replay baseline）；只有当该基线出现失败时，系统才会尝试非仅缓存的测量。

当确认存在失败后，修复工作按三个阶段逐步升级：

阶段 1 尝试在首个失败边界（failing frontier）执行 grounding 修复；推进该边界会记录元素重新定位（element regrounding）或 AI 重新回溯（AI retracing）。

阶段 2 仅在阶段 1 未能推进失败边界时，才尝试结构化的单步或尾部修复（single-step/tail repair）。

阶段 3 仅在仍有失败存在且用例未在其截止期限处停止时，才尝试全计划修复（full-plan repair）。

相关链接：[ambercast heal](/ambercast/zh-cn/reference/cli/heal/#repair-model)、[步骤](/ambercast/zh-cn/spec/steps/)、[重放与 grounding](/ambercast/zh-cn/explanation/replay-and-grounding/#drift-handoff)

## 约束增量修复的预算机制 {#repair-budgets}

为了防止增量修复发散，系统引入了具体的预算机制。配置项 `heal.maxStepRepairs` 是一个可选的正整数配置值。自愈用例在创建其调度预算（dispatch budget）时，若该项未设置则使用 `Infinity`，若已设置则采用 `maxStepRepairs` 的配置值。

用例的时间消耗同样受到严格约束。配置项 `heal.caseTimeoutMs` 是一个正整数，并在基线重放开始之前确立用例级别的准入截止时间（case-wide admission deadline）。该超时会阻止新的修复阶段或调度启动；但它不会中断正在进行的工作（in-flight work），也不会使已生成的提交（commit）失效。

相关链接：[配置](/ambercast/zh-cn/reference/configuration/#heal)、[ambercast heal](/ambercast/zh-cn/reference/cli/heal/#limits)

## 确认机制隔离测量与写入 {#confirmation-and-writes}

修复方案的可审查性依赖于测量与写入之间的清晰分离。在自愈过程中，每个用例都会在私有覆盖层（private overlay）中累积候选工件；返回的提交能力（commit capability）是真正写入工件的唯一途径。

确认环节发生在测量之后、首次提交之前，因此系统提示可以在写入先于许可发生之前，向您展示待处理的文件以及修复类型。

命令行选项进一步界定了这一确认边界：`--dry-run` 绝不提示确认，也绝不执行提交；`--yes` 是对确认边界的预先授权，但不能替代智能体获取用户授权。在未提供 `--yes` 的情况下，非交互式调用者将收到配置错误，而不会发生隐式写入。

相关链接：[ambercast heal](/ambercast/zh-cn/reference/cli/heal/#confirmation)、[操作契约](/ambercast/zh-cn/agents/operating-contract/#command-contract)、[审查生成的 diff](/ambercast/zh-cn/how-to/review-generated-diffs/)
