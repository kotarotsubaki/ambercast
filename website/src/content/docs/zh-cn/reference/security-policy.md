---
title: 安全策略
description: ambercast 的版本支持范围与安全漏洞私下报告流程。
---

本文档规定了 ambercast 的安全支持范围以及向维护者报告安全漏洞的正式渠道。

## 受支持的版本 {#supported-versions}

| 发布状态 | 受支持版本 |
| --- | --- |
| ambercast 处于 1.0 之前（pre-1.0）。 | 仅最新发布的版本接收修复。 |

ambercast 不承诺为较旧的 pre-1.0 版本提供修复。

## 漏洞报告 {#vulnerability-reporting}

| 主题 | 策略 |
| --- | --- |
| 渠道 | 通过 GitHub Security Advisories 私下报告：`https://github.com/kotarotsubaki/ambercast/security/advisories/new`。 |
| 必备内容 | 包含受影响版本、复现步骤以及影响说明。 |
| 公开 Issue | 请勿为安全报告创建公开 Issue。 |
| 供应链 | 针对 `ambercast` npm 包的名称仿冒（typosquats）或冒充行为，使用相同的私下渠道。 |

关于信任边界的详细说明，请参阅 [信任与安全](/ambercast/zh-cn/explanation/trust-and-security/)；若您希望了解常规贡献指南，请参阅 [参与贡献](/ambercast/zh-cn/how-to/contribute/)。
