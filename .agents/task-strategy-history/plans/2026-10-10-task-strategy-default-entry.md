# 策略版默认任务入口实施计划

> **For agentic workers:** Use superpowers:executing-plans for execution in this session, or superpowers:subagent-driven-development if the user chooses delegated execution. Complete each task's test cycle before proceeding.

**Goal:** 将普通任务默认接入策略层，并在本机应用中展示真实策略进度。

**Architecture:** 可选策略载体通过原版 Agent 扩展点协调根输入，通过原版工具服务限制根 Agent 执行，通过现有 submitTask、TaskRun 与 Jobs 执行任务。入口事实记录在 Session，前端通过独立的会话节点贡献展示；策略版打包默认启用入口。

**Tech Stack:** TypeScript、Cordis、Typert、React、Vitest、Electron 与现有 Windows 打包流程。

**Spec:** [已确认设计](../specs/2026-10-10-task-strategy-default-entry-design.md)。本计划待用户审阅，未开始产品实现。

## Global Constraints

- 作者 decide 保持同步；路由和选择模型使用可取消、有界的原版子任务能力。
- 不重写 AgentLoop，不引入第二套 Job、执行器或权限系统。
- 官方组合不默认启用入口；策略版默认启用，插件设置可保存未来输入的开关。
- 用户没有回复时按已配置默认选择继续；选择失败明确报错，不直接执行任务。
- 根 Agent 限制执行工具；执行与选择子 Agent 不进入入口协调器。
- 保留原始请求、当前策略绑定与已有结果；不支持进程重启后自动恢复执行。
- 配置、凭据、模型、会话和用户插件在本机更新时保留；日志不得输出密钥或 Host 登录令牌。

## Review Focus

1. 持久 inbox 已在 pre-step 前 claim：取消、拒绝和出错后原始输入仍可追溯，不能只保存在内存。
2. Agent 局部工具不受普通全局工具过滤影响：展示与执行检查均须覆盖，子任务执行能力不受根限制影响。
3. 同时收到追问、Jobs 完成通知和迟到回复：只关联原任务，不再次派发。
4. 附件、配置热重载或模型路由改变：不能丢附件、重复受理或改变已接收任务的规则。
5. 已存在独立桌面 profile：升级不能仅依赖新建 profile 的默认配置，且不能覆盖用户 API 与插件设置。

## Task 1: 根输入协调和可追溯状态

**Files:** 创建 `packages/experimental/task-strategy/src/entry-types.ts`、`entry-router.ts`、`entry-coordinator.ts`、`entry-events.ts`；修改 `src/cordis.ts`、`src/schema.ts`、`src/types.ts`、`package.json` 与 Host/Client tsconfig；创建 `tests/adapter.spec.ts`、`tests/adapter.spec.ts`，扩展 `tests/adapter.spec.ts` 与 Loader fixtures。

**Interfaces:**

- `EntryRoute` 为封闭可辨识联合：`chat`、`new-task`、`supplement`、`status`、`cancel`、`switch`、`clarify`。控制分支显式携带当前请求身份；策略切换携带 strategy 和 expectedBindingEpoch。
- `EntryView` 携带原始 messageId、宿主生成的 requestId、状态、可选 TaskReceipt、成本快照、阶段计数和错误；状态包含 routing、selecting、running、waiting、completed、failed、cancelled、interrupted。
- `routeEntry(parent, message, active, options, subagents, provider, signal): Promise<EntryRoute>` 仅判断意图；模型返回内容用结构化 schema 解析，不允许执行工具。
- `EntryCoordinator.accept(parent, message, signal): Promise<EntryView>` 在路由前预留原始消息身份，调用现有 submitTask；`views(parent)` 返回所属 Agent 的分离快照。
- 新配置 `entry.enabled` 为 Volatile，独立载体默认 false；路由额度沿用当前 selection 的有界配置，路由模型沿用其模型/provider 设置。入口开关只决定未来输入是否受理。
- 增加 Session 事件 `task-strategy/entry`，包含所属请求身份、状态和必要的原始输入快照；入口模型结论通过具名 context source 进入会话。新增持久类型按仓库流程记录兼容声明，不手改已发布历史。

