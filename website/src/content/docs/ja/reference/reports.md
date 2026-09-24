---
title: レポート
description: ambercast が出力する構造化レポートのスキーマおよび各コマンド固有の結果形式に関するリファレンスです。
---

ambercast が出力するすべての構造化フィールドを定義します。各コマンドの実行結果は、共通のエンベロープ（外枠）に格納され、厳格なスキーマを持つ JSON 形式で表現されます。

## エンベロープ {#envelope}

| フィールド | 型および制約 |
| --- | --- |
| `schemaVersion` | リテラル `3.7` |
| `command` | `generate`、`run`、`check`、`heal`、または `review` |
| `startedAt` | UTC 形式の `YYYY-MM-DDTHH:mm:ssZ` 文字列 |
| `durationMs` | 非負整数 |
| `summary` | 厳格なオブジェクト（`total`、`passed`、`failed`、`errored`、`skipped` の各非負整数） |
| `errors` | `ReportError` の配列 |
| `results` | コマンド固有の結果配列 |
| `reportPersistence` | `run` のみ: `persisted`、`failed`、または `not-attempted` |

公開レポートスキーマ内のオブジェクトは厳格（strict）に定義されており、未知のフィールドを拒否します。

`review` ブランチはスキーマ内に定義されていますが、実装された CLI に `review` コマンドは提供されていません。

## 結果の形状 {#result-shapes}

エンベロープの `results` 配列はコマンドごとに固有です。以降の各セクションで、実装されているブランチおよびスキーマ上のみに存在するブランチの構造を規定します。

## generate コマンドの結果 {#generate-results}

`GenerateResult` の各ブランチは厳格（strict）です。下表の任意メトリクスは、示されたブランチに限り追加できます。

| ステータス | 必須フィールド | 任意フィールド | ブランチで禁止されるフィールド |
| --- | --- | --- | --- |
| `generated` | `id`, `file`, `planFile`, `dryRun: false`, `ambiguities: JSON[]`, `secrets` | `durationMs`, `aiCalls`, `warnings` | — |
| `would-generate` | `id`, `file`, `planFile`, `dryRun: true`, `ambiguities: JSON[]`, `secrets` | `durationMs`, `aiCalls`, `warnings` | — |
| `skipped-fresh`（`dryRun: true`） | `id`, `file`, `planFile`, `dryRun: true`, `secrets` | `durationMs`, `aiCalls`, `warnings` | `ambiguities` |
| `skipped-fresh`（`dryRun: false`） | `id`, `file`, `planFile`, `dryRun: false` | `durationMs`, `aiCalls` | `ambiguities`, `secrets`, `warnings` |
| `listed` | `id`, `file`, `dryRun: false` | — | `planFile`, `ambiguities`, `durationMs`, `aiCalls` |
| `failed` | `id`, `file`, `dryRun: boolean` | `durationMs`, `aiCalls` | `planFile`, `ambiguities` |
| `skipped` | `id`, `file` | — | `planFile`, `dryRun`, `ambiguities`, `durationMs`, `aiCalls` |

## run コマンドの結果 {#run-results}

`RunResult` の各ブランチは厳格（strict）です。

| ステータス | 必須フィールド | 任意フィールド | ブランチで禁止されるフィールド |
| --- | --- | --- | --- |
| `passed` / `failed` / `error` | `id`, `file`, `planFile`, `durationMs`, `steps`, `explanation` | `aiCalls` | — |
| `listed` | `id`, `file` | — | `planFile`, `durationMs`, `steps`, `explanation`, `aiCalls` |
| `skipped` | `id`, `file` | — | `planFile`, `durationMs`, `steps`, `explanation`, `aiCalls` |

## check コマンドの結果 {#check-results}

`CheckResult` の各ブランチは厳格（strict）です。

| ステータス | 必須フィールド | オプションフィールド | ブランチで禁止されるフィールド |
| --- | --- | --- | --- |
| `fresh`, `stale`（古くなった状態）, `orphaned-plan`, `orphaned-grounding`, `missing-plan`, `missing-grounding`, `stale-grounding`, `invalid-grounding`, `fresh-without-grounding` | `id`, `file`, `planFile`, `reason` | `groundingFile`, `artifactFile` | — |
| `invalid-artifact-name` | `id`, `file`, `artifactFile`, `reason` | — | `planFile`, `groundingFile` |
| `listed` | `id`, `file` | — | `planFile`, `reason`, `groundingFile`, `artifactFile` |
| `skipped` | `id`, `file` | — | `planFile`, `reason`, `groundingFile`, `artifactFile` |

## heal コマンドの結果 {#heal-results}

`HealResult` において、`completed` の各ブランチはすべて `id`、`file`、`planFile`、`status: completed`、`durationMs`、`steps`、および `explanation` を必須とし、`aiCalls` は任意です。

