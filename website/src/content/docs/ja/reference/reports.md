---
title: レポート
description: ambercast の構造化 JSON レポートのエンベロープ、コマンドごとの結果の形、エラーの詳細、永続化の規則を示すリファレンス。
---

各コマンドは、実行のメタデータ、サマリー、エラー、コマンド固有の結果を持つ JSON のレポートを 1 つ出力できる。

## エンベロープ {#envelope}

公開レポートのスキーマのオブジェクトはすべて厳格で、未知のフィールドを拒否する。スキーマには `review` の分岐があるが、CLI に `review` コマンドはない。

| フィールド | 型と規則 |
| --- | --- |
| `schemaVersion` | リテラル `3.12` |
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
| `passed` / `failed` / `error` | `id`, `file`, `planFile`, `durationMs`, `steps`, `sessions`, `explanation` | `aiCalls`, `replayReadiness`, `warnings` | — |
| `listed` | `id`, `file` | — | `planFile`, `durationMs`, `steps`, `explanation`, `aiCalls` |
| `skipped` | `id`, `file` | — | `planFile`, `durationMs`, `steps`, `explanation`, `aiCalls` |

`run` は、有効で鮮度が保たれた計画を得たケースに `replayReadiness` を出す。`failed` と `error` のケースも対象である。計画を得る前に終了したケースと `heal` の行には出さない。

`ready` は、AI なしの再生に必要な項目がグラウンディングファイルに揃っている状態である。画面が変わって項目が合わなくなる場合は、この判定の対象外である。対象は click、press、fill、fill-secret、capture、ai のステップで、対象がない計画は `ready` になる。

| `status` | ほかのフィールド |
| --- | --- |
| `ready` | なし |
| `not-ready` | `reason`: `grounding-missing`、`grounding-invalid`、`grounding-stale`、`grounding-unreadable` のいずれか |
| `not-ready` | `reason: 'steps-unresolved'` と、計画の順に並ぶ空でない `steps` 配列 |

`steps` の各項目は `{ id, reason }` である。`reason` は、項目がない `no-entry`、種類や意図が合わない `entry-mismatch`、AI ステップの記録が再生に必要な検証を含まない `trace-uncovered` のいずれかである。

判定は、書き戻しの処理後にファイルを読み直した内容を使う。`not-ready` で、保存すべき変更を書き戻しの許可がないため保存しなかった場合だけ、`unsavedReason: 'write-back-not-allowed'` が付く。書込みの失敗ではこの項目を付けず、ケースのエラーで伝える。

`replayReadiness` はスキーマ上任意である。この項目がない 3.11 以前のレポートも読める。準備状態によってケースの合否や終了コードは変わらない。

### 操作前から成り立つ確認の警告 {#assertion-warnings}

`run` の `warnings` は、操作前から成り立っていた確認を `{ kind: 'assert-held-before-actions', stepId }` で示す。`stepId` は、実行時にも pass した assert の ID である。この確認は、前の確認から今回の確認までに行った一連の操作の効果を確かめていない可能性がある。

