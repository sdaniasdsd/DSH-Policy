---
kind: upgrade-guide
description: "直接组合任务策略载体时，现在需要独立的任务运行服务。"
---

# 独立任务运行服务

[English](guide.md) | 中文

## 变更

直接挂载 `@deepseek-ai/dsh-experimental-task-strategy/cordis` 的 profile 现在还需要 `@deepseek-ai/dsh-experimental-task-strategy/runtime`。策略载体负责策略注册与入口，任务服务负责计划准入、执行和原版 Jobs。已有原生计划和策略控制保留其行为，策略工作流 bundle 已挂载两个服务。

## 迁移

1. 直接组合时，在 profile patch 的载体旁添加名为 `@deepseek-ai/dsh-experimental-task-strategy/runtime` 的 Loader 条目；bundle 用户更新工作流 bundle 即可。
2. 原有 `preset` 任务无需修改计划。使用可选外部适配器时，显式设置 `allowedExecutors`，只启用已配置的[编排插件](../../../../packages/experimental/task-strategy/README.zh.md#runtime-plugins)。
3. 确认 `taskRuns` 和 `taskStrategies` 都已挂载。提交已有命名策略，确认只接受一个原版 Job，且能看到进度。现有 host 控制仍可通过 `taskStrategies` 使用，独立插件可直接调用 `taskRuns`。
