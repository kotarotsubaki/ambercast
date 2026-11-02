---
title: 兼容性
description: 说明各软件包版本的产物格式兼容性，以及哪些变更要求重新生成执行计划、定位缓存或报告。
---

每个发布版本都固定了各项 schema 版本和元素指纹标记。下表列出各版本固定的版本号，以及需要重新生成的变更。

## 兼容性表 {#compatibility-table}

| 软件包版本 | 执行计划 `schemaVersion` | 定位缓存 `schemaVersion` | 元素指纹标记 | 报告 `schemaVersion` |
| --- | --- | --- | --- | --- |
| `0.1.0` | `2` | `1` | `a11y-neighborhood-v2` | `3.0` |
| `0.2.0` | `2` | `1` | `a11y-neighborhood-v2` | `3.0` |
| `0.5.0` | `3` | `1` | `a11y-neighborhood-v2` | `3.5` |
| `0.7.0` | `5` | `3` | `a11y-neighborhood-v2` | `3.8` |
| `0.8.0` | `5` | `3` | `a11y-neighborhood-v2` | `3.9` |
| `0.9.0` | `5` | `3` | `a11y-neighborhood-v2` | `3.10` |

表中列出 0.1.0、0.2.0、从 0.8.0 起的所有发布版本，以及每个变更了执行计划或定位缓存 schema 版本的发布版本。最新发布版本之后 `main` 上新增的 schema 版本，会在发布时加入此表。当前已发布的 schema 请参阅 [JSON Schema](/ambercast/zh-cn/reference/json-schemas/#publication-metadata)。

0.2.0 版本变更了 provider 请求契约，但没有递增执行计划的 schema 版本。该变更改变了 `producerBundleFingerprint` 和每个提示词的 `inputsDigest`，使 0.1.0 的执行计划变为陈旧状态，即 `stale`。详见[变更日志](/ambercast/zh-cn/reference/changelog/#release-020)。

schema 变更都不会就地迁移。每次变更的处理方式如下。

- 执行计划 v1 和 v2：`generate` 将其视为非 fresh，并重新生成当前版本的执行计划。`check` 以只读方式将其报告为 `stale`。`run` 和 `heal` 以 `INTEGRITY_VIOLATION` 拒绝它，退出码为 4。
- 执行计划 v3：用同意和 `secrets.allow` 替代 v2 的机密授权 provenance 模型。
- 执行计划 v4：同样不会就地迁移，并受到相同的非 fresh、`stale` 和 `INTEGRITY_VIOLATION` 处理。
- 执行计划 v5：将 v4 的元素引用替换为有来源依据的 intent，并增加 `confirms`。
- 定位缓存 v3：将 v2 中仅含指纹的条目替换为 locator、fingerprint、intentDigest 和 provenance。

分步升级说明请参阅[在不同版本间升级](/ambercast/zh-cn/how-to/upgrade/)。

## 重新生成边界 {#regeneration-boundary}

| 变更 | 受影响产物 | 重新生成要求 |
| --- | --- | --- |
| 规范化提示词、执行计划 schema 版本、generator-template 指纹、producer-bundle 指纹，或命名的 target 定义 | `inputsDigest` 与执行计划的新鲜度 | 重新生成执行计划。由此产生的定位缓存绑定，则由回放相关内容的规则单独约束。 |
| 与回放相关的执行计划内容 | 定位缓存记录的 `planDigest` | 重新生成或替换定位缓存。仅 `generatorMeta` 发生变更不会计入 `planDigest`。 |
| 接受的元素指纹算法或原像（preimage） | 现有的元素定位缓存条目 | 在 `run` 中，以下源视为缓存未命中：缺失的源、JSON 无效的源、来源信息陈旧的源，以及未声明覆盖率却未通过严格解析的源。一旦具备当前来源信息的源声明了覆盖率，其结构或规范性失败就是完整性故障，不会降级回退。在 `check` 中，定位缓存检查把 JSON 或 schema 解析失败归类为 `invalid`，把声明的非规范源也归类为 `invalid`，把陈旧的 `planDigest` 归类为 `stale`。公开报告状态依据[新鲜度与摘要](/ambercast/zh-cn/spec/freshness/#freshness-consequences)中的仓库策略派生。 |
| 报告 schema 版本或字段契约 | 结构化输出的消费者与持久化的运行报告 | 更新消费者以适配输出的报告契约。每个报告版本的变更内容见[变更日志](/ambercast/zh-cn/reference/changelog/)。 |
| 执行计划、定位缓存、配置或报告的 Zod schema | 已发布的 npm schema 产物 | 运行软件包构建，从对应的 Zod 源码重新生成这四个 JSON Schema。 |

`inputsDigest` 只对声明的五项输入做哈希，哈希使用规范 JSON 与 SHA-256。五项输入如下。

- 规范化提示词
- 执行计划 schema 版本
- generator-template 指纹
- producer-bundle 指纹
- 命名的 target 定义

定位缓存的新鲜度判定，是将其记录的 `planDigest` 与候选执行计划算出的摘要直接比对是否相等。

## 另请参阅 {#see-also}

- [变更日志](/ambercast/zh-cn/reference/changelog/#release-020)
- [在不同版本间升级](/ambercast/zh-cn/how-to/upgrade/)
- [ambercast check](/ambercast/zh-cn/reference/cli/check/#status-vocabulary)
- [新鲜度与摘要](/ambercast/zh-cn/spec/freshness/)
- [新鲜度后果](/ambercast/zh-cn/spec/freshness/#freshness-consequences)
- [规范变更日志](/ambercast/zh-cn/spec/changelog/)