警告自体は合否や終了コードを変えず、pass した確認は pass のままである。確認の質を上げるには、操作後にだけ現れる文言など、操作の効果が現れて初めて成り立つ内容を書く。[プロンプトの作成例](/ambercast/ja/how-to/write-effective-prompts/#quote-new-text)も参照できる。

判定の単位は、連続する assert のブロックである。区間は直前の確認ブロックの終わりから次の確認ブロックの終わりまでで、最初の区間はケースの先頭から始まる。capture は確認ブロックを区切るが、操作には数えない。

操作として数えるのは click・press・fill・fill-secret・navigate と ai step である。区間に操作があれば、ambercast は最初の操作の前に、末尾の確認ブロックの assert を各1回だけ評価する。

対象は text-visible・element-visible・text-equals・url-matches・element-count である。AI 内部の確認と、操作を含まない区間の確認は対象外である。

観測は読み取りだけを行う。操作・AI 呼び出し・event・保存は変更せず、追加もしない。対象の session が未起動なら観測せず、観測のための起動は行わない。

観測できなかった場合や、変数展開後の期待値が実行時と異なる場合は警告しない。

`--resolve` の有無で判定は変わらない。heal 内の再生では観測せず、heal の行にこの警告は出ない。heal の `healed` 行が持つ `generator-assumption` の警告は別のものである。

有効で最新の計画を得たケースには `warnings` があり、警告がなければ空配列になる。途中で failed・error になったケースにも、それまでに pass した確認の警告が計画順に残る。計画を得る前に終了したケースでは省略する。

schema 上の `warnings` は optional である。`warnings` を持たない旧版の report も引き続き読める。人向けの出力では、ケースの行の下に警告を1件1行で表示し、再生準備の案内があればその前に置く。

```text
  warning: <stepId>: this assertion already held before the preceding actions ran, so it may not verify their effect
```

警告には次の限界がある。

- 同じページへの再移動など、状態が変わらないことを確かめる有効な確認にも警告が出る。
- 区間の最初の操作の前だけを調べる。区間の途中で初めて成り立った確認は、その後の操作の効果を見ていなくても警告しない。
- 前の操作の描画が観測時に終わっていなければ、警告を見逃すことがある。
- 観測に掛かる時間だけ後続の step の開始が遅れうる。時間とともに画面が変わるアプリでは、短時間だけ現れる対象への操作が失敗することもある。

## check の結果 {#check-results}

`CheckResult` の分岐はすべて厳格である。

| ステータス | 必須フィールド | 任意フィールド | 禁止フィールド |
| --- | --- | --- | --- |
| `fresh` | `id`, `file`, `planFile`, `reason` | `groundingFile`, `artifactFile`, `replayReadiness` | — |
| `stale`, `orphaned-plan`, `orphaned-grounding`, `missing-plan`, `missing-grounding`, `stale-grounding`, `invalid-grounding`, `fresh-without-grounding` | `id`, `file`, `planFile`, `reason` | `groundingFile`, `artifactFile` | — |
| `invalid-artifact-name` | `id`, `file`, `artifactFile`, `reason` | — | `planFile`, `groundingFile` |
| `listed` | `id`, `file` | — | `planFile`, `reason`, `groundingFile`, `artifactFile` |
| `skipped` | `id`, `file` | — | `planFile`, `reason`, `groundingFile`, `artifactFile` |

`replayReadiness` が付くのは `fresh` の行だけである。値は `{ status: 'ready' }` か、`status: 'not-ready'`、`reason: 'steps-unresolved'`、`steps` を持つオブジェクトになる。`steps` の形は [run の結果](#run-results) と同じである。`check` は `unsavedReason` を出さない。`fresh-without-grounding` など、ほかのステータスの行には `replayReadiness` を出さない。

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

ケースの全ステップが合格すると、残りの操作とキャプチャーのバインディングも `confirmed` が `true` になる。書き戻しが許可されない場合や失敗した場合も、この値は `true` のままである。グラウンディングファイルの更新を保証する値ではない。

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
| `GROUNDING_UNRESOLVED` | `{ stepId: string, reason: "missing" \| "recoverable-miss" \| "no-candidate" \| "ambiguous" \| "proposal-rejected" \| "candidate-changed", proposalOutcome?: "none" \| "ambiguous" \| "found", proposalRole?: string, proposalName?: string, proposalMatchCount?: non-negative integer, rejection?: "not-unique" \| "snapshot-invalid" \| "fingerprint-unavailable" \| "role-mismatch", verification?: "fingerprint-mismatch" \| "element-not-found" \| "ambiguous-match" \| "snapshot-invalid" \| "secret-contaminated" }` 要素ステップでは、`missing` はグラウンディングの項目が存在しないことを、`recoverable-miss` は既存の項目が現在のページと合わないことを示す。追加の任意項目は下表を参照する。 |

`GROUNDING_UNRESOLVED` の追加診断は、初回の対象特定で失敗した場合だけに付く。この段階では、AI が要素を提案する場合と、AI を呼ばずに引用から候補が一意に決まる場合がある。

| 任意項目 | 意味 |
| --- | --- |
| `proposalOutcome` | AI の応答の種類。`none` は候補なし、`ambiguous` は曖昧、`found` は提案ありを示す。 |
| `proposalRole`、`proposalName` | AI が提案した要素の role と名前。AI の応答の値を使い、名前が空文字でも出力する。ambercast は秘匿値と run 変数の値を伏せる。 |
| `proposalMatchCount` | 提案がページ上で一致した件数。0 を含む非負の整数である。 |
| `rejection` | 提案を採らなかった理由。`not-unique` は一意に定まらない、`snapshot-invalid` は画面の取得が不正、`fingerprint-unavailable` は候補の指紋が取れない、`role-mismatch` は role が意図と合わないことを示す。 |
| `verification` | 操作直前の再観測で対象が変わったときの結果。値はグラウンディングの取り直し理由と同じで、`fingerprint-mismatch`、`element-not-found`、`ambiguous-match`、`snapshot-invalid`、`secret-contaminated` のいずれかである。 |

次の表の「提案の3項目」は `proposalOutcome: "found"`、`proposalRole`、`proposalName` を指す。

| 止まった時点 | 追加する項目 |
| --- | --- |
| AI が候補なし・曖昧と答えた | `proposalOutcome` のみ。値は `none` または `ambiguous`。 |
| AI の提案がページ上で一意に定まらない | 提案の3項目、`rejection: "not-unique"`、`proposalMatchCount`。 |
| AI の提案を照合する際の画面の取得が不正 | 提案の3項目、`rejection: "snapshot-invalid"`。 |
| 候補の指紋が取れない、または role が意図と合わない | `rejection: "fingerprint-unavailable"` または `rejection: "role-mismatch"`。AI が提案した候補なら提案の3項目も出力する。 |
| 操作直前の再観測で対象が変わった | `verification`。AI が提案した候補なら提案の3項目も出力する。 |

引用から一意に決まった候補には、提案の3項目は付かない。CLI の人向け出力とビューアーは、`stepId`、`reason` の後に `proposalOutcome`、`proposalRole`、`proposalName`、`proposalMatchCount`、`rejection`、`verification` の順で、存在する項目を表示する。

この診断は失敗の原因を見分けるためのものである。初回の対象特定が実行ごとに揺れる問題そのものは解消しない。

`reason` の語彙、`message`、`hint`、終了コード、再実行の手順は変わらない。`missing` など、ほかの `GROUNDING_UNRESOLVED` の `details` も変わらない。

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
{"schemaVersion":"3.12","command":"generate","startedAt":"2026-09-06T00:00:00Z","durationMs":120,"summary":{"total":1,"passed":1,"failed":0,"errored":0,"skipped":0},"results":[{"id":"checkout.test.md","file":"checkout.test.md","planFile":"checkout.ambercast.plan.json","status":"generated","dryRun":false,"ambiguities":[],"secrets":[{"name":"LOGIN_PASSWORD","stepId":"fill-password","envVar":"AMBERCAST_SECRET_LOGIN_PASSWORD","allowed":true,"selectionSource":"target-slug"}],"durationMs":120,"aiCalls":1}],"errors":[]}
```
```json
{"schemaVersion":"3.12","command":"run","startedAt":"2026-09-06T00:00:00Z","durationMs":0,"summary":{"total":0,"passed":0,"failed":0,"errored":0,"skipped":0},"results":[],"errors":[],"reportPersistence":"not-attempted"}
```
```json
{"schemaVersion":"3.12","command":"check","startedAt":"2026-09-06T00:00:00Z","durationMs":0,"summary":{"total":0,"passed":0,"failed":0,"errored":0,"skipped":0},"results":[],"errors":[]}
```
```json
{"schemaVersion":"3.12","command":"heal","startedAt":"2026-09-06T00:00:00Z","durationMs":0,"summary":{"total":0,"passed":0,"failed":0,"errored":0,"skipped":0},"results":[],"errors":[]}
```

## 永続化の互換アンカー {#report-persistence}

旧来のアンカーを残すための節である。内容は[レポートの永続化](/ambercast/ja/reference/reports/#persistence)を参照する。

## 関連項目 {#see-also}

- [エラーコード](/ambercast/ja/reference/error-codes/#code-vocabulary)
- [終了コード](/ambercast/ja/reference/exit-codes/#exit-code-table)
- [ファイルレイアウト](/ambercast/ja/reference/file-layout/#run-artifacts)
- [ambercast run](/ambercast/ja/reference/cli/run/#report-and-exits)