- [ ] 先写失败用例：同一 MessageId 并发和重试只路由一次、只创建一个 Job；不同正文复用身份拒绝；普通对话不创建 Job；通知与子任务输入不触发路由；无效结构化输出、未知策略、超时和取消不执行。
- [ ] 增加真实 Loader 用例：`parent.followup(createUserMessage(...))` 自动进入入口，不手调策略工具；根循环继续保留 `await next()` 返回的消息与 startsRequestSeries。选择完成回执成为已记录 context，原始用户消息不被改写。
- [ ] 增加取消和错误用例：pre-step claim 后取消仍有可追溯原始输入；Owner 销毁和卸载释放选择资源；accepted 任务按 Jobs 生命周期继续；热重载不重复路由旧消息。
- [ ] 实现以上接口和 carrier 装配。仅源为 human user 的原始新输入参与路由；明确界面命令不重复模型判断。预留状态归属于 exact live owner，并跨载体重载保留；进程重启只还原显示，不启动执行。
- [ ] 正文完整传给现有文字任务接口；非文本执行输入在不能完整表达时明确拒绝，记录原始附件并在 UI 报告限制，不静默转换成残缺任务。已有工作目录与模型继承使用原版父子契约。
- [ ] 运行 `node node_modules/vitest/vitest.mjs run packages/experimental/task-strategy/tests/adapter.spec.ts packages/experimental/task-strategy/tests/adapter.spec.ts packages/experimental/task-strategy/tests/adapter.spec.ts`，先确认新增行为失败，再实现并确认通过；提交此任务。

## Task 2: 根工具边界与任务控制

**Files:** 创建 `packages/experimental/task-strategy/src/entry-tools.ts`、`src/entry-boundary.ts`、`tests/adapter.spec.ts`；修改该包 `src/cordis.ts`、`src/tools.ts`、`src/runtime-types.ts`、`src/task-run.ts`、`src/task-submissions.ts`；扩展 `tests/runtime.spec.ts`、`tests/adapter.spec.ts`。本任务及以下包内路径均相对于此包。

**Interfaces:**

- `mountEntryBoundary(parent, options): () => void` 贡献根工具展示限制和执行检查。检查实际 `exec.agent`，仅覆盖受控根 Agent；保留原版审批、权限与其他 guard 的拒绝。
- 根可用工具由入口维护明确控制集合：策略目录/预览、所属任务状态/取消/切换/继续、Jobs 查询/取消和问答。自动受理后的根工具禁止重复 submit、显式 run、任意子任务、文件和 Shell 执行；禁用入口时恢复原工具贡献。
- `EntryCoordinator.cancel(parent, requestId)` 取消尚未接收入口，接收后调用 jobs.kill；`switch(parent, requestId, request: TaskSwitch)` 与 `resume(parent, requestId, epoch)` 委托现有服务；`supplement(parent, requestId, message)` 记录补充。
- `TaskRunOptions.additionalContext?: () => string` 为可信、同步的补充快照提供者。在阶段开始时读取一次，同阶段任务获得相同快照；原始 task 和已完成结果不变，新增文本仍受输入字节限制。

