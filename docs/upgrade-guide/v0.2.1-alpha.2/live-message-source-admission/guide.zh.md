---
kind: upgrade-guide
description: "在持久化前拒绝不兼容的实时消息来源，并可选择适配指定旧上下文生产者。"
---

# 在持久化前准入实时消息来源

[English](guide.md) | 中文

## Change

Session 在提交消息或待处理 inbox 插入前拒绝缺失、空值和退役的 `kind: 'plugin'` 来源。拒绝使用 `INVALID_MESSAGE_SOURCE`；agent 轮次保留此代码，本地子代理结果携带已提交的诊断。不兼容上下文不会在失败前进入异步 writer。存储格式准入和历史迁移保留原有规则。

策略子级适配器在释放失败时以 `CHILD_DISPOSAL_FAILED` 保留已观察到的执行事实。清理失败不能证明工具没有运行。重新执行有副作用的工作前，必须查明执行异常和未知影响。

## Migration

1. 升级上下文生产者，声明并生成生产者拥有的 source kind，移除退役包装。
2. 已知外部生产者暂时无法升级时，将循环条目的 `legacyPluginSources` 设置为它自行声明的精确 `source.plugin` 身份。默认为空。适配器覆盖实时 inbox 和 pre-step user 上下文，不重写直接 Session 追加或持久化行。
3. 触发生产者的上下文生成路径，释放子级并重新打开会话。确认来源已规范化且终止事件完整，不只依赖内存结果。

对于旧 deja 提示路径，现有循环组合条目可包含：

```yaml
name: cordis:agent-loop
config:
  legacyPluginSources: [deja]
```

保留条目的其他设置。名单匹配声明身份，不认证插件归属。生产者改为生成原生来源后移除相应条目。元数据保留和严格回退语义见 [loop 约定](../../../../packages/core/agent-loop/README.zh.md)。
