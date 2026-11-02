---
title: レポート
description: ambercast の構造化 JSON レポートのエンベロープ、コマンドごとの結果の形、エラーの詳細、永続化の規則を示すリファレンス。
---

各コマンドは、実行のメタデータ、サマリー、エラー、コマンド固有の結果を持つ JSON のレポートを 1 つ出力できる。

## エンベロープ {#envelope}

公開レポートのスキーマのオブジェクトはすべて厳格で、未知のフィールドを拒否する。スキーマには `review` の分岐があるが、CLI に `review` コマンドはない。

| フィールド | 型と規則 |
| --- | --- |
| `schemaVersion` | リテラル `3.11` |
| `command` | `generate`、`run`、`check`、`heal`、`review` のいずれか |
| `startedAt` | `YYYY-MM-DDTHH:mm:ssZ` 形式の UTC 文字列 |
| `durationMs` | 非負の整数 |
| `summary` | 非負の整数 `total`、`passed`、`failed`、`errored`、`skipped` を持つ厳格なオブジェクト |
| `errors` | `ReportError` の配列 |
| `results` | コマンド固有の結果の配列 |
| `reportPersistence` | `run` のみ。`persisted`、`failed`、`not-attempted` のいずれか |

## 結果の形 {#result-shapes}

`results` 配列はコマンドごとに異なる。以降の節で、スキーマにだけ存在する分岐も含めて、各分岐を示す。

## generate の結果 {#generate-results}

`GenerateResult` の分岐はすべて厳格である。表の任意フィールドが、その分岐に追加できる唯一のフィールドである。

| ステータス | 必須フィールド | 任意フィールド | 禁止フィールド |
| --- | --- | --- | --- |
| `generated` | `id`, `file`, `planFile`, `dryRun: false`, `ambiguities: JSON[]`, `secrets` | `durationMs`, `aiCalls`, `warnings` | — |
| `would-generate` | `id`, `file`, `planFile`, `dryRun: true`, `ambiguities: JSON[]`, `secrets` | `durationMs`, `aiCalls`, `warnings` | — |
| `skipped-fresh` (`dryRun: true`) | `id`, `file`, `planFile`, `dryRun: true`, `secrets` | `durationMs`, `aiCalls`, `warnings` | `ambiguities` |
| `skipped-fresh` (`dryRun: false`) | `id`, `file`, `planFile`, `dryRun: false` | `durationMs`, `aiCalls` | `ambiguities`, `secrets`, `warnings` |
| `listed` | `id`, `file`, `dryRun: false` | — | `planFile`, `ambiguities`, `durationMs`, `aiCalls` |
| `failed` | `id`, `file`, `dryRun: boolean` | `durationMs`, `aiCalls` | `planFile`, `ambiguities` |
| `skipped` | `id`, `file` | — | `planFile`, `dryRun`, `ambiguities`, `durationMs`, `aiCalls` |

AI プロバイダーは、プロンプトに書かれていない前提を、任意の文字列配列 `assumptions` に列挙できる。`generated` と `would-generate` の結果では、`generate` が空白でない前提を 1 件ずつ `{ kind: 'generator-assumption', message }` として `warnings` に加える。前提によって `generate` や `heal` が止まることはない。

人が読む出力では、結果の行の直後に、2 つの空白でインデントした `warning: <message>` を表示する。前提がシークレット検出に該当した場合、ambercast はそれを `An assumption was omitted because it looked like a secret.` に置き換える。

ambercast は前提を計画（plan）に保存しない。鮮度が保たれた計画に対する再実行は、前提の警告を伴わない `skipped-fresh` を返す。前提をもう一度見るには `--force` を渡して再生成する。再生成は非決定的である。

`generated` と `would-generate` の結果では、`ambiguities` は常に `[]` である。プロバイダーの `ambiguities` は、ステップのターゲットを割り当てられないことだけを意味する。

ターゲットが 1 つの場合、ambercast は空でない `ambiguities` を含む応答を `AI_RESPONSE_INVALID` として再試行し、再試行が尽きると終了コード 3 で終わる。複数ターゲットで割り当てが未解決のままなら、従来どおり `PROMPT_AMBIGUOUS` と終了コード 2 になる。

警告の種別を閉じたユニオンとして検証する利用側には、レポート 3.11 のスキーマが必要である。

