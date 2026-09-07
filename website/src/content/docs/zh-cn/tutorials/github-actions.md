---
title: 在 GitHub Actions 中运行 ambercast
description: 在 GitHub Actions 工作流中运行 ambercast 的规范操作流程。
---

本文介绍在 GitHub Actions 中运行 ambercast 的规范操作流程。在完成代码检出、依赖安装与运行环境配置后，您可以在 CI 工作流中依次配置并执行测试命令。

## 操作步骤 {#steps}

1. 在代码检出、Node 及依赖安装、Chromium 安装以及完成所需的提供商认证之后，向作业中添加以下命令：

```yaml
- run: npx ambercast check
- run: npx ambercast run
```

`check` 是一个具有只读选择选项的独立命令；shell 仅在看到 `check` 返回退出码 `0` 后才会分发 `run`。

2. 请勿添加 `--update-cache`。

默认的 CI 配置中 `updateGroundingCache: false`。

3. 请由人工提交并推送工作流。智能体若参与，需先展示工作流 diff，且仅在对话中收到明确请求后才可执行提交或推送。

`stale`（已过期）或不可信的工件会返回退出码 `4`，这会在 `run` 之前停止作业；智能体的提交与推送策略与 CLI 行为相互独立。

## 完成状态 {#completion-state}

- 作业仅在 `check` 退出码为 `0` 后才会进入 `run`；该作业未选择加入 grounding 回写。

相关链接：[在其他 CI 平台上运行](/ambercast/zh-cn/how-to/run-on-other-ci/), [控制 grounding 回写](/ambercast/zh-cn/how-to/control-grounding-writeback/), [ambercast check](/ambercast/zh-cn/reference/cli/check/), [ambercast run](/ambercast/zh-cn/reference/cli/run/), [退出码](/ambercast/zh-cn/reference/exit-codes/)。
