---
title: 变更日志
description: 记录 ambercast 各版本中用户可见的产品行为与公共契约变更，破坏性变更排在最前。
---

本页只收录产品行为与公共契约方面的条目。仓库架构扫描器、agent hook、worktree 生命周期、lint 配置、CI、测试、文档站点和项目工作流都不在其列。

0.3.0 与 0.3.1 没有产品条目，所以不设章节。0.4.0 通过三次生产者包修订使既有执行计划过期，所以也不设章节。这三次修订是 `generatorSecretPolicy` 2 → 3 → 4 与 `instructionCoveragePolicy` 1 → 2。早期版本的执行计划需用 `ambercast generate` 重新生成。这些版本的其他条目也见仓库中的 `CHANGELOG.md`。

## 0.9.0 版本 {#release-090}

发布日期：2026-10-08。报告 schema 3.10。

| 类别 | 用户可见变更 |
| --- | --- |
| BREAKING | 报告 schema 3.10 新增用例级错误码 `CASE_ABORTED`（带 `reason` 与 `stepId`）和 `PROMPT_AMBIGUOUS`（带 `ambiguities`）。prompt 有歧义导致的 `generate` 或 `heal` 失败，现在以退出码 2 和 `PROMPT_AMBIGUOUS` 结束，不再以退出码 3 和运行级 `UNEXPECTED_CRASH` 结束。过去不带错误码就结束的运行行，现在带有 `CASE_ABORTED`、`AGENTIC_STEP_FAILED` 或用例级 `UNEXPECTED_CRASH`。`heal` 把 Stage 3 与最终回放的失败报告为用例错误，因此摘要将这些行计为出错，退出码不变。`ambercast view` 会显示错误提示与详情。 |
| Feature | 每条失败路径都会产生带错误码、可诊断的报告错误。 |

0.9.0 版本包含 1 项已声明的破坏性变更。

## 0.8.0 版本 {#release-080}

发布日期：2026-10-06。报告 schema 3.9。

| 类别 | 用户可见变更 |
| --- | --- |
| Feature | 报告 schema 3.9 在用例级环境错误中新增 `AGENTIC_STEP_FAILED`，并在 `AiResponseIssueCode` 中新增确认问题码 `confirms-unknown-step`、`confirms-not-earlier`、`confirms-not-action` 与 `confirms-duplicate`。 |
| Fix | `generate` 在构建诊断之前，先检查 provider 返回的步骤 ID 是否含有机密字面量。 |
| Fix | `generate` 丢弃 `navigate` 步骤上的 `confirms` 引用，并按错误码报告违规。 |
| Fix | 对来自已确认定位缓存条目的绑定，`run` 始终报告 `confirmed: true`。 |
| Fix | 运行器对 agentic 步骤失败进行分类，并对 AI 指示的断言持续轮询，直到截止时间。 |

0.8.0 版本未声明破坏性变更。

## 0.7.0 版本 {#release-070}

发布日期：2026-10-02。报告 schema 3.8。

