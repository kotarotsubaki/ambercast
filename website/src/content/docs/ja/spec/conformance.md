---
title: "適合性"
description: "この章は、適合するバリデーターが検査する、JSON Schema の射影、課題コードを持つ意味的な制約、検証の順序を定める。"
---

## 構造の検証 {#structural-validation}

Ambercast の公開パイプラインは、JSON Schema を Zod の実行時スキーマから導かなければならない（MUST）。対象は、計画（plan）・グラウンディング・設定・レポートである。手書きの並行スキーマは保守しない（`src/core/ir/schema.ts:7-8`、`src/core/config/json-schema.ts:1-2,27-34`、`src/report/json-schema.ts:1-2,23-25`）。ビルドツールは次の射影を書き出し、パッケージの export が生成ファイルを公開する（`src/build-tools/generate-json-schema.ts:80-83`、`package.json:23-35`）。

| Zod の射影 | JSON Schema のゲッター | 生成ファイル | パッケージの export |
| --- | --- | --- | --- |
| `PlanDocument` | `getPlanJsonSchema()` | `plan.schema.json` | `ambercast/schema/plan.json` → `./dist/schema/plan.schema.json` |
| `GroundingDocument` | `getGroundingJsonSchema()` | `grounding.schema.json` | `ambercast/schema/grounding.json` → `./dist/schema/grounding.schema.json` |
| `RawConfig` | `getConfigJsonSchema()` | `config.schema.json` | `ambercast/schema/config.json` → `./dist/schema/config.schema.json` |
| `ReportEnvelope` | `getReportJsonSchema()` | `report.schema.json` | `ambercast/schema/report.json` → `./dist/schema/report.schema.json` |

計画とグラウンディングのゲッターは、それぞれ `PlanDocument` と `GroundingDocument` から値を導く。設定のゲッターは `RawConfig` から、レポートのゲッターは `ReportEnvelope` から値を導く（`src/core/ir/json-schema.ts:16-55`、`src/core/config/json-schema.ts:20-39`、`src/report/json-schema.ts:23-29`）。外部のコンシューマーが適合するとは、公開された構造と意味の契約を検証することである。Zod を使う必要はなく、Ambercast の公開パイプラインを再現する必要もない。

## 意味の検証 {#semantic-validation}

JSON Schema の検証だけでは足りない。適合するバリデーターは、さらに次を強制しなければならない（MUST）。課題コードは安定した実装の値である。ポリシー上の課題は、ここで2つ目の公開ステータスを定めるのではなく、呼び出し側（生成・check・run）が対応づける（`src/usecases/instruction-coverage-policy.ts:73-82`）。

