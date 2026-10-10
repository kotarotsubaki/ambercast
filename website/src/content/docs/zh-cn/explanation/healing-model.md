---
title: 自愈模型
description: 说明界面变化导致测试失败时，ambercast 会自动修复到什么程度，以及什么时候交给人工判断。
---

修改应用的 UI 后，原本通过的测试可能突然失败。按钮文案或元素位置变化是常见原因。

ambercast 的自愈功能会自动排查失败原因并尝试修复测试，但不会无限制运行：每次运行都有时间上限，写入文件前必须经过人工确认。

## 安全前提 {#safe-precondition}

自愈会实际访问正在运行的应用，反复尝试找到可行的修复方案。如果目标应用无法在多次访问后恢复到同一状态，反复尝试可能堆积数据或损坏应用状态。

因此，除非配置将目标声明为 `healReplayIsolation: "idempotent"`，ambercast 会拒绝自愈，并在打开浏览器或调用 AI 之前就停止。省略该声明时，默认值是更安全的 `stateful`，这种情况下自愈同样会被拒绝。

CI 中没有人实时查看结果，因此除非启用 `ci.heal` 配置，自愈不会运行。仅列出可修复项的模式不会对应用做出真实改动，因此不受此限制。

相关链接：[ambercast heal](/ambercast/zh-cn/reference/cli/heal/#preconditions)、[配置](/ambercast/zh-cn/reference/configuration/#targets)、[CI 中的确定性](/ambercast/zh-cn/explanation/determinism-in-ci/#heal-refusal)

## 三段式递进 {#three-stages}

自愈首先用不调用 AI 的普通回放重新执行测试，确认失败是否真实重现。如果没有重现，自愈到此为止，不做任何修复。只有重现的失败才会进入以下三个阶段。

<div class="heal-stages">
<style>
.heal-stages {
  --ground: #FAF6F0; --surface: #FFFDFA; --line: #E2D9CC; --text: #27211C; --muted: #766B60;
  --amber: #A65C1F; --amber-soft: #FCF5EB; --verdigris: #2E7D5B; --verdigris-soft: rgba(46, 125, 91, .08);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .heal-stages {
    --ground: #181310; --surface: #27211C; --line: #3B332C; --text: #F1EBE2; --muted: #9E9184;
    --amber: #DB9140; --amber-soft: rgba(219,145,64,.14); --verdigris: #7FC8A9; --verdigris-soft: rgba(127,200,169,.12);
  }
}
:root[data-theme="dark"] .heal-stages {
  --ground: #181310; --surface: #27211C; --line: #3B332C; --text: #F1EBE2; --muted: #9E9184;
  --amber: #DB9140; --amber-soft: rgba(219,145,64,.14); --verdigris: #7FC8A9; --verdigris-soft: rgba(127,200,169,.12);
}
.heal-stages { margin: 1.5rem 0; }
.heal-stages figure { margin: 0 auto; max-width: 560px; display: grid; }
.heal-stages .node { border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; background: var(--surface); display: grid; gap: 8px; }
.heal-stages .node.stage { border-color: var(--amber); }
.heal-stages .top { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 12px; }
.heal-stages .num { font: 600 11.5px/1 ui-monospace, "JetBrains Mono", monospace; letter-spacing: .08em; color: var(--muted); }
.heal-stages .stage .num { color: var(--amber); }
.heal-stages h3 { margin: 0; font: 700 16px/1.35 system-ui, "Noto Sans JP", sans-serif; letter-spacing: -.01em; color: var(--text); }
.heal-stages p { margin: 0; color: var(--text); }
.heal-stages .chip { display: inline-flex; align-items: center; gap: 6px; font: 500 11px/1 ui-monospace, monospace; letter-spacing: .04em; padding: 5px 8px; border-radius: 999px; border: 1px solid currentColor; white-space: nowrap; }
.heal-stages .chip::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.heal-stages .chip.ai { color: var(--amber); background: var(--amber-soft); }
.heal-stages .chip.replay { color: var(--verdigris); background: var(--verdigris-soft); }
.heal-stages .scope { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 10px; }
.heal-stages .track { height: 6px; border-radius: 3px; background: var(--line); overflow: hidden; }
.heal-stages .fill { height: 100%; background: var(--amber); }
.heal-stages .scope span { font: 500 11px/1.3 ui-monospace, monospace; color: var(--muted); white-space: nowrap; }
.heal-stages .aside { font-size: 13px; color: var(--muted); }
.heal-stages .link { display: grid; grid-template-columns: 28px 1fr; align-items: center; gap: 10px; padding-left: 18px; min-height: 56px; }
.heal-stages .link svg { width: 28px; height: 44px; color: var(--muted); }
.heal-stages .link.up svg { color: var(--amber); }
.heal-stages .link span { font-size: 13px; color: var(--muted); }
.heal-stages .link b { color: var(--text); font-weight: 700; }
@media (max-width: 420px) { .heal-stages .scope { grid-template-columns: 1fr; gap: 6px; } }
</style>
<figure aria-label="heal 的三段式递进。基线回放失败则进入阶段 1；阶段 1 的失败点未推进则进入阶段 2；期限前仍有失败则进入阶段 3">

