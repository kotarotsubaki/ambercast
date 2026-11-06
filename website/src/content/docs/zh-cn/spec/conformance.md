---
title: "符合性"
description: "本章定义符合规范的验证器需要检查的内容：JSON Schema 投影、带有问题代码的语义约束，以及验证顺序。"
---

## 结构验证 {#structural-validation}

Ambercast 的发布流水线必须 (MUST) 从 Zod 运行时模式派生 JSON Schema。对象包括执行计划、定位缓存、配置和报告。流水线不维护手写的并行模式 (`src/core/ir/schema.ts:7-8`) (`src/core/config/json-schema.ts:1-2,27-34`) (`src/report/json-schema.ts:1-2,23-25`)。构建工具会序列化下列投影，软件包的导出项公开生成的文件 (`src/build-tools/generate-json-schema.ts:80-83`) (`package.json:23-35`)。

| Zod 投影 | JSON Schema 获取函数 | 生成的文件 | 软件包导出项 |
| --- | --- | --- | --- |
| `PlanDocument` | `getPlanJsonSchema()` | `plan.schema.json` | `ambercast/schema/plan.json` → `./dist/schema/plan.schema.json` |
| `GroundingDocument` | `getGroundingJsonSchema()` | `grounding.schema.json` | `ambercast/schema/grounding.json` → `./dist/schema/grounding.schema.json` |
| `RawConfig` | `getConfigJsonSchema()` | `config.schema.json` | `ambercast/schema/config.json` → `./dist/schema/config.schema.json` |
| `ReportEnvelope` | `getReportJsonSchema()` | `report.schema.json` | `ambercast/schema/report.json` → `./dist/schema/report.schema.json` |

执行计划和定位缓存的获取函数，分别从 `PlanDocument` 和 `GroundingDocument` 派生其值。配置的获取函数从 `RawConfig` 派生，报告的获取函数从 `ReportEnvelope` 派生 (`src/core/ir/json-schema.ts:16-55`) (`src/core/config/json-schema.ts:20-39`) (`src/report/json-schema.ts:23-29`)。外部使用方只要验证已发布的结构约定和语义约定，就算符合。它不必使用 Zod，也不必复现 Ambercast 的发布流水线。

## 语义验证 {#semantic-validation}

仅靠 JSON Schema 验证是不够的。符合规范的验证器还必须 (MUST) 强制执行下列约束。问题代码是稳定的实现值。策略问题由调用方映射，调用方可以是生成、check 或 run，这里不再定义第二个公开状态 (`src/usecases/instruction-coverage-policy.ts:73-82`)。