| id | 適用対象 | 制約 | 課題コード / 失敗 | 根拠 |
| --- | --- | --- | --- | --- |
| CON-01 | 計画 | 計画のステップ ID は一意でなければならない（MUST）。 | `duplicate step id: <id>` | `src/core/ir/schema.ts:1547-1558` |
| CON-02 | 生成されたシークレット名の選択 | 明示された `allowedName` は、ローカルでの解決の前に、プロバイダーのコンテキストで投影された許可リスト内の名前の集合に含まれなければならない（MUST）。 | `secret-allowed-name-not-projected` | `src/usecases/secret-naming.ts:190-239` |
| CON-03 | 生成された基準 | 各基準の `startAnchor` と `endAnchor` は、1始まりの UTF-16 列で、有効かつ空でも空白のみでもなく文書順の範囲を成す、既知の `L<n>` 行アンカーを指さなければならない（MUST）。プロバイダーの `citation` は、解決した正規化後のプロンプトの原文の部分文字列と一致しなければならない（MUST）。アンカーや列が不正または範囲外のときは、`citation` ではなく、誤りのある座標（`startAnchor`・`startColumn`・`endAnchor`・`endColumn`）を報告する。再試行のフィードバックが失敗パスだけを運ぶためである。 | `anchor-invalid`, `citation-whitespace-only`, `citation-checksum-mismatch` | `src/usecases/instruction-coverage-policy.ts:407-443` |
| CON-04 | 生成された基準 | 基準 ID と解決した座標の範囲は一意でなければならない（MUST）。解決した境界はサロゲートペアを分割してはならない（MUST NOT）。 | `criterion-id-duplicate`, `criterion-range-duplicate`, `anchor-invalid` | `src/usecases/instruction-coverage-policy.ts:407-443` |
| CON-05 | 生成された AI ステップ | 少なくとも1つの基準は `success` でなければならない（MUST）。success の ID と検証意図の ID は、厳密な全単射をなさなければならない（MUST）。 | `success-criterion-missing`, `intent-id-duplicate`, `intent-id-missing`, `intent-id-unknown`, `intent-id-action` | `src/usecases/instruction-coverage-policy.ts:456-476` |
| CON-06 | 生成された検証意図 | 終端のアサーションは、サポートされる `TraceAssert` でなければならず（MUST）、`url-matches` であってはならない（MUST NOT）。 | `intent-assertion-unsupported`, `terminal-url-matches-forbidden` | `src/usecases/instruction-coverage-policy.ts:467-472` |
| CON-07 | コミット済みの基準 | 基準は空であってはならず、ID と範囲が一意で、再抽出するとプロンプトの空白でないテキストになり、幅が0でない有効な UTF-16 座標を使わなければならない（MUST）。 | `criterion-id-duplicate`, `criterion-range-duplicate`, `source-span-invalid`, `source-span-whitespace-only`, `success-criterion-missing` | `src/usecases/instruction-coverage-policy.ts:509-522` |
| CON-08 | コミット済みの基準 | 基準は、ソース・終端・種別・ID の正準な順序にすでに並んでいなければならない（MUST）。 | `criterion-order-invalid` | `src/usecases/instruction-coverage-policy.ts:523-529` |
| CON-09 | 生成されたシークレット名 | プロバイダーのシークレットの選択は、ローカルで有効なコミット済みの `SecretRef` に解決されなければならない（MUST）。1つの環境変数に対応づく別々の参照は拒否しなければならない（MUST）。 | `SECRET_ENV_VAR_COLLISION` | `src/usecases/secret-naming.ts:205-344`; `src/core/secrets/env-var-name.ts:28-45` |
| CON-10 | 候補の計画の同意 | `secrets.allow` にない名前を含む候補は、`secrets.allow: "*"` の場合を除き、永続化の前に同意の判断を受けなければならない（MUST）。`consentMode: "forbid"` は、永続化せずに `candidate` を返さなければならない（MUST）。 | `SECRET_CONSENT_REQUIRED`; `candidate` | `src/usecases/generate.ts:1652-1741` |
| CON-11 | グラウンディングのカバレッジ | `verificationCoverage` は、すべての success の基準と success の基準だけを、範囲内で互いに異なる終端検証のインデックスに1つずつ対応づけなければならない（MUST）。終端のインデックスはすべて対応づけなければならない（MUST）。 | `verification-coverage-id-missing`, `verification-coverage-id-unknown`, `verification-coverage-id-action`, `verification-coverage-index-duplicate`, `verification-coverage-index-invalid` | `src/usecases/instruction-coverage-policy.ts:605-621` |
| CON-12 | グラウンディングの終端の証拠 | 終端のアサーションは、`url-matches` であってはならず、実行値の具体化の後でイベントのアサーションと重複してもならない（MUST NOT）。 | `terminal-url-matches-forbidden`, `verification-assertion-repeated` | `src/usecases/instruction-coverage-policy.ts:623-636` |
| CON-13 | グラウンディングの結合 | グラウンディングは、その `planDigest` が再計算した計画のダイジェストと等しいときだけ受け入れなければならない（MUST）。 | 検査の分類 `stale` | `src/usecases/check-grounding.ts:64` |
| CON-14 | カバレッジを持つグラウンディングのバイト列 | カバレッジを主張するグラウンディング文書は、正準なアーティファクトのバイト列を使わなければならない（MUST）。 | 検査の分類 `invalid` | `src/usecases/check-grounding.ts:66-72` |
| CON-15 | キャッシュした AI トレースのシークレット使用 | すべての `TraceFillSecret.secretRef` は、含む計画の AI ステップがコミットした `secrets[].ref` の集合に属さなければならない（MUST）。違反は整合性の失敗であり、フォールバックしてはならない（MUST NOT）。 | 整合性の失敗 | `src/usecases/run.ts:1356-1360` |
| CON-16 | ナビゲーション | 計画・キャッシュしたトレース・新しいエージェント実行のナビゲーションはすべて、対象の `baseUrl` に対して解決され、HTTP(S) を使い、対象と同一オリジンのままでなければならない（MUST）。 | 整合性の失敗 | `src/usecases/run.ts:993-1021` |
| CON-17 | キャッシュした AI トレースのシークレットマーカー | キャッシュした AI トレースの文字列値の子孫は、専用の `TraceFillSecret.secretRef` フィールドを除き、連続した `{{secrets.` マーカーを含んではならない（MUST NOT）。違反は整合性の失敗であり、フォールバックしてはならない（MUST NOT）。 | 整合性の失敗 | `src/usecases/run.ts:1250-1264` |
| CON-18 | キャッシュした AI トレースの `RunRef` | `RunRef` は、形式が正しく、含む AI ステップより前に宣言されたキャプチャ変数だけを指し、現在のケースで値が使えなければならない（MUST）。形式が不正、未認可、または値がない参照は整合性の失敗であり、フォールバックしてはならない（MUST NOT）。 | 整合性の失敗 | `src/usecases/run.ts:917-935`; `src/usecases/run.ts:4334-4336` |
| CON-19 | キャッシュした AI トレースの実体化シークレット | 再生の前に、トレースのイベントと検証リストにある `fill-secret` の参照のうち、含む計画の AI ステップが列挙したものを解決する。現在のケースの解決済みの値とあわせて、固定語彙の `type`・`check`・`target`・`timeoutMs`・`element.strategy`・`key`・`secretRef` を除くすべての値を走査する。空でない解決済みシークレットは、一致の場合も、3 UTF-16 コード単位以上のときの部分一致の場合も禁止される。 | 整合性の失敗; フォールバックしてはならない（MUST NOT） | `src/usecases/run.ts:1351-1384`; `src/usecases/run.ts:1265-1274,1545-1566`; `src/usecases/run.ts:2680-2684,2719-2722` |
| CON-20 | 保存したトレースと新しい AI の `fill.value` の認証情報リテラル | 保存したトレースと新しいエージェントのアクションは、`sk-`・`ghp_`・`AKIA` で始まる入力値を無条件に拒否しなければならない（MUST）。高エントロピーの入力値は、取得した現在のケースの値を除いた残りのテキストが、どの検出器にも一致しないときだけ受け入れる。保存したトレースの失敗はフォールバックしてはならない（MUST NOT）。新しい実行の失敗は、ブラウザーの実行やジャーナルの永続化の前に起きる。 | 整合性の失敗 | `src/usecases/run.ts:1295-1302`; `src/usecases/run.ts:1647-1680`; `src/usecases/run.ts:1710-1713,2343`; `src/usecases/run.ts:2680-2684,2719-2722` |
| CON-21 | AI の境界をまたぐ取得済みの値 | `verificationCoverage` を持たない旧形式の保存トレースは、未解決の `{{run.name}}` プレースホルダーを除き、固定語彙でないどの値にも、現在のケースで取得した空でない値を含んではならない（MUST NOT）。この検査は部分一致で行う。新しいエージェントのナビゲーション URL・入力値・アサーションのテキストとパターンは、取得した値と等しくてはならない（MUST NOT）。これらの値は、代わりに認可された `RunRef` 補間を使わなければならない（MUST）。違反は、保存したトレースがブラウザーやプロバイダーへのフォールバックに達する前、または新しい入力がブラウザーや永続化に達する前に失敗する。 | 整合性の失敗 | `src/usecases/run.ts:1590-1622`; `src/usecases/run.ts:1275-1281`; `src/usecases/run.ts:1704-1733`; `src/usecases/run.ts:2680-2684,2702` |
| CON-22 | 新しいエージェントのアクション・アサーションの実体化シークレット | 実体化の前に、新しいエージェントのすべてのアクションとアサーションは、固定語彙でない値を、ケースで観測した空でないすべての解決済みシークレットに照らして走査しなければならない（MUST）。閉じた語彙として除外するのは、`type`・`check`・`target`・`timeoutMs`・`element.strategy`・`key`・`secretRef` だけである。空でないシークレットとの完全一致は禁止される。シークレットが3 UTF-16 コード単位以上のときは、部分文字列の一致も禁止される。一致は、ブラウザーの実行、ジャーナルへの追加、グラウンディングの更新、永続化の前に起きる整合性の失敗である。 | 整合性の失敗 | `src/usecases/run.ts:1526-1543`; `src/usecases/run.ts:1545-1588`; `src/usecases/run.ts:1695-1702`; `src/usecases/run.ts:2333-2343`; `src/usecases/run.ts:2391-2403`; `src/usecases/run.ts:2373` |
| CON-23 | 位置指定または探索で選んだプロンプトのパス | 選んだプロンプトのパスは、`testDir` の内側で、正確な `.test.md` の接尾辞と空でない名前部分を持つように解決されなければならない（MUST）。この検査は、ファイルごとの処理を始める前に、選択全体に対して1度だけ行う。`--list` はこの検査を適用してはならない（MUST NOT）。 | `PROMPT_PATH_INVALID` | `src/core/layout/resolve.ts:191`; `src/usecases/prompt-path-eligibility.ts:25` |
| CON-24 | コミット済みおよび生成された要素意図 | 帰属付けとコミット済み形式の再検証は、次の5点をそれぞれ独立に確認しなければならない（MUST）。1つ目は、意図と引用のスパンが妥当なこと。2つ目は、空白のみの抜粋を拒否すること。3つ目は、プロバイダーの引用またはコミット済みの引用テキストが、場合に応じて一致すること。4つ目は、前後の引用符が対になっていること。5つ目は、引用が意図の中に収まること（境界が接する場合を含む）。コミット済み形式の再検証には、citation の比較がない。生成（Generation）は、期待テキストが対象の意図引用と一致する `text-equals` アサーションも拒否しなければならない（MUST）。どちらの引用も互いの役割を支持しないためである。 | `anchor-invalid`, `intent-span-invalid`, `intent-span-whitespace-only`, `intent-citation-mismatch`, `quote-span-invalid`, `quote-text-mismatch`, `quote-unpaired`, `quote-outside-intent`, `quote-whitespace-only`, `text-equals-self-quote` | `src/usecases/element-intent-policy.ts:75-105,129-188,211-231`; `src/usecases/generate.ts:246-254` |
| CON-25 | 計画の `confirms` フィールド | `generate` と `heal` は、検証の前に、`navigate` ステップへの `confirms` の参照を取り除く。残ったすべての ID は、同じ計画の前にある click・press・fill・fill-secret・capture のステップを指し、1度しか現れず、計画の昇順に従わなければならない（MUST）。対象の同一性は検査しない。 | `confirms-unknown-step`, `confirms-not-earlier`, `confirms-not-action`, `confirms-duplicate`, `confirms-unsorted` | `src/core/ir/confirms-validation.ts:19-57,76-96` |

