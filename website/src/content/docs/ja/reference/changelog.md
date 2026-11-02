---
title: 変更履歴
description: ambercast の各リリースにおける、ユーザーから見える製品の動作変更と公開コントラクトの変更を、破壊的変更を先頭にして記録する。
---

このページは、製品の動作と公開コントラクトに関するエントリだけを載せる。次の項目は載せない。リポジトリのアーキテクチャスキャナー、エージェントフック、ワークツリーのライフサイクル、lint 設定である。CI、テスト、ドキュメントサイト、プロジェクトのワークフローも載せない。

リリース 0.3.0 と 0.3.1 は製品に関するエントリがないため、節を設けない。リリース 0.4.0 は、3 回のプロデューサーバンドル改訂で既存の計画（plan）を古い状態にしたため、節を設けない。その改訂は `generatorSecretPolicy` 2 → 3 → 4 と `instructionCoveragePolicy` 1 → 2 である。以前のリリースの計画は `ambercast generate` で再生成する。これらのリリースのほかのエントリは、リポジトリの `CHANGELOG.md` にも載っている。

## リリース 0.9.0 {#release-090}

リリース日: 2026-10-08。レポートスキーマ 3.10。

| 区分 | 変更内容 |
| --- | --- |
| BREAKING | レポートスキーマ 3.10 は、ケーススコープのエラーコード `CASE_ABORTED`（`reason` と `stepId` を持つ）と `PROMPT_AMBIGUOUS`（`ambiguities` を持つ）を追加する。曖昧なプロンプトによる `generate` または `heal` の失敗は、実行スコープの `UNEXPECTED_CRASH` を伴う終了コード 3 ではなく、`PROMPT_AMBIGUOUS` を伴う終了コード 2 で終了する。これまでエラーコードなしで終わっていた実行行は、`CASE_ABORTED`、`AGENTIC_STEP_FAILED`、またはケーススコープの `UNEXPECTED_CRASH` を持つ。`heal` は Stage 3 と最終再生の失敗をケースエラーとして報告するため、サマリーはその行をエラー扱いで数える。終了コードは変わらない。`ambercast view` はエラーのヒントと詳細を表示する。 |
| Feature | すべての失敗経路が、コード付きで診断できるレポートエラーを返す。 |

バージョン 0.9.0 には、宣言された破壊的変更が 1 件ある。

## リリース 0.8.0 {#release-080}

リリース日: 2026-10-06。レポートスキーマ 3.9。

| 区分 | 変更内容 |
| --- | --- |
| Feature | レポートスキーマ 3.9 は、ケーススコープの環境エラーに `AGENTIC_STEP_FAILED` を追加する。また、確認に関する問題コード `confirms-unknown-step`、`confirms-not-earlier`、`confirms-not-action`、`confirms-duplicate` を `AiResponseIssueCode` に追加する。 |
| Fix | `generate` は、診断を組み立てる前に、プロバイダーのステップ ID にシークレットのリテラルが含まれないか確認する。 |
| Fix | `generate` は `navigate` ステップの `confirms` 参照を取り除き、違反をコードで報告する。 |
| Fix | `run` は、確認済みのグラウンディングエントリから得たバインディングに対して、常に `confirmed: true` を報告する。 |
| Fix | ランナーは、エージェントのステップ失敗を分類し、AI が指示したアサートを期限まで繰り返し確認する。 |

バージョン 0.8.0 には、宣言された破壊的変更がない。

## リリース 0.7.0 {#release-070}

リリース日: 2026-10-02。レポートスキーマ 3.8。