| repairOutcome | 許可される application | 許可される stopReason |
| --- | --- | --- |
| `healed` | `applied`, `preview-only`, `declined`, `not-applied-interrupted`, `apply-failed`, `partially-applied` | `settled`, `attempt-limit`, `deadline` |
| `partially-healed` | `applied`, `preview-only`, `declined`, `not-applied-interrupted`, `apply-failed`, `partially-applied` | `settled`, `attempt-limit`, `deadline` |
| `unresolved` | `no-artifact-change`, `not-eligible` | `settled`, `attempt-limit`, `deadline` |
| `no-changes-needed` | `no-artifact-change` | `settled` |
| `listed` | 識別情報のみ: `id`, `file`, `status` | 禁止: `application`, `stopReason`, `planFile`, `durationMs`, `steps`, `explanation` |
| `skipped` | 識別情報のみ: `id`, `file`, `status` | 禁止: `application`, `stopReason`, `planFile`, `durationMs`, `steps`, `explanation` |

Stage 3 が論理シークレット名セットの変更を理由に完全な Plan 候補を拒否した場合、完了結果は `stage3Rejection: { reason: "secret-set-changed", added: SecretName[], removed: SecretName[] }` となります。これはハード拒否です。アーティファクトはコミットされず、候補を黙って再帰属させるのではなく、ユーザーは同意を得て再生成する必要があります。

すべての completed ブランチには、ケースごとの Stage 1、Stage 2、Stage 3 の試行と結果を順序どおりに投影する診断配列 `repairTrace` を任意で含められます。Stage 1 のエントリは `{ stage: "stage1", stepId, outcome: "accepted" | "no-advance" | "not-eligible" }`、Stage 2 のエントリは `{ stage: "stage2", stepId, outcome: "accepted" }` または `{ stage: "stage2", stepId, outcome: "rejected", reason }`（`reason` は `provider-error`、`response-shape`、`id-mismatch`、`secret-name-invalid`、`coverage-invalid`、`obligation-mismatch`、`literal-secret`、`no-advance` のいずれか）、Stage 3 のエントリは `{ stage: "stage3", outcome: "accepted" }`、`{ stage: "stage3", outcome: "not-passing", firstFailureIndex }`、`{ stage: "stage3", outcome: "failed", code? }`、または `{ stage: "stage3", outcome: "secret-set-rejected" }` です。各エントリは厳格であり、別の stage や outcome に属するフィールドは許可されません。

admission-denied フェーズは `repairTrace` エントリを追加しません。そのケースの `stopReason: "attempt-limit" | "deadline"` としてのみ表れます。中断（interrupted）された作業は completed 結果に一切到達せず、代わりに `skipped` として報告されるため、`repairTrace` エントリも `stopReason` も持ちません。

## 結果ステータスと共通構造 {#result-statuses}

ステップおよび review 結果で共有される構造です。

| ブランチ | 必須フィールド | オプションフィールド |
| --- | --- | --- |
| `step` | `id`, `type: action/assert/capture/ai`, `status: passed/failed/error/skipped` | `kind: assertion/environment`, `expected`, `actual`, `screenshot`, `screenshotOmitted: secret-detected`, `observed` |
| `observed` | `note`: 固定値 `OBSERVED_NOTE`, `accessibilitySnapshot` | — |
| `review sufficient / insufficient` | `id`, `file`, `planFile`, `concerns[]` | — |
| `review skipped` | `id`, `file`, `status: skipped` | `concerns`, `planFile` |

## review の懸念事項 {#review-concerns}

`ReviewConcern` のフィールド定義です。

| フィールド | 型 |
| --- | --- |
| `stepId` | `string` |
| `concern` | `string` |
| `suggestion` | `string` |

## エラー {#errors}

`ReportError` は、コマンド全体または個々のテストケースにスコープされた厳格なオブジェクトです。すべてのエントリに `scope`、`kind`、`code`、`message` があり、`hint` はすべてのコードで任意です。case スコープのエントリには、空白以外の文字を含む `caseId` もあります。`details` は任意で、次の12コードにのみ存在します。記載されている `attempts` はすべて `Array<{ attempt: 1〜5 の整数, code: ReportErrorCode }>` であり、`SecretRef` は `{{secrets.<identifier>(.<identifier>)*}}` 構文です。

