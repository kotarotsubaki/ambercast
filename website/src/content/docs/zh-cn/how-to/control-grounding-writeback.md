---
title: 控制 grounding 回写
description: 配置本地开发与 CI 环境中变更后的 grounding 缓存回写策略。
---

在运行测试后，您可以根据团队工作流控制变更后的 grounding 缓存如何回写至磁盘。本文提供面向不同持久化目标的配置步骤；完整的规范矩阵与运行时行为请参阅 [配置](/ambercast/zh-cn/reference/configuration/) 与 [ambercast run](/ambercast/zh-cn/reference/cli/run/)。

## 前置条件 {#prerequisites}

在调整配置之前，请确认以下配置项及其取值要求：

- `grounding.localWriteBack` 接受 `auto` 或 `explicit`。
- `ci.updateGroundingCache` 为布尔值（boolean）。

## 操作步骤 {#steps}

### 1. 配置本地自动持久化

若希望在本地执行测试时自动持久化变更后的 grounding 缓存，请设置配置：

```json
{"$schema":"https://kotarotsubaki.github.io/ambercast/schemas/config.schema.json","grounding":{"localWriteBack":"auto"}}
```

这是官方发布的配置 Schema URL，且 `auto` 是本地环境的默认姿态。

### 2. 配置审查优先的本地持久化

若需要在本地采用审查优先（review-first）的工作流，请将 `localWriteBack` 设置为 `explicit`，并在确认需要持久化缓存时执行：

```json
{
  "grounding": {
    "localWriteBack": "explicit"
  }
}
```

CLI 解析器会将该显式回写请求直接传递给运行时。

### 3. 配置 CI 环境

在 CI 环境中，请保持 `ci.updateGroundingCache` 为 `false`，且不要传入 `--update-cache` 标志。CI 默认不主动启用回写（no write-back opt-in）。

## 验证 {#verification}

运行以下命令验证执行结果与缓存状态：

```bash
npx ambercast run --update-cache tests/ambercast/<name>.test.md
```

预期仅在测试批次通过（passed batch）时退出码为 `0`。在提交代码之前，请检查变更后的 grounding diff。

## 相关参考 {#related}

- [配置](/ambercast/zh-cn/reference/configuration/)
- [ambercast run](/ambercast/zh-cn/reference/cli/run/)
- [审查生成的 diff](/ambercast/zh-cn/how-to/review-generated-diffs/)

```bash
npx ambercast run --json tests/ambercast/<name>.test.md
```