CON-23 はファイル選択の間に、ほかのすべての CON 項目より前に適用される。CON-01 から CON-06、CON-09、CON-10、CON-24 は、計画を永続化する前に適用される。CON-01、CON-07、CON-08、CON-24、CON-25 は、コミット済みの計画に適用される。CON-11 から CON-22 は、グラウンディングと再生の検証に適用される。グラウンディングと再生の検証は、ブラウザーの操作が実体化した値を受け取る前に、次を検査する。トレースのシークレットマーカー、解決済みシークレット、認証情報リテラル、取得済みの値の境界と、動的な `RunRef` の権限である（`src/usecases/instruction-coverage-policy.ts:380-381,496-499`、`src/usecases/generate.ts:1652-1741`、`src/usecases/check-grounding.ts:18`、`src/usecases/run.ts:917-935`、`src/usecases/run.ts:1250-1264`）。

## 検証手順 {#verification-procedure}

コンシューマーは、次の順に処理しなければならない（MUST）。

1. アーティファクトを構造として解析する。
2. [入力ダイジェスト](/ambercast/ja/spec/freshness/#inputs-digest)の規則で現在のダイジェストを計算する。
3. 再生の前に意味の検査を適用する。

グラウンディングの検証に失敗したら、キャッシュした再生を認可してはならない（MUST NOT）（`src/core/ir/schema.ts:1541,1753`、`src/usecases/run.ts:820-851`、`src/core/ir/digest.ts:170-175`）。

## 設計根拠 {#rationale}

問題は、移植できる JSON Schema が形を検証できても、兄弟の値の比較、プロンプトの原文、レコードをまたぐ関係は検証できないことである。

採用した設計は、小さな意味の層を明示し、構造の解析の後で、安定したエラーコードを報告する。表現できる制約は、すべて Zod と、そこから導く JSON Schema に残す。

却下した案は2つある。1つはすべての規則を移植できない refinement に隠す案で、スキーマのコンシューマーが規則を失うため却下した。もう1つは JSON Schema だけに頼る案で、孤立した JSON の値からは来歴とカバレッジを証明できないため却下した。