- [ ] 先写失败用例：根模型看不到执行工具；绕过展示直接 execute 全局与局部执行工具均被拒绝；PTC transport 与嵌套业务派发不能绕过；标准执行子任务和 structured_output 选择子任务仍能工作。
- [ ] 实现根展示与执行双重限制。工具允许集合只包含实际已注册的控制能力，不向 restrict 传未知、局部或保留 transport 名称；局部工具展示由 prompt assembly 贡献处理，执行处使用 guard。校验 native、ptc、both 三种原版模式，避免单独注册与预设冲突的 presentAs。
- [ ] 先写失败用例：补充不创建新 Job、不改变正在执行阶段，在下一阶段统一生效；查询与取消不选择策略；过期 epoch 拒绝切换；迟到回复和 Jobs 通知不创建新任务。
- [ ] 实现控制接口、具名且已记录的补充上下文和阶段快照。存在多个活跃请求或不明确的控制意图时返回 clarify，禁止猜测目标并执行。
- [ ] 验证切换、取消、完成与同一阶段并发交错，失败不破坏原有 TaskRun 限额和清理；运行 `node node_modules/vitest/vitest.mjs run packages/experimental/task-strategy/tests/adapter.spec.ts packages/experimental/task-strategy/tests/adapter.spec.ts packages/experimental/task-strategy/tests/runtime.spec.ts packages/experimental/task-strategy/tests/selection.spec.ts`，通过后提交。

## Task 3: 聊天运行卡片与插件设置

**Files:** 创建 `src/client/task-entry-node.ts`、`TaskEntryCard.tsx`、`TaskEntryCard.module.css`、`task-entry-controller.ts`；修改 `src/client/mount.ts`、`TaskStrategyCard.tsx`、`task-strategy-card-controller.ts`、`locales.ts`、`src/cordis.ts`、`package.json`、`tsconfig.client.json`；创建 `tests/task-entry.client.spec.tsx`、`tests/task-entry.client.spec.tsx`，扩展原有 mount/settings 测试。

**Interfaces:**

- 在原版 uiConversation 贡献会话节点，扩展 ChatNodeDataMap 的 `task-strategy-entry`，以原始请求锚点合并入口状态、策略绑定和阶段进度；不导入其他业务 UI 组件。
- `@Remote entryState(args: { sessionId: SessionId }): EntryView[]` 读取所属当前状态；取消、切换、继续分别使用类型化 Remote 参数并在 Host 找到 exact live owner，校验请求、终态与 epoch。
- 前端 controller 以 Session 和连接代次绑定，丢弃旧响应；断线禁用控制并显示断线状态，重连读取快照，不调用 accept。
- 原插件表单增加 `entry.enabled`，继续使用原版版本化保存；配置草稿与当前运行状态分开。

- [ ] 先写失败用例：尚无 JobId 时显示 routing/selecting；接受后显示策略、已知输入、场景假设和未知项；阶段计数来自 Host；失败与取消准确区分。
- [ ] 增加重连、旧响应、异步卸载、保存冲突、过期绑定切换和双击取消测试。恢复旧会话但无 live run 时显示 interrupted，不伪造 completed。
- [ ] 实现节点和中英文 UI；挂载 required Client 服务、类型声明和 Typert 贡献，复用共享 primitives 与原会话状态源。
- [ ] 检查额外入口/选择/汇总用量的文案，不能将 child cost 写成完整账单；策略未配置场景假设时展示未知，不使用零替代。
- [ ] 运行 `node node_modules/vitest/vitest.mjs run packages/experimental/task-strategy/tests/task-entry.client.spec.tsx packages/experimental/task-strategy/tests/task-entry.client.spec.tsx packages/experimental/task-strategy/tests/task-strategy-mount.client.spec.ts packages/experimental/task-strategy/tests/task-strategy-controller.client.spec.ts packages/experimental/task-strategy/tests/task-strategy-card.client.spec.tsx`；运行 `node node_modules/pnpm/bin/pnpm.cjs run typecheck`，检查真实页面自动入口、取消与阶段切换，通过后提交。所需 pnpm 子调用沿用已验证的私有 shim，只在构建子进程 PATH 中启用。

## Task 4: 策略版默认组合和规范 Windows 构建

**Files:** 修改 `strategies/workflows.patch.yml`、`apps/desktop/scripts/smoke-runtime.ts`、`apps/desktop/tests/prepared-runtime-smoke.spec.ts`、`apps/desktop/tests/packaged-runtime-verification.spec.ts`、`apps/desktop/tests/policy-edition.spec.ts`；按实际行为更新策略 README 双语对、任务策略 package README 双语对、`docs/subsystems/task-strategy` 双语对及 `docs/upgrade-guide/v0.2.0-rc.2/task-strategy-default-entry/guide.md` 与 `guide.zh.md`；机械生成 Remote、API、配置和持久类型记录。