| 区分 | 変更内容 |
| --- | --- |
| BREAKING | 計画 v3 → v4 は、必須のステップ Target 名を追加し、計画のブラウザー選択を削除する。v3 の計画を再生成する。 |
| BREAKING | 計画 v4 → v5 は、ソースに裏付けられた `intent` と `confirms`、および Target スコープの `locale` を追加する。グラウンディング v2 → v3 は、素のフィンガープリントを、ロケーター、フィンガープリント、インテントダイジェスト、来歴に置き換える。v4 の計画とそのグラウンディングを再生成する。 |
| BREAKING | Target の設定が `targets.<name>.browser` から `targets.<name>.executor` に移り、ローダーは旧キーを拒否する。レポートに `EXECUTOR_UNSUPPORTED` と `sessions[name].executor` が加わる。 |
| BREAKING | UI エグゼキューターの種別語彙が統一される。`--resolve` なしで要素ステップがグラウンディングをミスすると、コードなしの終了コード 3 ではなく、`GROUNDING_UNRESOLVED` を伴う終了コード 4 で報告する。 |
| Feature | レポートスキーマが 3.8 に進む。3.7 はステップの Target 名と Target ごとのセッションを追加し、3.8 は heal Stage 1 の `binding` 診断を追加する。 |
| Feature | `ambercast init` が、設定、サンプルプロンプト、`.gitignore`、`AGENTS.md` を生成する。 |
| Feature | `ambercast view` は、`.runs` のレポートを表示する読み取り専用のローカルビューアーである。 |
| Feature | `targets.<name>.locale` で、ブラウザーコンテキストのロケールを指定できる。 |
| Feature | UI エグゼキューターの抽象化が、機能の事前確認を追加する。 |
| Feature | heal Stage 1 が `confirms` を通じて要素のインテントを再バインドする。 |
| Feature | 要素のインテント、引用の照合、インテントダイジェストのプリミティブが追加される。 |
| Feature | 計画 IR v4 は、ステップごとの Target と、Target ごとに 1 つのセッションを持つ。 |
| Feature | MCP の stdio サーバーが追加される。 |
| Feature | MCP のジョブモデルが `ambercast_job_status` と `ambercast_job_cancel` を追加する。 |
| Feature | MCP の heal 適用は 2 段階で行い、トークンの発行とエリシテーションを伴う。 |
| Feature | ランタイムイベントのファンアウトが MCP に対応し、heal の準備が 2 フェーズになる。 |
| Fix | `init` は、生成する設定にブラウザーを追加し、BOM に対して安全に計画を立て、失敗時は適用の前に中止する。 |
| Fix | MCP サーバーは、失敗したジョブと heal 適用のクラッシュに対して `AMBERCAST_DEBUG` 診断を出力する。 |
| Fix | MCP サーバーは、シャットダウン中に、heal 適用の確認と処理中のツール応答を待つ。 |
| Fix | MCP サーバーは、進捗通知の送信に失敗すると stderr に 1 行書き込む。 |
| Fix | レポートは、`AI_RESPONSE_INVALID` に生成時の問題の詳細を保持する。 |
| Fix | `run` は、エージェントによる Target 解決の失敗を、診断付きで回復する。 |
| Fix | `run` は、アサートとバインディングについて、期限の時点で最後のポーリングサンプルを取得する。 |
| Fix | `view` は、すべての 3.x スキーマバージョンの実行レポートを、寛容に読み込む。 |
| Fix | `view` は、既定ポートの `Host` ヘッダーと authority 形式でない `Host` ヘッダーを拒否し、属性内の `runId` をエスケープする。 |
| Fix | `view` は、スクリーンショットと長いテキストがステップ表からあふれないようにする。 |
| Fix | `view` は、デザインシステムのダークトークン、ステップ表のステータスバッジ、ゼロを省いた合計を適用する。 |

バージョン 0.7.0 には、宣言された破壊的変更が 4 件ある。

## リリース 0.6.0 {#release-060}

リリース日: 2026-09-18。レポートスキーマ 3.6。

| 区分 | 変更内容 |
| --- | --- |
| BREAKING | スキーマ検証に失敗したエージェントの MCP ツール呼び出しは、最初の不一致で `INTEGRITY_VIOLATION` をラッチしなくなる。ケースごとに連続 3 回までの拒否は、残りの予算を添えた構造化結果を返す。4 回目でケースは、`INTEGRITY_VIOLATION`（kind `usage`、終了コード 4）ではなく、`AI_RESPONSE_INVALID`（kind `environment`、終了コード 3）で終わる。この変更でレポートスキーマのバージョンは動かない。 |
| Feature | レポートスキーマ 3.6 は、完了した heal の結果に任意の診断 `repairTrace` を追加し、ドライランと適用は同じ結果を返す。 |
| Feature | `run` は、解決の前に要素が存在するまで待つ。 |

