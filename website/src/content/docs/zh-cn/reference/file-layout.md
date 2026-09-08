---
title: 文件布局
description: 详细定义 Ambercast 的路径运算规则、产物写入方、生成时机以及基于实现的仓库提交策略。
---

Ambercast 依据规范的路径运算规则管理测试 prompt 及其伴生文件与运行产物。本文说明测试套件中相关文件的路径推导方式、写入方、生成时序以及实现层面的代码仓提交策略。

## 伴生文件 {#companions}

| 输入路径 | 派生路径 | 规则 |
| --- | --- | --- |
| `<testDir>/<dirs>/<name>.test.md` | `<testDir>/<dirs>/<name>.ambercast.plan.json` | 仅替换末尾的 `.test.md`；保留 `<name>` 中的其他点号。 |
| `<testDir>/<dirs>/<name>.test.md` | `<testDir>/<dirs>/<name>.ambercast.grounding.json` | 使用相同的相邻末尾后缀转换。 |

- 正向映射仅接受位于 `testDir` 内且严格以 `.test.md` 结尾、名称非空的路径；无效的调用方输入会引发 `RangeError`。
- 逆向映射仅识别目录树内完全匹配的 plan 或 grounding 后缀，否则返回 `undefined`。

## 运行产物 {#run-artifacts}

| 产物 | 精确路径 | 写入方 / 时机 | 基于实现的提交策略 |
| --- | --- | --- | --- |
| Prompt | `<testDir>/<dirs>/<name>.test.md` | 用户编写的输入；Ambercast 读取它。 | 未编码任何 Git 决策；Git 流程由 [在 Git 中管理构件](/ambercast/zh-cn/how-to/manage-artifacts-in-git/) 管辖。 |
| Plan 伴生文件 | `<testDir>/<dirs>/<name>.ambercast.plan.json` | Generate 写入新生成的 plan；heal 仅在获得授权的解决后才可替换它。 | 运行时将其视为已提交的输入，但不执行任何 Git 操作。 |
| Grounding 伴生文件 | `<testDir>/<dirs>/<name>.ambercast.grounding.json` | Generate 创建/修复它；run 可以在回写策略下写入发生变化的 grounding；heal 可以在解决后替换它。 | `grounding.repositoryPolicy` 默认为 `committed`，亦可设置为 `uncommitted`；Ambercast 自身不执行任何 Git 操作。 |
| 调用目录 | `<runsDir>/<runId>/` | Run 与 heal 为用例证据共用同一个调用标识；run ID 是由时间戳和 UUID 组成的安全路径段。 | 该目录不存在代码仓策略；Git 流程由 [在 Git 中管理构件](/ambercast/zh-cn/how-to/manage-artifacts-in-git/) 管辖。 |
| 用例目录 | `<runsDir>/<runId>/<test-relative-dir>/<name>/` | Run 将此目录提供给用例的证据捕获。 | 与调用目录相同。 |
| 运行截图 | `<runsDir>/<runId>/<test-relative-dir>/<name>/<stepId>.png` | Run 针对符合条件的实时浏览器失败步骤写入截图；敏感信息检测可能会忽略该截图。 | 与调用目录相同。 |
| 修复尝试目录 | `<runsDir>/<runId>/<test-relative-dir>/<name>/attempt-<n>/` | Heal 为每次尝试分配一个正整数序号，并将该尝试的证据/叠加层限制在该目录下。 | 与调用目录相同。 |
| 修复截图 | `<runsDir>/<runId>/<test-relative-dir>/<name>/attempt-<n>/<stepId>.png` | 共享捕获路径将符合条件的失败步骤证据写入该尝试范围内的用例目录中。 | 与调用目录相同。 |
| 运行报告 | `<runsDir>/<runId>/report.json` | 仅 `run` 会在执行后写入最终的批处理封套；原子写入失败会改变 `reportPersistence`。 | 与调用目录相同。 |

- `runsDir` 是独立配置的，默认值为 `tests/ambercast/.runs`；它并非由布局解析器从 `testDir` 派生得出。
- `runId` 必须匹配 `^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$`，从而防止路径分隔符、点分路径段以及空 ID。
- 仅 `run` 会持久化保存 `report.json`；generate、check 与 heal 仅返回封套，不执行此布局写入。

## 相关链接

- [配置](/ambercast/zh-cn/reference/configuration/#key-table)
- [报告](/ambercast/zh-cn/reference/reports/#persistence)
- [提示词文件格式](/ambercast/zh-cn/reference/prompt-format/#file-identity)
- [在 Git 中管理构件](/ambercast/zh-cn/how-to/manage-artifacts-in-git/)
- [计划生命周期与新鲜度](/ambercast/zh-cn/explanation/plan-lifecycle/)
