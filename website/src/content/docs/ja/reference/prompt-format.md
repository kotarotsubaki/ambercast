---
title: プロンプトファイルのフォーマット
description: ambercast 0.3.1 が規定するテストプロンプトファイルの構文規則、テキスト正規化、およびシークレット参照仕様。
---

ambercast 0.3.1 において強制される、テストプロンプトファイルの構文および各種変換処理のリファレンスです。

効果的なプロンプトの作成方法やテストの粒度については [効果的なプロンプトの作成](/ambercast/ja/how-to/write-effective-prompts/) を参照してください。環境変数の検索やシークレットの取り扱いについては [シークレットの管理](/ambercast/ja/how-to/manage-secrets/) および [環境変数](/ambercast/ja/reference/environment-variables/#secrets)、シークレット検出ルールの定義については [プランにおけるシークレット](/ambercast/ja/spec/secrets/)、プランの来歴管理については [鮮度とダイジェスト](/ambercast/ja/spec/freshness/) で扱っています。

## ファイル識別 {#file-identity}

ファイル名に基づくサフィックス規約によってテストファイルを識別します。

| 条件 | 適用される結果 |
| --- | --- |
| パスが `testDir` 配下に存在し、末尾が `.test.md` であり、サフィックスの前に空でないファイル名が存在する。 | レイアウト解決機構（layout resolver）により、plan、grounding、および case の各パスを導出できる。 |
| パスが `testDir` の外にある、異なるサフィックスを持つ、またはファイル名単体の `.test.md` である。 | 前方レイアウト解決（forward layout resolution）により `RangeError` で拒絶される。 |

どのパスを検出するかは `testMatch` および `testIgnore` によって制御されます。`.test.md` はリゾルバが要求する厳密なソースサフィックスであり、一般的な Markdown パーサーの規則ではありません。

## 正規化とグラント {#normalization-and-grants}

テストプロンプトの読み込み時には、あらかじめ規定された正規化が行われ、その後にシークレットグラントの抽出が実行されます。

| 操作 | 厳密な規則 |
| --- | --- |
| 先頭の BOM | 先頭にある最大1つの U+FEFF を除去する。2つ目以降の先頭 U+FEFF、およびそれ以外の位置にある U+FEFF は保持する。 |
| 改行コード | 各 CRLF および単独の CR を、1つの LF に変換する。 |
| それ以外のすべて | そのまま保持する。トリミング、空白の縮約、並べ替え、言い換え、その他の変換は行わない。 |

グラント抽出処理は、この正規化された Markdown を受け取り、ソースコード内の出現順序でグラントを返します。

候補行の物理ソース範囲が、CommonMark のフェンスコードブロック（fenced-code）、インデントコードブロック（indented-code）、またはインラインコード（inline-code）の各ノードと重複している場合、その候補行は除外されます。

返される各グラントには、未加工の行テキスト、0から始まる UTF-16 の開始および終端排他オフセット、1から始まる物理行番号が保持されます。

同一の引用が2回以上出現する場合、各出現が別個の一致するグラントを一意に含むときに限り、帰属付けはそれらを文書順に解決します。そうでない場合は `citation-not-unique` で失敗します。

グラント行の検出には、以下の正規表現がそのまま使用されます。

```ts
new RegExp(`^[ \\t]*@ambercast-secret[ \\t]+(${SECRET_REF_SOURCE})[ \\t]*$`)
```

## シークレット参照 {#secret-references}

スキーマで定義されているシークレット参照の構文規則です。

| シンボル | 実装コード | 意味 |
| --- | --- | --- |
| `SECRET_REF_SOURCE` | `\\{\\{secrets\\.[A-Za-z0-9_]+(?:\\.[A-Za-z0-9_]+)*\\}\\}` | `secrets.` の後に、ドットで区切られた1つ以上の ASCII 英数字またはアンダースコアのセグメントが続く形式。 |
| `SECRET_REF_PATTERN` | `new RegExp(\`^${SECRET_REF_SOURCE}$\`)` | シークレットを保持するスキーマフィールドは、値全体がこの参照と一致する場合にのみ受け入れる。 |

`SecretRef` では、`{{secrets.name}}` などの参照の周囲に地の文を含めることは認められません。値全体にアンカーを設定することで、シークレットを保持するフィールドの曖昧さを排除しています。

## シークレットリテラルの拒否 {#literal-secret-rejection}

シークレット検出器の標準規約は [プランにおけるシークレット](/ambercast/ja/spec/secrets/#literal-secret-rejection) に定義されています。プロンプト形式に関連する方針は以下の通りです。

永続化やレポートのシリアライズを行う前に、生成された JSON またはプロバイダ由来の JSON はシークレットリテラルポリシーによって検査されます。シークレットリテラルが検出された場合は、診断情報にそのリテラル自体を保持することなく `SecretLiteralRejectedError` が発生します。

この生成プランに対するポリシーは、プロンプトの地の文に認証情報のようなテキストが含まれていることのみを理由としてプロンプトを拒絶することはありません。

関連ドキュメント:
- [ディスカバリーパターン](/ambercast/ja/reference/discovery-patterns/#selection)
- [環境変数](/ambercast/ja/reference/environment-variables/#secrets)
- [効果的なプロンプトの作成](/ambercast/ja/how-to/write-effective-prompts/)
- [シークレットの管理](/ambercast/ja/how-to/manage-secrets/)
- [プランにおけるシークレット](/ambercast/ja/spec/secrets/)
