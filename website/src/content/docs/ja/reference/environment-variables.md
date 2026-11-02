---
title: 環境変数
description: ambercast が読む環境変数と、AI プロバイダーの子プロセスに渡さない変数を示すリファレンス。
---

ambercast は、設定ファイルのパス、AI プロバイダー、シークレットの値、CI の判定に環境変数を使う。AI プロバイダーの子プロセスを起動する前には、環境を絞り込む。

## 設定とプロバイダー {#configuration}

| 変数 | 読む場面 | 効果 | 優先順位と注意点 |
| --- | --- | --- | --- |
| `AMBERCAST_CONFIG` | 設定ファイルを探すとき | 設定ファイルのパスを明示する。 | コマンドの `--config` が最優先である。次にこの変数、祖先ディレクトリの探索、既定値の順に続く。空の値は未指定として扱い、それ以外の値はそのまま使う。 |
| `AMBERCAST_AI_PROVIDER` | AI プロバイダーを決めるとき | 設定の `ai.provider` を `claude`、`codex`、`auto` のいずれかで置き換える。 | `--ai` が最優先である。次にこの変数、設定の `ai.provider`、既定値の `auto` の順に続く。空の値は未指定として扱う。この 3 つ以外の非空の値は無効である。 |
| `AMBERCAST_SECRET_*` | `{{secrets.*}}` の参照が値を必要とするとき | シークレット参照 1 件の値を渡す。 | ドットはアンダースコアに、各セグメントは大文字に変わる。`{{secrets.a.b}}` は `AMBERCAST_SECRET_A_B` を読む。変数がなければ未解決になる。存在する空の変数は、解決済みの値である。 |
| `CI` | コマンドが CI の方針を適用するとき | CI の方針を有効にする。 | 定義されていて、空でなく、小文字の `false` そのものでなければ有効である。`FALSE`、`0`、空白は有効のままになる。判定は大文字と小文字を区別し、空白を取り除かない。 |
| `AMBERCAST_DEBUG` | CLI がクラッシュしたとき、`run` が進捗を出すとき、MCP サーバーがクラッシュしたジョブや heal の適用を扱うとき | 診断を stderr に出す。 | 未設定、空、`0` そのもの、`false` そのものは無効である。それ以外は有効になる。判定は大文字と小文字を区別し、空白を取り除かない。 |

シークレット参照と `AMBERCAST_SECRET_*` の対応は 1 対 1 にならない。`a.b` と `a_b` のような参照を併用してはならない。

### AMBERCAST_DEBUG が出す内容 {#debug-output}

`AMBERCAST_DEBUG` が有効なとき、ambercast は次の診断を stderr に出す。

- CLI のクラッシュの原因メッセージとスタック。
- `run` で分類できなかったケース例外の名前、秘匿済みのメッセージ、スタック。
- MCP サーバーで失敗したジョブや heal の適用の原因メッセージとスタック。
- 子プロセスの診断があるときは、`child process: exit <n>` または `child process: signal <name>`。続けて `child stderr:` と本文（または `(empty)`）。

診断は、リクエスト由来の機微なテキストを含むことがある。

### プロバイダーの解決 {#provider-resolution}

プロバイダーの解決は、まず `--ai` を適用する。`auto` 以外の値は、確認せずにそのまま返す。`auto` のときは `claude`、`codex` の順で確認する。確認ごとの期限は 8,000 ms である。

## シークレットと CI {#secrets}

| 渡さない変数の種類 | AI プロバイダーの子プロセスへ渡すか | 規則 |
| --- | --- | --- |
| `AMBERCAST_SECRET_*` | 渡さない | 子プロセスを起動するたびに、大文字と小文字を区別せず、この名前空間を取り除く。 |
| `AMBERCAST_ENV_*` | 渡さない | 同じ規則で、この名前空間を取り除く。 |

## プロバイダーの子プロセスの環境 {#provider-child-environment}

| 渡す変数の種類 | AI プロバイダーの子プロセスへ渡すか | 規則 |
| --- | --- | --- |
| `/^AMBERCAST_(SECRET\|ENV)_/i` に一致しないキー | 渡す | ランナーは環境をコピーし、拒否したキーだけを取り除いて、結果を子プロセスに渡す。 |

このフィルターは許可リストではなく拒否リストである。浅いコピーを返し、親プロセスの環境は変えない。`AMBERCAST_CONFIG`、`AMBERCAST_AI_PROVIDER`、`CI` は、設定されていればそのまま渡る。通常の実行環境の変数やプロバイダーの変数も同様である。プロバイダーの認証用変数の名前については、何も保証しない。

## 関連項目 {#see-also}

- [設定](/ambercast/ja/reference/configuration/#file-selection)
- [ambercast generate](/ambercast/ja/reference/cli/generate/#flags)
- [ambercast run](/ambercast/ja/reference/cli/run/#flags)
- [ambercast heal](/ambercast/ja/reference/cli/heal/#flags)
- [プロンプトファイルのフォーマット](/ambercast/ja/reference/prompt-format/#normalization)