| コード | 任意の `details` 形状 |
| --- | --- |
| `AI_RESPONSE_INVALID` | `{ issues: Array<{ code: 任意の instruction-coverage issue code、"invalid-json"、または "schema-mismatch"; path: Array<string または非負整数>; stepId?: StepId }>, attempts?: ... }` |
| `SECRET_LITERAL_REJECTED` | `{ detector: credential-prefix-sk、credential-prefix-ghp、credential-prefix-aws-access-key、high-entropy-token、または embedded-secret-reference; path: 空白以外の文字列; attempts?: ... }` |
| `SECRET_ENV_VAR_COLLISION` | `{ envVar: 空白以外の文字列, refs: SecretRef[] }` |
| `SECRET_CONSENT_REQUIRED` | `{ reason: "consent-required", "declined", または "not-interactive"; secrets: Array<{ name: SecretName, stepId: StepId, envVar: 空白以外の文字列, reason: 空白以外の文字列 }> }` |
| `SECRET_SYNTAX_REJECTED` | `{ occurrences: Array<{ line: 正の整数, column: 正の整数, kind: "grant-line" または "reference" }> }` |
| `BROWSER_LAUNCH_FAILED` | `{ reason: "executable-missing"、"executor-unregistered"、または "launch-failed"; engine: 空白以外の文字列 }` |
| `EXECUTOR_UNSUPPORTED` | `{ target: 空白以外の文字列, executor: 空白以外の文字列, reason: "surface-mismatch" または "capability-missing", missing: UiCapability[], surface?: { target: "web", executor: 空白以外の文字列 } }` |
| `AI_EXECUTOR_UNAVAILABLE` | `{ attempts?: ... }` |
| `UNEXPECTED_CRASH` | `{ cause: { name: "Error"、"TypeError"、"RangeError"、"SyntaxError"、"ReferenceError"、"AbortError"、または "TimeoutError" } }` |
| `FS_IO_ERROR` | case スコープのみ: `{ partiallyWritten: Array<"plan" または "grounding"> }` |
| `PROMPT_PATH_INVALID` | `{ path: 空白以外の文字列, reason: "outside-test-dir"、"not-test-md"、または "no-name" }` |
| `GROUNDING_UNRESOLVED` | `{ stepId: string, reason: "missing" または "recoverable-miss" }` |

`generated` と `would-generate` の結果では、`secrets` が解決済みの候補シークレット使用を示し、dry run の `skipped-fresh` 結果にも含まれます。任意の `warnings` は、高リスクな `secrets.allow: "*"` 設定など、致命的でないポリシー警告を記録します。これらのフィールドにより、シークレット値を公開せずに同意関連の出力を観測できます。

## レポートの永続化 {#persistence}

レポートの永続化を試行するのは `run` コマンドのみです。確定した永続化エンベロープを `JSON.stringify` して、`runsDir/runId/report.json` に書き込みます。

`reportPersistence` フィールドの状態は以下のとおりです。

- `persisted`: ディスク上の JSON が返却されたエンベロープと一致する書き込みが成功したことを示します。
- `failed`: 書き込みが失敗し、部分的なファイル内容が外部から見えない状態を示します。
- `not-attempted`: 結果が得られる前にコマンドが失敗した場合など、書き込みが一度も試行されなかった場合に適用されます。

現行スキーマ版に固定されるのは書き込み側のみです。viewer は 3.x のレポートをすべて寛容に読み取ります。

```json
{"schemaVersion":"3.7","command":"generate","startedAt":"2026-09-06T00:00:00Z","durationMs":120,"summary":{"total":1,"passed":1,"failed":0,"errored":0,"skipped":0},"results":[{"id":"checkout.test.md","file":"checkout.test.md","planFile":"checkout.ambercast.plan.json","status":"generated","dryRun":false,"ambiguities":[],"secrets":[{"name":"LOGIN_PASSWORD","stepId":"fill-password","envVar":"AMBERCAST_SECRET_LOGIN_PASSWORD","allowed":true,"selectionSource":"target-slug"}],"durationMs":120,"aiCalls":1}],"errors":[]}
```

```json
{"schemaVersion":"3.7","command":"run","startedAt":"2026-09-06T00:00:00Z","durationMs":0,"summary":{"total":0,"passed":0,"failed":0,"errored":0,"skipped":0},"results":[],"errors":[],"reportPersistence":"not-attempted"}
```

```json
{"schemaVersion":"3.7","command":"check","startedAt":"2026-09-06T00:00:00Z","durationMs":0,"summary":{"total":0,"passed":0,"failed":0,"errored":0,"skipped":0},"results":[],"errors":[]}
```

```json
{"schemaVersion":"3.7","command":"heal","startedAt":"2026-09-06T00:00:00Z","durationMs":0,"summary":{"total":0,"passed":0,"failed":0,"errored":0,"skipped":0},"results":[],"errors":[]}
```

## 永続化の互換性リンク {#report-persistence}

このセクションは以前のアンカーとの後方互換性を維持するためのものです。永続化の仕様については [レポート](/ambercast/ja/reference/reports/#persistence) を参照してください。

関連情報: [エラーコード](/ambercast/ja/reference/error-codes/#code-vocabulary)、[終了コード](/ambercast/ja/reference/exit-codes/#exit-code-table)、[ファイルレイアウト](/ambercast/ja/reference/file-layout/#run-artifacts)、[ambercast run](/ambercast/ja/reference/cli/run/#report-and-exits)。
