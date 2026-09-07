---
title: 选择要运行的测试
description: 介绍如何指定测试文件路径、使用模式过滤用例以及配置用例发现规则。
---

您可以通过指定文件路径、使用匹配模式或自定义配置规则，来选择需要执行的测试用例。

## 前提条件 {#prerequisites}

默认的发现机制会匹配 `**/*.test.md`，并忽略 runs、plans 以及 grounding 伴生文件。

## 操作步骤 {#steps}

1. 运行 `npx ambercast run tests/ambercast/sign-in.test.md --list`。位置参数是字面提示词路径，`--list` 会直接返回而不进行回放。
2. 运行 `npx ambercast run --grep 'sign-in' --list`。解析器会构建一个正则表达式用于用例发现过滤。
3. 在有效配置中写入 `"testMatch":["**/*.test.md"],"testIgnore":["**/.runs/**"]`。匹配的忽略规则会排除该路径，即便它符合 `testMatch`。
4. 若字面路径以 `--` 开头，请运行 `npx ambercast run --list -- --literal.test.md`。诸如 `--list` 这样的标志必须置于分隔符之前；`--` 之后的所有内容均为字面位置路径，因此置于末尾的 `--list` 会被当作文件名处理。

## 验证 {#verification}

当报告了选中的路径时，`--list` 期望退出码为 `0`；仅在有意为之的情况下，才使用 `--allow-empty` 处理零匹配。

## 相关链接 {#related}

链接：[发现模式](/ambercast/zh-cn/reference/discovery-patterns/)、[ambercast run](/ambercast/zh-cn/reference/cli/run/)、[ambercast generate](/ambercast/zh-cn/reference/cli/generate/)、[配置](/ambercast/zh-cn/reference/configuration/)。
