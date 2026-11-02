---
title: プロンプトファイルのフォーマット
description: ambercast がどのファイルをテストプロンプトとして扱うか、どう正規化するか、シークレット参照をどう扱うかを示すリファレンス。
---

テストプロンプトは、1 つのエンドツーエンドのテストケースを自然言語で書いた Markdown ファイルである。このページは、プロンプトファイルの規則をまとめる。どのファイルがプロンプトか、ambercast がどう正規化するか、シークレットをどう扱うかを示す。

## ファイルの識別 {#file-identity}

| 条件 | 結果 |
| --- | --- |
| パスが `testDir` の中にあり、末尾が `.test.md` で、接尾辞の前に空でない名前がある。 | レイアウトが、計画（plan）、グラウンディング、ケースの各パスを導く。 |
| パスが `testDir` の外にある、別の接尾辞を持つ、またはファイル名が `.test.md` だけである。 | コマンドは `PROMPT_PATH_INVALID`（終了コード 2）で止まる。 |

このエラーの `details.reason` は `outside-test-dir`、`not-test-md`、`no-name` のいずれかである。`--list` は適格性の検証をしないので、このエラーを出さない。エラーの契約は[レポート](/ambercast/ja/reference/reports/#errors)を参照する。

検出の対象は `testMatch` と `testIgnore` で決まる。接尾辞 `.test.md` はレイアウトが求める厳密な条件であり、Markdown 一般の規則ではない。パターンの詳細は[ディスカバリーパターン](/ambercast/ja/reference/discovery-patterns/#selection)を参照する。

## 正規化 {#normalization}

ambercast は、プロンプトから何かを取り出す前に、プロンプトを正規化する。

| 操作 | 規則 |
| --- | --- |
| 先頭の BOM | 先頭の U+FEFF を最大 1 つ取り除く。2 つ目の先頭 U+FEFF と、それ以外の位置の U+FEFF は残す。 |
| 改行 | CRLF と単独の CR を、それぞれ 1 つの LF に変える。 |
| それ以外のすべて | そのまま残す。トリミング、空白の圧縮、並べ替え、言い換えはしない。 |

## シークレット参照 {#secret-references}

提案されたシークレット名に同意すると、`generate` は `{{secrets.name}}` のようなシークレット参照を計画の `secretRef` フィールドに書く。プロンプトにシークレット参照を書いてはならない。コードスパンとコードブロックの外に `{{secrets.` があるプロンプトは、`SECRET_SYNTAX_REJECTED` で拒否される。[旧形式のシークレット構文](#legacy-secret-syntax)を参照する。

| シンボル | 定義 | 意味 |
| --- | --- | --- |
| `SECRET_REF_SOURCE` | `\{\{secrets\.[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*\}\}` | `secrets.` のあとに、ASCII の英数字とアンダースコアからなるセグメントが、ドット区切りで 1 つ以上続く。 |
| `SECRET_REF_PATTERN` | 両端を固定した `SECRET_REF_SOURCE` | シークレットを持つフィールドは、値全体が参照である場合だけ受け付ける。 |

前後に文字を付けることはできない。有効な参照は、フィールドの値全体を占める必要がある。

## 旧形式のシークレット構文 {#legacy-secret-syntax}

以前のプロンプトには、次のような許可行を書けた。

```markdown
@ambercast-secret {{secrets.password}}
```

この構文は、もう受け付けない。該当する行をすべて削除し、[シークレット許可の移行](/ambercast/ja/how-to/upgrade/#migrate-secret-grants)に従う。現在の同意と許可リストの仕組みは、[計画におけるシークレット](/ambercast/ja/spec/secrets/)にある。

## 終端アサーションと指示の対応 {#terminal-assertions-and-instruction-coverage}

終端の成功アサーションは、それに対応する指示でカバーする必要がある。URL に到達しただけでは証明にならない。到達先で見える見出し、メッセージ、要素を書く。

> …I reach the dashboard and see the heading "Welcome back".

## リテラルのシークレットの拒否 {#literal-secret-rejection}

永続化やレポートの直列化の前に、ambercast は生成された JSON とプロバイダー由来の JSON をリテラルのシークレット方針で検査する。検出した値は `SECRET_LITERAL_REJECTED` で拒否し、リテラルは診断に残さない。

この方針は、認証情報らしい文字列を含むというだけで、プロンプトの文章を拒否することはない。検出器の契約は[計画におけるシークレット](/ambercast/ja/spec/secrets/#literal-secret-rejection)にある。

## 関連項目 {#see-also}

- [ディスカバリーパターン](/ambercast/ja/reference/discovery-patterns/#selection)
- [環境変数](/ambercast/ja/reference/environment-variables/#secrets)
- [効果的なプロンプトの書き方](/ambercast/ja/how-to/write-effective-prompts/)
- [シークレットの管理](/ambercast/ja/how-to/manage-secrets/)
- [計画におけるシークレット](/ambercast/ja/spec/secrets/)
