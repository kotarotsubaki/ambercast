---
title: "計画におけるシークレット"
description: "この章は、計画がシークレットを参照する方法、シークレット名を認可する方法、解決した値の送信先、リテラルのシークレットを拒否する方法を定める。"
---

## 認可 {#authorization}

計画（plan）は、シークレットの値を [値型](/ambercast/ja/spec/value-types/#shared-types) の `SecretRef` だけで表さなければならない（MUST）。`InterpolatableText` では、連続した `{{secrets.` という補間マーカーを禁止する（`src/core/ir/schema.ts:31-33`、`src/core/ir/schema.ts:37,193`）。

コミット済みの `fill-secret` は、`target: ElementRef` と `secretRef: SecretRef` だけを含まなければならない（MUST）。コミット済みの AI ステップが持つ任意の `secrets` 配列は、`AiStepSecretUse` のエントリを含み、各エントリは `{ "ref": SecretRef }` だけである。どちらのコミット済み形式にも、プロバイダーの命名データ、引用データ、プロンプト由来の出所情報は含まれない（`src/core/ir/schema.ts:572,576`、`src/core/ir/schema.ts:876-884`、`src/core/ir/schema.ts:682-698`）。

実行時には、`NAME` のすべての `.` を `_` に置き換えて大文字にした `AMBERCAST_SECRET_<NAME>` だけが、`{{secrets.NAME}}` の解決元になる。解決した値は計画に入ってはならない（MUST NOT）（`src/core/secrets/env-var-name.ts:8-16`、`src/adapters/system/env-secrets-provider.ts:14-34`）。

## 同意と許可リスト {#grant-origin}

生成は、まず候補の計画を作り、その計画とグラウンディングを永続化する前に同意を決めなければならない（MUST）。候補の段階では、プロバイダーの各提案をローカルで `SecretName` に解決し、`SecretRef` に包み、すべての使用を報告する。同意の段階では、`ambercast.config.json` の `secrets.allow` にすでにある名前と、ユーザーが受け入れた名前だけを通す（`src/usecases/generate.ts:1314-1326,1564-1624`、`src/usecases/generate.ts:1670-1741`、`src/core/config/schema.ts:139-145`）。

`SecretName` は、設定と同意が使う論理名そのものである。`SecretRef` は、その名前を計画で `{{secrets.NAME}}` の形に包んだものである。プロバイダー向けの `fill-secret` は、代わりに `secret?: SecretNameChoice` を持ってもよい（MAY）。`{ "allowedName": SecretName }` は、すでに投影された許可リスト内の名前を要求する。`{ "nameHint": SecretNameHint }` は、新しく見つけた名前を提案する。

`SecretNameChoice` は排他的な厳密ユニオンであり、`SecretNameHint` は `/^[a-z][a-z0-9_]{0,63}$/` に一致する。プロバイダー向けの AI のシークレット使用にも同じ選択を使い、プロバイダーが選択を出さないときは空の厳密オブジェクトを使う。コミットされる `SecretRef` はすべて、プロバイダーの参照ではなく、ローカルの決定論的な命名が作る（`src/core/ir/schema.ts:100-148`、`src/core/ir/schema.ts:1016-1029`、`src/core/ir/schema.ts:1139-1160`、`src/usecases/secret-naming.ts:172-205,320-337`）。

受け入れの際には、新しく受け入れた名前を `secrets.allow` にマージしなければならない（MUST）。これにより、以後の生成ではその名前について改めて判断しない。`secrets.allow: "*"` はすべての名前を受け入れ、同意のゲートを通さない。このワイルドカードは、手間を減らす代わりにリスクが高い抜け道である。AI が提案した任意のシークレット名を、名前ごとの確認なしに受け入れる。そのリスクを理解した場合にだけ使わなければならない（MUST）（`src/usecases/generate.ts:1670-1671,1711-1729`、`src/config/write-secrets-allow.ts:52-82`）。

`consentMode: "forbid"` を使うとき、生成は提案した計画とシークレットの使用を含む `candidate` の結果を返さなければならない（MUST）。このときアーティファクトを書いたり同意を求めたりしてはならない（MUST NOT）。同意が拒否された場合や、端末が非対話式で同意を取れない場合、生成は `SECRET_CONSENT_REQUIRED` で失敗しなければならない（MUST）。候補を黙って永続化してはならない（MUST NOT）（`src/usecases/generate.ts:1652-1668`、`src/usecases/generate.ts:1673-1674`、`src/usecases/generate.ts:1498-1505,1730-1740`、`src/runtime/secret-consent.ts:293-321`）。

プロバイダーが受け取るのは、投影または交渉したシークレット名であり、シークレットの値ではない。名前自体が内容を示すことがあるため（たとえば `stripe_api_key`）、これはプロバイダーへの開示リスクとして受け入れる。実装は、これを値の開示として表してはならない（MUST NOT）（`src/usecases/generate.ts:927-947,1183`、`src/core/ir/schema.ts:100-148`）。

`heal` は、新しい同意の判断をしてはならない（MUST NOT）。Stage 3 のフル計画の候補が論理的なシークレット名の集合を変えるとき、`heal` はオーバーレイを元に戻さなければならない（MUST）。その場合、`heal` は `secret-set-rejected` の結果の分岐を返さなければならない（MUST）。この分岐は `stage3Rejection.reason: "secret-set-changed"`、`added`、`removed` を持ち、ケースの結果は `commit: undefined` になる。

出荷済みの CLI は、この分岐のローカライズしたヒントを `秘匿値の構成が変わった。ambercast generate --force <file> で再生成し同意を取り直す` のまま表示する。ローカルの命名、許可リストの検証、環境変数の衝突のいずれかが、許可された置換計画を妨げるときは、Stage 2 が別の拒否理由 `secret-name-invalid` を使う（`src/usecases/heal.ts:210-221`、`src/usecases/heal.ts:1034-1068`、`src/usecases/heal.ts:1188,1207-1214`、`src/usecases/heal.ts:1528-1556`、`src/ports/system.ts:8-33`、`src/cli/main.ts:299-301`）。

## 送信先とマスキング {#sink-and-redaction}

シークレットの送信先オリジンは、HTTP(S) のオリジンでなければならず（MUST）、連続した `{{secrets.` という補間マーカーを含んではならない（MUST NOT）。このスキーマ上の制約だけでは、シークレットに見える任意のリテラルが存在しないことは証明できない。コンシューマーは、コミット済みのグラウンディングのトレースデータに、リテラルのパスワードではなく参照を残さなければならない（MUST）（`src/core/ir/schema.ts:40,163-165`、`src/core/ir/schema.ts:1293-1302`）。

送信先ポリシーは、実行時にオリジンを解析して正規化する。`secretSinkOrigins` に要求されたシークレットの項目がなければ、`baseUrl` だけを許可する。項目が空なら何も許可せず、空でない項目はこの既定を置き換える。

実際の `fill-secret` ごとに、実行パイプラインは、シークレットを解決する直前に、ライブのページのオリジンを検査しなければならない（MUST）。ブラウザーアダプターは、要素を取得した後、入力する直前に同じポリシーを繰り返さなければならない（MUST）。これにより、ナビゲーションや DOM の変化でライブのオリジンの境界を迂回できない（`src/core/secrets/sink-policy.ts:59-100`、`src/usecases/run.ts:3033-3040`、`src/usecases/run.ts:1045-1059,1164-1166`、`src/adapters/browser/chromium.ts:424,439,443-444`）。

## リテラルのシークレットの拒否 {#literal-secret-rejection}

この節は、リテラルのシークレットを検出する意味の正本である。リファレンスのページは、検出の境界をそれぞれの目的に合わせて要約するだけにとどめ、ここへリンクしなければならない（MUST）。永続化またはレポートのシリアライズの前に、生成は、プロバイダー由来のすべての JSON の文字列とオブジェクトキーを検査しなければならない（MUST）。検査には `generatorMeta`・`ambiguities`・`assumptions` も含め、キーの辞書順と配列の添字の順にたどる。

文字列の値またはオブジェクトキーごとに、埋め込まれた `{{secrets.` マーカー（SEC-17）は、下の4つの基本検出器を調べる前に拒否しなければならない（MUST）。基本検出器のうち、下の固定順で最初に一致したものを拒否しなければならない（MUST）（`src/usecases/generator-secret-policy.ts:162-250`）。

秘密の検出に一致した `assumptions` の項目は、`An assumption was omitted because it looked like a secret.` に置き換えなければならない（MUST）。生成は、その置換を使って続けなければならない（MUST）（`src/usecases/generate.ts:1242-1254`）。

| id | 検出器 | 一致する値 | 例外 | 分類される失敗 |
| --- | --- | --- | --- | --- |
| SEC-01 | `credential-prefix-sk` | `sk-` で始まる | 文字列値またはオブジェクトキーが有効な値全体の `SecretRef` である場合。`source.inputsDigest` のみ。 | `SECRET_LITERAL_REJECTED`、終了コード `2` |
| SEC-02 | `credential-prefix-ghp` | `ghp_` で始まる | 文字列値またはオブジェクトキーが有効な値全体の `SecretRef` である場合。`source.inputsDigest` のみ。 | `SECRET_LITERAL_REJECTED`、終了コード `2` |
| SEC-03 | `credential-prefix-aws-access-key` | `AKIA` で始まる | 文字列値またはオブジェクトキーが有効な値全体の `SecretRef` である場合。`source.inputsDigest` のみ。 | `SECRET_LITERAL_REJECTED`、終了コード `2` |
| SEC-04 | `high-entropy-token` | トークン形（32 UTF-16 コード単位以上、空白なし、全文字が `[A-Za-z0-9+/=_.-]`）で、シャノンエントロピーが 4.0 ビット以上。頻度のキーは Unicode コードポイントで数え、各確率の分母には UTF-16 コード単位の長さを使う。 | 文字列値またはオブジェクトキーが有効な値全体の `SecretRef` である場合。`source.inputsDigest` のみ。値の位置が `steps[<index>].url`・`steps[<index>].pattern`・`targets[<key>].baseUrl` のときも免除する。値の位置が `steps[<index>].id`・`steps[<index>].confirms[<index>]`・`steps[<index>].instructionCoverage[<index>].id` で、値が読みやすいスラッグのときも免除する。スラッグとは、ステップ ID の文法に合い、ハイフンで区切った2つ以上のセグメントを持ち、各セグメントが `[a-z]+`・`[0-9]{1,3}`・`[a-z]{1,4}[0-9]{1,3}` のいずれかで、2つ以上のセグメントが `[a-z]+` であるものである。オブジェクトキーとその他の位置は免除しない。 | `SECRET_LITERAL_REJECTED`、終了コード `2` |
| SEC-17 | `embedded-secret-reference` | 文字列値またはオブジェクトキーが、有効な値全体の `SecretRef` ではなく、`{{secrets.` マーカーを含む | `source.inputsDigest` のみ | `SECRET_LITERAL_REJECTED`、終了コード `2` |

有効な値全体の `SecretRef` である文字列値またはオブジェクトキーは、この節のすべての検出器を免除される。それ以外のキーは、値をたどる前に検出器へ渡す。拒否の診断には、検出器とマスク済みの JSON 風パスだけを含めなければならない（MUST）。検出したリテラルを保持してはならず（MUST NOT）、検出したオブジェクトキーは `[redacted-key]` と表す（`src/usecases/generator-secret-policy.ts:182-193`、`src/usecases/generator-secret-policy.ts:220-250`、`src/report/error-mapping.ts:82`、`src/core/errors/exit-codes.ts:45`）。

## 境界ごとの秘匿要件 {#boundary-specific-secrecy}

| id | 境界 | 要件 | 根拠 |
| --- | --- | --- | --- |
| SEC-05 | 生成 | プロバイダー由来の JSON は、永続化またはレポートのシリアライズの前に、リテラルのシークレットの拒否を通らなければならない（MUST）。 | `src/usecases/generator-secret-policy.ts:162-168,219` |
| SEC-06 | フィンガープリントの生成 | 空でない解決済みシークレットを完全一致で含む記述子は、`secret-contaminated` を生成しなければならない（MUST）。部分文字列の照合は、比較する値が3 UTF-16 コード単位以上のときだけ使う。この記述子はフィンガープリントを生成してはならない（MUST NOT）。 | `src/core/ir/fingerprint.ts:266-268,388-390` |
| SEC-07 | コミット済みトレース | `TraceFillSecret` は、実体化した値ではなく `secretRef` を保存しなければならない（MUST）。 | `src/core/ir/schema.ts:1293-1302` |
| SEC-08 | グラウンディングの永続化 | 実行パイプラインは、走査した文字列値が空でない解決済みシークレットと等しいとき、または3 UTF-16 コード単位以上の解決値を含むとき、グラウンディングの書き込みを拒否しなければならない（MUST）。これは整合性違反に分類しなければならない（MUST）。 | `src/usecases/run.ts:4445-4459`; `src/usecases/run.ts:1526-1543` |
| SEC-09 | 診断と報告可能なエラー | 実行パイプラインは、診断またはレポートのシリアライズの前に、JSON の文字列とオブジェクトキーをマスクしなければならない（MUST）。 | `src/usecases/run.ts:1829-1870,2081-2110` |
| SEC-10 | AI に渡すアクセシビリティ証拠 | AI プロバイダーへ送るアクセシビリティ証拠は、文字列値とオブジェクトキーから解決済みの値をマスクしなければならない（MUST）。スクリーンショットのバイト列はこの境界を越えてはならない（MUST NOT）。 | `src/usecases/run.ts:2466-2485,2818-2828` |
| SEC-11 | スクリーンショットの永続化 | アクセシビリティのキャプチャから解決済みシークレットの検出が値を見つけた場合、解決後にキャプチャを検査できない場合、検出に失敗した場合、スクリーンショットを保持してはならない（MUST NOT）。 | `src/usecases/run.ts:3318-3331,3396-3399` |
| SEC-12 | AI トレースのシークレットマーカー | キャッシュした AI トレースの子孫のうち文字列値であるものは、専用の `TraceFillSecret.secretRef` フィールドを除き、連続した `{{secrets.` マーカーを含んではならない（MUST NOT）。違反は整合性の失敗であり、プロバイダーの実行へフォールバックしてはならない（MUST NOT）。 | `src/usecases/run.ts:1250-1264` |
| SEC-13 | キャッシュした AI トレースの実体化シークレット | 再生の前に、パイプラインは、保存したトレースのイベントと検証リストにある各 `fill-secret` の参照のうち、含む計画の AI ステップが列挙したものを解決しなければならない（MUST）。得られた値は、現在のケースで解決済みの値に加わる。次に、固定の語彙 `type`・`check`・`target.strategy`・`key`・`secretRef` を除くすべてのトレースの値を走査しなければならない（MUST）。空でない解決済みシークレットとの完全一致、または3 UTF-16 コード単位以上のシークレットとの部分一致は整合性の失敗であり、プロバイダーの実行へフォールバックしてはならない（MUST NOT）。 | `src/usecases/run.ts:1351-1384`; `src/usecases/run.ts:1265-1274,1545-1566`; `src/usecases/run.ts:2680-2684,2719-2722` |
| SEC-14 | AI の `fill.value` の認証情報リテラル | ブラウザーの実行の前に、保存したトレースと新しいエージェント実行の `fill.value` は、`sk-`・`ghp_`・`AKIA` の検出器を無条件に拒否しなければならない（MUST）。高エントロピーの一致が許されるのは、取得した現在のケースの値を除くと検出器に一致しなくなる場合だけである。この例外はプレフィックスの検出器には適用しない。違反は整合性の失敗である。保存したトレースの検証はフォールバックしてはならず（MUST NOT）、新しいエージェント実行はブラウザーの実行やジャーナルの永続化に到達してはならない（MUST NOT）。 | `src/usecases/run.ts:1295-1302`; `src/usecases/run.ts:1647-1680`; `src/usecases/run.ts:1710-1713,2343`; `src/usecases/run.ts:2680-2684,2719-2722` |
| SEC-15 | プロバイダー境界での取得済みの実行値 | `verificationCoverage` を持たない旧形式の保存トレースは、未解決の `{{run.name}}` プレースホルダーを除き、固定語彙でないどの値にも、現在のケースで取得した空でない値を含んではならない（MUST NOT）。照合は部分文字列で行う。新しいエージェント実行のナビゲーション URL・`fill.value`・テキストとアサーションのパターンは、現在のケースで取得した値と等しくてはならない（MUST NOT）。保存トレースの違反は、ブラウザーの再生の前、またはプロバイダーが `priorTrace` を受け取る前に失敗させる。新しい実行の違反は、ブラウザーの実行と永続化の前に失敗させる。コンシューマーは、取得した値を実体化せず、認可された `RunRef` 補間を使わなければならない（MUST）。 | `src/usecases/run.ts:1590-1622`; `src/usecases/run.ts:1275-1281`; `src/usecases/run.ts:1704-1733`; `src/usecases/run.ts:2680-2684,2702` |
| SEC-16 | 新しいエージェントのアクション・アサーションの実体化シークレット | 実体化の前に、新しいエージェントのすべてのアクションとアサーションは、固定語彙でない値を、現在のケースで解決済みの空でないすべてのシークレットに照らして走査しなければならない（MUST）。閉じた語彙として除外するのは `type`・`check`・`target.strategy`・`key`・`secretRef` だけである。走査した値は、完全一致、または3 UTF-16 コード単位以上の解決済みシークレットを含む場合に、失敗させなければならない（MUST）。この失敗はブラウザーの実行前の整合性の失敗である。アクションや成功したアサーションをジャーナルへ追加したり、グラウンディングを更新したり、アーティファクトの永続化に到達したりしてはならない（MUST NOT）。 | `src/usecases/run.ts:1526-1543`; `src/usecases/run.ts:1545-1588`; `src/usecases/run.ts:1695-1702`; `src/usecases/run.ts:2333-2343`; `src/usecases/run.ts:2391-2403`; `src/usecases/run.ts:2373` |

キャンバス・画像・CSS で描画したピクセルと、アクセシビリティの走査からスクリーンショットの取得までの間は、開示リスクとして残る。この実装は、それらを検出するとは主張しない（`src/usecases/run.ts:3358-3359`）。

すべての `TraceFillSecret` について、記録した `secretRef` は、含む計画の AI ステップがコミットした `secrets[].ref` の集合に含まれなければならない（MUST）。列挙されていない参照は整合性の失敗であり、フォールバックを起こしてはならない（MUST NOT）（`src/usecases/run.ts:1356-1360,2668`、`src/usecases/run.ts:1158-1162`）。

## 設計根拠 {#rationale}

問題は、必要な認証情報をエージェントに入力させながら、プロンプトの文章・ログ・UI の証拠をシークレットの経路にしないことである。認可は、監査でき、範囲が狭くなければならない。

採用した設計は、プロバイダーによる発見と認可を分ける。ローカルで導いた候補名を同意のために示し、永続的な許可リストの項目は監査でき、コミットされる計画には値全体の参照だけを記録する。同意が拒否された場合や取れない場合は、安全側に倒れて失敗する。送信先オリジンの境界は、これとは独立に強制され続ける。

却下した案は2つある。1つは、認可の構文をプロンプトの文章に埋め込み、プロンプトの範囲を永続化する案で、プロンプトの言い回しは持続的で監査できる同意の仕組みにならないため却下した。もう1つはトレースにリテラルの値を残す案で、コミットされるアーティファクトと診断は長く残る開示の面になるため却下した。
