---
title: 兼容性
description: 说明产物格式的兼容性与重新生成要求。
---

ambercast 在不同版本之间定义了明确的产物格式兼容性与重新生成边界。本文档为您提供各版本对应的模式版本、元素指纹算法标记，以及当底层契约、模板或规范发生变更时重新生成各项产物的具体规则。

## 兼容性表 {#compatibility-table}

| package 版本 | Plan `schemaVersion` | Grounding `schemaVersion` | element fingerprint tag | report `schemaVersion` |
| --- | --- | --- | --- | --- |
| `0.1.0` | `2` | `1`（尚未确认） | `a11y-neighborhood-v2` | `3.0` |
| `0.2.0` | `2` | `1` | `a11y-neighborhood-v2` | `3.0` |

0.2.0 版本变更了 provider 请求契约，但并未递增 Plan 的 `schemaVersion`。该变更改变了 `producerBundleFingerprint` 以及每个提示词的 `inputsDigest`，导致 0.1.0 版本的 Plan 变为陈旧状态（stale）。

对于第 1 版 Plan（version 1），系统会直接将其重新生成或报告为 stale，而不支持就地迁移（migrated in place）。

## 重新生成边界 {#regeneration-boundary}

| 变更 | 受影响产物 | 重新生成要求 |
| --- | --- | --- |
| 规范化提示词（normalized prompt）、Plan schema 版本、generator-template 指纹、producer-bundle 指纹，或命名的 target 定义 | `inputsDigest` 与 Plan 新鲜度 | 重新生成 Plan。由此产生的 Grounding 绑定则由回放相关内容的规则单独约束。 |
| 与回放相关的 Plan 内容 | Grounding 记录的 `planDigest` | 重新生成或替换 Grounding；仅 `generatorMeta` 发生变更不会计入 `planDigest`。 |
| 接受的 element 指纹算法或原像（preimage） | 现有的 element-grounding 条目 | 在 `run` 执行期间，不可用的源在缺失、JSON 无效、来源信息陈旧（stale provenance），或在未声明覆盖率（coverage claim）的情况下未通过严格解析时，均视为缓存未命中（cache miss）。一旦具备当前来源信息的源声明了覆盖率，其结构或规范性失败将被判定为完整性故障（integrity failure），不会降级回退。在 `check` 中，grounding 检查将 JSON/模式解析失败以及声明的非规范源归类为 `invalid`，将陈旧的 `planDigest` 归类为 `stale`；公共报告状态依据 [新鲜度与摘要](/ambercast/zh-cn/spec/freshness/#freshness-consequences) 派生。 |
| Report schema 版本或字段契约 | 结构化输出消费者与持久化的运行报告 | （尚未确认）消费者的迁移与报告重新生成要求在 0.2.0 代码中尚未定义；当前实现仅固定了生成的信封（envelope）版本。 |
| Plan、Grounding 或配置的 Zod schema | 已发布的 npm schema 产物 | 运行 package 构建，以便从对应的 Zod 源码重新生成这三个 JSON Schema。 |

`inputsDigest` 通过规范 JSON（canonical JSON）与 SHA-256 对上述五项输入（规范化提示词、Plan schema 版本、generator-template 指纹、producer-bundle 指纹以及命名的 target 定义）进行精确哈希。

Grounding 的新鲜度判定是将其自身记录的 `planDigest` 与为候选 Plan 计算得出的摘要进行直接相等性比对。

相关链接：
- [变更日志](/ambercast/zh-cn/reference/changelog/#release-020)
- [在不同版本间升级](/ambercast/zh-cn/how-to/upgrade/)
- [ambercast check](/ambercast/zh-cn/reference/cli/check/#status-vocabulary)
- [新鲜度与摘要](/ambercast/zh-cn/spec/freshness/)
- [规范变更日志](/ambercast/zh-cn/spec/changelog/)
