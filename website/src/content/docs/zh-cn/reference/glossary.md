---
title: 术语表
description: ambercast 全站术语的权威规范性定义以及翻译人员必须保留的字面量词元索引。
---

本参考页是 ambercast 全站术语的单一权威来源，同时作为翻译过程中必须严格保留的字面量词元（literal tokens）索引。此处的每项定义均具备规范性，且由单句界定，不冗余展开完整的字段、标志位、状态或错误表格；请遵循各条目对应的归属链接以查阅完整契约。处于规划阶段（在 0.3.1 中未实现）的词元不具备 0.3.1 运行时语义，不得将其呈现为当前可用状态。

## 工件术语 {#artifact-terms}

| 术语 | 规范性定义 | 所属 Schema / 命令 | 避免混淆的概念 |
| --- | --- | --- | --- |
| plan | Plan（计划）是一份符合 Schema 校验的 `PlanDocument`，其 `inputsDigest` 记录规范化 Prompt 的来源凭证，正文记录命名目标与可执行步骤。 | `PlanDocument`；[计划文档](/ambercast/zh-cn/spec/plan-document/) | prompt 或 grounding |
| grounding | Grounding 是针对每份 Plan 独立的、符合 Schema 校验的缓存，其 `planDigest` 将以步骤为键的条目绑定至单个 Plan。 | `GroundingDocument`；[Grounding 文档](/ambercast/zh-cn/spec/grounding-document/) | Plan 或运行报告 |
| artifact | 工件（artifact）是针对代码库内 `.test.md` Prompt 的派生 plan 或 grounding 伴生文件。 | 布局解析器；[文件布局](/ambercast/zh-cn/reference/file-layout/#companions) | 运行凭据 |
| fingerprint | 指纹（fingerprint）是一种元素 Grounding 值，包含字面量算法 `a11y-neighborhood-v2` 与一个 SHA-256 哈希值。 | `Fingerprint`；[元素指纹](/ambercast/zh-cn/spec/fingerprint/) | `planDigest` |
| inputs digest | 输入摘要（inputs digest）是基于规范化 Prompt、Plan Schema 版本、生成器模板指纹、生产器产物包指纹（producer-bundle fingerprint）及命名目标计算出的权威 SHA-256 来源凭证摘要。 | `computeInputsDigest`；[新鲜度与摘要](/ambercast/zh-cn/spec/freshness/) | `planDigest` |
| plan digest | 计划摘要（plan digest）是排除 `generatorMeta` 后符合 Schema 校验的 Plan 的权威 SHA-256 哈希值，用于绑定 Grounding。 | `computePlanDigest`；[新鲜度与摘要](/ambercast/zh-cn/spec/freshness/) | `inputsDigest` |
| normalized test prompt | 规范化测试 Prompt（normalized test prompt）至多移除一个开头的 U+FEFF 字符，并将 CRLF 或单独的 CR 映射为 LF，同时保留其余全部内容。 | `normalizeTestMd`；[提示词文件格式](/ambercast/zh-cn/reference/prompt-format/#normalization-and-grants) | 格式清理 |

- `PlanDocument` 与 `GroundingDocument` 是严格的运行时信任边界，JSON Schema 均派生自二者。

## 执行术语 {#execution-terms}

| 术语 | 规范性定义 | 所属 Schema / 命令 | 避免混淆的概念 |
| --- | --- | --- | --- |
| freshness | 新鲜度（freshness）是 `check` 命令针对 Plan/Grounding 工件报告的来源凭证状态，而非执行结果。 | `ambercast check`；[新鲜度与摘要](/ambercast/zh-cn/spec/freshness/) | 运行成功 |
| stale | 过期（stale）是已完成的 `check` 状态，表示对应工件的新鲜度不可信。 | `CompletedCheckResult`；[ambercast check](/ambercast/zh-cn/reference/cli/check/#status-vocabulary) | UI 漂移 |
| drift | 漂移（drift）是元素无障碍邻域中的局部变动，该变动会改变其指纹。 | 指纹解析器；[元素指纹](/ambercast/zh-cn/spec/fingerprint/) | 过期的 Plan 来源凭证 |
| heal | 自愈（heal）是一项修复命令，其非列表模式仅在 CI 策略允许且所选目标为 `idempotent` 时才被允许执行。 | `ambercast heal`；[ambercast heal](/ambercast/zh-cn/reference/cli/heal/) | 运行时的 Grounding 回退 |
| target | 目标（target）是命名的已配置浏览器目的地，可显式选择、依配置默认值选定，或在它是唯一已配置目标时自动选定。 | `resolveTarget`；[配置](/ambercast/zh-cn/reference/configuration/#key-table) | prompt |
| replay isolation | 重放隔离（replay isolation）是指目标策略 `healReplayIsolation`；`idempotent` 允许自愈，而 `stateful` 拒绝自愈。 | 目标配置 / `ambercast heal` | Plan 中的目标定义 |
| report envelope | 报告信封（report envelope）是由报告命令返回的、带版本且按命令进行区分的结构化结果。 | `ReportEnvelope`；[报告](/ambercast/zh-cn/reference/reports/#envelope) | 持久化的 `report.json` |
| report persistence | 报告持久化（report persistence）是运行信封针对最终信封写入操作记录的状态，取值为 `persisted`、`failed` 或 `not-attempted`。 | 运行 `ReportEnvelope`；[报告](/ambercast/zh-cn/reference/reports/#persistence) | 语义测试结果 |
| secret reference | 密钥引用（secret reference）是由 `SecretRef` 接受的完整值字符串，在 `secrets.` 之后包含一个或多个由点分隔的 ASCII 字母、数字或下划线段。 | `SecretRef`；[提示词文件格式](/ambercast/zh-cn/reference/prompt-format/#secret-references) | 字面量密钥 |
| secret grant | 密钥授权（secret grant）是位于 CommonMark 代码范围之外、严格按照源文件顺序书写的完整 `@ambercast-secret <secret reference>` 行。 | `extractSecretGrants`；[提示词文件格式](/ambercast/zh-cn/reference/prompt-format/#normalization-and-grants) | 密钥引用本身 |

- `stale` 属于 check 结果，而不是 run 结果状态。
- 自愈命令对幂等目标（idempotent target）的检查仅在列表模式下跳过。

## 翻译不可变词元注册表 {#translation-invariant-registry}

| 不可变词元 | 规范性说明 | 归属 | 避免混淆的概念 |
| --- | --- | --- | --- |
| `$id` | `$id` 保留供 JSON Schema 标识符使用，但生成的 0.3.1 Schema 并未确立该标识符。 | [JSON Schema 规范](/ambercast/zh-cn/reference/json-schemas/#publication-metadata) | 配置中的 `$schema` |
| `$schema` | `$schema` 是现有配置文件中的必填标识字段，也是生成 Schema 中的 draft 声明。 | `RawConfig`；[配置](/ambercast/zh-cn/reference/configuration/#key-table) | `$id` |
| `**` | `**` 是可跨越路径分隔符的发现通配符。 | 匹配器；[发现模式](/ambercast/zh-cn/reference/discovery-patterns/#pattern-language) | 单段 `*` |
| `--` | `--` 终止选项解析，并将其后的词元保留为字面量路径。 | CLI 解析器；[CLI 概览](/ambercast/zh-cn/reference/cli/overview/#command-flag-matrix) | 以 `--` 开头的文件名 |
| `--allow-empty` | `--allow-empty` 使得解析该选项的命令在选择集为空时仍被允许执行。 | CLI 解析器；[CLI 概览](/ambercast/zh-cn/reference/cli/overview/#command-flag-matrix) | `--list` |
| `--allow-headless` | `--allow-headless` 处于规划阶段（在 0.3.1 中未实现），没有被接受的 0.3.1 解析器语义。 | [ambercast view](/ambercast/zh-cn/reference/cli/view/#planned-interface) | 已实现的 `--headed` |
| `--cache-only` | `--cache-only` 使 run 命令在 Grounding 未命中时直接拒绝，而不是调用 AI 回退。 | `ambercast run`；[ambercast run](/ambercast/zh-cn/reference/cli/run/#flags) | 离线测试发现 |
| `--clear` | `--clear` 处于规划阶段（在 0.3.1 中未实现），没有被接受的 0.3.1 baseline 解析器语义。 | [ambercast baseline 与 restore](/ambercast/zh-cn/reference/cli/baseline-restore/#planned-boundary) | 当前命令执行的文件删除 |
| `--config` | `--config` 是命令局部选项，仅由 generate 和 check 命令解析。 | CLI 解析器；[CLI 概览](/ambercast/zh-cn/reference/cli/overview/#command-flag-matrix) | `AMBERCAST_CONFIG` |
| `--dir` | `--dir` 处于规划阶段（在 0.3.1 中未实现），没有被接受的 0.3.1 init 解析器语义。 | [ambercast init](/ambercast/zh-cn/reference/cli/init/#planned-interface) | 配置 `testDir` |
| `--dry-run` | `--dry-run` 会阻止 generate 与 heal 命令写入工件。 | generate/heal；[ambercast generate](/ambercast/zh-cn/reference/cli/generate/#flags) | `--list` |
| `--force` | `--force` 使已实现的 generate 命令退出对新鲜 Plan 的复用逻辑。 | `ambercast generate`；[ambercast generate](/ambercast/zh-cn/reference/cli/generate/#flags) | heal `--yes` |
| `--host` | `--host` 处于规划阶段（在 0.3.1 中未实现），没有被接受的 0.3.1 viewer 解析器语义。 | [ambercast view](/ambercast/zh-cn/reference/cli/view/#undecided-items) | 目标的 `baseUrl` |
| `--json` | `--json` 在已实现的命令返回后选择序列化的结构化报告输出。 | CLI 渲染器；[报告](/ambercast/zh-cn/reference/reports/#envelope) | MCP JSON-RPC |
| `--list` | `--list` 由每个已实现的命令解析；各命令页面拥有各自的列表结果语义。 | CLI 解析器；[CLI 概览](/ambercast/zh-cn/reference/cli/overview/#command-flag-matrix) | `--allow-empty` |
| `--no-reset` | `--no-reset` 处于规划阶段（在 0.3.1 中未实现），没有被接受的 0.3.1 run 解析器语义。 | [ambercast baseline 与 restore](/ambercast/zh-cn/reference/cli/baseline-restore/#planned-boundary) | `--force` |
| `--port` | `--port` 处于规划阶段（在 0.3.1 中未实现），没有被接受的 0.3.1 viewer 解析器语义。 | [ambercast view](/ambercast/zh-cn/reference/cli/view/#planned-interface) | 配置 `viewer.port` |
| `--target` | `--target` 为每个已实现的命令指定命名的已配置执行目标。 | CLI 解析器 / 目标解析器；[CLI 概览](/ambercast/zh-cn/reference/cli/overview/#command-flag-matrix) | 目标定义本身 |
| `--yes` | `--yes` 授权 heal 在无需交互式确认的情况下直接完成结算。 | `ambercast heal`；[ambercast heal](/ambercast/zh-cn/reference/cli/heal/#flags) | generate `--force` |
| `.ambercast.grounding.json` | `.ambercast.grounding.json` 是确切的相邻 Grounding 伴生文件后缀。 | 布局解析器；[文件布局](/ambercast/zh-cn/reference/file-layout/#companions) | Plan 后缀 |
| `.ambercast.plan.json` | `.ambercast.plan.json` 是确切的相邻 Plan 伴生文件后缀。 | 布局解析器；[文件布局](/ambercast/zh-cn/reference/file-layout/#companions) | Grounding 后缀 |
| `.baseline` | `.baseline` 处于规划阶段（在 0.3.1 中未实现），没有 0.3.1 布局解析器会推导该路径。 | [ambercast baseline 与 restore](/ambercast/zh-cn/reference/cli/baseline-restore/#planned-storage-and-freshness) | 已实现的 `.runs` |
| `.runs` | `.runs` 是默认 `runsDir` 的末尾路径段，并非独立解析的根目录。 | 配置 / [文件布局](/ambercast/zh-cn/reference/file-layout/#run-artifacts) | 伴生工件 |
| `.test.md` | `.test.md` 是已发现 Prompt 路径获取布局映射所需的确切后缀。 | 布局解析器；[提示词文件格式](/ambercast/zh-cn/reference/prompt-format/#file-identity) | 任意 Markdown |
| `0.1.0` | `0.1.0` 指代版本库更新日志中 2026-09-03 的发布版本。 | [变更日志](/ambercast/zh-cn/reference/changelog/#release-010) | 工件 Schema 版本 |
| `0.3.1` | `0.3.1` 是本参考文档集所记录的当前软件包版本。 | package / [兼容性](/ambercast/zh-cn/reference/compatibility/#compatibility-table) | 报告 `3.1` |
| `2 > 3 > 4 > 1 > 5 > 0` | `2 > 3 > 4 > 1 > 5 > 0` 是进程退出码从强到弱的固定优先级顺序。 | 退出码选择器；[退出码](/ambercast/zh-cn/reference/exit-codes/#aggregation-priority) | 数值大小顺序 |
| `@ambercast-secret` | `@ambercast-secret` 用于在 CommonMark 代码范围之外开启一个完整的授权行。 | 授权提取器；[提示词文件格式](/ambercast/zh-cn/reference/prompt-format/#normalization-and-grants) | 密钥引用 |
| `AMBERCAST_AI_PROVIDER` | `AMBERCAST_AI_PROVIDER` 提供环境变量级别的 Provider 覆盖。 | 配置环境变量；[环境变量](/ambercast/zh-cn/reference/environment-variables/#configuration) | CLI `--ai` |
| `AMBERCAST_CONFIG` | `AMBERCAST_CONFIG` 提供环境变量级别的配置路径覆盖。 | 配置环境变量；[环境变量](/ambercast/zh-cn/reference/environment-variables/#configuration) | CLI `--config` |
| `AMBERCAST_ENV_*` | `AMBERCAST_ENV_*` 是对 AI 提供商子进程隐藏且未列出的 Ambercast 输入命名空间。 | 子进程运行器；[环境变量](/ambercast/zh-cn/reference/environment-variables/#provider-child-environment) | `AMBERCAST_SECRET_*` |
| `AMBERCAST_SECRET_*` | `AMBERCAST_SECRET_*` 用于解析密钥引用，且对 AI 提供商子进程隐藏。 | 密钥适配器 / 子进程运行器；[环境变量](/ambercast/zh-cn/reference/environment-variables/#secrets) | `AMBERCAST_ENV_*` |
| `CI` | `CI` 在已定义、非空且值不严格为小写 `false` 时处于激活状态。 | 环境信息；[环境变量](/ambercast/zh-cn/reference/environment-variables/#secrets) | 通用真值解析 |
| `CONFIG_INVALID` | `CONFIG_INVALID` 是针对无效配置的结构化用法错误代码。 | 报告 Schema；[错误代码](/ambercast/zh-cn/reference/error-codes/#code-vocabulary) | 进程退出码 2 本身 |
| `FS_IO_ERROR` | `FS_IO_ERROR` 是针对文件系统 I/O 失败的结构化环境错误代码。 | 报告 Schema；[错误代码](/ambercast/zh-cn/reference/error-codes/#code-vocabulary) | 任意被拒绝的工件 |
| `GitHub Security Advisories` | GitHub Security Advisories 是私密安全漏洞报告通道。 | `SECURITY.md`；[安全策略](/ambercast/zh-cn/reference/security-policy/#vulnerability-reporting) | 公开 Issue |
| `GroundingDocument` | `GroundingDocument` 是拥有 Grounding `schemaVersion`、`planDigest` 与条目的严格 Schema。 | `GroundingDocument`；[Grounding 文档](/ambercast/zh-cn/spec/grounding-document/) | `PlanDocument` |
| `INTERRUPTED` | `INTERRUPTED` 是针对执行中断的结构化环境错误代码。 | 报告 Schema；[错误代码](/ambercast/zh-cn/reference/error-codes/#code-vocabulary) | 断言失败 |
| `JSON-RPC` | `JSON-RPC` 处于规划阶段（在 0.3.1 中未实现），作为 MCP 传输协议，在 0.3.1 中尚无服务端运行时。 | [ambercast mcp](/ambercast/zh-cn/reference/cli/mcp/#planned-interface) | CLI `--json` |
| `PlanDocument` | `PlanDocument` 是拥有 Plan 版本、来源凭证、目标与步骤的严格 Schema。 | `PlanDocument`；[计划文档](/ambercast/zh-cn/spec/plan-document/) | `GroundingDocument` |
| `SECRET_REF_PATTERN` | `SECRET_REF_PATTERN` 是由 `SECRET_REF_SOURCE` 构建的锚定全值正则表达式。 | `SecretRef`；[提示词文件格式](/ambercast/zh-cn/reference/prompt-format/#secret-references) | 未锚定的片段 |
| `a11y-neighborhood-v2` | `a11y-neighborhood-v2` 是唯一被接受的元素指纹算法字面量。 | `Fingerprint`；[元素指纹](/ambercast/zh-cn/spec/fingerprint/) | Plan Schema 版本 2 |
| `ambercast` | `ambercast` 是软件包二进制文件名称和 CLI 程序。 | package / CLI 概览 | 某个工件 Schema |
| `ambercast baseline` | `ambercast baseline` 处于规划阶段（在 0.3.1 中未实现），会被 0.3.1 解析器拒绝。 | [ambercast baseline 与 restore](/ambercast/zh-cn/reference/cli/baseline-restore/#status) | 已实现的命令 |
| `ambercast check` | `ambercast check` 是已实现的只读新鲜度检查命令。 | [ambercast check](/ambercast/zh-cn/reference/cli/check/) | `ambercast run` |
| `ambercast generate` | `ambercast generate` 是已实现的 Plan 生成命令。 | [ambercast generate](/ambercast/zh-cn/reference/cli/generate/) | `ambercast run` |
| `ambercast heal` | `ambercast heal` 是已实现且受守卫保护的工件修复命令。 | [ambercast heal](/ambercast/zh-cn/reference/cli/heal/) | 运行时回退 |
| `ambercast init` | `ambercast init` 处于规划阶段（在 0.3.1 中未实现），会被 0.3.1 解析器拒绝。 | [ambercast init](/ambercast/zh-cn/reference/cli/init/#status) | 已实现的命令 |
| `ambercast mcp` | `ambercast mcp` 处于规划阶段（在 0.3.1 中未实现），会被 0.3.1 解析器拒绝。 | [ambercast mcp](/ambercast/zh-cn/reference/cli/mcp/#status) | MCP 工具名 |
| `ambercast restore` | `ambercast restore` 处于规划阶段（在 0.3.1 中未实现），会被 0.3.1 解析器拒绝。 | [ambercast baseline 与 restore](/ambercast/zh-cn/reference/cli/baseline-restore/#status) | 已实现的命令 |
| `ambercast review` | `ambercast review` 处于规划阶段（在 0.3.1 中未实现），即使运行时报告 Schema 中包含 review 分支也是如此。 | [ambercast review](/ambercast/zh-cn/reference/cli/review/#status) | Schema 可用性 |
| `ambercast run` | `ambercast run` 是已实现的确定性重放命令。 | [ambercast run](/ambercast/zh-cn/reference/cli/run/) | `ambercast generate` |
| `ambercast view` | `ambercast view` 处于规划阶段（在 0.3.1 中未实现），会被 0.3.1 解析器拒绝。 | [ambercast view](/ambercast/zh-cn/reference/cli/view/#status) | 已实现的命令 |
| `ambercast_check` | `ambercast_check` 是规划中的 MCP 工具词元，在 0.3.1 中没有服务端运行时。 | [MCP 工具](/ambercast/zh-cn/reference/mcp-tools/#tool-table) | CLI `ambercast check` |
| `ambercast_generate` | `ambercast_generate` 是规划中的 MCP 工具词元，在 0.3.1 中没有服务端运行时。 | [MCP 工具](/ambercast/zh-cn/reference/mcp-tools/#tool-table) | CLI `ambercast generate` |
| `ambercast_heal` | `ambercast_heal` 是规划中的 MCP 工具词元，在 0.3.1 中没有服务端运行时。 | [MCP 工具](/ambercast/zh-cn/reference/mcp-tools/#tool-table) | CLI `ambercast heal` |
| `ambercast_review` | `ambercast_review` 是规划中的 MCP 工具词元，在 0.3.1 中没有服务端运行时。 | [MCP 工具](/ambercast/zh-cn/reference/mcp-tools/#tool-table) | 规划中的 CLI review |
| `ambercast_run` | `ambercast_run` 是规划中的 MCP 工具词元，在 0.3.1 中没有服务端运行时。 | [MCP 工具](/ambercast/zh-cn/reference/mcp-tools/#tool-table) | CLI `ambercast run` |
| `config.schema.json` | `config.schema.json` 是生成的配置 JSON Schema 及 npm 配置 Schema 导出目标。 | [JSON Schema 规范](/ambercast/zh-cn/reference/json-schemas/#generated-artifacts) | 配置实例 |
| `dryRun` | `dryRun` 是 CLI/MCP 自愈预览请求的输入字段；已完成的 `HealResult` 使用 `application: preview-only` 表示预览，而非 `dryRun` 字段。 | 自愈请求 / [MCP 工具](/ambercast/zh-cn/reference/mcp-tools/#heal-safety-default) | HealResult 的表示形式 |
| `fresh-without-grounding` | `fresh-without-grounding` 是已完成的 check 状态，与 `fresh` 区分开来。 | check 结果；[ambercast check](/ambercast/zh-cn/reference/cli/check/#status-vocabulary) | 缺失 Plan |
| `grounding.schema.json` | `grounding.schema.json` 是生成的 Grounding JSON Schema 及 npm 导出目标。 | [JSON Schema 规范](/ambercast/zh-cn/reference/json-schemas/#generated-artifacts) | Grounding 实例 |
| `healReplayIsolation` | `healReplayIsolation` 是目标策略，自愈要求其值必须为 `idempotent`。 | 目标配置 / heal | 浏览器模式 |
| `inputsDigest` | `inputsDigest` 记录五项输入的 Plan 来源凭证摘要。 | `computeInputsDigest`；[新鲜度与摘要](/ambercast/zh-cn/spec/freshness/) | `planDigest` |
| `isError` | `isError` 是规划中的 MCP 结果分类字段，在 0.3.1 中没有 MCP 运行时语义。 | [MCP 工具](/ambercast/zh-cn/reference/mcp-tools/#tool-table) | 测试失败状态 |
| `outputSchema` | `outputSchema` 是规划中的 MCP Schema 元数据，在 0.3.1 中没有 MCP 运行时语义。 | [MCP 工具](/ambercast/zh-cn/reference/mcp-tools/#planned-tool-contract) | 生成的 npm JSON Schema |
| `plan.schema.json` | `plan.schema.json` 是生成的 Plan JSON Schema 及 npm 导出目标。 | [JSON Schema 规范](/ambercast/zh-cn/reference/json-schemas/#generated-artifacts) | Plan 实例 |
| `planDigest` | `planDigest` 将 Grounding 绑定至排除 `generatorMeta` 后的重放相关 Plan 内容。 | `computePlanDigest`；[新鲜度与摘要](/ambercast/zh-cn/spec/freshness/) | `inputsDigest` |
| `producerBundleFingerprint` | `producerBundleFingerprint` 命名生产器契约来源凭证，其变更会改变 `inputsDigest`。 | 生成来源凭证 / [兼容性](/ambercast/zh-cn/reference/compatibility/#regeneration-boundary) | 元素指纹 |
| `report.json` | `report.json` 是调用目录下仅由 run 命令持久化的最终信封。 | run / [文件布局](/ambercast/zh-cn/reference/file-layout/#run-artifacts) | stdout 信封 |
| `reportPersistence` | `reportPersistence` 是运行信封对其持久化尝试状态的记录。 | 运行报告；[报告](/ambercast/zh-cn/reference/reports/#persistence) | 测试状态 |
| `review` | `review` 是报告 Schema 中的命令分支，并非已实现 CLI 命令的证据。 | `ReportEnvelope`；[报告](/ambercast/zh-cn/reference/reports/#result-shapes) | 可用命令 |
| `schemaVersion` | `schemaVersion` 用于区分带版本的 Plan、Grounding 或报告契约。 | IR/报告 Schema | 软件包版本 |
| `stderr` | `stderr` 用于传递 CLI 用法错误、崩溃诊断和持久化警告，而非成功的报告输出。 | CLI 运行时 / [ambercast mcp](/ambercast/zh-cn/reference/cli/mcp/#planned-interface) | stdout 响应 |
| `stdio` | `stdio` 处于规划阶段（在 0.3.1 中未实现），用于 MCP 传输，在 0.3.1 中没有服务端运行时。 | [ambercast mcp](/ambercast/zh-cn/reference/cli/mcp/#planned-interface) | 网络端口 |
| `stdout` | `stdout` 用于传递帮助/版本信息和已完成的命令报告，进程状态则单独指定。 | CLI 运行时 / [报告](/ambercast/zh-cn/reference/reports/#envelope) | stderr 诊断信息 |
| `structuredContent` | `structuredContent` 处于规划阶段（在 0.3.1 中未实现），属于 MCP 结果载荷，在 0.3.1 中没有 MCP 运行时语义。 | [MCP 工具](/ambercast/zh-cn/reference/mcp-tools/#planned-tool-contract) | CLI JSON 文本 |
| `testIgnore` | `testIgnore` 在相对路径匹配包含规则之后将其排除。 | 发现匹配器；[发现模式](/ambercast/zh-cn/reference/discovery-patterns/#selection) | `testMatch` |
| `testMatch` | `testMatch` 要求相对路径至少匹配一项包含规则。 | 发现匹配器；[发现模式](/ambercast/zh-cn/reference/discovery-patterns/#selection) | `testIgnore` |
| `{{secrets.name}}` | `{{secrets.name}}` 示范了一个全值密钥引用，其正文映射到环境变量键。 | `SecretRef`；[提示词文件格式](/ambercast/zh-cn/reference/prompt-format/#secret-references) | 字面量凭据 |

相关链接：[CLI 概览](/ambercast/zh-cn/reference/cli/overview/)，[配置](/ambercast/zh-cn/reference/configuration/)，[报告](/ambercast/zh-cn/reference/reports/)，[错误代码](/ambercast/zh-cn/reference/error-codes/)，[退出码](/ambercast/zh-cn/reference/exit-codes/)，[JSON Schema 规范](/ambercast/zh-cn/reference/json-schemas/)，[环境变量](/ambercast/zh-cn/reference/environment-variables/)，[MCP 工具](/ambercast/zh-cn/reference/mcp-tools/)。