## run の結果 {#run-results}

`RunResult` の分岐はすべて厳格である。

| ステータス | 必須フィールド | 任意フィールド | 禁止フィールド |
| --- | --- | --- | --- |
| `passed` / `failed` / `error` | `id`, `file`, `planFile`, `durationMs`, `steps`, `sessions`, `explanation` | `aiCalls` | — |
| `listed` | `id`, `file` | — | `planFile`, `durationMs`, `steps`, `explanation`, `aiCalls` |
| `skipped` | `id`, `file` | — | `planFile`, `durationMs`, `steps`, `explanation`, `aiCalls` |

## check の結果 {#check-results}

`CheckResult` の分岐はすべて厳格である。

| ステータス | 必須フィールド | 任意フィールド | 禁止フィールド |
| --- | --- | --- | --- |
| `fresh`, `stale`, `orphaned-plan`, `orphaned-grounding`, `missing-plan`, `missing-grounding`, `stale-grounding`, `invalid-grounding`, `fresh-without-grounding` | `id`, `file`, `planFile`, `reason` | `groundingFile`, `artifactFile` | — |
| `invalid-artifact-name` | `id`, `file`, `artifactFile`, `reason` | — | `planFile`, `groundingFile` |
| `listed` | `id`, `file` | — | `planFile`, `reason`, `groundingFile`, `artifactFile` |
| `skipped` | `id`, `file` | — | `planFile`, `reason`, `groundingFile`, `artifactFile` |

## heal の結果 {#heal-results}

完了した `HealResult` の分岐は、`id`、`file`、`planFile`、`status: completed`、`durationMs`、`steps`、`sessions`、`explanation` をすべて必須とする。`aiCalls` は任意である。

任意の `warnings` を持てるのは `healed` の行だけで、受理した Stage 3 の候補の `assumptions` に由来する `generator-assumption` の項目を入れる。ほかの heal の結果では `warnings` を禁止する。前提が Stage 3 を失敗させることはない。

| repairOutcome | 許可される application | 許可される stopReason |
| --- | --- | --- |
| `healed` | `applied`, `preview-only`, `declined`, `not-applied-interrupted`, `apply-failed`, `partially-applied` | `settled`, `attempt-limit`, `deadline` |
| `partially-healed` | `applied`, `preview-only`, `declined`, `not-applied-interrupted`, `apply-failed`, `partially-applied` | `settled`, `attempt-limit`, `deadline` |
| `unresolved` | `no-artifact-change`, `not-eligible` | `settled`, `attempt-limit`, `deadline` |
| `no-changes-needed` | `no-artifact-change` | `settled` |
| `listed` | 識別情報のみ: `id`, `file`, `status` | 禁止: `application`, `stopReason`, `planFile`, `durationMs`, `steps`, `explanation` |
| `skipped` | 識別情報のみ: `id`, `file`, `status` | 禁止: `application`, `stopReason`, `planFile`, `durationMs`, `steps`, `explanation` |

Stage 3 が、論理的なシークレット名の集合が変わったことを理由に計画全体の候補を拒否すると、完了した結果は `stage3Rejection: { reason: "secret-set-changed", added: SecretName[], removed: SecretName[] }` を持つ。これは強い拒否である。成果物はコミットされず、候補を黙って付け替えるのではなく、同意を得て再生成する必要がある。

完了した分岐は、`repairTrace` も持てる。これは、ケースの Stage 1、Stage 2、Stage 3 の試行を順に並べた診断の配列である。各項目は厳格で、別の段階や別の結果のフィールドは使えない。

| 段階 | outcome | そのほかのフィールド |
| --- | --- | --- |
| `stage1` | `accepted`, `no-advance` | `stepId` |
| `stage1` | `not-eligible` | `stepId`, `reason`。値は `frontier-out-of-range`, `mode-none`, `trace-current`, `no-confirming-step`, `no-confirms` のいずれか |
| `stage2` | `accepted` | `stepId` |
| `stage2` | `rejected` | `stepId`, `reason`。値は `provider-error`, `response-shape`, `id-mismatch`, `secret-name-invalid`, `coverage-invalid`, `obligation-mismatch`, `literal-secret`, `no-advance`, `intent-invalid` のいずれか |
| `stage3` | `accepted` | — |
| `stage3` | `not-passing` | `firstFailureIndex` |
| `stage3` | `failed` | 任意の `code` |
| `stage3` | `secret-set-rejected` | — |