| 类别 | 用户可见变更 |
| --- | --- |
| BREAKING | 执行计划 v3 → v4 新增必填的步骤 Target 名称，并移除执行计划中的浏览器选择。请重新生成 v3 执行计划。 |
| BREAKING | 执行计划 v4 → v5 新增有来源支撑的 `intent` 与 `confirms`，以及 Target 级 `locale`。定位缓存 v2 → v3 把裸指纹替换为定位器、指纹、意图摘要与来源。请重新生成 v4 执行计划及其定位缓存。 |
| BREAKING | Target 配置从 `targets.<name>.browser` 改为 `targets.<name>.executor`，加载器会拒绝旧键。报告新增 `EXECUTOR_UNSUPPORTED` 与 `sessions[name].executor`。 |
| BREAKING | UI 执行器的 kind 词汇表得到统一。元素步骤在未使用 `--resolve` 时遇到定位缓存未命中，现在以退出码 4 报告 `GROUNDING_UNRESOLVED`，不再以退出码 3 且不带错误码。 |
| Feature | 报告 schema 升至 3.8。3.7 新增步骤的 Target 名称与按 Target 划分的会话，3.8 新增 heal Stage 1 的 `binding` 诊断。 |
| Feature | `ambercast init` 生成配置、示例 prompt、`.gitignore` 与 `AGENTS.md`。 |
| Feature | `ambercast view` 是只读的本地查看器，用于查看 `.runs` 报告。 |
| Feature | `targets.<name>.locale` 为浏览器上下文设置语言区域。 |
| Feature | UI 执行器抽象新增能力预检。 |
| Feature | heal Stage 1 通过 `confirms` 重新绑定元素意图。 |
| Feature | 新增元素意图、引文匹配与意图摘要的基础组件。 |
| Feature | 执行计划 IR v4 为每个步骤指定 Target，并为每个 Target 使用一个会话。 |
| Feature | 新增 MCP stdio 服务器。 |
| Feature | MCP 任务模型新增 `ambercast_job_status` 与 `ambercast_job_cancel`。 |
| Feature | MCP 的 heal 应用分两步进行，包含令牌签发与征询（elicitation）。 |
| Feature | 运行时事件分发支持 MCP，heal 的准备分为两个阶段。 |
| Fix | `init` 在生成的配置中加入浏览器，以对 BOM 安全的方式规划，并在失败时先中止再应用。 |
| Fix | MCP 服务器为失败的任务与 heal 应用崩溃输出 `AMBERCAST_DEBUG` 诊断。 |
| Fix | MCP 服务器在关闭期间，会等待 heal 应用的确认与处理中的工具响应。 |
| Fix | 进度通知发送失败时，MCP 服务器会向 stderr 写入一行。 |
| Fix | 报告在 `AI_RESPONSE_INVALID` 中保留生成阶段的问题详情。 |
| Fix | `run` 带着诊断信息恢复 agentic 的 Target 解析失败。 |
| Fix | `run` 在截止时间取最后一次轮询样本，用于断言与绑定。 |
| Fix | `view` 宽松地读取所有 3.x schema 版本的运行报告。 |
| Fix | `view` 拒绝带默认端口和非 authority 形式的 `Host` 头，并对属性中的 `runId` 转义。 |
| Fix | `view` 避免截图与长文本撑破步骤表。 |
| Fix | `view` 应用设计系统的深色令牌、步骤表中的状态徽章，以及省略零值的合计。 |

0.7.0 版本包含 4 项已声明的破坏性变更。

## 0.6.0 版本 {#release-060}

发布日期：2026-09-18。报告 schema 3.6。

| 类别 | 用户可见变更 |
| --- | --- |
| BREAKING | schema 校验失败的 agentic MCP 工具调用，不再在第一次不匹配时锁存 `INTEGRITY_VIOLATION`。每个用例连续最多 3 次被拒绝时，会返回带剩余预算的结构化结果。第 4 次拒绝时，用例以 `AI_RESPONSE_INVALID`（kind `environment`，退出码 3）结束，不再以 `INTEGRITY_VIOLATION`（kind `usage`，退出码 4）结束。这项变更不改变报告 schema 版本。 |
| Feature | 报告 schema 3.6 为已完成的 heal 结果新增可选诊断 `repairTrace`，dry-run 与应用产生相同的结果。 |
| Feature | `run` 在解析之前会等待元素出现。 |

0.6.0 版本包含 1 项已声明的破坏性变更。

## 0.5.0 版本 {#release-050}

发布日期：2026-09-15。报告 schema 3.5。

| 类别 | 用户可见变更 |
| --- | --- |
| BREAKING | 执行计划 v2 → v3 删除机密授权来源。请删除旧授权行，用 `generate --force` 重新生成，并通过同意／`secrets.allow` 模型批准候选机密名称。执行计划 v2 不会原地迁移。报告 schema 3.5 新增机密策略错误码 `SECRET_ENV_VAR_COLLISION`、`SECRET_CONSENT_REQUIRED` 与 `SECRET_SYNTAX_REJECTED`，新增可选的 `GROUNDING_UNRESOLVED` 详情，以及可选的 `GenerateResult` 字段 `secrets` 与 `warnings`。当 Stage 3 候选改变机密名称集合时，`heal` 返回 `secret-set-rejected` 结果，其 `stage3Rejection.reason` 为 `secret-set-changed`，并给出 `added` 与 `removed` 名称。旧的 `@ambercast-secret` 授权行与 `{{secrets.*}}` prompt 语法会以退出码 2 被拒绝。 |
| BREAKING | 既有执行计划过期，需用 `ambercast generate --force` 重新生成。指令覆盖准则带有 `startAnchor`、`startColumn`、`endAnchor` 与 `endColumn`，`instructionCoveragePolicy` 修订号从 2 升到 3。 |
| BREAKING | `generate` 对每个新检测到的机密名称都会停在同意关口。交互式终端会询问 `y / N / i`，其他运行以退出码 2 结束并列出未获允许的名称。同意后，这些名称会追加到 `secrets.allow`。 |
| BREAKING | 只有带 `--resolve` 时，`run` 才用 AI 解决定位缓存未命中。`--cache-only` 被移除，使用它会以退出码 2 结束。`GROUNDING_UNRESOLVED` 对应退出码 4。 |
| Feature | `run` 新增基于进程内 MCP 服务器的 agentic 执行器。 |
| Feature | 指令覆盖改用锚点 ID 匹配。 |
| Feature | heal 的 Stage 2 与 Stage 3 在允许列表模型下运行，并保持机密集合不变。 |
| Feature | 机密命名变为确定性的，允许列表也会被校验。 |
| Fix | `generate` 会重试因内嵌机密引用而被拒绝的 provider 响应。 |
| Fix | `BROWSER_LAUNCH_FAILED` 被分类，并附带提示与详情（报告 schema 3.4）。 |