<div class="node"><div class="top"><span class="num">BASELINE</span><span class="chip replay">不调用 AI</span></div><h3>按失败关闭的方式回放基线</h3><p class="aside">没有失败则自愈直接结束，不做修复</p></div>

<div class="link" aria-hidden="true"><svg viewBox="0 0 28 52" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2v46M8 42l6 6 6-6"></path></svg><span><b>出现失败后</b>，启用解析并重新测量</span></div>

<div class="node stage"><div class="top"><span class="num">STAGE 1</span><span class="chip ai">可能调用 AI</span></div><h3>修复定位缓存</h3><div class="scope"><div class="track"><div class="fill" style="width:22%"></div></div><span>最初失败的位置</span></div><p>自愈重新定位失败点的元素。位置推进后，记为重新建立定位缓存或 AI 重新追踪。</p></div>

<div class="link up" aria-hidden="true"><svg viewBox="0 0 28 52" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2v46M8 42l6 6 6-6"></path></svg><span><b>失败点未推进时</b></span></div>

<div class="node stage"><div class="top"><span class="num">STAGE 2</span><span class="chip ai">可能调用 AI</span></div><h3>修复单个 step 或其后全部</h3><div class="scope"><div class="track"><div class="fill" style="width:55%"></div></div><span>单个 step 或尾部</span></div><p>自愈修复失败的那个 step，或连同其后的全部 step 一起修复。</p></div>

<div class="link up" aria-hidden="true"><svg viewBox="0 0 28 52" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2v46M8 42l6 6 6-6"></path></svg><span><b>仍有失败且未超期限时</b></span></div>

<div class="node stage"><div class="top"><span class="num">STAGE 3</span><span class="chip ai">可能调用 AI</span></div><h3>重建整份执行计划</h3><div class="scope"><div class="track"><div class="fill" style="width:100%"></div></div><span>整份执行计划</span></div><p>自愈解析 AI executor 并调用 generate，重建整份执行计划。</p></div>

</figure>
</div>

依次尝试从轻量到重量级的修复，是为了避免不必要的 AI 调用与开销。

相关链接：[ambercast heal](/ambercast/zh-cn/reference/cli/heal/#repair-model)、[步骤](/ambercast/zh-cn/spec/steps/)、[重放与定位缓存](/ambercast/zh-cn/explanation/replay-and-grounding/#drift-handoff)

## 限制修复次数与时长的预算 {#repair-budgets}

可以设置两种上限，防止自愈无限期尝试下去。

- `heal.maxStepRepairs`：限制 STAGE 1、STAGE 2 修复中调用 AI 的次数，在调用发生时计数。STAGE 3 仍会调用 AI，但不计入该上限。取正整数；省略时不设上限。
- `heal.caseTimeoutMs`：整次自愈可用时长的上限，单位毫秒，在首次回放开始前就已确定。超过该期限后不再开始新的修复，但不会强制中止已在进行的工作，也不会废弃已生成的修复。

相关链接：[配置](/ambercast/zh-cn/reference/configuration/#heal)、[ambercast heal](/ambercast/zh-cn/reference/cli/heal/#limits)

## 写入前必须确认 {#confirmation-and-writes}

自愈找到修复方案后，项目文件此时仍未发生任何改动。方案会先存入临时位置，只有在用户查看并批准后，才会写入实际文件。

这样一来，写入发生之前就能确认哪个文件会如何改变。

:::caution
加上 `--dry-run` 后不会请求确认，也不会提交执行计划或定位缓存的改动，但回放尝试本身仍可能在 runs 目录下写入证据。`--yes` 只是预先批准 CLI 的确认提示，本身并不代表用户已审查并批准改动。

通过 agent 执行且既没有 `--yes` 也无法交互式确认时，ambercast 会直接以错误停止，不会静默写入。

:::

相关链接：[ambercast heal](/ambercast/zh-cn/reference/cli/heal/#confirmation)、[操作契约](/ambercast/zh-cn/agents/operating-contract/#command-contract)、[审查生成的 diff](/ambercast/zh-cn/how-to/review-generated-diffs/)
