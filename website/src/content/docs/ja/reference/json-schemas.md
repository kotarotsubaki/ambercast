---
title: JSON スキーマ
description: Ambercast におけるスキーマ再構築時の公開規約を定義し、現在生成されている JSON Schema アーティファクトの一覧を提示します。
---

Ambercast におけるスキーマ再構築時の公開規約を定義し、現在生成されているスキーマの一覧を提示します。ドキュメントサイトおよび npm エクスポート向けに計画されている公開メタデータと、ビルド時に生成されるアーティファクトの仕様を説明します。

## 公開メタデータ {#publication-metadata}

ambercast は、これらのメタデータと、ドキュメントサイトおよび npm 間でバイト単位で同一なファイルを公開しています。

| アーティファクト | 公開パスおよび `$id` | バージョン | `title` | `description` | スコープ | 状態 |
| --- | --- | --- | --- | --- | --- | --- |
| config | `https://kotarotsubaki.github.io/ambercast/schemas/config.schema.json` | バージョンなし（config には `schemaVersion` がありません） | `ambercast config schema` | `Validates the parsed contents of a present Ambercast configuration file.` | 存在する設定ドキュメント。 | 利用可能 |
| plan | `https://kotarotsubaki.github.io/ambercast/schemas/plan.v2.schema.json` | 2 | `ambercast plan schema v2` | `Validates the complete generated plan document that is reviewed and committed beside its source test prompt.` | provenance、targets、steps を含む完成した `PlanDocument`。 | 利用可能 |
| grounding | `https://kotarotsubaki.github.io/ambercast/schemas/grounding.v1.schema.json` | 1 | `ambercast grounding schema v1` | `Validates the committed grounding cache associated with one plan digest.` | `planDigest` とステップをキーとするエントリを持つ `GroundingDocument`。 | 利用可能 |
| report | `https://kotarotsubaki.github.io/ambercast/schemas/report.v3.schema.json` | 3 (`schemaVersion: "3.2"`) | `ambercast report schema v3.0` | `Zod schema for the complete versioned output of a reporting command.` | 構造化されたレポートエンベロープとコマンド固有の結果。 | 利用可能 |

各スキーマの `$id` はその公開パス URL と一致します。バイト単位で同一のスキーマファイルが、ドキュメントサイトと npm の `schemas/` エクスポートに公開されています。

現在の Astro 設定では、`site` は規定の `https://kotarotsubaki.github.io` ホスト、base は `/ambercast` に設定されています。上記の公開 URL はこのホストを使用します。

## 生成されるアーティファクト {#generated-artifacts}

| 生成ファイル | 検証対象 | 生成元 | npm エクスポート |
| --- | --- | --- | --- |
| `plan.schema.json` | Plan の `schemaVersion` が 2 であり、provenance source、targets、steps を含む完成した `PlanDocument`。 | JSON Schema 2020-12 として変換された Zod の `PlanDocument`。 | `ambercast/schema/plan.json` → `./dist/schema/plan.schema.json` |
| `grounding.schema.json` | Grounding の `schemaVersion` が 1 であり、`planDigest` およびステップをキーとするエントリを持つ `GroundingDocument`。 | JSON Schema 2020-12 として変換された Zod の `GroundingDocument`。 | `ambercast/schema/grounding.json` → `./dist/schema/grounding.schema.json` |
| `config.schema.json` | `$schema` が必須であり、それ以外に宣言される設定は任意である、存在する設定ドキュメント。 | JSON Schema 2020-12 として変換された Zod の `RawConfig`。 | `ambercast/schema/config.json` → `./dist/schema/config.schema.json` |
| `report.schema.json` | Report の `schemaVersion` 3.2 を含む、構造化されたレポートエンベロープとコマンド固有の結果。 | JSON Schema 2020-12 として変換された Zod の `ReportEnvelope`。 | `ambercast/schema/report.json` → `./dist/schema/report.schema.json` |

`npm run build` はパッケージをコンパイルした後に `node dist/schema-gen.js` を実行します。これによりスキーマディレクトリが再帰的に作成され、上記のちょうど 4 つのファイルが書き出されます。

確認された生成ファイルは、`$schema` を通じて JSON Schema draft 2020-12 を宣言し、公開メタデータに示した `$id` も含んでいます。

## 構造上の境界 {#structural-boundary}

Plan、Grounding、config の各 JSON Schema は、個別の手書き定義として保守されるのではなく、Zod から導出されています。

Plan の重複するステップ ID や `SourceSpan.endLine >= startLine` は、JSON Schema 2020-12 では項目間・プロパティ間の制約を表現できないため、Zod のみによる意味論的リファインメントとなっています。

生成された Plan の JSON Schema を検証するだけでは、重複ステップ ID の一意性や `SourceSpan` の行順序は担保されません。統合された検証境界については [適合性](/ambercast/ja/spec/conformance/) に記載されています。

## レポートスキーマ {#report-schema}

`report.schema.json` は他のスキーマとともに生成され、`ambercast/schema/report.json` → `./dist/schema/report.schema.json` としてエクスポートされています。Report の `schemaVersion` 3.2 を含む、構造化されたレポートエンベロープとコマンド固有の結果を検証します。

関連リンク: [設定](/ambercast/ja/reference/configuration/#key-table), [レポート](/ambercast/ja/reference/reports/#envelope), [適合性](/ambercast/ja/spec/conformance/), [計画ドキュメント](/ambercast/ja/spec/plan-document/), [グラウンディングドキュメント](/ambercast/ja/spec/grounding-document/)
