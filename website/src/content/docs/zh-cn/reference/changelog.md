---
title: 变更日志
description: 记录 ambercast 用户可见的产品行为与公共契约变更，优先展示破坏性变更。
---

ambercast 是面向 prompt 原生的端到端测试 CLI 工具，由 AI 将自然语言测试 prompt 一次性编译为类似 lockfile 的确定性 Plan；在 Chromium 中命中 Grounding 时无需任何 AI 调用即可重放，并在 UI 发生漂移时通过自愈流程进行修复。本参考页面记录 ambercast 各版本中用户可见的产品行为与公共契约变更，并严格按照破坏性变更（BREAKING）优先的顺序编排。有关升级的具体步骤请参阅 [在不同版本间升级](/ambercast/zh-cn/how-to/upgrade/)，兼容性规则与详细对照请参阅 [兼容性](/ambercast/zh-cn/reference/compatibility/#compatibility-table) 及 [兼容性](/ambercast/zh-cn/reference/compatibility/#regeneration-boundary)，变更记录规范请参阅 [规范变更日志](/ambercast/zh-cn/spec/changelog/)。

## 0.2.0 版本 {#release-020}

0.2.0 版本发布于 2026-09-04。该版本包含 1 项已声明的破坏性变更，在此置于修复项之前展示。

| 类别 | 用户可见变更 |
| --- | --- |
| BREAKING | Provider 请求模式（schema）变更了 `producerBundleFingerprint`，进而导致每个 prompt 的 `inputsDigest` 发生变化；请重新生成所有 0.1.0 版本的 Plan。`check` 会报告旧 Plan 已过期并以退出码 4 退出，执行 `generate` 或使用 `--force` 可创建全新的 Plan。 |
| Fix | 生成（generation）现在接受 Provider 响应中为空的 `verificationIntent`。 |
| Fix | 除非生成过程确实需要 AI Provider，否则 `generate --list` 不会解析任何 AI Provider。 |
| Fix | 面向人类可读的报告输出会净化控制序列。 |

## 0.1.0 版本 {#release-010}

0.1.0 版本发布于 2026-09-03。此版本记录排除了仅涉及代码仓库架构扫描器、Agent Hook、Worktree 生命周期、Lint 配置或项目工作流的维护条目，但完整收录了所有产品行为与公共契约的修改。

| 类别 | 用户可见变更 |
| --- | --- |
| BREAKING | v1 指纹原像（preimage）发生变更，现已包含规范化的父节点与相邻同级节点标识；旧的 Grounding 会发生不匹配，常规重放获得 1 次 AI 回退机会，而纯缓存（cache-only）或 CI 重放在完全未命中（clean miss）时会直接中止。 |
| BREAKING | TypeScript 构建基线要求 Node.js 22.14 或更高版本。 |
| Feature | 浏览器捕获新增单次无障碍（accessibility）捕获以及三通道“或（OR）”敏感信息检测。 |
| Feature | 提供真实的存储与系统适配器。 |
| Feature | `generate` 命令接入了 Claude Code CLI 与 Codex CLI 适配器。 |
| Feature | 实现了配置加载与打包的 JSON Schema。 |
| Feature | 实现了规范 JSON 序列化与摘要（digest）计算。 |
| Feature | Grounding 成为唯一的追踪权威（trace authority）。 |
| Feature | 实现了 Plan/Grounding 的 Zod Schema 以及 JSON Schema 生成。 |
| Feature | AI Grounding 追踪重构为事件与验证记录（verification record）。 |
| Feature | 新增布局解析器（layout resolver）与共享配置词汇。 |
| Feature | `inputsDigest` 纳入了 Plan 生产者包指纹（producer-bundle fingerprint）。 |
| Feature | 敏感信息引用获得了显式授权行（grant lines）与逐字引用验证（verbatim citation verification）。 |
| Feature | Grounding 仓库/写回策略与缺失 Grounding 的检测机制实现统一。 |
| Feature | `heal` 获得了提交原像完整性校验与 `runsDir` 写入隔离约束（write containment）。 |
| Feature | `heal` 获得了前沿单步 Stage 2 迭代能力。 |
| Feature | 实现了三阶段自愈状态机（three-stage heal state machine）。 |
| Feature | 实现了 `heal` CLI 确认机制与命令接入。 |
| Feature | `heal` 针对实际 AI 调度引入了用例作用域准入预算（case-scoped admission budget）。 |
| Feature | `heal` 获得了单次读取且经过验证的快照原像（read-once validated snapshot preimage）。 |
| Feature | `run` 与 `heal` 共享同一张 Grounding 恢复表。 |
| Feature | `heal` Stage 2 的 Provider 上下文变更为结构化形式，且包含当前 Plan。 |
| Feature | Plan Schema 版本 2 要求指令覆盖率（instruction coverage）。 |
| Feature | 存储写入获得了原子写入契约（atomic-write contract）。 |
| Feature | 配置新增 `secretSinkOrigins`，浏览器端口获得了专用的 `fillSecret`。 |
| Feature | 浏览器元素解析迁移至 `BoundElement` 实时句柄，并移除了 `.first()`。 |
| Feature | 结构化报告获得了 Schema 2.0 中断与规范化行为。 |
| Feature | `heal` 报告新增列出的分支（listed branch）与 `dryRun`。 |
| Feature | 报告定稿（report finalization）收敛为单一类型化边界。 |
| Feature | 报告 Schema 3.0 将 `heal` 的 `repairOutcome` 与 `application` 分离；拒绝修复将退出且退出码为 1。 |
| Feature | `run` 实现了 Chromium Grounding 命中重放，且零 AI 调用。 |
| Feature | `run` 获得了 Grounding 未命中恢复与追踪重放功能。 |
| Feature | `run` 实现了 `--allow-empty` 与 `--list`，同时保持故意不支持 `--stale=regenerate`。 |
| Feature | `run` 会在 `.runs` 目录下持久化保存失败证据及其 RunReport。 |
| Feature | 各命令间的目标选择（target selection）实现统一。 |
| Feature | `check` 成为只读的 Plan/Grounding 新鲜度门禁（freshness gate）。 |
| Fix | Codex CLI 未正常完成时保留 stderr 摘要。 |
| Fix | 敏感信息接收源（secret-sink origin）在浏览器填充操作执行前立即重新验证。 |
| Fix | `fillSecret` 被固定绑定至单个元素句柄。 |
| Fix | `check` 使用先反转后判定（inverse-then-judge）产物扫描机制，并支持仅用于发现的 `--list`。 |
| Fix | `check` 与 `run` 共享规范的 Grounding 验证逻辑。 |
| Fix | 子进程销毁流程在 spawn 失败后等待真实的 close 事件。 |
| Fix | 修正了 v1 指纹实现，并在回退期间对 AI 提供的指纹进行验证。 |
| Fix | 强化了 Schema 正则处理，防止 dotAll 丢失与 `baseUrl` 敏感信息泄露漏洞。 |
| Fix | 指纹解析变更为故障闭锁（fail-closed），且接受的算法变更为 `a11y-neighborhood-v2`。 |
| Fix | `heal` 将可修复导航的分类严格限制在用例结果错误（case-outcome errors）范围内。 |
| Fix | `heal` 仲裁与传播在发生完整性违规时执行故障闭锁。 |
| Fix | `heal` 会在阶段令牌（phase token）上锁存调度协议违规。 |
| Fix | `heal` Stage 2 保留敏感信息授权种子（secret-grant seeds），并具备类型化拒绝机制。 |
| Fix | `heal` 监管实际 CLI 子进程的销毁流程，具备故障闭锁清理机制。 |
| Fix | `heal` 将 AI 调用的发起与调度预算准入保持同步。 |
| Fix | 强化了原子写入契约的测试覆盖与文档说明。 |
| Fix | `run` 报告标识路径变更为相对于项目根目录的相对路径。 |
| Fix | 凭据启发式字面量检测对称应用于 `fill.value`。 |
| Fix | 重放机制拒绝 `blob:` 导航，将其视为跨域绕过。 |
| Fix | 对 Grounding 回退时的 AI 超时进行了组合与分类。 |
| Fix | Provider 可用性探测获得独立且全新的中止超时（abort timeout）。 |
| Fix | `run` 截图路径相对于项目根目录，报告持久化具备三种状态。 |
| Fix | 在 AI 交互边界上，无障碍快照会经过脱敏处理，且截图会被扣留不予传递。 |
| Fix | 敏感信息与运行值在报告边界处被脱敏。 |
| Fix | 重放机制拒绝跨域导航。 |
| Fix | 拒绝嵌入式敏感信息引用，且在持久化之前重新验证 Grounding。 |
| Fix | 已解析敏感信息的扫描针对追踪记录（traces）变更为迭代式且故障闭锁。 |
| Fix | `run` 强制执行严格的一对一敏感信息授权消耗，并重新生成归属不健全（attribution-unsound）的新 Plan。 |
| Fix | 拒绝向 AI CLI 子进程传递环境变量，且在中止时强制回收无响应的子进程。 |
| Fix | 生成和重放过程中若出现 prompt 中不存在的敏感信息引用，将被直接拒绝。 |
| Fix | 退出码聚合优先级采用 `2 > 3 > 4 > 1 > 5 > 0`。 |
| Fix | `generate` 接入事件接收器（event sink），从 Claude CLI 请求中剥除 `$schema`，并修复了运行步骤的开始计时。 |
