---
title: 文件布局
description: 说明 Ambercast 为伴生文件和运行产物推导的路径、各文件的写入方以及写入时机。
---

Ambercast 从测试目录和运行目录解析所有伴生文件与运行产物的路径。本文列出每个推导路径、写入方与时机，以及实现中编码的提交策略。

## 伴生文件 {#companions}

| 输入路径 | 派生路径 | 规则 |
| --- | --- | --- |
| `<testDir>/<dirs>/<name>.test.md` | `<testDir>/<dirs>/<name>.ambercast.plan.json` | 只替换末尾的 `.test.md`。保留 `<name>` 中的其他点号。 |
| `<testDir>/<dirs>/<name>.test.md` | `<testDir>/<dirs>/<name>.ambercast.grounding.json` | 对相邻的末尾后缀应用同样的转换。 |

正向映射只接受位于 `testDir` 内、严格以 `.test.md` 结尾且名称非空的路径。无效的调用方输入会引发 `RangeError`。逆向映射只识别目录树内完全匹配的执行计划或定位缓存后缀，其余情况返回 `undefined`。

## 运行产物 {#run-artifacts}

| 产物 | 精确路径 | 写入方 / 时机 | 基于实现的提交策略 |
| --- | --- | --- | --- |
| 提示词 | `<testDir>/<dirs>/<name>.test.md` | 由你编写。Ambercast 读取它。 | 实现中没有编码任何仓库决策。流程见[在 Git 中管理产物](/ambercast/zh-cn/how-to/manage-artifacts-in-git/)。 |
| 执行计划伴生文件 | `<testDir>/<dirs>/<name>.ambercast.plan.json` | `generate` 写入新生成的执行计划。`heal` 只有在获得授权的确定（settlement）后才能替换它。 | 运行时把它当作已提交的输入。它不执行任何仓库操作。 |
| 定位缓存伴生文件 | `<testDir>/<dirs>/<name>.ambercast.grounding.json` | `generate` 创建或修复它。`run` 可在回写策略下写入发生变化的定位缓存。`heal` 可在确定后替换它。 | `grounding.repositoryPolicy` 默认为 `committed`，也可设为 `uncommitted`。Ambercast 自身不执行任何仓库操作。 |
| 调用目录 | `<runsDir>/<runId>/` | `run` 与 `heal` 为用例证据使用同一个调用标识。run ID 是由时间戳和 UUID 组成的安全路径段。 | 运行时对该目录没有仓库策略。`ambercast init` 会为默认的 `runsDir` 在 `.gitignore` 中追加 `tests/ambercast/.runs/`。流程见[在 Git 中管理产物](/ambercast/zh-cn/how-to/manage-artifacts-in-git/)。 |
| 用例目录 | `<runsDir>/<runId>/<test-relative-dir>/<name>/` | `run` 把该目录提供给用例的证据捕获。 | 与调用目录相同。 |
| 运行截图 | `<runsDir>/<runId>/<test-relative-dir>/<name>/<stepId>.png` | `run` 为符合条件的实时浏览器失败步骤写入。机密检测可能会省略它。 | 与调用目录相同。 |
| 修复尝试目录 | `<runsDir>/<runId>/<test-relative-dir>/<name>/attempt-<n>/` | `heal` 为每次尝试分配一个正整数序号，并把该尝试的证据和叠加层限制在此目录下。 | 与调用目录相同。 |
| 修复截图 | `<runsDir>/<runId>/<test-relative-dir>/<name>/attempt-<n>/<stepId>.png` | 共享捕获路径把符合条件的失败步骤证据写入该尝试范围内的用例目录。 | 与调用目录相同。 |
| 运行报告 | `<runsDir>/<runId>/report.json` | `run` 在执行后写入最终的批处理封套。[`ambercast view`](/ambercast/zh-cn/reference/cli/view/)会读取它。原子写入失败会改变 `reportPersistence`。 | 与调用目录相同。 |

截图是尽力而为的。截图捕获或存储失败时，也会省略截图。

`runsDir` 单独配置，默认值为 `tests/ambercast/.runs`。布局解析器不会从 `testDir` 推导它。

`runId` 必须匹配 `^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$`。该模式排除了路径分隔符、点分路径段和空 ID。

`report.json` 由 `run` 写入。其他报告类命令只返回封套，不写入该文件。

## 另请参阅 {#see-also}

- [配置](/ambercast/zh-cn/reference/configuration/#key-table)
- [报告](/ambercast/zh-cn/reference/reports/#persistence)
- [提示词文件格式](/ambercast/zh-cn/reference/prompt-format/#file-identity)
- [在 Git 中管理产物](/ambercast/zh-cn/how-to/manage-artifacts-in-git/)
- [计划生命周期与新鲜度](/ambercast/zh-cn/explanation/plan-lifecycle/)