**Interfaces:** 策略版默认 bundle 配置 `entry.enabled: true`；目录 RPC 附带可读的入口启用状态，打包检查必须确认它实际启用。现有用户 profile 的显式 false 仍有效，升级不覆盖用户设置。

- [ ] 先写失败的产物组合用例：新建和现有策略 profile 均加载入口；显式关闭时保留旧行为；标准官方组合不默认启用。
- [ ] 更新策略版配置，维持 12 条策略与 allowedPresets；修正最终 ASAR 内检查方式，不能由普通 Node 的 existsSync 误判归档内部文件后跳过策略断言。
- [ ] 按仓库生成器重建类型与文档，新增持久类型按 type-acknowledgement 流程记录；双语哈希由脚本重新记录，运行相关文档与类型门禁。测试按影响范围选择，不执行无关全仓测试。
- [ ] 设置子进程环境 `DSH_DESKTOP_EDITION=policy`、`DSH_DESKTOP_APP_ID=io.github.sdaniasdsd.dshchange`，运行 `node node_modules/pnpm/bin/pnpm.cjs --dir apps/desktop run package:win:x64 -- --unsigned --dir`；使用现有网络代理配置但不输出敏感环境。
- [ ] 检查构建日志、prepared runtime、最终 ASAR、matching frontend 和 built commit。产物普通聊天的免密钥测试应证明一次自动入口和一次执行，不仅断言策略目录存在。通过后提交并记录构建证据。

## Task 5: 真实模型黑盒与本机更新

**Files:** 私有测试与更新记录写入 Git 忽略的 `.superpowers/`；本机程序目录为 `C:\Users\AA\AppData\Local\Programs\DSH Policy Edition`，数据目录为 `C:\Users\AA\.dsh-policy`。不得把凭据、登录 URL 或用户会话复制到可提交文件。

**Interfaces:** 使用现有本机 API 与模型，在独立测试会话和临时工作目录从普通输入验证；更新使用完整目录构建、暂存校验、回退目录和受控重启，不混拷新旧 JS 产物。

- [ ] 使用已配置提供方创建真实模型黑盒测试：普通低档任务生成一个临时文件并核对结果、所选策略、阶段与会话证据；问候、追问、进度查询、无回复和取消分别核对无重复执行。故障修复按单一复现、先失败后通过处理。
- [ ] 对照源码执行路径和网页状态，确认根 Agent 没有直接使用文件或 Shell，执行子 Agent 确实完成任务。记录实际提供方用量与可解释估算的区别。
- [ ] 查询本机活跃任务和用户配置覆盖，等待结算后更新；若仍有用户任务在运行，说明原因并等待用户安排重启，不强杀任务。
- [ ] 为本次构建使用新的绝对暂存与回退目录；检查目录都在指定 Programs 父目录之下，复制后校验哈希和 ASAR build commit。保留原卸载器、凭据、用户插件和 profile patch。
- [ ] 重启时显式使用 `DSH_HOME=C:\Users\AA\.dsh-policy`；后台辅助进程隐藏启动，主窗口通过单实例激活展示。启动或检查失败时回退程序目录，不改动用户数据。
- [ ] 在安装后的实际普通聊天入口再次验证自动策略、卡片、低档任务结果、取消和配置保存。向用户交付安装位置、运行提交、验证结果与已知限制；未经本轮请求，不重发线上安装包。

## 执行与审阅

建议由当前 Agent 在本会话串行实施：这五项共享消息归属、请求状态和 UI 协议，串行执行便于保持接口一致。也可按用户选择采用子 Agent 逐项实施与审阅。用户审阅本计划并选择方式后才进入产品实现、测试与安装。