| id | 适用对象 | 约束 | 问题代码 / 失败 | 依据 |
| --- | --- | --- | --- | --- |
| CON-01 | 执行计划 | 执行计划的步骤 ID 必须 (MUST) 唯一。 | `duplicate step id: <id>` | `src/core/ir/schema.ts:1547-1558` |
| CON-02 | 生成的机密名称选择 | 显式的 `allowedName` 必须 (MUST) 在本地解析之前，出现在提供方上下文中已投影的允许列表名称集合里。 | `secret-allowed-name-not-projected` | `src/usecases/secret-naming.ts:190-239` |
| CON-03 | 生成的准则 | 每条准则的 `startAnchor` 和 `endAnchor` 必须 (MUST) 指向已知的 `L<n>` 行锚点。它们须按从 1 开始的 UTF-16 列，构成有效、非空、非纯空白且按文档顺序排列的范围。提供方的 `citation` 必须 (MUST) 与解析出的规范化提示词原文子串一致。锚点或列格式错误、超出范围时，报告出错的具体坐标，即 `startAnchor`、`startColumn`、`endAnchor` 或 `endColumn`，而不是 `citation`，因为重试反馈只携带失败路径。 | `anchor-invalid`, `citation-whitespace-only`, `citation-checksum-mismatch` | `src/usecases/instruction-coverage-policy.ts:407-443` |
| CON-04 | 生成的准则 | 准则 ID 和解析出的坐标范围必须 (MUST) 唯一。解析出的边界不得 (MUST NOT) 拆开代理对。 | `criterion-id-duplicate`, `criterion-range-duplicate`, `anchor-invalid` | `src/usecases/instruction-coverage-policy.ts:407-443` |
| CON-05 | 生成的 AI 步骤 | 至少一条准则必须 (MUST) 是 `success`。success ID 与验证意图 ID 必须 (MUST) 构成严格的双射。 | `success-criterion-missing`, `intent-id-duplicate`, `intent-id-missing`, `intent-id-unknown`, `intent-id-action` | `src/usecases/instruction-coverage-policy.ts:456-476` |
| CON-06 | 生成的验证意图 | 终端断言必须 (MUST) 是受支持的 `TraceAssert`，并且不得 (MUST NOT) 是 `url-matches`。 | `intent-assertion-unsupported`, `terminal-url-matches-forbidden` | `src/usecases/instruction-coverage-policy.ts:467-472` |
| CON-07 | 已提交的准则 | 准则必须 (MUST) 非空、ID 和范围唯一，重新提取后是非空白的提示词文本，并使用有效且宽度非零的 UTF-16 坐标。 | `criterion-id-duplicate`, `criterion-range-duplicate`, `source-span-invalid`, `source-span-whitespace-only`, `success-criterion-missing` | `src/usecases/instruction-coverage-policy.ts:509-522` |
| CON-08 | 已提交的准则 | 准则必须 (MUST) 已经按规范的来源、结束、种类、ID 顺序排列。 | `criterion-order-invalid` | `src/usecases/instruction-coverage-policy.ts:523-529` |
| CON-09 | 生成的机密名称 | 提供方的机密选择必须 (MUST) 在本地解析为有效的已提交 `SecretRef`。映射到同一个环境变量的不同引用必须 (MUST) 被拒绝。 | `SECRET_ENV_VAR_COLLISION` | `src/usecases/secret-naming.ts:205-344`; `src/core/secrets/env-var-name.ts:28-45` |
| CON-10 | 候选执行计划的同意 | 含有 `secrets.allow` 之外名称的候选，除 `secrets.allow: "*"` 外，必须 (MUST) 在持久化之前获得同意决定。`consentMode: "forbid"` 必须 (MUST) 返回 `candidate` 且不持久化。 | `SECRET_CONSENT_REQUIRED`; `candidate` | `src/usecases/generate.ts:1652-1741` |
| CON-11 | 定位缓存覆盖 | `verificationCoverage` 必须 (MUST) 把每条 success 准则，且只把 success 准则，映射到一个互不相同、在范围内的终端验证索引。每个终端索引都必须 (MUST) 被映射。 | `verification-coverage-id-missing`, `verification-coverage-id-unknown`, `verification-coverage-id-action`, `verification-coverage-index-duplicate`, `verification-coverage-index-invalid` | `src/usecases/instruction-coverage-policy.ts:605-621` |
| CON-12 | 定位缓存的终端证据 | 终端断言不得 (MUST NOT) 是 `url-matches`，也不得重复运行值具体化之后的事件断言。 | `terminal-url-matches-forbidden`, `verification-assertion-repeated` | `src/usecases/instruction-coverage-policy.ts:623-636` |
| CON-13 | 定位缓存的绑定 | 定位缓存必须 (MUST) 仅在其 `planDigest` 等于重新计算出的执行计划摘要时被接受。 | 检查分类 `stale` | `src/usecases/check-grounding.ts:64` |
| CON-14 | 带覆盖信息的定位缓存字节 | 声称带有覆盖信息的定位缓存文档必须 (MUST) 使用规范的产物字节。 | 检查分类 `invalid` | `src/usecases/check-grounding.ts:66-72` |
| CON-15 | 缓存 AI 追踪中的机密使用 | 每个 `TraceFillSecret.secretRef` 必须 (MUST) 属于所属执行计划 AI 步骤已提交的 `secrets[].ref` 集合。违反即完整性失败，且不得 (MUST NOT) 回退。 | 完整性失败 | `src/usecases/run.ts:1356-1360` |
| CON-16 | 导航 | 每个执行计划导航、缓存追踪导航和新的代理式导航，都必须 (MUST) 相对目标的 `baseUrl` 解析，使用 HTTP(S)，并保持与目标同源。 | 完整性失败 | `src/usecases/run.ts:993-1021` |
| CON-17 | 缓存 AI 追踪中的机密标记 | 缓存的 AI 追踪中，除专用的 `TraceFillSecret.secretRef` 字段外，每个字符串值的后代都不得 (MUST NOT) 含有连续的 `{{secrets.` 标记。违反即完整性失败，且不得 (MUST NOT) 回退。 | 完整性失败 | `src/usecases/run.ts:1250-1264` |
| CON-18 | 缓存 AI 追踪的 `RunRef` | `RunRef` 必须 (MUST) 格式正确，只指向在所属 AI 步骤之前声明的捕获变量，并且在当前用例中有可用的值。格式错误、未授权或不可用的引用都是完整性失败，且不得 (MUST NOT) 回退。 | 完整性失败 | `src/usecases/run.ts:917-935`; `src/usecases/run.ts:4334-4336` |
| CON-19 | 缓存 AI 追踪中具体化的机密 | 回放之前，解析追踪的事件和验证列表中、由所属执行计划 AI 步骤列出的每个 `fill-secret` 引用。连同当前用例的已解析值，扫描所有值，但固定词汇 `type`、`check`、`target`、`timeoutMs`、`element.strategy`、`key` 和 `secretRef` 除外。非空的已解析机密，完全匹配即被禁止；在其至少有 3 个 UTF-16 码元时，子串匹配也被禁止。 | 完整性失败; 不得 (MUST NOT) 回退 | `src/usecases/run.ts:1351-1384`; `src/usecases/run.ts:1265-1274,1545-1566`; `src/usecases/run.ts:2680-2684,2719-2722` |
| CON-20 | 已存储追踪与新的 AI `fill.value` 中的凭据字面量 | 已存储追踪和新的代理式动作必须 (MUST) 无条件拒绝以 `sk-`、`ghp_` 和 `AKIA` 开头的填写值。高熵的填写值，只有在去掉已捕获的当前用例值后，剩余文本不匹配任何检测器时才被接受。已存储追踪的失败不得 (MUST NOT) 回退。新执行的失败发生在浏览器执行或日志持久化之前。 | 完整性失败 | `src/usecases/run.ts:1295-1302`; `src/usecases/run.ts:1647-1680`; `src/usecases/run.ts:1710-1713,2343`; `src/usecases/run.ts:2680-2684,2719-2722` |
| CON-21 | 跨 AI 边界的已捕获值 | 没有 `verificationCoverage` 的旧版已存储追踪，在任何非固定词汇的值中，不得 (MUST NOT) 含有当前用例中已捕获的非空值，未解析的 `{{run.name}}` 占位符除外。该检查是子串匹配。新的代理式导航 URL、填写值以及断言文本和模式，不得 (MUST NOT) 与已捕获的值完全相等。这些值必须 (MUST) 改用已授权的 `RunRef` 插值。违反会在已存储追踪到达浏览器或提供方回退之前，或新输入到达浏览器或持久化之前失败。 | 完整性失败 | `src/usecases/run.ts:1590-1622`; `src/usecases/run.ts:1275-1281`; `src/usecases/run.ts:1704-1733`; `src/usecases/run.ts:2680-2684,2702` |
| CON-22 | 新的代理式动作与断言中具体化的机密 | 具体化之前，每个新的代理式动作和断言必须 (MUST) 把非固定词汇的值，与用例中观察到的每个非空已解析机密比对。仅有的封闭词汇例外是 `type`、`check`、`target`、`timeoutMs`、`element.strategy`、`key` 和 `secretRef`。任何非空机密，完全相等都被禁止；机密至少有 3 个 UTF-16 码元时，子串匹配也被禁止。匹配即完整性失败，发生在浏览器执行、日志追加、定位缓存更新或持久化之前。 | 完整性失败 | `src/usecases/run.ts:1526-1543`; `src/usecases/run.ts:1545-1588`; `src/usecases/run.ts:1695-1702`; `src/usecases/run.ts:2333-2343`; `src/usecases/run.ts:2391-2403`; `src/usecases/run.ts:2373` |
| CON-23 | 位置参数或发现得到的提示词路径选择 | 所选的提示词路径必须 (MUST) 解析到 `testDir` 内，后缀恰为 `.test.md`，且名称部分非空。这项检查在任何逐文件处理开始之前，对整个选择只做一次。`--list` 不得 (MUST NOT) 应用这项检查。 | `PROMPT_PATH_INVALID` | `src/core/layout/resolve.ts:191`; `src/usecases/prompt-path-eligibility.ts:25` |
| CON-24 | 已提交和生成的元素意图 | 归属检查和已提交内容的重新验证，必须 (MUST) 各自独立地确认下列五点。第一，意图和引用的范围有效。第二，拒绝纯空白的摘录。第三，视情况核对提供方的引用或已提交的引用文本。第四，前后的引号成对出现。第五，引用包含在意图之内，边界相接也算。已提交内容的重新验证不比较 citation。生成（Generation）还必须拒绝期望文本与其目标意图引用相同的 `text-equals` 断言 (MUST)，因为这样两个引用都无法支持对方的角色。 | `anchor-invalid`, `intent-span-invalid`, `intent-span-whitespace-only`, `intent-citation-mismatch`, `quote-span-invalid`, `quote-text-mismatch`, `quote-unpaired`, `quote-outside-intent`, `quote-whitespace-only`, `text-equals-self-quote` | `src/usecases/element-intent-policy.ts:75-105,129-188,211-231`; `src/usecases/generate.ts:246-254` |
| CON-25 | 执行计划的 `confirms` 字段 | `generate` 和 `heal` 在验证之前，会移除指向 `navigate` 步骤的 `confirms` 引用。其余每个 ID 都必须 (MUST) 指向同一执行计划中靠前的 click、press、fill、fill-secret 或 capture 步骤，只出现一次，并遵循执行计划的升序。不检查目标标识。 | `confirms-unknown-step`, `confirms-not-earlier`, `confirms-not-action`, `confirms-duplicate`, `confirms-unsorted` | `src/core/ir/confirms-validation.ts:19-57,76-96` |

