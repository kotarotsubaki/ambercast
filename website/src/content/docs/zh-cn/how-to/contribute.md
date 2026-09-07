---
title: 参与贡献
description: ambercast 代码仓库的贡献指南与流程说明。
---

本文档介绍了向 ambercast 代码仓库提交贡献的具体流程与要求。

## 前提条件 {#prerequisites}

- 项目 package 声明了 `npm test`、`npm run typecheck` 和 `npm run lint` 脚本。

## 操作步骤 {#steps}

### 外部贡献者流程

1. 提交一个 issue 描述您发现的问题或提议，随后 fork 代码仓库并创建开发分支。这是公开发布的外部贡献流程。
2. 运行 `npm test`、`npm run typecheck` 和 `npm run lint`，然后提交一个标题符合 Conventional Commit 规范的 Pull Request，并处理评审中的讨论。这些脚本均已存在，且仓库要求执行该 PR 工作流。
3. 若发现安全漏洞，请通过 GitHub Security Advisories 提交，而非创建公开 issue。安全策略要求提交包含版本、复现步骤及影响说明的私密报告。

### 维护者与 Agent 工作流

- `AGENTS.md` 与 `.claude/` 描述了维护者 AI Agent 自动化流程，并非外部贡献者的前提条件；外部 PR 检查会在 CI 中运行。
- 维护者或仓库 Agent 遵循 `AGENTS.md` 中的开发工作流，包括其针对行为变更的测试顺序。

## 验证 {#verification}

- 这三个 package 命令以退出码 `0` 退出，或者在移交前记录其失败信息。

## 相关链接 {#related}

链接：[安全策略](/ambercast/zh-cn/reference/security-policy/)，[变更日志](/ambercast/zh-cn/reference/changelog/)。
