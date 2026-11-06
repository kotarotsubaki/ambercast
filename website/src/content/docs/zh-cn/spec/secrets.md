---
title: "执行计划中的机密"
description: "本章定义执行计划如何引用机密、如何授权机密名称、解析后的值可以发送到哪里，以及如何拒绝字面量机密。"
---

## 授权 {#authorization}

执行计划必须 (MUST) 只通过[值类型](/ambercast/zh-cn/spec/value-types/#shared-types)中的 `SecretRef` 来表示机密值。`InterpolatableText` 禁止出现连续的 `{{secrets.` 插值标记 (`src/core/ir/schema.ts:31-33`) (`src/core/ir/schema.ts:37,193`)。

已提交的 `fill-secret` 步骤必须 (MUST) 恰好包含 `id`、`target: TargetName`、`kind`、`action`、`intent: ElementIntent` 和 `secretRef: SecretRef`；解析得到的 `element: ElementRef` 只记录在定位缓存追踪的 `TraceFillSecret` 条目中。已提交的 AI 步骤中，可选的 `secrets` 数组包含 `AiStepSecretUse` 条目，每个条目恰好是 `{ "ref": SecretRef }`。两种已提交形式都不包含提供方命名数据和引用数据。已提交形式保留的提示词来源信息，只有 `fill-secret` 的 intent 中 `description` 的 `sourceSpan` 以及可选的 `quote` (`src/core/ir/schema.ts:561,576,693-698`) (`src/core/ir/schema.ts:572,1299-1302`) (`src/core/ir/schema.ts:876-884`) (`src/core/ir/schema.ts:682-698`)。

运行时，`{{secrets.NAME}}` 只通过 `AMBERCAST_SECRET_<NAME>` 解析，其中 `NAME` 里的每个 `.` 都先替换为 `_` 并转成大写。解析出的值不得 (MUST NOT) 进入执行计划 (`src/core/secrets/env-var-name.ts:8-16`) (`src/adapters/system/env-secrets-provider.ts:14-34`)。

## 同意与允许列表 {#grant-origin}

生成必须 (MUST) 先构造候选执行计划，再在持久化该执行计划或其定位缓存之前决定是否同意。候选阶段在本地把提供方的每个提议解析为 `SecretName`，包装成 `SecretRef`，并报告每一处使用。同意阶段只放行 `ambercast.config.json` 的 `secrets.allow` 中已有的名称，以及用户接受的名称 (`src/usecases/generate.ts:1314-1326,1564-1624`) (`src/usecases/generate.ts:1670-1741`) (`src/core/config/schema.ts:139-145`)。

`SecretName` 是配置和同意所用的裸逻辑名称。`SecretRef` 是它在执行计划中的 `{{secrets.NAME}}` 包装形式。面向提供方的 `fill-secret` 可以 (MAY) 改为携带 `secret?: SecretNameChoice`。`{ "allowedName": SecretName }` 请求一个已投影的、在允许列表中的名称。`{ "nameHint": SecretNameHint }` 提议一个新发现的名称。

`SecretNameChoice` 是严格的互斥联合类型，`SecretNameHint` 是 `/^[a-z][a-z0-9_]{0,63}$/`。面向提供方的 AI 机密使用采用同样的选择；提供方没有给出选择时，使用空的严格对象。每个已提交的 `SecretRef` 都由本地的确定性命名生成，而不是来自提供方的引用 (`src/core/ir/schema.ts:100-148`) (`src/core/ir/schema.ts:1016-1029`) (`src/core/ir/schema.ts:1139-1160`) (`src/usecases/secret-naming.ts:172-205,320-337`)。

接受时，新接受的名称必须 (MUST) 合并进 `secrets.allow`，所以之后的生成不会再次就这些名称做决定。`secrets.allow: "*"` 接受所有名称，并绕过同意关卡。这个通配符有意降低了操作门槛，但风险很高：它会不经逐个名称审查，就接受 AI 提议的任意机密名称。只有在理解该风险时才可以 (MUST) 使用它 (`src/usecases/generate.ts:1670-1671,1711-1729`) (`src/config/write-secrets-allow.ts:52-82`)。

使用 `consentMode: "forbid"` 时，生成必须 (MUST) 返回 `candidate` 结果，其中包含被提议的执行计划和机密使用情况。此时不得 (MUST NOT) 写入产物或请求同意。如果同意被拒绝，或终端不是交互式而无法获得同意，生成必须 (MUST) 以 `SECRET_CONSENT_REQUIRED` 失败。不得 (MUST NOT) 悄悄持久化候选 (`src/usecases/generate.ts:1652-1668`) (`src/usecases/generate.ts:1673-1674`) (`src/usecases/generate.ts:1498-1505,1730-1740`) (`src/runtime/secret-consent.ts:293-321`)。

提供方收到的是投影或协商后的机密名称，而不是机密值。名称本身可能带有描述性，例如 `stripe_api_key`，所以这是被接受的提供方披露风险。实现不得 (MUST NOT) 把它表述为值的披露 (`src/usecases/generate.ts:927-947,1183`) (`src/core/ir/schema.ts:100-148`)。

`heal` 不得 (MUST NOT) 做出新的同意决定。如果它的 Stage 3 完整执行计划候选改变了逻辑上的机密名称集合，`heal` 必须 (MUST) 恢复其覆盖层。这时 `heal` 必须 (MUST) 返回 `secret-set-rejected` 结果分支。该分支带有 `stage3Rejection.reason: "secret-set-changed"`、`added` 和 `removed`，其用例结果为 `commit: undefined`。

已发布的 CLI 会原样输出该分支的本地化提示：`秘匿値の構成が変わった。ambercast generate --force <file> で再生成し同意を取り直す`。当本地命名、允许列表校验或环境变量冲突使允许的替换执行计划无法生成时，Stage 2 使用另一个拒绝原因 `secret-name-invalid` (`src/usecases/heal.ts:210-221`) (`src/usecases/heal.ts:1034-1068`) (`src/usecases/heal.ts:1188,1207-1214`) (`src/usecases/heal.ts:1528-1556`) (`src/ports/system.ts:8-33`) (`src/cli/main.ts:299-301`)。

## 汇点与脱敏 {#sink-and-redaction}

机密汇点的来源必须 (MUST) 是 HTTP(S) 来源，且不得 (MUST NOT) 包含连续的 `{{secrets.` 插值标记。这个模式约束本身不能证明不存在任意看起来像机密的字面量。使用方必须 (MUST) 在已提交的定位缓存追踪数据中保留引用，而不是字面量密码 (`src/core/ir/schema.ts:40,163-165`) (`src/core/ir/schema.ts:1293-1302`)。

汇点策略在运行时解析并规范化来源。`secretSinkOrigins` 中没有所请求机密的配置项时，只允许 `baseUrl`。配置项为空时不允许任何来源，非空配置项则替换这一默认值。

对每个实际的 `fill-secret`，运行流水线必须 (MUST) 在解析其机密之前，立即检查实时页面的来源。浏览器适配器必须 (MUST) 在获取元素之后、紧接填写之前，再次应用该策略，使导航或 DOM 变化无法绕过实时来源的边界 (`src/core/secrets/sink-policy.ts:59-100`) (`src/usecases/run.ts:3033-3040`) (`src/usecases/run.ts:1045-1059,1164-1166`) (`src/adapters/browser/chromium.ts:424,439,443-444`)。

## 字面量机密的拒绝 {#literal-secret-rejection}

本节是字面量机密检测语义的规范权威。参考页面只能概述检测边界以满足各自的局部目的，并且必须 (MUST) 链接到这里。在持久化或报告序列化之前，生成必须 (MUST) 检查提供方派生的每个 JSON 字符串和对象键，包括 `generatorMeta`、`ambiguities` 和 `assumptions`，遍历顺序是按键的字典序和数组下标。

对每个字符串值或对象键，嵌入的 `{{secrets.` 标记 (SEC-17) 必须 (MUST) 在检查下面四个基础检测器之前被拒绝。在这些检测器中，按下面固定顺序第一个匹配的必须 (MUST) 被拒绝 (`src/usecases/generator-secret-policy.ts:162-250`)。

匹配到机密检测的 `assumptions` 条目必须 (MUST) 变成 `An assumption was omitted because it looked like a secret.`。生成必须 (MUST) 使用该替换文本继续 (`src/usecases/generate.ts:1242-1254`)。

| id | 检测器 | 匹配的值 | 例外 | 归类的失败 |
| --- | --- | --- | --- | --- |
| SEC-01 | `credential-prefix-sk` | 以 `sk-` 开头 | 字符串值或对象键是有效的整值 `SecretRef`；仅限 `source.inputsDigest`。 | `SECRET_LITERAL_REJECTED`，退出码 `2` |
| SEC-02 | `credential-prefix-ghp` | 以 `ghp_` 开头 | 字符串值或对象键是有效的整值 `SecretRef`；仅限 `source.inputsDigest`。 | `SECRET_LITERAL_REJECTED`，退出码 `2` |
| SEC-03 | `credential-prefix-aws-access-key` | 以 `AKIA` 开头 | 字符串值或对象键是有效的整值 `SecretRef`；仅限 `source.inputsDigest`。 | `SECRET_LITERAL_REJECTED`，退出码 `2` |
| SEC-04 | `high-entropy-token` | 形如令牌（至少 32 个 UTF-16 码元，不含空白，每个字符都在 `[A-Za-z0-9+/=_.-]` 内），且香农熵至少为 4.0 比特。频率的键按 Unicode 码点遍历，每个概率的分母使用 UTF-16 码元长度。 | 字符串值或对象键是有效的整值 `SecretRef`；仅限 `source.inputsDigest`。值位置是 `steps[<index>].url`、`steps[<index>].pattern` 或 `targets[<key>].baseUrl` 时也豁免。值位置是 `steps[<index>].id`、`steps[<index>].confirms[<index>]` 或 `steps[<index>].instructionCoverage[<index>].id`，且值是可读的 slug 时也豁免。这种 slug 符合步骤 ID 语法，至少有两个用连字符分隔的段，每段是 `[a-z]+`、`[0-9]{1,3}` 或 `[a-z]{1,4}[0-9]{1,3}` 之一，且至少两段是 `[a-z]+`。对象键和其他位置不豁免。 | `SECRET_LITERAL_REJECTED`，退出码 `2` |
| SEC-17 | `embedded-secret-reference` | 字符串值或对象键不是有效的整值 `SecretRef`，且含有 `{{secrets.` 标记 | 仅限 `source.inputsDigest` | `SECRET_LITERAL_REJECTED`，退出码 `2` |

有效的整值 `SecretRef` 使该字符串值或对象键免于本节的所有检测器。其他任何键，都在遍历其值之前先交给检测器。拒绝诊断只能包含 (MUST) 检测器和脱敏后的类 JSON 路径。它不得 (MUST NOT) 保留检测到的字面量，检测到的对象键使用 `[redacted-key]` (`src/usecases/generator-secret-policy.ts:182-193`) (`src/usecases/generator-secret-policy.ts:220-250`) (`src/report/error-mapping.ts:82`) (`src/core/errors/exit-codes.ts:45`)。

## 各边界的保密要求 {#boundary-specific-secrecy}

| id | 边界 | 要求 | 依据 |
| --- | --- | --- | --- |
| SEC-05 | 生成 | 提供方派生的 JSON 必须 (MUST) 在持久化或报告序列化之前通过字面量机密拒绝。 | `src/usecases/generator-secret-policy.ts:162-168,219` |
| SEC-06 | 指纹生成 | 描述符中含有非空的已解析机密且完全匹配时，必须 (MUST) 产生 `secret-contaminated`；只有比较值至少有 3 个 UTF-16 码元时才做子串匹配，并且不得 (MUST NOT) 产生指纹。 | `src/core/ir/fingerprint.ts:266-268,388-390` |
| SEC-07 | 已提交的追踪 | `TraceFillSecret` 必须 (MUST) 存储 `secretRef`，而不是具体化后的值。 | `src/core/ir/schema.ts:1293-1302` |
| SEC-08 | 定位缓存持久化 | 当被扫描的字符串值与任何非空的已解析机密完全相等，或包含长度至少为 3 个 UTF-16 码元的已解析值时，运行流水线必须 (MUST) 拒绝写入定位缓存；并且必须 (MUST) 把它归类为完整性违规。 | `src/usecases/run.ts:4445-4459`; `src/usecases/run.ts:1526-1543` |
| SEC-09 | 诊断与可报告的错误 | 运行流水线必须 (MUST) 在诊断或报告序列化之前，对 JSON 字符串和对象键做脱敏。 | `src/usecases/run.ts:1829-1870,2081-2110` |
| SEC-10 | 送往 AI 的无障碍证据 | 发送给 AI 提供方的无障碍证据，必须 (MUST) 对字符串值和对象键中的已解析值做脱敏；截图字节不得 (MUST NOT) 越过这一边界。 | `src/usecases/run.ts:2466-2485,2818-2828` |
| SEC-11 | 截图持久化 | 如果已解析机密的检测在无障碍捕获中发现了值，或解析后的捕获无法检查，或检测失败，则不得 (MUST NOT) 保留截图。 | `src/usecases/run.ts:3318-3331,3396-3399` |
| SEC-12 | AI 追踪中的机密标记 | 缓存的 AI 追踪中，除专用的 `TraceFillSecret.secretRef` 字段外，每个取字符串值的后代节点都不得 (MUST NOT) 含有连续的 `{{secrets.` 标记。违反即完整性失败，并且不得 (MUST NOT) 回退到提供方执行。 | `src/usecases/run.ts:1250-1264` |
| SEC-13 | 缓存 AI 追踪中具体化的机密 | 回放之前，流水线必须 (MUST) 解析已存储追踪的事件和验证列表中的每个 `fill-secret` 引用，这些引用须由所属执行计划的 AI 步骤列出。得到的值与当前用例中已解析的值合并。然后必须 (MUST) 扫描追踪中的每个值，但固定词汇 `type`、`check`、`element.strategy`、`key` 和 `secretRef` 除外。与任何非空的已解析机密完全匹配，或在该机密至少有 3 个 UTF-16 码元时子串匹配，都是完整性失败，并且不得 (MUST NOT) 回退到提供方执行。 | `src/usecases/run.ts:1351-1384`; `src/usecases/run.ts:1265-1274,1545-1566`; `src/usecases/run.ts:2680-2684,2719-2722` |
| SEC-14 | AI `fill.value` 中的凭据字面量 | 浏览器执行之前，已存储追踪和新的代理式 `fill.value` 必须 (MUST) 无条件拒绝 `sk-`、`ghp_` 和 `AKIA` 检测器。只有去掉已捕获的当前用例值后不再匹配任何检测器时，才允许高熵匹配；这一例外不适用于前缀检测器。违反即完整性失败。已存储追踪的校验不得 (MUST NOT) 回退，新的代理式执行不得 (MUST NOT) 到达浏览器执行或日志持久化。 | `src/usecases/run.ts:1295-1302`; `src/usecases/run.ts:1647-1680`; `src/usecases/run.ts:1710-1713,2343`; `src/usecases/run.ts:2680-2684,2719-2722` |
| SEC-15 | 提供方边界上已捕获的运行值 | 没有 `verificationCoverage` 的旧版已存储追踪，在任何非固定词汇的值中，不得 (MUST NOT) 含有当前用例中已捕获的非空值，未解析的 `{{run.name}}` 占位符除外；按子串匹配。新的代理式导航 URL、`fill.value` 以及文本和断言模式，不得 (MUST NOT) 与当前用例中已捕获的值完全相等。已存储追踪的违规，在浏览器回放之前或提供方收到 `priorTrace` 之前失败；新执行的违规，在浏览器执行和持久化之前失败。使用方必须 (MUST) 使用已授权的 `RunRef` 插值，而不是把已捕获的值具体化。 | `src/usecases/run.ts:1590-1622`; `src/usecases/run.ts:1275-1281`; `src/usecases/run.ts:1704-1733`; `src/usecases/run.ts:2680-2684,2702` |
| SEC-16 | 新的代理式动作与断言中具体化的机密 | 具体化之前，每个新的代理式动作和断言必须 (MUST) 把其非固定词汇的值，与当前用例中所有非空的已解析机密比对。`type`、`check`、`element.strategy`、`key` 和 `secretRef` 是仅有的封闭词汇例外。被扫描的值如果完全相等，或包含长度至少为 3 个 UTF-16 码元的已解析机密，必须 (MUST) 失败。该失败是浏览器执行之前的完整性失败；它不得 (MUST NOT) 把动作或通过的断言追加到日志、更新定位缓存，或到达产物持久化。 | `src/usecases/run.ts:1526-1543`; `src/usecases/run.ts:1545-1588`; `src/usecases/run.ts:1695-1702`; `src/usecases/run.ts:2333-2343`; `src/usecases/run.ts:2391-2403`; `src/usecases/run.ts:2373` |

画布、图像和由 CSS 渲染的像素，以及无障碍扫描与截图捕获之间的间隔，仍然是残留的披露风险；本实现不声称能检测它们 (`src/usecases/run.ts:3358-3359`)。

对每个 `TraceFillSecret`，其记录的 `secretRef` 必须 (MUST) 包含在所属执行计划 AI 步骤已提交的 `secrets[].ref` 集合中。未列出的引用是完整性失败，并且不得 (MUST NOT) 引发回退 (`src/usecases/run.ts:1356-1360,2668`) (`src/usecases/run.ts:1158-1162`)。

## 设计依据 {#rationale}

问题在于让代理填写所需的凭据，同时不把提示词正文、日志或 UI 证据变成机密的传播渠道。授权必须可审计且范围狭窄。

所选设计把提供方的发现与授权分开：在本地推导出的候选名称交给用户确认，持久的允许列表条目可以审计，已提交的执行计划只记录整值引用。同意被拒绝或无法获得时，它以安全方式失败，而汇点来源的边界依然被独立强制执行。

被否决的方案有两个。一个把授权语法嵌入提示词正文，并持久化提示词的范围，因为提示词的措辞不是持久且可审阅的同意控制，所以被否决。另一个在追踪中持久化字面量值，因为已提交的产物和诊断是长期存在的披露面，所以被否决。