CON-23 在文件选择期间应用，先于其他所有 CON 项。CON-01 到 CON-06、CON-09、CON-10 和 CON-24 在执行计划持久化之前应用。CON-01、CON-07、CON-08、CON-24 和 CON-25 应用于已提交的执行计划。CON-11 到 CON-22 应用于定位缓存与回放验证。在浏览器操作收到具体化的值之前，定位缓存与回放验证会检查几类边界。这些边界是追踪中的机密标记、已解析的机密、凭据字面量和已捕获的值。它还检查动态 `RunRef` 的权限 (`src/usecases/instruction-coverage-policy.ts:380-381,496-499`) (`src/usecases/generate.ts:1652-1741`) (`src/usecases/check-grounding.ts:18`) (`src/usecases/run.ts:917-935`) (`src/usecases/run.ts:1250-1264`)。

## 验证流程 {#verification-procedure}

使用方必须 (MUST) 先按结构解析产物，再按[新鲜度与摘要](/ambercast/zh-cn/spec/freshness/#inputs-digest)中的规则计算当前摘要，然后在回放之前应用语义检查。定位缓存验证失败，不得 (MUST NOT) 授权使用缓存回放 (`src/core/ir/schema.ts:1541,1753`) (`src/usecases/run.ts:820-851`) (`src/core/ir/digest.ts:170-175`)。

## 设计依据 {#rationale}

问题在于，可移植的 JSON Schema 能验证结构，却无法比较同级的值、提示词原文，或跨记录的关系。

所选设计把小规模的语义层明确出来，在结构解析之后报告稳定的错误代码。凡是能够表达的约束，都保留在 Zod 以及由它派生的 JSON Schema 中。

被否决的方案有两个。一个把所有规则藏进不可移植的 refinement，因为模式的使用方会因此丢失这些规则，所以被否决。另一个只依赖 JSON Schema，因为仅凭孤立的 JSON 值无法证明来源和覆盖情况，所以被否决。
