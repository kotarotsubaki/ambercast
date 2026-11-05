---
title: "グラウンディングドキュメント"
description: "この章は、1 つの計画ダイジェストに束縛してコミットするグラウンディングのキャッシュである `GroundingDocument`、そのエントリとトレースレコード、および実装がエントリを書き込む条件と保持する条件を定義する。"
---

## グラウンディングの形状 {#grounding-shape}

`GroundingDocument` は、1 つの計画（plan）ダイジェストだけに束縛された厳格なオブジェクトである（`src/core/ir/schema.ts:1753`）。

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `schemaVersion` | integer | required | literal `4` | グラウンディングフォーマットのバージョン。 | `src/core/ir/schema.ts:74,1754` |
| `planDigest` | `HexSha256` | required | `/^[0-9a-f]{64}$/` | 関連する計画のダイジェスト。 | `src/core/ir/schema.ts:35,1755` |
| `entries` | record `StepId` → `GroundingEntry` | required | strict entry branches | ID をキーとするキャッシュされたステップグラウンディング。 | `src/core/ir/schema.ts:1756` |

## エントリバリアント {#entry-variants}

| object | field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- | --- |
| `ElementGroundingEntryV4` | `kind` | string | required | literal `element` | Element エントリの識別子。 | `src/core/ir/schema.ts:1443` |
|  | `locator` | `GroundingElementLocator` | required | [値型](/ambercast/ja/spec/value-types/#shared-types) | 意図に結び付けられた観測済みロケータ。 | `src/core/ir/schema.ts:1444` |
|  | `fingerprint` | `Fingerprint` | required | [要素フィンガープリント](/ambercast/ja/spec/fingerprint/#algorithm) | アクセシビリティ近傍のエビデンス。 | `src/core/ir/schema.ts:1445` |
|  | `intentDigest` | `HexSha256` | required | `/^[0-9a-f]{64}$/` | ロケータが結び付けられたコミット済み意図のダイジェスト。 | `src/core/ir/schema.ts:1446` |
|  | `provenance` | string | required | enum `quoted-match`, `ai-proposed` | このロケータを生成した初回バインディングの段階。 | `src/core/ir/schema.ts:1447` |
| `AiGroundingEntry` | `kind` | string | required | literal `ai` | AI エントリの識別子。 | `src/core/ir/schema.ts:1464` |
|  | `trace` | `TraceRecord` | required | strict trace | 再生可能な成功トレース。 | `src/core/ir/schema.ts:1465` |

`GroundingEntry` は、この 2 つの厳密な形状を `kind` で区別する共用体である。AI エントリがないことは、トレースを記録していないことを意味する。検証が空の `ai` エントリは無効である（`src/core/ir/schema.ts:1402-1406,1463-1466,1480-1483`）。

## トレースレコード {#trace-record}

| object | field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- | --- |
| `TraceRecord` | `events` | `TraceEntry[]` | required | may be empty | 時系列のアクション／アサーションジャーナル。 | `src/core/ir/schema.ts:1403` |
|  | `verification` | `TraceAssert[]` | required | min 1 | 再生可能な成功に必要とされる終了アサーション。 | `src/core/ir/schema.ts:1404` |
|  | `verificationCoverage` | record `InstructionCriterionId` → integer | optional | integer nonnegative | カバレッジから検証インデックスへの加法的なマッピング。 | `src/core/ir/schema.ts:1405` |
| `TraceClick` | `type`, `target` | string, `ElementRef` | required | literal `click`; strict target | 記録されたクリック。 | `src/core/ir/schema.ts:1235` |
| `TraceNavigate` | `type`, `url` | string, `InterpolatableText` | required | literal `navigate`; no secret marker | 記録されたナビゲーション。 | `src/core/ir/schema.ts:1251` |
| `TracePress` | `type`, `target`, `key` | string, locator, string | required | literal `press`; key enum | 記録されたキー押下。 | `src/core/ir/schema.ts:1267` |
| `TraceFill` | `type`, `target`, `value` | string, locator, text | required | literal `fill`; no secret marker | 記録された通常の入力。 | `src/core/ir/schema.ts:1283` |
| `TraceFillSecret` | `type`, `target`, `secretRef` | string, locator, ref | required | literal `fill-secret`; whole ref | リテラル値を持たない、記録されたシークレット入力。 | `src/core/ir/schema.ts:1299` |

`TraceAction` は、5 つのアクションレコードを `type` で区別する共用体である。`key` の列挙値は `Enter`、`Tab`、`Escape`、`ArrowDown`、`ArrowUp` である。`ElementRef`、`InterpolatableText`、`SecretRef` は、[値型](/ambercast/ja/spec/value-types/#shared-types)の制約をそのまま保つ（`src/core/ir/schema.ts:567-570,1267-1270,1315-1321`）。

## トレース検証レコード {#trace-verification-records}

すべての `TraceAssert` の分岐は厳格であり、`type: "assert"` を必須とする。計画のアサーションと同じ、検査ごとのフィールドの組を共有する（`src/core/ir/schema.ts:1342`）。

| variant | fields | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `text-visible` | `type`, `check`, `text` | all required | literals `assert`, `text-visible`; non-secret text | 可視性の観測。 | `src/core/ir/schema.ts:1343` |
| `element-visible` | `type`, `check`, `target` | all required | literals `assert`, `element-visible`; strict locator | 要素の可視性の観測。 | `src/core/ir/schema.ts:1348` |
| `text-equals` | `type`, `check`, `target`, `text` | all required | literals `assert`, `text-equals`; non-secret text | 正確なテキストの観測。 | `src/core/ir/schema.ts:1353` |
| `url-matches` | `type`, `check`, `pattern` | all required | literals `assert`, `url-matches`; non-secret text | URL の観測。 | `src/core/ir/schema.ts:1358` |
| `element-count` | `type`, `check`, `target`, `count` | all required | literals `assert`, `element-count`; integer ≥ 0 | カウントの観測。 | `src/core/ir/schema.ts:1363` |

`TraceEntry` は、`TraceAction` と `TraceAssert` を外側の `type` で区別する共用体である（`src/core/ir/schema.ts:1384`）。

## 完全な最小ドキュメント {#complete-minimal-document}

この例示用の `planDigest` は、[計画ドキュメント](/ambercast/ja/spec/plan-document/#complete-minimal-document)の完全な計画の例を指す。計算したダイジェストではない。

```json
{
  "schemaVersion": 4,
  "planDigest": "0000000000000000000000000000000000000000000000000000000000000000",
  "entries": {}
}
```

## 権威とバインディング {#authority-and-binding}

コンシューマは、計画のダイジェストを再計算しなければならず（MUST）、それが `planDigest` と等しいときにだけグラウンディングを受け入れなければならない（MUST）（`src/core/ir/digest.ts:153`、`src/core/ir/digest.ts:170`）。

## 計画ダイジェストの束縛 {#plan-digest}

既存のトレースの再生が成功した後、実装はそのエントリを変更せずに残さなければならない（MUST）。実装は、終端の成功基準を正確に被覆したエージェント実行が成功した後にだけ、AI エントリを書き込み、上書きしなければならない（MUST）。エージェント実行が成功しても、最後の観測がスナップショットか失敗したアサーションなら、コールドパスはエントリを書き込んではならない（MUST NOT）。成功したエージェント実行の最後の観測がスナップショットか失敗したアサーションなら、フォールバックパスは、原因の古いエントリを削除しなければならない（MUST）。エージェント実行が失敗するか中断した後、実装は既存のエントリを変更せずに残さなければならない（MUST）（`src/usecases/run.ts:2255-2266`、`src/usecases/run.ts:2565`）。

要素エントリは、そのバインディングが `confirmed` に達したときにだけ、書き込む、または上書きしなければならない（MUST）。そのためには、少なくとも 1 つのステップがその要素ステップを自身の空でないコミット済み `confirms` リストに挙げ、該当するすべてのステップが同じケースで成功しなければならない。確認するアサーションが `element-visible` の場合、成功が有効な確認の根拠になるのは、一致した候補がちょうど 1 つのときだけである。複数の候補が一致した成功では、バインディングを確認しない。`acted` だけのバインディングは、書き戻しの時点で破棄し、永続化しない（`src/usecases/run.ts:149-180`、`src/usecases/run.ts:3472-3495`、`src/usecases/run.ts:4238-4247`）。

すべての `TraceFillSecret` について、`secretRef` は、それを含む計画の AI ステップのコミット済み `secrets[].ref` の集合に属さなければならない（MUST）。違反は整合性の失敗であり、エージェント実行へフォールバックしてはならない（MUST NOT）（`src/usecases/run.ts:1158`、`src/usecases/run.ts:1356`）。

グラウンディングのバージョン 2 と 3 は廃止した。`check` は、コミット済みのポリシーではスキーマ検証の前に `stale-grounding` を報告し、未コミットのポリシーでは `fresh-without-grounding` を報告する。`--resolve` なしの `run` は、計画のダイジェストが一致し、要素ステップにグラウンディングが必要な場合、`GROUNDING_UNRESOLVED` を `recoverable-miss` として報告する。ダイジェストが異なる場合は `missing` になる。

`run --resolve` は空のキャッシュから始まり、既存の書き戻しの条件のもとで v4 を保存できる。`generate` は、変更のない新しい計画に対して、廃止したキャッシュを空の v4 グラウンディングに置き換える。`heal` は、`ambercast run --resolve --update-cache` でキャッシュを再生成するまで `FS_IO_ERROR` を報告する。バージョン 1 と未知のバージョンは、`check` では無効のまま、`run` ではキャッシュミスのままである。

## 設計根拠 {#rationale}

課題は、要素の解決と AI 実行の証拠が揮発的である一方、計画の意図はレビューできる状態を保つ必要があることである。別のキャッシュには、その意図への曖昧さのない束縛が要る。

採用した設計は、要素ステップに範囲を限ったフィンガープリントを与え、AI ステップに終端の検証を持つ完全なトレースを与える。どちらも安定したステップ ID で引き、ダイジェストで束縛する。これにより、グラウンディングがトレースの唯一の権威になる。

却下した代替案の 1 つは、トレースを計画に埋め込むことである。通常の成功した実行が、レビュー済みの成果物を何度も変更してしまうため、却下した。もう 1 つは、空のトレースを成功として扱うことである。再生には明示的な終端の証拠が必要なため、却下した。
