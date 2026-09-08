---
title: "グラウンディングドキュメント"
description: "`GroundingDocument` は、厳密に1つの Plan ダイジェストにバインドされた厳格なオブジェクトである。"
---

## グラウンディングの形状 {#grounding-shape}

`GroundingDocument` は、厳密に1つの Plan ダイジェストにバインドされた厳格なオブジェクトである。[src/core/ir/schema.ts:1367](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1367)

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `schemaVersion` | integer | required | literal `1` | グラウンディングフォーマットのバージョン。 | [src/core/ir/schema.ts:64](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L64), [src/core/ir/schema.ts:1368](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1368) |
| `planDigest` | `HexSha256` | required | `/^[0-9a-f]{64}$/` | 関連する計画のダイジェスト。 | [src/core/ir/schema.ts:35](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L35), [src/core/ir/schema.ts:1369](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1369) |
| `entries` | record `StepId` → `GroundingEntry` | required | strict entry branches | ID をキーとするキャッシュされたステップグラウンディング。 | [src/core/ir/schema.ts:1370](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1370) |

## エントリバリアント {#entry-variants}

| object | field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- | --- |
| `ElementGroundingEntry` | `kind` | string | required | literal `element` | Element エントリの識別子。 | [src/core/ir/schema.ts:1093](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1093) |
|  | `fingerprint` | `Fingerprint` | required | strict v2 fingerprint | アクセシビリティ近傍のエビデンス。 | [src/core/ir/schema.ts:1095](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1095) |
| `AiGroundingEntry` | `kind` | string | required | literal `ai` | AI エントリの識別子。 | [src/core/ir/schema.ts:1114](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1114) |
|  | `trace` | `TraceRecord` | required | strict trace | 再生可能な成功トレース。 | [src/core/ir/schema.ts:1116](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1116) |

`GroundingEntry` は、これら2つの厳密な形状の `kind` 共用体である。AI エントリの欠落はトレースが記録されていないことを意味し、空の検証（verification）を持つ `ai` エントリは無効である。[src/core/ir/schema.ts:1057-1061](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1057-L1061), [src/core/ir/schema.ts:1114-1117](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1114-L1117), [src/core/ir/schema.ts:1131-1134](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1131-L1134)

## トレースレコード {#trace-record}

| object | field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- | --- |
| `TraceRecord` | `events` | `TraceEntry[]` | required | may be empty | 時系列のアクション／アサーションジャーナル。 | [src/core/ir/schema.ts:1057](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1057) |
|  | `verification` | `TraceAssert[]` | required | min 1 | 再生可能な成功に必要とされる終了アサーション。 | [src/core/ir/schema.ts:1059](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1059) |
|  | `verificationCoverage` | record `InstructionCriterionId` → integer | optional | integer nonnegative | カバレッジから検証インデックスへの加法的なマッピング。 | [src/core/ir/schema.ts:1060](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1060) |
| `TraceClick` | `type`, `target` | string, `ElementRef` | required | literal `click`; strict target | 記録されたクリック。 | [src/core/ir/schema.ts:890](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L890) |
| `TraceNavigate` | `type`, `url` | string, `InterpolatableText` | required | literal `navigate`; no secret marker | 記録されたナビゲーション。 | [src/core/ir/schema.ts:906](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L906) |
| `TracePress` | `type`, `target`, `key` | string, locator, string | required | literal `press`; key enum | 記録されたキー押下。 | [src/core/ir/schema.ts:922](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L922) |
| `TraceFill` | `type`, `target`, `value` | string, locator, text | required | literal `fill`; no secret marker | 記録された通常の入力。 | [src/core/ir/schema.ts:938](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L938) |
| `TraceFillSecret` | `type`, `target`, `secretRef` | string, locator, ref | required | literal `fill-secret`; whole ref | リテラル値を持たない、記録されたシークレット入力。 | [src/core/ir/schema.ts:954](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L954) |

