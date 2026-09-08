---
title: 在 Git 中管理构件
description: 指导您在 Git 中管理 ambercast 生成的测试计划、grounding 伴生文件和运行目录。
---

本文介绍如何在 Git 中管理 ambercast 的构件。默认情况下，grounding 策略为 `repositoryPolicy: "committed"`，默认 runs 目录为 `tests/ambercast/.runs`。您可以依据团队配置，将对应文件纳入版本控制或添加至忽略规则。

## 前提条件 {#prerequisites}

- 默认 grounding 策略为 `repositoryPolicy: "committed"`；默认 runs 目录为 `tests/ambercast/.runs`。

## 操作步骤 {#steps}

1. 当策略为 `committed` 时，暂存 `<name>.test.md`、`<name>.ambercast.plan.json` 与 `<name>.ambercast.grounding.json`。解析器定义了这两个相邻的伴生文件后缀。
2. 当将 grounding 作为本地缓存使用时，请配置：

   这是官方发布的配置 Schema URL，`uncommitted` 是受支持的策略。
3. 将配置的 `runsDir` 添加至 `.gitignore`。若使用默认配置，请添加 `tests/ambercast/.runs/`。`runsDir` 是可配置的，运行过程会在其下专属的调用目录中写入一份 `report.json`。
4. 当 `repositoryPolicy` 为 `uncommitted` 时，将 `tests/ambercast/**/*.ambercast.grounding.json` 也添加至 `.gitignore`。若配置的 `testDir` 与默认值不同，请将路径中的 `tests/ambercast` 替换为您配置的 `testDir`。解析器仅在 `testDir` 内部推导带有固定 `.ambercast.grounding.json` 后缀的 grounding 伴生文件。这样在忽略本地 grounding 伴生文件的同时，测试计划（Plan）依然保持被追踪状态。

## 验证 {#verification}

- 运行 `git status --short`：
  - 策略为 `committed` 时，应显示计划文件与 grounding 伴生文件。
  - 策略为 `uncommitted` 时，应显示计划文件，但不应包含 `testDir` 本地的 `*.ambercast.grounding.json`。
  - 当配置的 `runsDir` 已被忽略时，不应出现该目录下的运行证据。

## 相关链接 {#related}

链接：[文件布局](/ambercast/zh-cn/reference/file-layout/)、[配置](/ambercast/zh-cn/reference/configuration/)、[计划文档](/ambercast/zh-cn/spec/plan-document/)、[Grounding 文档](/ambercast/zh-cn/spec/grounding-document/)、[控制 grounding 回写](/ambercast/zh-cn/how-to/control-grounding-writeback/)。
