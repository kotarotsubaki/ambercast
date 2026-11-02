---
title: ディスカバリーパターン
description: ambercast がどのテストプロンプトを検出するかを決める、パターンの文法、選択の段階、既定値、順序を示すリファレンス。
---

ambercast は、`testDir` からの相対パスに `testMatch` と `testIgnore` のパターンを当てる。パターン言語のワイルドカードは `*` と `**` の 2 つである。

## パターン言語 {#pattern-language}

文法に含まれるのは、次のワイルドカードだけである。それ以外の文字はすべてリテラルとして扱う。

| 構文 | 意味 |
| --- | --- |
| `*` | 1 つのパスセグメント内で、`/` 以外の 0 文字以上に一致する（`[^/]*`）。 |
| `**/` | 0 個を含む、0 個以上の完全なパスセグメントに一致する（`(?:.*/)?`）。 |
| `/` が後ろに続かない `**` | `/` を含む任意の 0 文字以上に一致する（`.*`）。 |
| それ以外のすべての文字 | リテラルである。文字クラス、波括弧、extglob などの glob 構文に特別な意味はない。 |
| パターン全体 | 両端に固定される。部分文字列への一致は数えない。 |

## 選択 {#selection}

| 段階 | 規則 |
| --- | --- |
| 包含 | パスは `testMatch` のパターンを 1 つ以上満たす必要がある。`testMatch` が空なら何も選ばない。 |
| 除外 | `testIgnore` のどれかに一致したパスは、`testMatch` にも一致していても除外する。 |
| パスの形式 | マッチャーは `testDir` からの相対パスを、`/` 区切りの POSIX 形式で受け取る。絶対パスは受け取らない。 |
| 順序 | 検出はファイル以外を飛ばし、重複を除き、パスを辞書順に並べる。 |
| ルートの欠落 | `testDir` がなければ、選択は空になる。それ以外の読み取り失敗は `FsIoError` になり、`FS_IO_ERROR` として報告する。 |

並べ替えた順序が、各コマンドの安定した実行順序である。

通常の検出からは外し、明示したときだけ実行したいプロンプトは、`testIgnore` で除外してリテラルのパスで渡す。`--list` は、どの選択に対しても適格性の検証をしない。

## 既定値 {#defaults}

既定では、`.test.md` のプロンプトを含め、実行ディレクトリと 2 種類の付随ファイルの接尾辞を除外する。

| キー | 既定のパターン |
| --- | --- |
| `testMatch` | `["**/*.test.md"]` |
| `testIgnore` | `["**/.runs/**", "**/*.ambercast.plan.json", "**/*.ambercast.grounding.json"]` |

## 具体例 {#worked-examples}

| パターンまたは設定 | 候補 | 結果 | 理由 |
| --- | --- | --- | --- |
| `**/*.test.md` | `login.test.md` | 一致する | `**/` は 0 個のセグメントにも一致する。 |
| `**/*.test.md` | `nested/checkout.test.md` | 一致する | `**/` は親のセグメントにまたがる。 |
| `ui/*.test.md` | `ui/auth/login.test.md` | 一致しない | `*` は `/` をまたげない。 |
| `login.test.md` | `login.test.md.bak` | 一致しない | パス全体が一致する必要がある。 |
| 包含 `**/*.test.md`、除外 `**/.runs/**` | `nested/.runs/cached.test.md` | 一致しない | 包含のあとでは `testIgnore` が優先される。 |
| `{login,nested}/*.test.md` | `login/login.test.md` | 一致しない | 波括弧は選択肢の展開ではなく、リテラルである。 |

## 関連項目 {#see-also}

- [設定](/ambercast/ja/reference/configuration/#key-table)
- [ファイルレイアウト](/ambercast/ja/reference/file-layout/#companions)
- [実行するテストの選択](/ambercast/ja/how-to/select-tests/)
