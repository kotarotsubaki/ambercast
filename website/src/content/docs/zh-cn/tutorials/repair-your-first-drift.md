---
title: UI 变更后的测试自愈
description: 在一次性练习应用中，安全地自愈并验证因定位器变更而失败的既有测试用例。
---

当界面调整导致元素定位失效时，ambercast 可以通过自愈流程重新建立元素对应关系。假设您正在一个已生成既有测试用例的一次性练习应用中操作，本教程将带您完成单个测试用例的安全自愈。请注意，默认的具状态（stateful）目标无法执行自愈；关于配置与命令契约的权威定义，请参阅 [配置](/ambercast/zh-cn/reference/configuration/) 与 [ambercast heal](/ambercast/zh-cn/reference/cli/heal/)。

## 步骤 {#steps}

> [!IMPORTANT]
> **写入范围**：请严格保留现有配置，仅修改所选 target 的 `healReplayIsolation` 键。请保持其 target 名称、`baseUrl`、`browser` 以及任何 `secretSinkOrigins` 原样不变；切勿新增、删除、重命名或编辑其他 target。一旦显式提供 `targets` 记录，它将整体替换内置默认值；target 的名称与定义会参与 `inputsDigest` 计算，而 `healReplayIsolation` 经专门设计独立于该摘要契约之外。

1. 在 `ambercast.config.json` 中，编辑现有的所选 target 条目，仅将其 `healReplayIsolation` 修改为 `"idempotent"`。对于未显式配置的默认 target，等效的保留配置如下：

```json
{"$schema":"https://kotarotsubaki.github.io/ambercast/schemas/config.schema.json","targets":{"web-user":{"baseUrl":"http://localhost:3000","browser":"chromium","healReplayIsolation":"idempotent"}},"defaultTarget":"web-user"}
```

→ **预期现象**：由于 target 名称以及参与摘要计算的定义均未改动，现有的 Plan 依然保持新鲜（fresh）；改变的仅是其实时自愈策略。该文件符合 `RawConfig` 必需的 `$schema` 要求，且使用的 Schema URL 为已发布的官方配置 Schema URL。

2. 在触发失败运行之前，请确认 runs 目录的保留策略（retention policy）以及授权读取者。一次完整的 `run` 执行会尝试向该目录持久化写入 `report.json`，并可能写入失败截图（尽力而为：在检测到机密信息、截图捕获失败或存储写入失败时将被忽略）。接着，进行一项会影响定位器的 UI 变更，并运行：



在尝试修复之前，观察并确认测试已失败。

→ **预期现象**：`--cache-only` 选项会将定位匹配缺失（grounding miss）直接判定为失败，而不是触发 AI 重新定位。这样可以确保在获得显式自愈批准之前，受版本控制的 grounding 不会被提前重写（否则默认的 `grounding.localWriteBack: "auto"` 会自动持久化重新解析后的指纹，导致本次运行直接通过）。

3. 运行 dry-run 模式以生成并检查报告（runs 目录的保留策略与读取权限已在步骤 2 中确认）：



→ **预期现象**：当缓冲的 plan 与 grounding 写入尚未实际应用时，报告会将本次完成的修复状态标记为 `preview-only`；该报告不会输出候选补丁的原始字节，因此这一步是一次批准决策，而非写入前的 diff 审查。需要注意的是，每次重放都会使用一个专属的尝试子目录，失败截图仍可能作为独立的取证数据保存在其中，因此 `ambercast heal --dry-run` 并不是完全无写入的预览。

4. 获得人类的显式批准后，选择对应的执行路径：
   - 若您处于交互式终端，请运行 `npx ambercast heal tests/ambercast/<name>.test.md` 并响应 CLI 的交互确认提示；
   - 若由 Agent 或其他非交互式调用方执行，必须在显式批准明确出现在对话中之后，方可运行 `npx ambercast heal --yes tests/ambercast/<name>.test.md`。

→ **预期现象**：`--yes` 参数仅用于预先授权 CLI 的交互确认，绝不能替代人类对 Agent 写入行为的批准。详情请参阅 [设置提示词](/ambercast/zh-cn/agents/setup-prompt/#copy-paste-prompt)。

5. 验证测试的新鲜状态：



→ **预期现象**：`ambercast check` 退出代码为 `0`，即表明修复后的用例已处于可观察的新鲜完成状态；若退出代码非 0，请参阅 [恢复 stale（已过期）产物](/ambercast/zh-cn/how-to/recover-stale-artifacts/)。

6. 实际自愈执行完毕后，运行 `git status --short`。针对每一个受版本控制且在作用域内的变更文件（配置文件、影响定位器的 UI 文件、Plan 以及 Grounding），运行 `git diff -- <path>` 进行展示；对于每一个未受版本控制的作用域内文件，展示其完整内容或通过 `git diff --no-index /dev/null <path>` 展示。展示完整的变更集后停止操作。只有在对话中明确提出要求时才执行提交（commit）。只有在确认目标文件并获得显式批准后才执行撤销（revert）。

→ **预期现象**：默认只进行 diff 展示，且仅在显式请求时才允许提交；这一明确的确认与批准边界可防止 Agent 仅凭推断擅自丢弃既有变更。请参考 [设置提示词](/ambercast/zh-cn/agents/setup-prompt/#copy-paste-prompt) 与 [审查生成的 diff](/ambercast/zh-cn/how-to/review-generated-diffs/#steps)。

> [!NOTE]
> **范围说明**：不带参数的命令形式 `npx ambercast heal` 会发现所有符合测试目录、匹配规则及忽略规则的测试。请仅在经过单独批准的全量修复操作中使用该形式；本教程仅针对单个指定的 `.test.md` 进行自愈。

## 完成状态 {#completion-state}

- 所选 target（在步骤 1 的无额外配置示例中为 `web-user`）已显式设为 `idempotent`；未修改的内置模板中 `web-user` 默认为 `stateful`，显式配置的 `targets` 映射表已替换该内置模板。
- 在接受修复且测试保持新鲜后，`ambercast check` 正常退出且退出代码为 `0`。

相关参考：[配置](/ambercast/zh-cn/reference/configuration/)、[ambercast heal](/ambercast/zh-cn/reference/cli/heal/)、[ambercast check](/ambercast/zh-cn/reference/cli/check/)、[审查生成的 diff](/ambercast/zh-cn/how-to/review-generated-diffs/)、[恢复 stale（已过期）产物](/ambercast/zh-cn/how-to/recover-stale-artifacts/)。