`TraceAction` は、5つのアクションレコードの `type` 共用体である。`key` 列挙型は `Enter`、`Tab`、`Escape`、`ArrowDown`、`ArrowUp` である。`ElementRef`、`InterpolatableText`、および `SecretRef` は、[値型](/ambercast/ja/spec/value-types/#shared-types) による制約を維持する。[src/core/ir/schema.ts:407-410](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L407-L410), [src/core/ir/schema.ts:922-925](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L922-L925), [src/core/ir/schema.ts:970-976](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L970-L976)

## トレース検証レコード {#trace-verification-records}

すべての `TraceAssert` 分岐は厳格であり、`type: "assert"` を要求する。これは Plan のアサーションと同じチェック固有のフィールドバンドルを共有する。[src/core/ir/schema.ts:997](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L997)

| variant | fields | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `text-visible` | `type`, `check`, `text` | all required | literals `assert`, `text-visible`; non-secret text | 可視性の観測。 | [src/core/ir/schema.ts:998](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L998) |
| `element-visible` | `type`, `check`, `target` | all required | literals `assert`, `element-visible`; strict locator | 要素の可視性の観測。 | [src/core/ir/schema.ts:1003](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1003) |
| `text-equals` | `type`, `check`, `target`, `text` | all required | literals `assert`, `text-equals`; non-secret text | 正確なテキストの観測。 | [src/core/ir/schema.ts:1008](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1008) |
| `url-matches` | `type`, `check`, `pattern` | all required | literals `assert`, `url-matches`; non-secret text | URL の観測。 | [src/core/ir/schema.ts:1013](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1013) |
| `element-count` | `type`, `check`, `target`, `count` | all required | literals `assert`, `element-count`; integer ≥ 0 | カウントの観測。 | [src/core/ir/schema.ts:1018](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1018) |

`TraceEntry` は、`TraceAction` と `TraceAssert` の外側の `type` 共用体である。[src/core/ir/schema.ts:1039](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1039)

## 完全な最小ドキュメント {#complete-minimal-document}

この例示的な `planDigest` は、[計画ドキュメント](/ambercast/ja/spec/plan-document/#complete-minimal-document) の完全な Plan の例を参照している。これは計算されたダイジェストではない。

```json
{
  "schemaVersion": 1,
  "planDigest": "0000000000000000000000000000000000000000000000000000000000000000",
  "entries": {}
}
```

## 権威とバインディング {#authority-and-binding}

コンシューマは Plan ダイジェストを再計算しなければならず（MUST）、それが `planDigest` と等しい場合にのみ Grounding を受け入れなければならない（MUST）。[src/core/ir/digest.ts:145](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/digest.ts#L145)

## Plan ダイジェストのバインディング {#plan-digest}

既存のトレースの再生に成功した後、実装はそのエントリを変更せずそのまま残さなければならない（MUST）。実装は、終了成功基準の厳密なカバレッジを伴うエージェント実行に成功した後にのみ、AI エントリを書き込むか上書きしなければならない（MUST）。スナップショットまたは失敗したアサーションで終了する成功したエージェント実行の場合、コールドパスはいかなるエントリも書き込んではならず（MUST NOT）、フォールバックパスはフォールバックを引き起こした古いエントリを削除しなければならない（MUST）。実装は、エージェント実行の失敗または中断の後は、既存のエントリに手を触れずに残さなければならない（MUST）。[src/usecases/run.ts:1895-1912](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L1895-L1912) [src/usecases/run.ts:2051-2127](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L2051-L2127)

すべての `TraceFillSecret` について、`secretRef` はそれを含む Plan の AI ステップのコミットされた `secrets[].ref` 付与セットに属していなければならない（MUST）。違反は整合性の失敗（integrity failure）であり、エージェント実行にフォールバックしてはならない（MUST NOT）。[src/usecases/run.ts:896](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L896) [src/usecases/run.ts:1075](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L1075)

## 設計根拠 {#rationale}

課題は、計画の意図はレビュー可能な状態を維持すべきであるのに対し、要素解決と AI 実行のエビデンスは揮発的である点である。独立したキャッシュには、その意図への曖昧さのないバインディングが必要である。

採用された設計では、要素ステップには境界付けられたフィンガープリントを与え、AI ステップには終了検証を伴う完全なトレースを与え、これらすべてが安定したステップ ID でキー付けされ、ダイジェストによってバインドされる。これにより、グラウンディングがトレースの唯一の権威となる。

却下された代替案の1つは、トレースを計画に埋め込むものであった。これは、通常の成功実行によってレビュー済みの成果物が頻繁に変更されてしまうため却下された。別の代替案は空のトレースを成功として扱うものであったが、再生には明示的な終了エビデンスが必要であるため却下された。 
