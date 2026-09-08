---
title: 信任与安全
description: 阐释 ambercast 的信任边界与故障安全设计考量。
---

在端到端测试系统中，明确系统的信任边界与故障安全（fail-closed）选择是架构设计的核心。ambercast 将持久化工件校验与提供商输出的接纳边界明确区分开来：回放运行仅通过受信任的指令覆盖计划边界读取测试计划，而在生成阶段，提供商生成的步骤在持久化前必须经过本地响应契约解析与指令覆盖检查。

## 工件与提供商输出经过验证 {#artifact-and-provider-boundaries}

持久化工件的校验与提供商输出的接纳遵循相互独立的信任边界。在执行回放之前，`run` 命令仅通过其受信任的指令覆盖计划边界（instruction-covered-plan boundary）读取测试计划，使回放执行建立在已验证的计划结构之上。

对于提供商生成的步骤，系统不会将其直接视作可信的持久化工件。这些步骤首先需要针对本地响应契约进行解析，并接受指令覆盖检查；随后组装并作为完整计划进行解析，只有完全通过这些阶段后才会持久化存储。

相关链接：[计划文档](/ambercast/zh-cn/spec/plan-document/)、[符合性](/ambercast/zh-cn/spec/conformance/)、[错误代码](/ambercast/zh-cn/reference/error-codes/)

## 页面观测数据不构成指令 {#untrusted-page-data}

被测应用的内容与驱动测试执行的指令之间存在严格的界限。来自被测页面的观测数据属于外部输入，系统不会将其作为控制指令执行。为此，结构化的无障碍凭证带有固定声明，明确指出源自页面的内容不得被解释为指令。

在错误处理架构上，错误设计将报告规范（report schema）作为 `errors[].code` 的外部真实来源，从而将特定于实现的错误类隔离在公共契约之外。

相关链接：[报告](/ambercast/zh-cn/reference/reports/)、[错误代码](/ambercast/zh-cn/reference/error-codes/)、[读取结构化输出](/ambercast/zh-cn/agents/reading-structured-output/)

## 页面凭证在复用前进行脱敏 {#page-evidence-boundary}

实时页面观测数据不会直接作为不受限制的提供商输入，也不会无条件转为持久化凭证。发往 AI 的快照在传入 AI 适配器之前，会排除截图字节，并从无障碍树字符串和对象键中对已解析的 Secret 值进行脱敏处理。

当实时步骤执行失败时，失败步骤凭证使用脱敏后的无障碍数据，同时系统将不确定的 Secret 存在视为不适宜进行屏幕截图捕获。

需要注意的是，脱敏范围覆盖了已解析的 Secret 以及回放已知的运行状态值，但这并不保证能从 `actual` 文本、无障碍快照、屏幕截图、canvas、图像、CSS 渲染像素或扫描与截图之间的时间差间隙中移除任意源自页面的个人数据。请您将持久化的报告和凭据视为敏感数据，并妥善限制其访问权限与保留期限。

相关链接：[计划中的机密](/ambercast/zh-cn/spec/secrets/)、[报告](/ambercast/zh-cn/reference/reports/)

## Secret 接收端限制浏览器填充 {#secret-sink-boundary}

浏览器源边界与提供商进程的环境变量过滤机制具有不同的控制范围。在执行 `fill-secret` 跟踪操作时，系统会在 Secret 解析和浏览器绑定之前，先应用其针对每条记录的接收端源门禁（per-entry sink-origin gate）。

相关链接：[管理机密](/ambercast/zh-cn/how-to/manage-secrets/)、[配置](/ambercast/zh-cn/reference/configuration/)

## ambercast 管理的 Secret 命名空间不进入提供商子进程 {#secret-boundary}

配置的提供商子进程不会被托付 ambercast 管理的敏感命名空间。提供商子进程接收的是一份复制的环境变量，该环境变量通过不区分大小写的匹配方式排除了 `AMBERCAST_SECRET_*` 与 `AMBERCAST_ENV_*`。

在整体安全设计中，系统为 Secret 校验、生成器策略以及报告脱敏分配了各自独立的角色，而不是单纯依赖数据模式自身来证明保密性。

相关链接：[管理机密](/ambercast/zh-cn/how-to/manage-secrets/)、[环境变量](/ambercast/zh-cn/reference/environment-variables/)、[安全策略](/ambercast/zh-cn/reference/security-policy/)
