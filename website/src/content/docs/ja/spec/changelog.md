---
title: "仕様変更履歴"
description: "アーティファクトのバージョン受け入れは、リリース番号の直感ではなく、Ambercast Plan 仕様 に従わなければならない（MUST）。"
---

## バージョン履歴 {#version-history}

| 変更 | エビデンス | 移行義務 |
| --- | --- | --- |
| Plan v1 → v2 で instruction coverage を追加 | [src/core/ir/schema.ts:45](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L45), [src/core/ir/schema.ts:1185](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1185) | Producer および consumer は v1 を拒否し、再生成するか stale として報告しなければならず（MUST）、インプレースで移行してはならない（MUST NOT）。[src/core/ir/schema.ts:50](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L50) |
| fingerprint v1 → v2 | [CHANGELOG.md:78](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/CHANGELOG.md#L78) | v2 が唯一受け入れられるタグである。coverage claim を伴う current-provenance ドキュメントは、その後の strict/canonical 検証が失敗した場合、整合性の失敗（integrity failure）としなければならない（MUST）；その claim を持たないコンパニオンは `run` においてキャッシュミスとなる場合があるが、一方で `check` のグラウンディング検査はスキーマ無効なコンテンツを `invalid` として分類する（[鮮度とダイジェスト](/ambercast/ja/spec/freshness/#freshness-consequences) に基づく公開ステータス）。[src/usecases/run.ts:498](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L498) [src/usecases/check-grounding.ts:45](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/check-grounding.ts#L45) |
| producer bundle fingerprint が `inputsDigest` に入る | [CHANGELOG.md:8](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/CHANGELOG.md#L8) | この変更前に生成された Plan は stale であるため、再生成しなければならない（MUST）。[CHANGELOG.md:8](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/CHANGELOG.md#L8) |
| report 2.0 → 3.0 | [CHANGELOG.md:55](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/CHANGELOG.md#L55), [CHANGELOG.md:58](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/CHANGELOG.md#L58) | Report consumer は、Plan バージョンから互換性を推論するのではなく、現在の `3.0` コントラクトを受け入れなければならない（MUST）。[src/report/schema.ts:15](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/report/schema.ts#L15) |
| report 3.0 → 3.1 | [src/report/schema.ts:22](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/report/schema.ts#L22) | Report consumer は、Plan バージョンから互換性を推論するのではなく、任意の構造化エラー診断を含む現在の `3.1` コントラクトを受け入れなければならない（MUST）。[src/report/schema.ts:22](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/report/schema.ts#L22) |
| report 3.1 → 3.2 | [src/report/schema.ts:30](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/report/schema.ts#L30) | Report consumer は、Plan バージョンから互換性を推論するのではなく、任意の `PROMPT_PATH_INVALID` details 分岐を含む現在の `3.2` コントラクトを受け入れなければならない（MUST）。[src/report/schema.ts:30](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/report/schema.ts#L30) |
| report 3.2 → 3.3 | [src/report/schema.ts:30](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/report/schema.ts#L30) | Report consumer は、Plan バージョンから互換性を推論するのではなく、任意の AI 呼び出し計測フィールドを含む現在の `3.3` コントラクトを受け入れなければならない（MUST）。[src/report/schema.ts:30](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/report/schema.ts#L30) |
| report 3.3 → 3.4 | [src/report/schema.ts:30](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/report/schema.ts#L30) | Report consumer は、Plan バージョンから互換性を推論するのではなく、任意の `BROWSER_LAUNCH_FAILED` details 分岐を含む現在の `3.4` コントラクトを受け入れなければならない（MUST）。[src/report/schema.ts:30](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/report/schema.ts#L30) |

## 互換性ポリシー {#compatibility-policy}

アーティファクトのバージョン受け入れは、リリース番号の直感ではなく、[Ambercast Plan 仕様](/ambercast/ja/spec/overview/#compatibility) に従わなければならない（MUST）。plan は派生アーティファクトであるため、スキーマバージョンの変更はマイナーリリースにおける再生成を要求してもよい（MAY）。[src/core/ir/schema.ts:45](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L45) 

## 設計根拠 {#rationale}

変更履歴は、互換性の変更とその再生成の帰結を1つの規範的な場所に記録するため、consumer はパッケージのバージョニングからアーティファクトの互換性を推論する必要がない。

却下された代替案の1つは、パッケージリリースのみを追跡するものであった。producer-contract の fingerprint の変更は、Plan スキーマのバージョンを変更することなく plan を stale にし得るため、この代替案は却下された。[CHANGELOG.md:8](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/CHANGELOG.md#L8) [src/core/ir/schema.ts:45](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L45)
