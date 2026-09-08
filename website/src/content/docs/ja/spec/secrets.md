---
title: "プランにおけるシークレット"
description: "プランはシークレット値を 値型 `SecretRef` のみによって表現しなければならず（MUST）、連続する `{{secrets."
---

## 認可 {#authorization}

プランはシークレット値を [値型](/ambercast/ja/spec/value-types/#shared-types) `SecretRef` のみによって表現しなければならず（MUST）、連続する `{{secrets.` 補間マーカーは `InterpolatableText` において禁止される。[src/core/ir/schema.ts:33](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L33) [src/core/ir/schema.ts:125](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L125) `fill-secret` はその `SourceSpan` を保持しなければならず（MUST）、AIシークレット付与は参照ごとに1つのスパンを保持しなければならない（MUST）。[src/core/ir/schema.ts:515](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L515) [src/core/ir/schema.ts:690](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L690)

## 付与の起点 {#grant-origin}

認可は、正規化されたプロンプトテキスト内の、CommonMarkのコード構造の外側にある完全な `@ambercast-secret {{secrets.X}}` 行に由来しなければならない（MUST）。[src/core/ir/secret-grant-source.ts:4](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/secret-grant-source.ts#L4) 重複する行は別個の付与の出現であり、それらのスパンは1始まりの物理行である。[src/core/ir/secret-grant-source.ts:28](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/secret-grant-source.ts#L28)

帰属付けは、正規化されたプロンプトテキスト内でプロバイダー引用を正確に1回特定し、それが名前付きリテラル参照を含んでいることを要求した上で、その一意な範囲を正確に1つのパース済み付与へと解決しなければならない（MUST）。そうでなければ、生成処理は `citation-not-found`、`citation-not-unique`、`citation-missing-ref`、または `citation-unresolved` を表出させる。[src/core/errors/secret-grant-unattributable-error.ts:77](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/errors/secret-grant-unattributable-error.ts#L77) コミットされた形式は `SourceSpan` を記録し、プロバイダー引用を決して記録しない。[src/core/ir/schema.ts:515-520](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L515-L520) [src/core/ir/schema.ts:690-692](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L690-L692) [src/core/ir/schema.ts:758-763](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L758-L763) [src/core/ir/schema.ts:798-800](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L798-L800)

## シンクとリダクション {#sink-and-redaction}

シークレットシンクオリジンは HTTP(S) オリジンでなければならず（MUST）、連続する `{{secrets.` 補間マーカーを含んではならない（MUST NOT）。このスキーマ制約自体は、シークレットのように見える任意のリテラルの不在を証明するものではない。[src/core/ir/schema.ts:83](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L83) [src/core/ir/schema.ts:95](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L95) コンシューマは、コミットされたグラウンディングトレースデータにおいて、リテラルパスワードではなく参照を保持しなければならない（MUST）。[src/core/ir/schema.ts:949](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L949)

シンクポリシーは実行時にオリジンを解析および正規化する。`secretSinkOrigins` 内に対象シークレットの設定エントリが存在しない場合は `baseUrl` のみを許可し、空のエントリは何も許可せず、空でないエントリはそのデフォルトを置き換える。実際の各 `fill-secret` について、実行パイプラインはシークレットを解決する直前にライブページのオリジンを検査しなければならない（MUST）。ブラウザアダプタは、要素の取得後かつ入力（filling）の直前にポリシー検査を繰り返さなければならず（MUST）、これによりナビゲーションやDOMの変更がライブオリジンの境界を迂回できないようにする。[src/core/ir/schema.ts:152-157](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L152-L157) [src/usecases/run.ts:765](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L765) [src/usecases/run.ts:896](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L896) [src/adapters/browser/chromium.ts:413](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/adapters/browser/chromium.ts#L413)

## シークレットリテラルの拒否 {#literal-secret-rejection}

本セクションは、リテラルシークレット検出器のセマンティクスに対する正準な定義元である。リファレンスページは局所的な目的に対して検出器境界を要約するのみにとどめ、本セクションへリンクしなければならない（MUST）。永続化またはレポートのシリアライズの前に、生成処理は `generatorMeta` および曖昧性を含む、プロバイダに由来するすべてのJSON文字列およびオブジェクトキーを検査しなければならない（MUST）。字句キーおよび配列インデックスの走査順序において、最初に一致した検出器で拒否しなければならない（MUST）。[src/usecases/generator-secret-policy.ts:520](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/generator-secret-policy.ts#L520)

| id | 検出器 | 一致する値 | 例外 | 分類される障害 |
| --- | --- | --- | --- | --- |
| SEC-01 | `credential-prefix-sk` | `sk-` で始まる | 文字列値内の有効な完全値 `SecretRef` のみ；`source.inputsDigest` のみ | `SECRET_LITERAL_REJECTED`, exit `2` |
| SEC-02 | `credential-prefix-ghp` | `ghp_` で始まる | 文字列値内の有効な完全値 `SecretRef` のみ；`source.inputsDigest` のみ | `SECRET_LITERAL_REJECTED`, exit `2` |
| SEC-03 | `credential-prefix-aws-access-key` | `AKIA` で始まる | 文字列値内の有効な完全値 `SecretRef` のみ；`source.inputsDigest` のみ | `SECRET_LITERAL_REJECTED`, exit `2` |
| SEC-04 | `high-entropy-token` | 32 UTF-16 コード単位以上かつシャノンエントロピーが 4.0 ビット以上。頻度キーは Unicode コードポイントとして反復されるが、各確率の分母には UTF-16 コード単位の長さを使用する | 文字列値内の有効な完全値 `SecretRef` のみ；`source.inputsDigest` のみ | `SECRET_LITERAL_REJECTED`, exit `2` |

`SecretRef` の例外はオブジェクトキーには決して適用されない。すべてのキーは、その値が走査される前に検出器に渡される。拒否の診断情報は検出器およびリダクションされたJSON風パスのみを含まなければならず（MUST）、検出されたリテラルを保持してはならない（MUST NOT）。また、検出されたオブジェクトキーには `[redacted-key]` を使用する。[src/usecases/generator-secret-policy.ts:546](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/generator-secret-policy.ts#L546) [src/usecases/generator-secret-policy.ts:567](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/generator-secret-policy.ts#L567) [src/report/error-mapping.ts:23](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/report/error-mapping.ts#L23) [src/core/errors/exit-codes.ts:31](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/errors/exit-codes.ts#L31)

## 境界固有の機密性要件 {#boundary-specific-secrecy}

| id | 境界 | 要件 | エビデンス |
| --- | --- | --- | --- |
| SEC-05 | 生成 | プロバイダに由来するJSONは、永続化またはレポートのシリアライズの前にリテラルシークレット拒否を通過しなければならない（MUST）。 | [src/usecases/generator-secret-policy.ts:520](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/generator-secret-policy.ts#L520) |
| SEC-06 | フィンガープリント生成 | 空でない解決済みシークレットと完全一致する記述子は `secret-contaminated` を生成しなければならない（MUST）。部分文字列の一致は比較値が 3 UTF-16 コード単位以上である場合にのみ適用され、フィンガープリントを生成してはならない（MUST NOT）。 | [src/core/ir/fingerprint.ts:278](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/fingerprint.ts#L278) |
| SEC-07 | コミットされたトレース | `TraceFillSecret` は実体化された値ではなく、`secretRef` を保存しなければならない（MUST）。 | [src/core/ir/schema.ts:949](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L949) |
| SEC-08 | グラウンディングの永続化 | 実行パイプラインは、スキャンされた文字列値がいずれかの空でない解決済みシークレットと完全に等しい場合、または解決された値が 3 UTF-16 コード単位以上であるシークレットを含む場合、グラウンディングの書き込みを拒絶しなければならず（MUST）、これを整合性の失敗（integrity failure）として分類しなければならない（MUST）。 | [src/usecases/run.ts:1252](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L1252) [src/usecases/run.ts:3425](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L3425) |
| SEC-09 | 診断および報告可能なエラー | 実行パイプラインは、診断／レポートのシリアライズの前にJSON文字列およびオブジェクトキーをリダクションしなければならない（MUST）。 | [src/usecases/run.ts:1542](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L1542) |
| SEC-10 | AI向けアクセシビリティエビデンス | AIプロバイダへ送信されるアクセシビリティエビデンスは、文字列値およびオブジェクトキーから解決済みの値をリダクションしなければならない（MUST）。スクリーンショットのバイトデータがこの境界を越えてはならない（MUST NOT）。 | [src/usecases/run.ts:2023](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L2023) |
| SEC-11 | スクリーンショットの永続化 | アクセシビリティキャプチャ内で解決済みシークレット検出によって値が見つかった場合、解決後にキャプチャが検査不能である場合、または検出が失敗した場合は、スクリーンショットを保持してはならない（MUST NOT）。 | [src/usecases/run.ts:2550](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L2550) |
| SEC-12 | AIトレースのシークレットマーカー | キャッシュされたAIトレースの文字列値を持つすべての子孫要素は、専用の `TraceFillSecret.secretRef` フィールドを除き、連続する `{{secrets.` マーカーを含んではならない（MUST NOT）。違反は整合性の失敗（integrity failure）であり、プロバイダー実行へフォールバックしてはならない（MUST NOT）。 | [src/usecases/run.ts:984](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L984) |
| SEC-13 | キャッシュされたAIトレースの実体化されたシークレット | リプレイの前に、パイプラインは、内包する Plan AI ステップによって付与されている、保存されたトレースのイベントおよび検証リスト内の各 `fill-secret` 参照を解決しなければならない（MUST）。得られた値は、現在のケースですでに解決されている値に合流する。その後、パイプラインは固定語彙である `type`、`check`、`target.strategy`、`key`、および `secretRef` を除くすべてのトレース値をスキャンしなければならない（MUST）。空でない解決済みシークレットとの完全一致、またはそのシークレットが 3 UTF-16 コード単位以上である場合の部分文字列一致は整合性の失敗（integrity failure）であり、プロバイダー実行へフォールバックしてはならない（MUST NOT）。 | [src/usecases/run.ts:1075-1129](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L1075-L1129); [src/usecases/run.ts:1252-1313](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L1252-L1313); [src/usecases/run.ts:2190-2209](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L2190-L2209) |
| SEC-14 | AI `fill.value` のクレデンシャルリテラル | ブラウザ実行の前に、保存されたトレースおよび新規のエージェント的な `fill.value` は、`sk-`、`ghp_`、および `AKIA` 検出器を無条件で拒否しなければならない（MUST）。高エントロピーの一致は、キャプチャされた現在のケースの値を除去した後に検出器の一致が残らない場合にのみ許可される。この例外はプレフィックス検出器には適用されない。違反は整合性の失敗（integrity failure）である。保存されたトレースのバリデーションはフォールバックしてはならず（MUST NOT）、新規のエージェント実行はブラウザ実行またはジャーナルの永続化に到達してはならない（MUST NOT）。 | [src/usecases/run.ts:984-1040](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L984-L1040); [src/usecases/run.ts:1350-1405](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L1350-L1405); [src/usecases/run.ts:1954-1975](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L1954-L1975); [src/usecases/run.ts:2190-2209](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L2190-L2209) |
| SEC-15 | プロバイダー境界におけるキャプチャされた実行値 | `verificationCoverage` を持たないレガシーな保存トレースは、未解決の `{{run.name}}` プレースホルダを除き、固定語彙以外の任意の値において、現在のケースでキャプチャされた空でない値を含んではならない（MUST NOT）。一致判定は部分文字列による。新規のエージェント的なナビゲーションURL、`fill.value`、およびテキスト／アサーションパターンは、現在のケースでキャプチャされた値と完全に一致してはならない（MUST NOT）。保存トレースの違反は、ブラウザのリプレイ前またはプロバイダが `priorTrace` を受け取る前に失敗する。新規実行の違反は、ブラウザ実行および永続化の前に失敗する。コンシューマは、キャプチャされた値を実体化するのではなく、認可された `RunRef` 補間を使用しなければならない（MUST）。 | [src/usecases/run.ts:1013-1063](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L1013-L1063); [src/usecases/run.ts:1316-1347](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L1316-L1347); [src/usecases/run.ts:1420-1458](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L1420-L1458); [src/usecases/run.ts:2190-2209](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L2190-L2209) |
| SEC-16 | 新規エージェントのアクション／アサートにおける実体化されたシークレット | 実体化の前に、すべての新規のエージェント的なアクションおよびアサーションは、現在のケースにおけるすべての空でない解決済みシークレットに対して、固定語彙以外の値をスキャンしなければならない（MUST）。`type`、`check`、`target.strategy`、`key`、および `secretRef` が唯一の閉じた語彙の除外対象である。スキャンされた値は、完全一致、または 3 UTF-16 コード単位以上の解決済みシークレットを含む場合に失敗しなければならない（MUST）。この失敗はブラウザ実行前の整合性の失敗（integrity failure）であり、アクションまたは成功したアサーションをジャーナルに追加したり、Groundingを更新したり、成果物の永続化に到達したりしてはならない（MUST NOT）。 | [src/usecases/run.ts:1252-1263](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L1252-L1263); [src/usecases/run.ts:1286-1313](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L1286-L1313); [src/usecases/run.ts:1420-1427](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L1420-L1427); [src/usecases/run.ts:1954-1975](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L1954-L1975); [src/usecases/run.ts:1991-2013](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L1991-L2013); [src/usecases/run.ts:2051-2116](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L2051-L2116) |

Canvas、画像、およびCSSレンダリングされたピクセル、ならびにアクセシビリティスキャンとスクリーンショットキャプチャの間の時間間隔は、依然として残留漏洩リスクである。本実装はこれらを検出可能であるとは主張しない。[src/usecases/run.ts:2610](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L2610)

すべての `TraceFillSecret` について、記録された `secretRef` は内包する Plan AI ステップの付与セットに含まれていなければならない（MUST）。付与されていない参照は整合性の失敗（integrity failure）であり、フォールバックを引き起こしてはならない（MUST NOT）。[src/usecases/run.ts:896](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L896) [src/usecases/run.ts:1075](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L1075)

## 設計根拠 {#rationale}

課題は、プロンプトの地の文、ログ、またはUIエビデンスをシークレットの流出経路にすることなく、エージェントが必要なクレデンシャルを入力できるようにすることである。認可は監査可能かつ限定的でなければならない。

採用された設計は、正規化されたプロンプトによる明示的な付与、局所的に帰属付けられたスパン、完全値の参照、および許可されたシンクオリジンを要求する。その連鎖内のいずれかのリンクが曖昧である場合、フェイルクローズとなる。

却下された代替案の1つは、一致するテキストから権限を推論するものであったが、例示や地の文は認可ではないため却下された。別の案はトレース内にリテラル値を永続化するものであったが、コミットされた成果物および診断情報は長期間残る情報漏洩面となるため却下された。 
