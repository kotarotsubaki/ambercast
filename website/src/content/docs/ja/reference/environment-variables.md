---
title: 環境変数
description: Ambercastが読み取る環境変数と、AIプロバイダーの子プロセスに対するフィルタリング境界のリファレンスです。
---

Ambercastが読み取る環境変数と、AIプロバイダーの子プロセスに対するフィルタリング境界について説明します。

## 設定とプロバイダー {#configuration}

| 変数 | 読み取り箇所 | 影響 | 優先順位・エッジケース |
| --- | --- | --- | --- |
| `AMBERCAST_CONFIG` | `readConfigEnvironment()` → `configPathOverride` | 明示的な設定ファイルのパスを選択します。 | コマンドの `--config` の値が優先され、次にこの変数、次に祖先ディレクトリの探索、最後に既定値の順になります。空値は未指定として扱われ、その他の値は維持されます。 |
| `AMBERCAST_AI_PROVIDER` | `readConfigEnvironment()` → `aiProviderRaw` | `claude`、`codex`、または `auto` として検証された後、設定ファイルまたは既定値の `ai.provider` を置き換えます。 | `--ai` が優先され、次にこの変数、次に設定ファイルの `ai.provider`、最後に既定値の `auto` の順になります。空値は未指定として扱われ、サポートされていない非空の値は無効となります。 |
| `AMBERCAST_SECRET_*` | `createEnvSecretsProvider().resolve()` | シークレットプロバイダーの境界において、特定の `{{secrets.*}}` 参照を解決します。 | ドットはアンダースコアに変換され、各セグメントは大文字化されます（例: `{{secrets.a.b}}` は `AMBERCAST_SECRET_A_B` にマッピングされます）。キーが存在しない場合は `undefined` を返します。このマッピングは単射ではないため、`a.b` と `a_b` のような参照を同時に使用してはなりません。 |
| `CI` | `createProcessEnvironmentInfo().isCI()` | ランタイムコマンドが消費するCIポリシーのブール値を提供します。 | 定義されており、空ではなく、かつ正確に小文字の `false` でない場合にのみアクティブになります。`FALSE`、`0`、および空白文字はアクティブとして扱われます。 |

プロバイダーの解決では、読み込まれたプロバイダーの前にコマンドの `--ai` による上書きが適用されます。`auto` 以外の値はプローブを行わずに返されますが、`auto` は `claude`、次に `codex` の順でプローブします。

各自動プロバイダーのプローブには、それぞれ固有の 8,000 ms の利用可能性デッドラインが設定されています。

## シークレットとCI {#secrets}

| 除外される変数の種類 | AIプロバイダーの子プロセスに渡されるか | 厳密なルール |
| --- | --- | --- |
| `AMBERCAST_SECRET_*` | いいえ | 子プロセスの実行ごとに、大文字・小文字を区別せずこの名前空間を削除します。 |
| `AMBERCAST_ENV_*` | いいえ | 同様の大文字・小文字を区別しない拒否ルールによって、この名前空間を削除します。 |

環境アダプターは `CI` を大文字・小文字を区別せずにパースすることはなく、トリムも行いません。

環境変数として存在する空の `AMBERCAST_SECRET_<NAME>` は解決された値として維持され、計算されたキーが存在しない場合にのみ `undefined` を返します。

## プロバイダーの子プロセス環境 {#provider-child-environment}

| 渡される変数の種類 | AIプロバイダーの子プロセスに渡されるか | ルール |
| --- | --- | --- |
| `/^AMBERCAST_(SECRET|ENV)_/i` に一致しない指定されたキー | はい | ランナーは注入された環境を浅くコピーし、拒否されたキーのみを削除して、その結果を `spawn(...).env` として渡します。そのため、通常のランタイム変数やプロバイダー変数、および `AMBERCAST_CONFIG`、`AMBERCAST_AI_PROVIDER`、`CI` は、存在していれば渡されます。 |

フィルタリングは固定の許可リストではなく拒否リストであるため、実装としてプロバイダー固有の認証変数名について網羅的な保証は行われません。

フィルタリングは環境のコピーを返し、親プロセスの環境は変更されません。

関連リンク: [設定](/ambercast/ja/reference/configuration/#file-selection), [ambercast generate](/ambercast/ja/reference/cli/generate/#flags), [ambercast run](/ambercast/ja/reference/cli/run/#flags), [ambercast heal](/ambercast/ja/reference/cli/heal/#flags), [プロンプトファイルのフォーマット](/ambercast/ja/reference/prompt-format/#normalization-and-grants).