受け付けを拒否された段階は、`repairTrace` の項目を追加しない。ケースの `stopReason: "attempt-limit"` または `"deadline"` にだけ現れる。中断された作業は、完了した結果にならない。`skipped` として報告するので、`repairTrace` の項目と `stopReason` を持たない。

## 結果のステータス {#result-statuses}

ステップの結果とレビューの結果は、次の分岐を共有する。

| 分岐 | 必須フィールド | 任意フィールド |
| --- | --- | --- |
| `step` | `id`, `type: action/assert/capture/ai`, `target`, `status: passed/failed/error/skipped` | `variable`（capture のみ）、`kind: assertion/environment`、`expected`、`actual`、`screenshot`、`screenshotOmitted: secret-detected`、`observed`、`binding` |
| `observed` | `note`（固定の `OBSERVED_NOTE`）、`accessibilitySnapshot` | — |
| `review sufficient / insufficient` | `id`, `file`, `planFile`, `concerns[]` | — |
| `review skipped` | `id`, `file`, `status: skipped` | — |

ローカルでの検証を通ったあと、操作またはキャプチャーのステップは `binding: { provenance: "grounding" | "quoted-match" | "ai-proposed", confirmed: boolean, quoteWaitMs?: non-negative integer, aiProposalMs?: non-negative integer }` を持てる。`grounding` では、バインディングが以前の実行で確認済みの項目に由来するため、`confirmed` は常に `true` である。その項目を今回の実行で書いたという意味ではない。`quoted-match` と `ai-proposed` では、ケース終了時の値を示す。時間のフィールドは、その段階が実行されたときだけ現れる。それより前のバインディングの失敗は、代わりにケースのエラーとして報告する。

実行された run の結果と完了した heal の結果は、計画の各ターゲットについて `sessions` の項目を持つ。各値は `{ surface: "web", executor: { kind: "playwright", browser: "chromium" }, state }` で、`state` は `not-opened`、`closed`、`close-failed` のいずれかである。`not-opened` は、そのターゲットの起動がセッションを返さなかったことを示す。最初のステップの前に実行が止まった場合も、これに当たる。クローズに失敗しても、ケースのステータスは変わらない。

## レビューの指摘 {#review-concerns}

レビューは、見つけた問題を計画に対する指摘として報告する。

| フィールド | 型 |
| --- | --- |
| `stepId` | string |
| `concern` | string |
| `suggestion` | string |

## エラー {#errors}

レポートのエラーは、実行全体またはケース 1 つを範囲とする厳格なオブジェクトである。すべての項目が `scope`、`kind`、`code`、`message` を持つ。`hint` はどのコードでも任意で、ケースを範囲とする項目はさらに空白でない `caseId` を持つ。`details` は任意で、次の 15 個のコードにだけ存在する。

`attempts` が現れる場合、型は `Array<{ attempt: integer 1–5, code: ReportErrorCode }>` である。`SecretRef` の構文は `{{secrets.<identifier>(.<identifier>)*}}` である。

