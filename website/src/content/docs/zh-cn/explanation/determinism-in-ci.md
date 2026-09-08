---
title: CI 中的确定性
description: 解释 CI 行为背后的信任边界。
---

本文解释 CI 行为背后的信任边界。在 CI 流程中，Ambercast 将检查操作（`check`）作为门禁使用，其依赖结构被限制在只读范围之内：`CheckDeps` 仅暴露必要的只读与配置能力，同时省略了 AI 执行器、浏览器驱动与密钥等具有副作用的端口。

## 只读检查是结构性的 {#read-only-check}

当您在 CI 流水线中运行 `check` 时，该命令之所以能够作为可靠的检查门禁，是因为其只读特性并非依赖运行时约定，而是通过结构设计实现的。`CheckDeps` 仅暴露 `ReadStorageAdapter`、布局解析（layout resolution）、发现（discovery）、选定的配置以及一个可选的中止信号（abort signal）。

`CheckDeps` 有意省略了 AI 执行器、浏览器驱动、密钥（secrets）、时钟以及事件端口；在代码实现中，正是这些端口的缺失界定了只读边界。在此边界约束下，存储能力也被明确限定为只读：对于 prompt、plan、grounding 伴生文件以及孤立发现（orphan findings），仅进行读取和存在性检查便足以完成检查任务。

相关链接：[ambercast check](/ambercast/zh-cn/reference/cli/check/#read-only-contract)、[计划生命周期与新鲜度](/ambercast/zh-cn/explanation/plan-lifecycle/#fresh-plan-decision)

## 回放具有受限的持久化范围 {#bounded-side-effects}

在执行测试回放时，运行产物的持久化具有受限的范围，从而将回放证据与源构件的变更区分开来。`run` 执行时，首先定稿一个标记为 `persisted` 的信封（envelope），随后将其 JSON 仅写入该次调用的运行报告路径（run-report path）。

如果该写入操作失败，`run` 会返回一个包含 `reportPersistence: "failed"` 的信封；在此条件下，即便用例批次本身执行成功，进程状态也会变为退出码 3。对于该字段的状态含义，`reportPersistence: "not-attempted"` 表示未曾尝试进行持久化写入，而 `failed` 则表示在目标路径上没有任何部分内容变为可见。关于伴生文件回写的边界，请参阅 [ambercast run](/ambercast/zh-cn/reference/cli/run/#grounding-write-back)。

相关链接：[报告](/ambercast/zh-cn/reference/reports/#report-persistence)、[ambercast run](/ambercast/zh-cn/reference/cli/run/#grounding-write-back)

## CI 中默认拒绝修复 {#heal-refusal}

为了避免修复操作在流水线中静默修改 CI 构件，在 CI 环境中发起真正的 `heal` 调用时，除非 `config.ci.heal` 为 true，否则会抛出配置错误。CI 的这一拒绝判断是在列表模式短路求值之后才进行评估的，因此 `heal --list` 仍然是一个不执行写操作的发现操作。

在修复流程中，系统仅将 plan 和 grounding 伴生文件缓冲在私有覆盖层（private overlay）中；在确认之前或在 `--dry-run` 期间，回放尝试仍可在用例运行目录下写入受限的证据文件。从缓冲的伴生文件候选对象到真正的构件写入，后续的提交能力（commit capability）是唯一的途径。

相关链接：[ambercast heal](/ambercast/zh-cn/reference/cli/heal/#ci)、[自愈模型](/ambercast/zh-cn/explanation/healing-model/#confirmation-and-writes)

## 单一进程状态代表最强阻塞项 {#exit-priority}

当批次运行产生混合的结果时，系统通过单一的退出状态反映最关键的问题。退出码选择器（exit selector）独立于迭代顺序和重复候选对象，从中选出最强候选状态（strongest candidate）。

在模块加载阶段，断言机制会拒绝无效的排序表（rank table），从而将该选择规则维持为一项运行时不变式。这使得混合结果能够以一个可预测的进程状态体现，反映出当前的最高优先级阻塞项。

相关链接：[退出码](/ambercast/zh-cn/reference/exit-codes/#priority)、[操作契约](/ambercast/zh-cn/agents/operating-contract/#next-action-by-exit-code)、[读取结构化输出](/ambercast/zh-cn/agents/reading-structured-output/#decision-tree)