バージョン 0.6.0 には、宣言された破壊的変更が 1 件ある。

## リリース 0.5.0 {#release-050}

リリース日: 2026-09-15。レポートスキーマ 3.5。

| 区分 | 変更内容 |
| --- | --- |
| BREAKING | 計画 v2 → v3 は、シークレットグラントの来歴を削除する。旧グラント行を削除し、`generate --force` で再生成して、同意／`secrets.allow` モデルで候補のシークレット名を承認する。計画 v2 はその場で移行されない。レポートスキーマ 3.5 は、シークレットポリシーのエラーコード `SECRET_ENV_VAR_COLLISION`、`SECRET_CONSENT_REQUIRED`、`SECRET_SYNTAX_REJECTED`、任意の `GROUNDING_UNRESOLVED` の詳細、任意の `GenerateResult` の `secrets` と `warnings` フィールドを追加する。旧来の `@ambercast-secret` グラント行と `{{secrets.*}}` プロンプト構文は、終了コード 2 で拒否される。 |
| BREAKING | 既存の計画は古い状態になり、`ambercast generate --force` で再生成する。命令カバレッジの基準は `startAnchor`、`startColumn`、`endAnchor`、`endColumn` を持ち、`instructionCoveragePolicy` のリビジョンは 2 から 3 に進む。 |
| BREAKING | `generate` は、新たに検出したシークレット名ごとに同意ゲートで止まる。対話端末では `y / N / i` を尋ね、それ以外の実行は終了コード 2 で終了して、許可されていない名前を列挙する。同意すると、その名前が `secrets.allow` に追記される。 |
| BREAKING | `run` は、`--resolve` を付けた場合に限り、AI でグラウンディングのミスを解決する。`--cache-only` は削除され、終了コード 2 で終了する。`GROUNDING_UNRESOLVED` は終了コード 4 に対応する。 |
| Feature | `run` に、プロセス内 MCP サーバーを使うエージェントエグゼキューターが加わる。 |
| Feature | 命令カバレッジは、アンカー ID で照合する。 |
| Feature | heal の Stage 2 と Stage 3 は、許可リストモデルの下で、シークレット集合の不変性を保って動く。 |
| Feature | シークレット名の付与は決定的になり、許可リストが検証される。 |
| Fix | `generate` は、埋め込まれたシークレット参照を理由に拒否されたプロバイダー応答を再試行する。 |
| Fix | `BROWSER_LAUNCH_FAILED` は、ヒントと詳細を付けて分類される（レポートスキーマ 3.4）。 |

バージョン 0.5.0 には、宣言された破壊的変更が 4 件ある。

## リリース 0.2.0 {#release-020}

リリース日: 2026-09-04。

| 区分 | 変更内容 |
| --- | --- |
| BREAKING | プロバイダーリクエストスキーマにおいて `producerBundleFingerprint`、ひいてはすべてのプロンプトの `inputsDigest` が変更された。すべての 0.1.0 の計画を再生成する。`check` は古い計画を stale として終了コード 4 で報告し、`generate` または `--force` により新しい計画を作成する。 |
| Fix | 生成処理において、プロバイダーレスポンス内の空の `verificationIntent` を受け入れるようになった。 |
| Fix | `generate --list` は、生成処理で実際に必要とされない限り、AI プロバイダーを解決しない。 |
| Fix | 人間向けレポート出力において、制御シーケンスがサニタイズされる。 |

バージョン 0.2.0 には、宣言された破壊的変更が 1 件あり、修正より前に置いている。

## リリース 0.1.0 {#release-010}

リリース日: 2026-09-03。

