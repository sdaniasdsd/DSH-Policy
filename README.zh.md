# DeepSeek Harness — 策略增强版

[English](README.md) | 中文

[![CI](https://github.com/sdaniasdsd/DSH-Policy/actions/workflows/ci-master.yml/badge.svg?branch=main)](https://github.com/sdaniasdsd/DSH-Policy/actions/workflows/ci-master.yml)

[![GitHub release](https://img.shields.io/github/v/release/sdaniasdsd/DSH-Policy?include_prereleases)](https://github.com/sdaniasdsd/DSH-Policy/releases)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[![GitHub issues](https://img.shields.io/github/issues/sdaniasdsd/DSH-Policy)](https://github.com/sdaniasdsd/DSH-Policy/issues)

本仓库是独立维护的 DeepSeek Harness fork，不是 DeepSeek 官方发行版。策略增强版 1.0.0 基于 DSH 0.2.1-alpha.3 对应的源码，并在原版 DSH 执行层上增加了由作者控制的任务策略层。正式源码仓库为 [sdaniasdsd/DSH-Policy](https://github.com/sdaniasdsd/DSH-Policy)。

DeepSeek Harness（`dsh`）是由 [DeepSeek AI](https://deepseek.com) 开发的开源 agent harness（智能体框架）。

它构建于**一切皆插件**的架构之上，由 [Cordis](https://github.com/cordiverse/cordis) 驱动，其设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512)。

上游文档：[https://deepseek-harness.github.io/deepseek-harness/](https://deepseek-harness.github.io/deepseek-harness/)

## 策略实测结果

2026 年 11 月 11 日的测试比较了 RC5（官方 DSH `0.2.1-rc.5`，增强包 `1.0.5`）和较新的 RC1（官方 DSH `0.2.2-rc.1`，增强包 `1.0.6`）。每种策略与同版本官方原版对照，使用同一 GPT-5.6-Luna、任务和验收标准。新旧两组同时更换了运行时和增强包，版本差异反映两者的组合效果。

### 真实项目复测

计划 90 个样本，本次快照有 56 个可计量结果，其中 50 个组成完整十组对照。下表每组 5 个样本，覆盖指令双链预算两次、存储批删两次、Duration API 一次。产物评分按功能 40、边界与故障 30、兼容与回归 20、改动范围 10 计分，表内四维分按此顺序列出。通过还要求模型路由正确、产物满足全部验收，策略组须完成工作流。耗时和 token 含有效返工，token 含缓存读取。Duration 验收器修复了 TypeScript 模块加载问题，相关四个产物重新评分，误触发的返工从结果和成本中扣除。

| 版本 / 策略 | 平均首轮→最终分 /100 | 最终四维分 | 首轮→最终通过 | 返工 / 修复后通过 | 平均耗时 | 平均 token |
|---|---:|---:|---:|---:|---:|---:|
| RC5 官方 | 74.0→76.0 | 24.0 / 22.0 / 20.0 / 10.0 | 3/5→3/5 | 2 / 0 | 183.1 秒 | 453,328 |
| RC5 Codex | 86.0→96.0 | 40.0 / 30.0 / 16.0 / 10.0 | 3/5→3/5 | 2 / 0 | 452.2 秒 | 1,041,151 |
| RC5 Claude | 88.0→88.0 | 32.0 / 26.0 / 20.0 / 10.0 | 4/5→4/5 | 1 / 0 | 347.3 秒 | 801,842 |
| RC5 ZCode | 83.3→83.3 | 29.3 / 24.0 / 20.0 / 10.0 | 3/5→3/5 | 2 / 0 | 536.0 秒 | 1,319,666 |
| RC5 Superpowers | 86.0→86.0 | 32.0 / 26.0 / 18.0 / 10.0 | 3/5→3/5 | 1 / 0 | 535.1 秒 | 1,297,893 |
| RC1 官方 | 86.0→88.0 | 32.0 / 26.0 / 20.0 / 10.0 | 3/5→4/5 | 2 / 1 | 216.9 秒 | 516,664 |
| RC1 Codex | 98.0→96.0 | 40.0 / 28.0 / 18.0 / 10.0 | 4/5→4/5 | 1 / 0 | 386.9 秒 | 904,926 |
| RC1 Claude | 88.0→88.0 | 32.0 / 26.0 / 20.0 / 10.0 | 4/5→4/5 | 1 / 0 | 355.1 秒 | 849,463 |
| RC1 ZCode | 86.0→95.3 | 37.3 / 30.0 / 18.0 / 10.0 | 3/5→3/5 | 2 / 0 | 416.3 秒 | 1,001,634 |
| RC1 Superpowers | 98.0→98.0 | 40.0 / 30.0 / 18.0 / 10.0 | 4/5→4/5 | 1 / 0 | 522.5 秒 | 1,178,541 |

- **指令双链预算。** RC5 Codex 平均最终分从同版官方的 40 提高到 90，主要改善功能和边界处理，两轮仍均未通过兼容回归检查。RC5 Claude 在两轮中通过一次，同版官方两轮均未通过。RC1 Codex 和 Superpowers 的平均最终分为 90 和 95，同版官方为 70，三组均通过一次。RC1 四种策略的兼容回归维度都未超过官方。
- **存储批删与 Duration API。** 完整对照中的 30 个样本均首轮 100 分通过，无有效返工。各策略相对同版官方耗时约 1.6–4.3 倍、token 约 1.5–6.3 倍。
- **新旧策略。** 相比 RC5，RC1 Codex 最终均分同为 96，返工从 2 次降到 1 次，平均耗时和 token 下降约 14% 和 13%。Claude 的最终均分与通过数持平，成本略升。ZCode 和 Superpowers 的最终均分各增加 12 分，严格通过数分别维持 3/5 和从 3/5 增至 4/5。RC1 官方也增加 12 分并通过一次有效返工补齐缺项。重复样本仍少，部分批次并发运行，耗时也受服务负载影响。

### 固定任务与模型通道

Luna 的固定任务覆盖简单问答、单文件解码和跨模块告警。两版每组 3 个样本，共 30/30 首轮通过、0 次返工。下表是三题合计。产物由评审按功能、契约、边界、可维护性和错误定位评分，满分 48，评审者知道版本。

| 策略 | RC5 分数 / 秒 / token | RC1 分数 / 秒 / token |
|---|---:|---:|
| 官方 | 46 / 129.9 / 183,859 | 47 / 96.7 / 154,386 |
| Codex | 47 / 238.7 / 381,544 | 47 / 177.2 / 311,160 |
| Claude | 47 / 242.6 / 439,266 | 48 / 237.4 / 398,865 |
| ZCode | 46 / 235.6 / 441,267 | 48 / 368.6 / 615,886 |
| Superpowers | 47 / 322.7 / 518,645 | 48 / 331.4 / 596,791 |

| 通道 | 观测结果 |
|---|---|
| Kilo Nemotron | 30 次尝试中 25 次被限额。简单题上 RC1 Codex 和官方均通过，Codex 耗时 28.3 秒、67,034 token，官方 5.0 秒、10,889 token。两道编码题无可评分样本。 |
| TRAE DeepSeek V4 Flash | 单文件任务中官方首轮 2/2 通过。八个策略组首轮均未完成策略流程，四组收到返工反馈。 |
| CodeArts / WorkBuddy | CodeArts 12 次请求均在生成前返回 HTTP 403。WorkBuddy 三次请求均在生成前被拒绝。 |
| 匿名 DeepSeek / CodeBuddy | 连通性探测分别返回 HTTP 429 和渠道拒绝。 |

另一次壁纸编辑器烟测中，官方、策略版、Claude 和 Superpowers 四份产物均导出 640×360 PNG，未记录浏览器运行错误。该测试检查产物功能。

### 发布验证

增强包预览的 62 项测试通过，1 项标为 TODO。管理器发行校验 11/11 通过。官方 DSH `0.2.2-rc.1` 在隔离 Web 配置中完成预览包的安装、启动和卸载。GitHub 附件校验值与实测包一致。[发布记录](https://github.com/sdaniasdsd/DSH-Policy/actions/runs/43042160800)

以上结果支持把 Claude 和 Codex 作为复杂任务的实验选项。对本轮官方已能满分完成的任务，策略只增加了时间和 token。管理器按签名目录为官方 DSH 安装兼容增强包，实验包通过独立 Web 配置手动试用。[管理器 1.0.11](https://github.com/sdaniasdsd/DSH-Policy/releases/tag/dsh-policy-manager-v1.0.11) · [Claude / Codex 实验预览](https://github.com/sdaniasdsd/DSH-Policy/releases/tag/policy-extension-v1.0.7-experimental.1)

## 策略增强版：我们的改动

当前源码构建在策略版工作流 bundle 中开启自动根任务入口。普通工作在原版 DSH 子任务执行之前，通过有界意图分类及策略选择。聊天卡片展示策略、子任务 Token 场景估算和阶段进度；插件页可以关闭未来输入的自动入口。见[入口指南](docs/upgrade-guide/v0.2.0-rc.2/task-strategy-default-entry/guide.zh.md)。

### Windows 预览版安装包

从 [GitHub Releases](https://github.com/sdaniasdsd/DSH-Policy/releases) 下载未签名的 Windows x64 策略增强版 1.0.0 安装包。 它包含完整 DSH 浏览器界面、策略插件 UI、自动或手动策略选择、阶段边界控制、可解释 Token 估算，以及十二个可配置工作流： 编程、论文调研、问题研究、方案规划，每类都有低、中、高三档。 估算描述子任务执行场景，不是账单或 Token 硬上限。安装后需自行配置供应商和模型。 默认数据目录为 `~/.dsh-policy`；显式 `DSH_HOME` 仍优先。 该版不接入官方自动更新源或强制更新服务，桌面壳也关闭强制更新遮罩。后续策略版通过下载安装包手动升级。

复现未签名构建时，创建被 Git 忽略的 `apps/desktop/.env.windows`：

```dotenv
DSH_DESKTOP_EDITION=policy
DSH_DESKTOP_APP_ID=io.github.sdaniasdsd.dshchange
```

然后运行 `corepack pnpm run package:desktop:win:x64:unsigned`。新建 Desktop 配置时将策略库激活为 bundle； 后续在插件页进行的修改持久化到用户配置补丁。 已有配置保持原样。安装包不包含 API 密钥或用户会话。

上层决定分发哪些任务、按什么顺序执行、使用什么能力；实际工作由原版 DSH subagent 完成。作者自行定义决策偏好，不替换模型循环，也不把每个策略混入 DSH 插件体系。

- **独立策略部件：**具名策略接收任务与作者偏好，产出执行计划。作者可以编写 JavaScript 决策函数，也可以在配置中按偏好选择不同流程。
- **任务流程与并发：**计划由有序阶段组成。同一阶段的任务可以在配置的单次运行并发上限内同时执行；前一阶段结束后，后一阶段接收已有结果。
- **下层能力选择：**每个任务选择允许使用的原版 DSH preset，由 preset 提供插件组合，并可限制工具或选择模型与提供商。选择 preset 不会额外授予文件系统或审批权限。
- **沿用原版 DSH 执行：**可选的 Cordis 接入部件把独立策略部件连接到现有 subagent、preset 和 Job。下层任务仍由原版 agent loop 执行并负责资源清理。
- **进度观察与取消：**上层 agent 通过 `task_strategy_list`、`task_strategy_plan`、`task_strategy_run` 发现、预览和分发计划。现有 `job_list`、`job_output`、`job_kill` 提供进度、已完成任务的子会话标识、结果和取消操作。

策略层需要显式启用：不加载补丁的 profile 保留原版组合。示例配置提供 `direct` 和 `cautious`；后者先并行进行两项只读检查，再执行实现任务，而 `speed=fast` 偏好会选择更短的流程。

这个原型支持进程内的阶段边界暂停、恢复和策略切换。它不是持久化工作流引擎： 没有全局并发配额、自动重试或崩溃恢复。下层任务共享工作文件，并发写入需要作者安排安全流程。 真实模型执行需要配置模型提供商。已经执行无密钥集成检查和七个真实模型冒烟场景； 这些检查不代表模型质量评分，也不证明账单估算准确度。

建议从这里开始阅读：

- [策略用法、源码结构与限制](packages/experimental/task-strategy/README.zh.md)
- [作者偏好与任务流程示例](packages/experimental/task-strategy/cordis.source.patch.yml)
- [策略子系统与 API 参考](docs/subsystems/task-strategy.zh.md)

## 开发者预览

DeepSeek Harness 处于 _开发者预览_ 阶段，正在快速迭代。**未来将出现破坏兼容性的变更。**

运行本项目前，请阅读[安全说明](SAFETY.zh.md)。

<a id="run"></a>

## 运行

### 通过 `npm` 运行

这条命令运行上游 npm 发行版，不包含本 fork 的策略增强。安装 `Node.js`，然后运行：

```sh
npx @deepseek-ai/dsh web
```

该命令默认会在 `http://127.0.0.1:3080` 启动 Web UI，本机启动时还会用默认浏览器打开页面。通过 SSH 启动时只打印宿主机 URL，因为本地转发地址由 SSH 客户端或编辑器持有。传入 `--no-open` 可仅运行服务器而不打开浏览器。详见 [Web UI 指南](docs/user/guide/index.zh.md)。

<a id="run-from-source"></a>

### 从源码运行

如需从仓库源码运行：

```sh
git clone https://github.com/sdaniasdsd/DSH-Policy.git
cd DSH-Policy
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` 会准备仓库产物。`pnpm dsh web` 会直接使用这些已构建产物，不会重新构建。

上面的命令不会加载策略层。如需启用，请按[策略部件的源码试用说明](packages/experimental/task-strategy/README.zh.md#use-this-package)加载附带的源码补丁；启动命令和配置细节以该节为准。GitHub 仓库是本 fork 的正式源码来源。

## 社区与支持

- 策略增强版的问题请提交到[本 fork 的问题追踪器](https://github.com/sdaniasdsd/DSH-Policy/issues)；上游反馈请提交到 [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions)。
- 为你的插件仓库添加 [`dsh-plugin`](https://github.com/topics/dsh-plugin) 话题，便于被发现。
- 欢迎加入 DeepSeek Harness 企微群！扫描下方二维码填写入群问卷，小助手会定期发送入群邀请。

<table>   <thead>     <tr>       <th align="center">入群问卷</th>       <th align="center">微信公众号</th>     </tr>   </thead>   <tbody>     <tr>       <td align="center"><a href="https://trtgsjkv6r.feishu.cn/share/base/form/shrcnIt5twSVdLGD52KJBckGCgg"><img src="https://cdn.deepseek.com/harness/readme/community-wecom-survey.png" alt="DeepSeek Harness 入群问卷二维码" width="180" height="180"></a></td>       <td align="center"><img src="https://cdn.deepseek.com/harness/readme/community-wechat-official-account.png" alt="DeepSeek Harness 团队微信公众号二维码" width="180" height="180"></td>     </tr>   </tbody> </table>

## 参与贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.zh.md)。

## 开发

请先阅读[开发指南](docs/development.zh.md)与[架构文档](docs/architecture.zh.md)。

`pnpm run dev:web` 会在一个终端里完成构建、启动，并在源码修改时重建 client bundle；`make help` 列出 Web 与 Desktop 对应的 Make target。完整表格见开发指南的「应用命令」一节。

面向 agent：请遵循 [AGENTS.md](AGENTS.md)。

## 引用

```bibtex
@misc{deepseek-harness2026,
  title={DeepSeek Harness: Everything is a Plugin},
  author={DeepSeek-AI},
  year={2026},
  publisher={GitHub},
  howpublished={\url{https://github.com/deepseek-ai/deepseek-harness}},
}
```

## 许可证

[MIT](LICENSE)

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