| コード | 任意の `details` の形 |
| --- | --- |
| `AGENTIC_STEP_FAILED` | `{ stepId: non-whitespace string, actions: non-negative integer, assertions: non-negative integer, passedAssertions: non-negative integer, failedAssertions: non-negative integer, targetRejections: non-negative integer, lastFailedAssertion?: { check: "text-visible" \| "element-visible" \| "text-equals" \| "url-matches" \| "element-count", expected: string } }` ケースの範囲のみ。カウンターは完了したツール呼び出しを数える。 |
| `CASE_ABORTED` | `{ reason: "run-reference-invalid" \| "run-value-missing" \| "secret-fill-incomplete" \| "agentic-no-terminal-evidence" \| "agentic-coverage-inexact" \| "agentic-proof-invalid" \| "grounding-secret-contaminated" \| "grounding-snapshot-invalid", stepId: string }` ケースの範囲のみ。`reason` の定義済みの値は 8 つである。 |
| `AI_RESPONSE_INVALID` | `{ issues: Array<{ code: instruction-coverage, element-intent, or confirms issue code \| "text-equals-self-quote" \| "invalid-json" \| "schema-mismatch" \| "secret-allowed-name-not-projected" \| "secret-conflicting-target-names", path: Array<string or non-negative integer>, stepId?: StepId }>, attempts?: ... }` `confirms` の問題コードは `confirms-unknown-step`、`confirms-not-earlier`、`confirms-not-action`、`confirms-duplicate` である。`confirms` 以外の最後の 2 つの問題コードは、常に `stepId` を持つ。 |
| `SECRET_LITERAL_REJECTED` | `{ detector: credential-prefix-sk \| credential-prefix-ghp \| credential-prefix-aws-access-key \| high-entropy-token \| embedded-secret-reference, path: non-whitespace string, attempts?: ... }` |
| `SECRET_ENV_VAR_COLLISION` | `{ envVar: non-whitespace string, refs: SecretRef[] }` `refs` は 2 件以上を持つ。 |
| `SECRET_CONSENT_REQUIRED` | `{ reason: "consent-required" \| "declined" \| "not-interactive", secrets: Array<{ name: SecretName, stepId: StepId, envVar: non-whitespace string, reason: string }> }` 内側の `reason` は任意の文字列でよい。 |
| `SECRET_SYNTAX_REJECTED` | `{ occurrences: Array<{ line: positive integer, column: positive integer, kind: "grant-line" \| "reference" }> }` |
| `BROWSER_LAUNCH_FAILED` | `{ reason: "executable-missing" \| "launch-failed", engine: non-whitespace string }` |
| `EXECUTOR_UNSUPPORTED` | `{ target: non-whitespace string, executor: non-whitespace string, reason: "surface-mismatch" \| "capability-missing", missing: UiCapability[], surface?: { target: "web", executor: non-whitespace string } }` |
| `PROMPT_AMBIGUOUS` | `{ ambiguities: integer at least 1 }` ケースの範囲のみ。 |
| `AI_EXECUTOR_UNAVAILABLE` | `{ attempts?: ... }` |
| `UNEXPECTED_CRASH` | `{ cause: { name: "Error" \| "TypeError" \| "RangeError" \| "SyntaxError" \| "ReferenceError" \| "AbortError" \| "TimeoutError" } }` |
| `FS_IO_ERROR` | `{ partiallyWritten: Array<"plan" \| "grounding"> }` ケースの範囲のみ。 |
| `PROMPT_PATH_INVALID` | `{ path: non-whitespace string, reason: "outside-test-dir" \| "not-test-md" \| "no-name" }` |
| `GROUNDING_UNRESOLVED` | `{ stepId: string, reason: "missing" \| "recoverable-miss" \| "no-candidate" \| "ambiguous" \| "proposal-rejected" \| "candidate-changed" }` 要素ステップでは、`missing` はグラウンディングの項目が存在しないことを、`recoverable-miss` は既存の項目が現在のページと合わないことを示す。 |

`AI_RESPONSE_INVALID` の問題の `code` は、次のいずれかである。

| コード | 分類 |
| --- | --- |
| `citation-whitespace-only` | 指示のカバレッジ |
| `anchor-invalid` | 指示のカバレッジ |
| `citation-checksum-mismatch` | 指示のカバレッジ |
| `criterion-id-duplicate` | 指示のカバレッジ |
| `criterion-range-duplicate` | 指示のカバレッジ |
| `criterion-order-invalid` | 指示のカバレッジ |
| `source-span-invalid` | 指示のカバレッジ |
| `source-span-whitespace-only` | 指示のカバレッジ |
| `success-criterion-missing` | 指示のカバレッジ |
| `intent-id-duplicate` | 指示のカバレッジ |
| `intent-id-missing` | 指示のカバレッジ |
| `intent-id-unknown` | 指示のカバレッジ |
| `intent-id-action` | 指示のカバレッジ |
| `intent-assertion-unsupported` | 指示のカバレッジ |
| `terminal-url-matches-forbidden` | 指示のカバレッジ |
| `verification-coverage-id-missing` | 指示のカバレッジ |
| `verification-coverage-id-unknown` | 指示のカバレッジ |
| `verification-coverage-id-action` | 指示のカバレッジ |
| `verification-coverage-index-duplicate` | 指示のカバレッジ |
| `verification-coverage-index-invalid` | 指示のカバレッジ |
| `verification-assertion-repeated` | 指示のカバレッジ |
| `intent-span-invalid` | 要素の意図 |
| `intent-span-whitespace-only` | 要素の意図 |
| `intent-citation-mismatch` | 要素の意図 |
| `quote-span-invalid` | 要素の意図 |
| `quote-text-mismatch` | 要素の意図 |
| `quote-unpaired` | 要素の意図 |
| `quote-outside-intent` | 要素の意図 |
| `quote-whitespace-only` | 要素の意図 |
| `confirms-unknown-step` | confirms |
| `confirms-not-earlier` | confirms |
| `confirms-not-action` | confirms |
| `confirms-duplicate` | confirms |
| `invalid-json` | そのほか |
| `schema-mismatch` | そのほか |
| `secret-allowed-name-not-projected` | そのほか |
| `secret-conflicting-target-names` | そのほか |
| `text-equals-self-quote` | そのほか |