| 区分 | 変更内容 |
| --- | --- |
| BREAKING | v1 フィンガープリントのプリイメージが変更され、正規化された親要素および隣接兄弟要素の識別情報が含まれるようになった。古いグラウンディングはミスマッチとなり、通常の再生では1回の AI フォールバックが実行され、キャッシュ専用（cache-only）および CI での再生では完全なミス（clean miss）時に処理を中止（abort）する。 |
| BREAKING | TypeScript のビルドベースラインとして Node.js 22.14 以降が必須となった。 |
| Feature | ブラウザキャプチャに単一のアクセシビリティキャプチャと、3チャネルの OR シークレット検出機能が追加された。 |
| Feature | 実ストレージおよびシステムアダプターが利用可能になった。 |
| Feature | `generate` が Claude Code CLI および Codex CLI アダプターと接続された。 |
| Feature | 設定の読み込みとパッケージ化された JSON Schema が実装された。 |
| Feature | Canonical JSON シリアライゼーションとダイジェスト計算が実装された。 |
| Feature | グラウンディングがトレースの唯一の権威となった。 |
| Feature | 計画／グラウンディングの Zod スキーマおよび JSON Schema 生成が実装された。 |
| Feature | AI グラウンディングトレースがイベントと検証レコードの形式に再設計された。 |
| Feature | レイアウトレゾルバーと共通設定ボキャブラリが追加された。 |
| Feature | `inputsDigest` に計画の producer-bundle フィンガープリントが含まれるようになった。 |
| Feature | シークレット参照に明示的な付与行（grant lines）と逐語引用（verbatim citation）検証が導入された。 |
| Feature | グラウンディングリポジトリ／書き戻しポリシーが、グラウンディング未検出の検知と統合された。 |
| Feature | `heal` にコミットプリイメージの完全性検証と `runsDir` への書き込み封じ込めが追加された。 |
| Feature | `heal` にフロンティア単一ステップの Stage 2 イテレーションが追加された。 |
| Feature | 3段階の heal ステートマシンが実装された。 |
| Feature | Heal CLI の確認プロンプトとコマンド配線が実装された。 |
| Feature | `heal` に実際の AI ディスパッチに対するケーススコープの承認バジェット（admission budget）が追加された。 |
| Feature | `heal` に1回読み取りの検証済みスナップショットプリイメージが追加された。 |
| Feature | `run` と `heal` が単一のグラウンディング回復テーブルを共有するようになった。 |
| Feature | `heal` の Stage 2 プロバイダーコンテキストが構造化され、現在の計画を含むようになった。 |
| Feature | 計画スキーマバージョン 2 で命令カバレッジ（instruction coverage）が必須となった。 |
| Feature | ストレージ書き込みにアトミック書き込みコントラクトが追加された。 |
| Feature | 設定に `secretSinkOrigins` が追加され、ブラウザポートに専用の `fillSecret` が追加された。 |
| Feature | ブラウザ要素の解決が `BoundElement` ライブハンドルに移行し、`.first()` が廃止された。 |
| Feature | 構造化レポートにスキーマ 2.0 の中断および正規化動作が追加された。 |
| Feature | Heal レポートに一覧化されたブランチと `dryRun` が追加された。 |
| Feature | レポートの確定処理が単一の型付き境界となった。 |
| Feature | レポートスキーマ 3.0 において、heal の `repairOutcome` が `application` から分離された。修復を拒絶した場合は終了コード 1 で終了する。 |
| Feature | レポートスキーマ 3.1 により、コードごとの任意のエラー `details` が追加され、すべてのレポートエラーで `hint` を使用できるようになった。 |
| Feature | `run` に Chromium でのグラウンディングヒット時に AI 呼び出しゼロで再生する機能が追加された。 |
| Feature | `run` にグラウンディングミス時のリカバリおよびトレース再生機能が追加された。 |
| Feature | `run` に `--allow-empty` と `--list` が実装され、`--stale=regenerate` は意図的に未サポートのまま維持された。 |
| Feature | `run` が失敗の証跡およびその RunReport を `.runs` 配下に永続化するようになった。 |
| Feature | コマンド間でのターゲット選択が統合された。 |
| Feature | `check` が読み取り専用の計画／グラウンディング鮮度ゲートとなった。 |
| Fix | Codex CLI の未完了時に stderr の抜粋を保持するようになった。 |
| Fix | ブラウザへの入力直前に secret-sink オリジンが再検証されるようになった。 |
| Fix | `fillSecret` が単一の要素ハンドルに固定されるようになった。 |
| Fix | `check` が inverse-then-judge によるアーティファクトスキャンと、検出専用の `--list` を使用するようになった。 |
| Fix | `check` と `run` が正規のグラウンディング検証を共有するようになった。 |
| Fix | 子プロセスの破棄において、spawn 失敗後に実際の close イベントを待機するようになった。 |
| Fix | v1 フィンガープリントの実装が修正され、フォールバック中に AI から提供されたフィンガープリントが検証されるようになった。 |
| Fix | スキーマの正規表現処理が、dotAll の欠落および `baseUrl` のシークレット漏洩ギャップに対して強化された。 |
| Fix | フィンガープリントのパース処理がフェイルクローズとなり、受け入れられるアルゴリズムが `a11y-neighborhood-v2` に変更された。 |
| Fix | `heal` は修復可能なナビゲーションの分類を case-outcome エラーのみに限定するようになった。 |
| Fix | `heal` の調停および伝播処理が、整合性違反時にフェイルクローズするようになった。 |
| Fix | `heal` がフェーズトークン上のディスパッチプロトコル違反をラッチするようになった。 |
| Fix | `heal` の Stage 2 において、型付き拒絶を伴って secret-grant シードを保持するようになった。 |
| Fix | `heal` が実際の CLI 子プロセスの破棄を監視し、フェイルクローズなクリーンアップを行うようになった。 |
| Fix | `heal` が AI 呼び出しの送出をディスパッチバジェットの承認と同期させるようになった。 |
| Fix | アトミック書き込みコントラクトのカバレッジとドキュメントが強化された。 |
| Fix | Run レポートの識別パスがプロジェクトルート相対になった。 |
| Fix | 認証情報ヒューリスティックのリテラル検出が `fill.value` に対しても対称的に適用されるようになった。 |
| Fix | 再生処理がクロスオリジンバイパスとして `blob:` ナビゲーションを拒否するようになった。 |
| Fix | グラウンディングフォールバックの AI タイムアウトが合成・分類されるようになった。 |
| Fix | プロバイダーの可用性プローブに新しいアボートタイムアウトが設定されるようになった。 |
| Fix | Run のスクリーンショットがプロジェクトルート相対となり、レポートの永続化に3つの状態が定義された。 |
| Fix | アクセシビリティスナップショットがリダクトされ、AI 境界においてスクリーンショットが差し控え（withhold）られるようになった。 |
| Fix | レポート境界においてシークレットおよび実行時の値がリダクトされるようになった。 |
| Fix | 再生処理がクロスオリジンナビゲーションを拒否するようになった。 |
| Fix | 埋め込みシークレット参照が拒否され、永続化前にグラウンディングが再検証されるようになった。 |
| Fix | 解決済みシークレットのスキャンがトレースに対して反復的かつフェイルクローズになった。 |
| Fix | `run` が厳格な 1 対 1 の secret-grant 消費を強制し、帰属が不健全（attribution-unsound）な新規計画を再生成するようになった。 |
| Fix | AI CLI の子プロセス環境変数が拒絶され、応答しない子プロセスはアボート時に回収（reap）されるようになった。 |
| Fix | プロンプトに存在しない、生成または再生されたシークレット参照が拒否されるようになった。 |
| Fix | 終了コードの集約順序として `2 > 3 > 4 > 1 > 5 > 0` が使用されるようになった。 |
| Fix | `generate` がイベントシンクを接続し、Claude CLI リクエストから `$schema` を削除するようになり、さらに run のステップ開始タイミングが修正された。 |

## 関連項目 {#see-also}

- [互換性表](/ambercast/ja/reference/compatibility/#compatibility-table)
- [再生成の境界](/ambercast/ja/reference/compatibility/#regeneration-boundary)
- [バージョン間のアップグレード](/ambercast/ja/how-to/upgrade/)
- [仕様変更履歴](/ambercast/ja/spec/changelog/)
