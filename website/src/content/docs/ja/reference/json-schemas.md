---
title: JSON スキーマ
description: ambercast の設定・計画・グラウンディング・レポートを検証する JSON Schema の公開メタデータ、生成ファイル、構造上の限界を示すリファレンス。
---

ambercast は JSON Schema draft 2020-12 のファイルを公開する。これらは、設定ファイル、計画（plan）ドキュメント、グラウンディングキャッシュ、レポートを検証する。このページは、公開メタデータ、生成ファイル、スキーマで表現できない事項を示す。

## 公開メタデータ {#publication-metadata}

現在の契約を表すスキーマは `main` 上に 4 つある。最新リリースより新しいスキーマバージョンは、リリースされた時点で[互換性と再生成](/ambercast/ja/reference/compatibility/#compatibility-table)に載る。

| artifact | 公開パスと `$id` | バージョン | `title` | `description` | スコープ | 状態 |
| --- | --- | --- | --- | --- | --- | --- |
| config | `https://kotarotsubaki.github.io/ambercast/schemas/config.schema.json` | バージョンなし（config には `schemaVersion` がない） | `ambercast config schema` | `Validates the parsed contents of a present Ambercast configuration file.` | 存在する設定ドキュメント。 | 利用可能 |
| plan | `https://kotarotsubaki.github.io/ambercast/schemas/plan.v5.schema.json` | 5 | `ambercast plan schema v5` | `Validates the complete generated plan document that is reviewed and committed beside its source test prompt.` | targets と steps を含む、現在の完成した `PlanDocument`。 | 利用可能 |
| grounding | `https://kotarotsubaki.github.io/ambercast/schemas/grounding.v4.schema.json` | 4 | `ambercast grounding schema v4` | `Validates the committed grounding cache associated with one plan digest.` | `planDigest` とステップをキーとするエントリを持つ `GroundingDocument`。 | 利用可能 |
| report | `https://kotarotsubaki.github.io/ambercast/schemas/report.v3.schema.json` | 3 (`schemaVersion: "3.11"`) | `ambercast report schema v3.0` | `Zod schema for the complete versioned output of a reporting command.` | 構造化されたレポートエンベロープとコマンド固有の結果。 | 利用可能 |

廃止された契約の利用者のために、凍結済みのスナップショットを 5 つ残している。サイトはコミット済みのファイルからこれらを公開し、npm パッケージはエクスポートしない。

| artifact | 公開パスと `$id` | バージョン | `title` | `description` | スコープ | 状態 |
| --- | --- | --- | --- | --- | --- | --- |
| plan （履歴スナップショット） | `https://kotarotsubaki.github.io/ambercast/schemas/plan.v2.schema.json` | 2 | `ambercast plan schema v2` | `Validates the complete generated plan document that is reviewed and committed beside its source test prompt.` | 廃止された契約の利用者のために保持する、凍結済みの 計画 v2 スナップショット。 | 利用可能 |
| plan （履歴スナップショット） | `https://kotarotsubaki.github.io/ambercast/schemas/plan.v3.schema.json` | 3 | `ambercast plan schema v3` | `Validates the complete generated plan document that is reviewed and committed beside its source test prompt.` | 廃止された契約の利用者のために保持する、凍結済みの 計画 v3 スナップショット。 | 利用可能 |
| plan （履歴スナップショット） | `https://kotarotsubaki.github.io/ambercast/schemas/plan.v4.schema.json` | 4 | `ambercast plan schema v4` | `Validates the complete generated plan document that is reviewed and committed beside its source test prompt.` | 廃止された契約の利用者のために保持する、凍結済みの 計画 v4 スナップショット。 | 利用可能 |
| grounding （履歴スナップショット） | `https://kotarotsubaki.github.io/ambercast/schemas/grounding.v2.schema.json` | 2 | `ambercast grounding schema v2` | `Validates the committed grounding cache associated with one plan digest.` | 廃止された契約の利用者のために保持する、凍結済みの グラウンディング v2 スナップショット。 | 利用可能 |
| grounding （履歴スナップショット） | `https://kotarotsubaki.github.io/ambercast/schemas/grounding.v3.schema.json` | 3 | `ambercast grounding schema v3` | `Validates the committed grounding cache associated with one plan digest.` | 廃止された契約の利用者のために保持する、凍結済みの グラウンディング v3 スナップショット。 | 利用可能 |

各 `$id` は公開パスの URL と一致する。サイトは現在の 4 つのスキーマを、`dist/schema/` のファイルとバイト単位で同一のコピーとして配信する。npm パッケージはこの 4 つを `ambercast/schema/<name>.json` としてエクスポートする。

サイト設定では、`site` を `https://kotarotsubaki.github.io` ホスト、base を `/ambercast` に設定する。上記の公開 URL はこのホストを使う。

## 生成されるアーティファクト {#generated-artifacts}

| 生成ファイル | 検証対象 | 生成元 | npm エクスポート |
| --- | --- | --- | --- |
| `plan.schema.json` | 計画の `schemaVersion` が 5 であり、provenance source、targets、steps を含む現在の完成した `PlanDocument`。 | JSON Schema 2020-12 に変換した Zod の `PlanDocument`。 | `ambercast/schema/plan.json` → `./dist/schema/plan.schema.json` |
| `grounding.schema.json` | グラウンディングの `schemaVersion` が 4 であり、`planDigest` とステップをキーとするエントリを持つ `GroundingDocument`。 | JSON Schema 2020-12 に変換した Zod の `GroundingDocument`。 | `ambercast/schema/grounding.json` → `./dist/schema/grounding.schema.json` |
| `config.schema.json` | `$schema` が必須で、宣言される設定はそれ以外すべて任意である、存在する設定ドキュメント。 | JSON Schema 2020-12 に変換した Zod の `RawConfig`。 | `ambercast/schema/config.json` → `./dist/schema/config.schema.json` |
| `report.schema.json` | Report の `schemaVersion` 3.11 を持つ、構造化されたレポートエンベロープとコマンド固有の結果。 | JSON Schema 2020-12 に変換した Zod の `ReportEnvelope`。 | `ambercast/schema/report.json` → `./dist/schema/report.schema.json` |

`npm run build` はパッケージをコンパイルした後に `node dist/schema-gen.js` を実行する。このスクリプトはスキーマディレクトリを再帰的に作成し、上記 4 つのスキーマファイルを書き出す。`dist/manifest/` 配下にはマニフェストファイルも書き出す。

確認済みの生成ファイルは、`$schema` で JSON Schema draft 2020-12 を宣言する。各ファイルは、公開メタデータに示した `$id` も宣言する。

## 構造上の境界 {#structural-boundary}

計画、グラウンディング、config、レポートの JSON Schema は Zod から導出する。個別の手書き定義としては保守しない。

計画の重複したステップ ID は、Zod だけが担う意味上のリファインメントである。JSON Schema 2020-12 は、配列項目にまたがる射影フィールドの一意性を表現できない。

生成された計画の JSON Schema だけを検証しても、ステップ ID の重複がないことは確かめられない。両者を合わせた境界は[適合性](/ambercast/ja/spec/conformance/)に記載している。

## レポートスキーマ {#report-schema}

`report.schema.json` は他のスキーマとともに生成され、`ambercast/schema/report.json` → `./dist/schema/report.schema.json` としてエクスポートされる。このスキーマは、構造化されたレポートエンベロープとコマンド固有の結果を検証する。対象には、Report の `schemaVersion` 3.11、必須のステップ Target 識別情報、実行された run と完了した heal の結果にあるセッション一覧が含まれる。

## 関連項目 {#see-also}

- [計画ドキュメント](/ambercast/ja/spec/plan-document/)
- [グラウンディングドキュメント](/ambercast/ja/spec/grounding-document/)
- [設定](/ambercast/ja/reference/configuration/#key-table)
- [適合性](/ambercast/ja/spec/conformance/)
- [レポート](/ambercast/ja/reference/reports/#envelope)
