---
title: 在其他 CI 平台上运行
description: 适用于 GitLab CI 与通用运行器的可移植 CI 配置方案。
---

本文介绍适用于 GitLab CI 和通用运行器（generic runners）的可移植 CI 配置方案。

## 前提条件 {#prerequisites}

- `run` 接受 `--cache-only`、`--update-cache`、`--allow-empty` 和 `--list`；它没有 `--config` 选项。

## 操作步骤 {#steps}

1. 在 GitLab CI 或通用运行器中，安装项目的 Node 依赖项，并使用 `npx playwright-core install chromium` 安装 Chromium；使用对应平台的缓存机制缓存浏览器安装目录。代码仓库需要 Chromium 并记录了此安装命令；完全 grounding 的重放可能在无需选择提供商的情况下继续执行。
2. 精确执行 `npx ambercast check`，随后执行 `npx ambercast run`。在上传调用生成的 `report.json` 之前，应用事前审查、受限访问及较短的保留期；仅在具备这些控制措施时才进行上传。Shell 顺序执行机制仅在 check 成功退出时才会执行 run；run 会在其调用目录中写入一份报告，且报告步骤结果可以保留 `actual` 文本和无障碍快照。
3. 仅在经过相同的事前审查、受限访问及较短的保留期后，通过明确选择加入（opt-in）来上传调用证据或截图。执行失败的实时浏览器步骤可以在调用证据目录下持久化保存 PNG 截图，且安全扫描无法检测 Canvas、图像或 CSS 渲染的像素，也无法检测扫描到截图之间的时间差。
4. 不要调用 `heal`，也不要传递 `--update-cache`。CI 默认配置包含 `heal: false` 和 `updateGroundingCache: false`；真正的修复是通过 `ci.heal: true` 明确选择加入的操作，并非默认的 CI 行为。

## 验证 {#verification}

- 依据进程退出代码对作业设置门禁，并据此解读结果。不可信产物与环境故障属于不同的进程类别。

## 相关链接 {#related}

链接：[在 GitHub Actions 中运行 ambercast](/ambercast/zh-cn/tutorials/github-actions/)、[ambercast check](/ambercast/zh-cn/reference/cli/check/)、[ambercast run](/ambercast/zh-cn/reference/cli/run/)、[退出码](/ambercast/zh-cn/reference/exit-codes/)、[配置](/ambercast/zh-cn/reference/configuration/)。
