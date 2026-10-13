---
title: バージョン間のアップグレード
description: ambercast のバージョン間を安全にアップグレードし、プランの整合性を確認する手順です。
---

ambercast のバージョン間を安全にアップグレードするための手順である。リリースの更新によって producer-fingerprint が変更され、計画が stale（古くなった状態）になった場合の再生成と検証を扱う。

## 前提条件 {#prerequisites}

CHANGELOG 0.3.1 に記載されている通り、producer-fingerprint の変更によって 0.1.0 の計画は stale（古くなった状態）になり、再生成が必要になる。

## 手順 {#steps}

1. 依存関係を変更する前に、アップグレード対象リリースの BREAKING セクションを確認する。0.3.1 の項目では `inputsDigest` への影響が明記されている。
2. プロジェクトのパッケージマネージャーを使用して ambercast をアップグレードし、`npx ambercast check --json` を実行する。check はレポートを返し、信頼できない検出結果に対して終了コード `4` を選択する。
3. check が終了コード `4` で終了した場合は、`npx ambercast generate` を実行して計画とグラウンディングの差分を確認する。生成処理はジェネレーターとレポート結果を構成する。
4. 依存関係と、受け入れたコンパニオンの変更をまとめてコミットする。その後に check を再実行して、最終的な状態を観測可能にする。

## シークレットグラントの移行 {#migrate-secret-grants}

Plan v2 用に作成されたプロンプトには、旧シークレットグラント行を含められる。プロンプトからグラント行をすべて削除する。旧構文は拒否され、その場で移行できない。

```markdown
@ambercast-secret {{secrets.password}}
```

続いて `npx ambercast generate --force <file>` を実行し、新しい同意プロンプトに応答する。CI または別の非対話環境では、先にレビュー済みの名前を `secrets.allow` に追加する。再生成された Plan では v3 の同意／許可リストモデルが使用される。

## プロデューサー変更後の再グラウンディング {#reground-after-producer-change}

ジェネレーターの `confirms` 指示が変わるとプロデューサーのフィンガープリントも変わり、以前の計画は stale になる。計画を再生成するとグラウンディングは空に置き換わるため、以下の手順ですべての要素ステップを束縛し直す。Plan 5、Grounding 4、report 3.10 は変わらない。

1. `npx ambercast check --json` を実行し、対象の計画が `stale` と報告されることを確かめる。
2. stale の計画ごとに `npx ambercast generate <file>` を実行する。差分を見て、入力の効果を示す assert の `confirms` にその入力が入ったことを確かめる。
   - generate がある入力について `action-unconfirmed` の警告を出したら、手順 3 へ進まない。
   - 通常の run はその入力で `GROUNDING_UNRESOLVED` になる。
   - サインイン後のユーザー名のように、その入力の効果を示す assert を足し、手順 2 をやり直す。
3. 手元で `npx ambercast run --resolve --update-cache <file>` を実行する。再生成の直後はグラウンディングが空なので、逐語の引用がない要素ステップごとに ambercast が AI を 1 回呼ぶ。CI は既定でグラウンディングを保存しない。
4. `npx ambercast check` で計画が `fresh` であることを確かめる。続けて `npx ambercast run <file>` を実行し、pass することと、レポートの `aiCalls` が 0 であることを確かめる。計画は常にコミットする。グラウンディングは `grounding.repositoryPolicy` が `committed` のときだけ計画と一緒にコミットし、`uncommitted` なら手元に置く。

## 確認 {#verification}

再生成を受け入れた後、`npx ambercast check` が終了コード `0` で終了することを確認する。

## 関連情報 {#related}

リンク: [変更履歴](/ambercast/ja/reference/changelog/), [鮮度とダイジェスト](/ambercast/ja/spec/freshness/), [ambercast check](/ambercast/ja/reference/cli/check/), [ambercast generate](/ambercast/ja/reference/cli/generate/), [生成された差分のレビュー](/ambercast/ja/how-to/review-generated-diffs/)
