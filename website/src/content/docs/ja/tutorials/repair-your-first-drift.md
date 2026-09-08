---
title: UI変更後にテストを修復する
description: UI変更によって失敗したテストに対し、ターゲットのhealReplayIsolationを設定して安全に修復する手順を学びます。
---

本チュートリアルでは、すでに生成済みのテストが存在する、使い捨ての練習用アプリケーションを前提として進めます。デフォルトのステートフルなターゲットは修復できません。設定およびコマンドの仕様についての詳細は、[設定](/ambercast/ja/reference/configuration/) および [ambercast heal](/ambercast/ja/reference/cli/heal/) を参照してください。

## 手順 {#steps}

作業スコープとして、既存の設定を維持し、選択したターゲットの `healReplayIsolation` キーのみを変更します。ターゲット名、`baseUrl`、`browser`、およびすべての `secretSinkOrigins` は変更しないでください。ターゲットの追加、削除、名前変更、その他の編集も行ってはいけません。指定された `targets` レコードはデフォルト設定を置き換えます。ターゲット名とその定義は `inputsDigest` の計算対象となりますが、`healReplayIsolation` は意図的にそのダイジェスト契約の対象外とされています。

1. `ambercast.config.json` において、選択した既存ターゲットのエントリを編集し、`healReplayIsolation` のみを `"idempotent"` に変更します。設定ファイルが存在しないデフォルトターゲットの場合、同等の維持設定は次のとおりです。

```json
{"$schema":"https://kotarotsubaki.github.io/ambercast/schemas/config.schema.json","targets":{"web-user":{"baseUrl":"http://localhost:3000","browser":"chromium","healReplayIsolation":"idempotent"}},"defaultTarget":"web-user"}
```

ターゲット名およびダイジェストに参加する定義が変更されていないため、既存の Plan の鮮度（freshness）は保たれます。変更されるのはライブ修復ポリシーのみです。このファイルは `RawConfig` で必須とされている `$schema` を満たしており、Schema URL は公開されている設定用 Schema URL です。

2. 失敗する実行を行う前に、runs ディレクトリの保持ポリシーと承認された閲覧者を確認します。完了した `run` はそのディレクトリに `report.json` を保存しようとし、失敗時のスクリーンショットを保存する場合があるためです（ベストエフォートであり、シークレット検出時、キャプチャ失敗時、またはストレージ書き込み失敗時には省略されます）。確認後、ロケーターに影響を与える UI の変更を行い、`npx ambercast run --cache-only tests/ambercast/<name>.test.md` を実行します。修復を試みる前に、テストが失敗した結果を確認してください。

`--cache-only` を指定すると、グラウンディングのミスが発生した際に AI による再グラウンディングを行わずにテストを失敗させます。これにより、明示的な修復承認を得る前にバージョン管理されたグラウンディングが上書きされるのを防ぎます（デフォルトの `grounding.localWriteBack: "auto"` では、再解決されたフィンガープリントが永続化され、実行が成功してしまう可能性があります）。

3. `npx ambercast heal --dry-run tests/ambercast/<name>.test.md` を実行し、dry-run レポートを確認します（runs ディレクトリの保持ポリシーと閲覧者はステップ2で確認済みです）。

バッファされた Plan および Grounding の書き込みが未適用のままである場合、レポートには完了した修復が `preview-only` として記録されます。このレポートは候補パッチのバイト列を公開しないため、このステップは書き込み前の diff レビューではなく、承認可否を判断するためのものです。ただし、各リプレイは試行ごとの専用子ディレクトリを使用し、失敗時のスクリーンショットは隔離された証拠としてそこに保存される可能性があるため、dry-run は一切書き込みを行わないプレビューではない点に留意してください。

4. 人間による明示的な承認を得た上で、実行経路を選択します。対話型ターミナルで人間が実行する場合は `npx ambercast heal tests/ambercast/<name>.test.md` を実行し、ambercast の CLI 確認プロンプトに応答します。エージェントやその他の非対話型呼び出し元が実行する場合は、その明示的な承認が会話内に現れた後にのみ `npx ambercast heal --yes tests/ambercast/<name>.test.md` を実行します。

`--yes` は CLI の確認プロンプトのみを事前承認するものであり、エージェントによるファイル書き込みに対する人間の承認の代わりになることは決してありません（[セットアッププロンプト](/ambercast/ja/agents/setup-prompt/#copy-paste-prompt) も参照してください）。

5. `npx ambercast check tests/ambercast/<name>.test.md` を実行します。

修復されたテストケースが最新状態（fresh）で完了したことは、終了コード `0` で確認できます。終了コードが `0` 以外の場合は、[stale（古くなった状態）のアーティファクトの復旧](/ambercast/ja/how-to/recover-stale-artifacts/) を参照して対処してください。

6. 実際の修復が完了したら、`git status --short` を実行します。スコープに含まれる変更されたすべての追跡対象ファイル（設定ファイル、ロケーター変更の影響を受けた UI ファイル、Plan、Grounding）について `git diff -- <path>` を表示します。スコープに含まれる未追跡ファイルについては、その全内容を表示するか、`git diff --no-index /dev/null <path>` を表示します。この完全な変更セットを提示した上で処理を停止してください。コミットは、会話内で明示的に要求された場合にのみ行います。変更の revert は、対象ファイルを確認し、明示的な承認を受け取った後にのみ行います。

エージェントのデフォルト動作は diff の提示であり、コミットは要求があった場合にのみ許可されます。必要な確認と承認の境界を設けることで、エージェントが推測によって既存の変更を破棄することを防ぎます（[セットアッププロンプト](/ambercast/ja/agents/setup-prompt/#copy-paste-prompt) および [生成された差分のレビュー](/ambercast/ja/how-to/review-generated-diffs/#steps) を参照してください）。

スコープに関する注意: 引数を指定しない `npx ambercast heal` は、設定されたテストディレクトリ、一致（match）ルール、除外（ignore）ルールに合致するすべてのテストを検出します。これは、個別に承認された「検出された全テストの修復」操作でのみ使用してください。本チュートリアルで修復対象とするのは、指定された単一の `.test.md` です。

## 完了状態 {#completion-state}

- 選択されたターゲット（ステップ1の未設定時の例では `web-user`）が明示的に `idempotent` に設定されていること。変更前の `web-user` 向け組み込みテンプレートは `stateful` であり、設定された `targets` マップはそのテンプレートを置き換えます。
- 受け入れられた修復が最新状態になった後、`check` が終了コード `0` で終了すること。

関連リンク: [設定](/ambercast/ja/reference/configuration/), [ambercast heal](/ambercast/ja/reference/cli/heal/), [ambercast check](/ambercast/ja/reference/cli/check/), [生成された差分のレビュー](/ambercast/ja/how-to/review-generated-diffs/), [stale（古くなった状態）のアーティファクトの復旧](/ambercast/ja/how-to/recover-stale-artifacts/)
