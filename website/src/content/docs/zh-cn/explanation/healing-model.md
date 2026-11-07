---
title: 自愈模型
description: 说明界面变化导致测试失败时，ambercast 会自动修复到什么程度，以及什么时候交给人工判断。
---

修改应用的 UI 后，原本通过的测试可能突然失败。按钮文案或元素位置变化是常见原因。

ambercast 的自愈功能会自动排查失败原因并尝试修复测试，但不会无限制运行。每个用例都有时间上限，执行计划和定位缓存文件的改动只在人工确认后写入。

## 安全前提 {#safe-precondition}

自愈会实际访问正在运行的应用，反复尝试找到可行的修复方案。如果目标应用无法在多次访问后恢复到同一状态，反复尝试可能堆积数据或损坏应用状态。

因此，除非配置将目标声明为 `healReplayIsolation: "idempotent"`，ambercast 会拒绝自愈，并在打开浏览器或调用 AI 之前就停止。省略该声明时，默认值是更安全的 `stateful`，这种情况下自愈同样会被拒绝。

CI 中没有人实时查看结果，因此除非启用 `ci.heal` 配置，自愈不会运行。仅列出可修复项的模式不会对应用做出真实改动，因此不受此限制。

相关链接：[ambercast heal](/ambercast/zh-cn/reference/cli/heal/#preconditions)、[配置](/ambercast/zh-cn/reference/configuration/#targets)、[CI 中的确定性](/ambercast/zh-cn/explanation/determinism-in-ci/#heal-refusal)

## 三段式递进 {#three-stages}

自愈首先用不调用 AI 的普通回放重新执行测试，确认失败是否真实重现。如果没有重现，自愈到此为止，不做任何修复。

失败重现后，自愈会启用解析并重新测量。重新测量后所有 step 都通过时，自愈直接结束，不做修复。只有仍有失败且可以开始修复时，才会进入以下三个阶段。

<figure class="ac-flow" aria-label="heal 的三段式递进。基线回放没有失败时，自愈直接结束，不做修复。出现失败后，启用解析并重新测量，仅在仍有失败且可以开始修复时继续。重新测量后所有 step 都通过时，同样不做修复。阶段 1 修复最初失败位置的定位缓存。失败点未推进时，阶段 2 修复单个 step 或尾部。仍有失败且未超期限时，阶段 3 重建整份执行计划；超过期限后不再开始新的修复。执行计划和定位缓存只在确认后写入。">
<div class="ac-flow-node"><div class="ac-flow-head"><span class="ac-flow-num">BASELINE</span><span class="ac-flow-chip ac-flow-chip-replay">不调用 AI</span></div><p class="ac-flow-title">按失败关闭的方式回放基线</p><p class="ac-flow-note">没有失败则自愈直接结束，不做修复</p></div>
<div class="ac-flow-link"><svg aria-hidden="true" viewbox="0 0 28 52" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2v46M8 42l6 6 6-6"></path></svg><span class="ac-flow-cond"><b>出现失败后</b>，启用解析并重新测量，仅在仍有失败且可以开始修复时继续</span></div>
<div class="ac-flow-node ac-flow-stage"><div class="ac-flow-head"><span class="ac-flow-num">STAGE 1</span><span class="ac-flow-chip ac-flow-chip-ai">可能调用 AI</span></div><p class="ac-flow-title">修复定位缓存</p><div class="ac-flow-meter ac-flow-meter-s"><div class="ac-flow-track"><div class="ac-flow-fill"></div></div><span>最初失败的位置</span></div><p class="ac-flow-body">自愈重新定位失败点的元素。位置推进后，记为重新建立定位缓存或 AI 重新追踪。</p></div>
<div class="ac-flow-link ac-flow-link-stage"><svg aria-hidden="true" viewbox="0 0 28 52" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2v46M8 42l6 6 6-6"></path></svg><span class="ac-flow-cond"><b>失败点未推进时</b></span></div>
<div class="ac-flow-node ac-flow-stage"><div class="ac-flow-head"><span class="ac-flow-num">STAGE 2</span><span class="ac-flow-chip ac-flow-chip-ai">可能调用 AI</span></div><p class="ac-flow-title">修复单个 step 或其后全部</p><div class="ac-flow-meter ac-flow-meter-m"><div class="ac-flow-track"><div class="ac-flow-fill"></div></div><span>单个 step 或尾部</span></div><p class="ac-flow-body">自愈修复失败的那个 step，或连同其后的全部 step 一起修复。</p></div>
<div class="ac-flow-link ac-flow-link-stage"><svg aria-hidden="true" viewbox="0 0 28 52" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2v46M8 42l6 6 6-6"></path></svg><span class="ac-flow-cond"><b>仍有失败且未超期限时</b></span></div>
<div class="ac-flow-node ac-flow-stage"><div class="ac-flow-head"><span class="ac-flow-num">STAGE 3</span><span class="ac-flow-chip ac-flow-chip-ai">可能调用 AI</span></div><p class="ac-flow-title">重建整份执行计划</p><div class="ac-flow-meter ac-flow-meter-l"><div class="ac-flow-track"><div class="ac-flow-fill"></div></div><span>整份执行计划</span></div><p class="ac-flow-body">自愈解析 AI executor 并调用 generate，重建整份执行计划。</p></div>
</figure>

依次尝试从轻量到重量级的修复，是为了避免不必要的 AI 调用与开销。

相关链接：[ambercast heal](/ambercast/zh-cn/reference/cli/heal/#repair-model)、[步骤](/ambercast/zh-cn/spec/steps/)、[回放与定位缓存](/ambercast/zh-cn/explanation/replay-and-grounding/#drift-handoff)

## 限制修复次数与时长的预算 {#repair-budgets}

可以设置两种上限，防止自愈无限期尝试下去。

- `heal.maxStepRepairs`：限制 STAGE 1、STAGE 2 修复中调用 AI 的次数，在调用发生时计数。STAGE 3 仍会调用 AI，但不计入该上限。取正整数；省略时不设上限。
- `heal.caseTimeoutMs`：单个用例的自愈可用时长的上限，单位毫秒。每个用例的期限在该用例首次回放开始前确定。选择多个测试时，整条命令的耗时可能超过该值。超过该期限后不再开始新的修复，但不会强制中止已在进行的工作，也不会废弃已生成的修复。

相关链接：[配置](/ambercast/zh-cn/reference/configuration/#heal)、[ambercast heal](/ambercast/zh-cn/reference/cli/heal/#limits)

## 执行计划和定位缓存在确认后写入 {#confirmation-and-writes}

自愈找到修复方案后，执行计划和定位缓存文件此时仍未改动。方案会先存入临时位置，只有在回答 CLI 的确认提示后，或通过 `--yes` 预先批准后，才会写入实际文件。确认之前，请先审查提议的改动。

这样一来，写入发生之前就能确认哪个文件会如何改变。

:::caution
加上 `--dry-run` 后不会请求确认，也不会提交执行计划或定位缓存的改动，但回放尝试本身仍可能在 runs 目录下写入证据。`--yes` 只是预先批准 CLI 的确认提示，本身并不代表用户已审查并批准改动。

通过 agent 执行且既没有 `--yes` 也无法交互式确认时，ambercast 会直接以错误停止，不会静默写入。

:::

相关链接：[ambercast heal](/ambercast/zh-cn/reference/cli/heal/#confirmation)、[操作契约](/ambercast/zh-cn/agents/operating-contract/#command-contract)、[审查生成的 diff](/ambercast/zh-cn/how-to/review-generated-diffs/)