0.5.0 版本包含 4 项已声明的破坏性变更。

## 0.2.0 版本 {#release-020}

发布日期：2026-09-04。

| 类别 | 用户可见变更 |
| --- | --- |
| BREAKING | Provider 请求模式（schema）变更了 `producerBundleFingerprint`，进而导致每个 prompt 的 `inputsDigest` 发生变化；请重新生成所有 0.1.0 版本的 执行计划。`check` 会报告旧 执行计划 已过期并以退出码 4 退出，执行 `generate` 或使用 `--force` 可创建全新的 执行计划。 |
| Fix | 生成（generation）现在接受 Provider 响应中为空的 `verificationIntent`。 |
| Fix | 除非生成过程确实需要 AI Provider，否则 `generate --list` 不会解析任何 AI Provider。 |
| Fix | 面向人类可读的报告输出会净化控制序列。 |

0.2.0 版本包含 1 项已声明的破坏性变更，排在修复项之前。

## 0.1.0 版本 {#release-010}

发布日期：2026-09-03。

| 类别 | 用户可见变更 |
| --- | --- |
| BREAKING | v1 指纹原像（preimage）发生变更，现已包含规范化的父节点与相邻同级节点标识；旧的 定位缓存 会发生不匹配，常规回放获得 1 次 AI 回退机会，而纯缓存（cache-only）或 CI 回放在完全未命中（clean miss）时会直接中止。 |
| BREAKING | TypeScript 构建基线要求 Node.js 22.14 或更高版本。 |
| Feature | 浏览器捕获新增单次无障碍（accessibility）捕获以及三通道“或（OR）”机密检测。 |
| Feature | 提供真实的存储与系统适配器。 |
| Feature | `generate` 命令接入了 Claude Code CLI 与 Codex CLI 适配器。 |
| Feature | 实现了配置加载与打包的 JSON Schema。 |
| Feature | 实现了规范 JSON 序列化与摘要（digest）计算。 |
| Feature | 定位缓存 成为唯一的追踪权威（trace authority）。 |
| Feature | 实现了 执行计划／定位缓存 的 Zod Schema 以及 JSON Schema 生成。 |
| Feature | AI 定位缓存 追踪重构为事件与验证记录（verification record）。 |
| Feature | 新增布局解析器（layout resolver）与共享配置词汇。 |
| Feature | `inputsDigest` 纳入了 执行计划 生产者包指纹（producer-bundle fingerprint）。 |
| Feature | 机密引用获得了显式授权行（grant lines）与逐字引用验证（verbatim citation verification）。 |
| Feature | 定位缓存 仓库/写回策略与缺失 定位缓存 的检测机制实现统一。 |
| Feature | `heal` 获得了提交原像完整性校验与 `runsDir` 写入隔离约束（write containment）。 |
| Feature | `heal` 获得了前沿单步 Stage 2 迭代能力。 |
| Feature | 实现了三阶段自愈状态机（three-stage heal state machine）。 |
| Feature | 实现了 `heal` CLI 确认机制与命令接入。 |
| Feature | `heal` 针对实际 AI 调度引入了用例作用域准入预算（case-scoped admission budget）。 |
| Feature | `heal` 获得了单次读取且经过验证的快照原像（read-once validated snapshot preimage）。 |
| Feature | `run` 与 `heal` 共享同一张 定位缓存 恢复表。 |
| Feature | `heal` Stage 2 的 Provider 上下文变更为结构化形式，且包含当前 执行计划。 |
| Feature | 执行计划 Schema 版本 2 要求指令覆盖率（instruction coverage）。 |
| Feature | 存储写入获得了原子写入契约（atomic-write contract）。 |
| Feature | 配置新增 `secretSinkOrigins`，浏览器端口获得了专用的 `fillSecret`。 |
| Feature | 浏览器元素解析迁移至 `BoundElement` 实时句柄，并移除了 `.first()`。 |
| Feature | 结构化报告获得了 Schema 2.0 中断与规范化行为。 |
| Feature | `heal` 报告新增列出的分支（listed branch）与 `dryRun`。 |
| Feature | 报告定稿（report finalization）收敛为单一类型化边界。 |
| Feature | 报告 Schema 3.0 将 `heal` 的 `repairOutcome` 与 `application` 分离；拒绝修复将退出且退出码为 1。 |
| Feature | 报告 Schema 3.1 新增按代码划分的可选错误 `details`，并让所有报告错误都可使用 `hint`。 |
| Feature | `run` 实现了 Chromium 定位缓存 命中回放，且零 AI 调用。 |
| Feature | `run` 获得了 定位缓存 未命中恢复与追踪回放功能。 |
| Feature | `run` 实现了 `--allow-empty` 与 `--list`，同时保持故意不支持 `--stale=regenerate`。 |
| Feature | `run` 会在 `.runs` 目录下持久化保存失败证据及其 RunReport。 |
| Feature | 各命令间的目标选择（target selection）实现统一。 |
| Feature | `check` 成为只读的 执行计划／定位缓存 新鲜度门禁（freshness gate）。 |
| Fix | Codex CLI 未正常完成时保留 stderr 摘要。 |
| Fix | 机密接收源（secret-sink origin）在浏览器填充操作执行前立即重新验证。 |
| Fix | `fillSecret` 被固定绑定至单个元素句柄。 |
| Fix | `check` 使用先反转后判定（inverse-then-judge）产物扫描机制，并支持仅用于发现的 `--list`。 |
| Fix | `check` 与 `run` 共享规范的 定位缓存 验证逻辑。 |
| Fix | 子进程销毁流程在 spawn 失败后等待真实的 close 事件。 |
| Fix | 修正了 v1 指纹实现，并在回退期间对 AI 提供的指纹进行验证。 |
| Fix | 强化了 Schema 正则处理，防止 dotAll 丢失与 `baseUrl` 机密泄露漏洞。 |
| Fix | 指纹解析变更为故障闭锁（fail-closed），且接受的算法变更为 `a11y-neighborhood-v2`。 |
| Fix | `heal` 将可修复导航的分类严格限制在用例结果错误（case-outcome errors）范围内。 |
| Fix | `heal` 仲裁与传播在发生完整性违规时执行故障闭锁。 |
| Fix | `heal` 会在阶段令牌（phase token）上锁存调度协议违规。 |
| Fix | `heal` Stage 2 保留机密授权种子（secret-grant seeds），并具备类型化拒绝机制。 |
| Fix | `heal` 监管实际 CLI 子进程的销毁流程，具备故障闭锁清理机制。 |
| Fix | `heal` 将 AI 调用的发起与调度预算准入保持同步。 |
| Fix | 强化了原子写入契约的测试覆盖与文档说明。 |
| Fix | `run` 报告标识路径变更为相对于项目根目录的相对路径。 |
| Fix | 凭据启发式字面量检测对称应用于 `fill.value`。 |
| Fix | 回放机制拒绝 `blob:` 导航，将其视为跨域绕过。 |
| Fix | 对 定位缓存 回退时的 AI 超时进行了组合与分类。 |
| Fix | Provider 可用性探测获得独立且全新的中止超时（abort timeout）。 |
| Fix | `run` 截图路径相对于项目根目录，报告持久化具备三种状态。 |
| Fix | 在 AI 交互边界上，无障碍快照会经过脱敏处理，且截图会被扣留不予传递。 |
| Fix | 机密与运行值在报告边界处被脱敏。 |
| Fix | 回放机制拒绝跨域导航。 |
| Fix | 拒绝嵌入式机密引用，且在持久化之前重新验证 定位缓存。 |
| Fix | 已解析机密的扫描针对追踪记录（traces）变更为迭代式且故障闭锁。 |
| Fix | `run` 强制执行严格的一对一机密授权消耗，并重新生成归属不健全（attribution-unsound）的新 执行计划。 |
| Fix | 拒绝向 AI CLI 子进程传递环境变量，且在中止时强制回收无响应的子进程。 |
| Fix | 生成和回放过程中若出现 prompt 中不存在的机密引用，将被直接拒绝。 |
| Fix | 退出码聚合优先级采用 `2 > 3 > 4 > 1 > 5 > 0`。 |
| Fix | `generate` 接入事件接收器（event sink），从 Claude CLI 请求中剥除 `$schema`，并修复了运行步骤的开始计时。 |

## 另请参阅 {#see-also}

- [兼容性表](/ambercast/zh-cn/reference/compatibility/#compatibility-table)
- [重新生成的边界](/ambercast/zh-cn/reference/compatibility/#regeneration-boundary)
- [在不同版本间升级](/ambercast/zh-cn/how-to/upgrade/)
- [规范变更日志](/ambercast/zh-cn/spec/changelog/)