`generated` と `would-generate` の結果では、`secrets` に ambercast が解決したシークレット使用の候補を挙げる。dry-run の `skipped-fresh` の結果にも含まれる。任意の `warnings` は、致命的でない方針の警告を 5 種類記録する。`secret-name-reused-across-targets`、`secret-target-changed`、`allowed-names-truncated`、`action-unconfirmed`（`stepId` を伴う）、`generator-assumption` である。これらのフィールドにより、シークレットの値を出さずに、同意に関する出力を確認できる。リスクの高い `"*"` の設定は[シークレットの同意](/ambercast/ja/reference/configuration/#secret-consent)を参照する。

## レポートの永続化 {#persistence}

レポートを永続化するのは `run` だけである。確定したエンベロープを `JSON.stringify` で直列化し、`runsDir/runId/report.json` に書く。

`reportPersistence` は、書き込みの結果を記録する。

- `persisted`: 書き込みに成功し、ディスク上の JSON が返したエンベロープと一致する。
- `failed`: 書き込みに失敗し、一部の内容も見えない。
- `not-attempted`: 書き込みを試みていない。結果が出る前にコマンドが失敗した場合も含む。

現在のスキーマのバージョンに固定されるのは、書き込み側だけである。ビューアーは、3.x のレポートであれば寛容に読む。次の例は、コマンドごとのエンベロープを 1 つずつ示す。

```json
{"schemaVersion":"3.11","command":"generate","startedAt":"2026-09-06T00:00:00Z","durationMs":120,"summary":{"total":1,"passed":1,"failed":0,"errored":0,"skipped":0},"results":[{"id":"checkout.test.md","file":"checkout.test.md","planFile":"checkout.ambercast.plan.json","status":"generated","dryRun":false,"ambiguities":[],"secrets":[{"name":"LOGIN_PASSWORD","stepId":"fill-password","envVar":"AMBERCAST_SECRET_LOGIN_PASSWORD","allowed":true,"selectionSource":"target-slug"}],"durationMs":120,"aiCalls":1}],"errors":[]}
```
```json
{"schemaVersion":"3.11","command":"run","startedAt":"2026-09-06T00:00:00Z","durationMs":0,"summary":{"total":0,"passed":0,"failed":0,"errored":0,"skipped":0},"results":[],"errors":[],"reportPersistence":"not-attempted"}
```
```json
{"schemaVersion":"3.11","command":"check","startedAt":"2026-09-06T00:00:00Z","durationMs":0,"summary":{"total":0,"passed":0,"failed":0,"errored":0,"skipped":0},"results":[],"errors":[]}
```
```json
{"schemaVersion":"3.11","command":"heal","startedAt":"2026-09-06T00:00:00Z","durationMs":0,"summary":{"total":0,"passed":0,"failed":0,"errored":0,"skipped":0},"results":[],"errors":[]}
```

## 永続化の互換アンカー {#report-persistence}

旧来のアンカーを残すための節である。内容は[レポートの永続化](/ambercast/ja/reference/reports/#persistence)を参照する。

## 関連項目 {#see-also}

- [エラーコード](/ambercast/ja/reference/error-codes/#code-vocabulary)
- [終了コード](/ambercast/ja/reference/exit-codes/#exit-code-table)
- [ファイルレイアウト](/ambercast/ja/reference/file-layout/#run-artifacts)
- [ambercast run](/ambercast/ja/reference/cli/run/#report-and-exits)
