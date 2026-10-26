# DSH Policy 独立扩展框架实施计划

[English](2026-10-22-dsh-policy-extension.md) | 中文

> **面向智能体执行者：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 子技能，按任务逐项实施本计划。步骤使用复选框（`- [ ]`）跟踪。

**目标：** 将 DSH Policy 拆分为可安装到官方 DSH 的扩展，同时保留当前运行中任务的策略反馈能力，并确保每个扩展发行版只绑定一个确定的官方 DSH 发行版和源码提交。

**架构：** Policy 任务控制器继续管理任务身份、策略状态、阶段边界和反馈。将它打包为官方 profile Bundle，并提供自己的宿主端和客户端插件；脚本阶段调用官方 Workflow，当 Workflow 无法提供现有实时成员控制时，继续使用 DSH 原生成员执行器。在干净 profile 的安装和行为一致性验证通过前，保留当前桌面版发行方式。

**技术栈：** TypeScript、pnpm workspace、Cordis 插件、官方 DSH Bundle/profile 插件系统、官方 Workflow API、Vitest、包 tarball 和干净消费者环境冒烟测试。

**规格：** [docs/superpowers/specs/2026-10-22-dsh-policy-extension-design.md](../specs/2026-10-22-dsh-policy-extension-design.zh.md)

## 全局约束

- 每个已发布的 Policy 扩展版本只对应一个精确的官方 DSH 运行时版本和一个上游源码提交。
- 扩展包发行元数据记录这两个值，并为其使用的 DSH 服务声明精确版本的 peer 依赖。
- 已发布的清单不得包含 `workspace:*` peer 依赖。
- 发行检查核对元数据、包 peer 版本、锁文件和被测试的 DSH 源码是否指向同一版本组合。
- DSH 版本不匹配时，包兼容性检查必须拒绝加载；常规安装路径不提供自动回退、宽泛兼容范围或版本豁免。
- 正在执行的阶段保留启动时捕获的指令和执行器；反馈只在明确的阶段边界影响后续工作。
- 如果 Workflow 不提供所需的子任务归属和控制句柄，相关策略继续使用 DSH 原生成员执行器，且不得宣称支持无法提供的成员消息能力。
- 除非现有运行时已提供进程重启恢复能力，否则本次不新增该能力。

## 审查重点

- DSH 运行时版本不完全匹配时，必须在扩展激活前拒绝；在任务 1 和任务 6 测试。
- 发行元数据、peer 依赖、锁文件、tag 或源码提交任一不一致时，发行检查必须失败；在任务 1 和任务 6 测试。
- 阶段执行期间收到的反馈不得修改当前阶段，并须在下一阶段边界应用；在任务 3 测试。
- 过期 binding epoch 或被拒绝的策略切换不得替换当前状态，恢复操作应恢复保留的策略；在任务 3 测试。
- Workflow 报错或取消时，外层任务必须结束并清理子任务，且不得宣称不支持的实时成员消息能力；在任务 4 和任务 6 测试。

---

## 文件地图

- `packages/policy-extension/package.json`、`src/index.ts` 和 `src/client/index.ts`：独立宿主端/客户端包入口及发布边界。
- `packages/policy-extension/dsh.bundle.patch.yml`：官方 profile Bundle 元数据，以及扩展宿主端/客户端插件的启用配置。
- `packages/policy-extension/src/compatibility.ts` 和 `compatibility.json`：运行时兼容性 API，以及本次发行对应的 DSH 版本、tag、提交精确组合。
- `scripts/verify-policy-compatibility.ts` 和 `scripts/verify-policy-compatibility.spec.ts`：对包元数据、锁文件和检出的官方源码执行发行组合校验。
- `packages/policy-extension/src/task-runtime/**`：从 `packages/experimental/task-strategy/src/**` 适配迁移的任务控制器、策略绑定、阶段编排和反馈接口。
- `packages/policy-extension/src/workflow-executor.ts`：官方 Workflow 脚本阶段适配器；需要成员级控制时仍保留 DSH 原生执行器。
- `packages/policy-extension/src/client/**`：从现有 task-strategy 客户端迁移的策略选择、任务进度、反馈和控制 UI。
- `packages/policy-extension/tests/**`：兼容性、控制器、Workflow 适配器、UI 和包消费者测试。
- `apps/desktop/src/project-manager.ts`、`apps/desktop/scripts/prepare-dsh.ts` 和 `apps/desktop/scripts/smoke-runtime.ts`：移除仅桌面版使用的自动注入，并在迁移期间保留旧发行方式的桌面冒烟覆盖。
- `.github/workflows/**` 和 `docs/superpowers/**`：发行兼容性门禁及配套的成对安装文档；若新增公开文档页，再更新仓库文档白名单。

## 任务 1：固定并强制校验官方 DSH 发行组合

**文件：**
- 新建：`packages/policy-extension/compatibility.json`
- 新建：`packages/policy-extension/src/compatibility.ts`
- 新建：`scripts/verify-policy-compatibility.ts`
- 新建：`scripts/verify-policy-compatibility.spec.ts`
- 修改：根目录 `package.json` 脚本；仅在测试命令要求时修改根锁文件

**接口：**
- 产出包含字符串字段 `policyVersion`、`dshVersion`、`dshTag` 和 `dshCommit` 的 `PolicyCompatibility`。
- 首个官方版本组合：DSH 版本 `0.2.1-rc.2`、tag `dsh-v0.2.1-rc.2`、提交 `687f282e8625c6b8d11ff58211a90524be2e4317`。
- 产出 `assertCompatibleDsh(actualVersion: string, expected: PolicyCompatibility): void`；版本不匹配时抛出有明确类型的兼容性错误。

- [ ] 增加名为 `acceptsThePinnedRuntimeVersion`、`rejectsDifferentRuntimeVersions`、`rejectsMetadataPeerVersionMismatch` 和 `rejectsTestedSourceCommitMismatch` 的测试。
- [ ] 执行 `corepack pnpm exec vitest run scripts/verify-policy-compatibility.spec.ts`，确认每个新断言都因待实现的行为而失败。
- [ ] 实现元数据解析、精确相等检查和发行校验器。校验器读取 CI 提供的官方源码版本和提交，并与兼容性组合及所有精确 DSH peer 版本比对。
- [ ] 再次执行 `corepack pnpm exec vitest run scripts/verify-policy-compatibility.spec.ts`；预期四个测试全部通过。
- [ ] 提交为 `feat: pin policy extension to an official dsh release`。

## 任务 2：创建可独立打包的扩展 Bundle

**文件：**
- 新建：`packages/policy-extension/package.json`、`tsconfig.json`、`src/index.ts`、`src/client/index.ts` 和 `dsh.bundle.patch.yml`
- 新建：`packages/policy-extension/tests/package-metadata.spec.ts`
- 修改：根目录 `package.json` workspace 列表和脚本、`pnpm-workspace.yaml` 及 `pnpm-lock.yaml`

**接口：**
- 使用任务 1 提供的 `PolicyCompatibility`。
- 产出名为 `@deepseek-ai/dsh-policy-extension` 的包，提供宿主端和客户端导出、`dsh.bundle.patch` 声明，以及每个所用官方 DSH 包的精确版本 peer 依赖。
- Bundle 元数据通过官方 DSH profile 插件管理器启用宿主端和客户端插件；它不依赖桌面应用。包清单声明精确的 `engines.dsh: "0.2.1-rc.2"`；锁定版本的官方 DSH 会在 Bundle 加载前执行兼容性预检并拒绝不匹配版本，因此扩展不重复实现运行时准入。

- [ ] 增加 `packageMetadataDeclaresAnOfficialBundle`、`publishedPeersAreExact` 和 `packedTarballHasNoWorkspacePeerRanges` 测试。
- [ ] 执行 `corepack pnpm exec vitest run packages/policy-extension/tests/package-metadata.spec.ts`，确认在实现包之前测试失败。
- [ ] 定义包导出、官方 Bundle patch、构建配置，以及根据实际导入确定的精确 DSH peer/dev 依赖；不要将无关 DSH 运行时包复制到扩展内。
- [ ] 将包打入临时目录并检查包清单；预期包含 Bundle 声明和宿主端/客户端入口，且不含 `workspace:*` 依赖或 peer 范围。
- [ ] 运行包构建和元数据测试；预期全部通过。
- [ ] 提交为 `feat: scaffold standalone policy extension bundle`。

## 任务 3：抽离 Policy 控制器并保留反馈语义

**文件：**
- 新建：从 `packages/experimental/task-strategy/src/**` 迁移策略自有行为到 `packages/policy-extension/src/task-runtime/**`
- 新建：`packages/policy-extension/tests/task-runtime/**`
- 修改：`packages/policy-extension/src/index.ts`

**接口：**
- 使用任务 2 声明的精确官方服务，以及任务 1 的包兼容性检查。
- 产出任务控制器，管理已接收任务的策略绑定、结果历史、阶段游标、限制和控制命令。
- 对外控制器操作继续保持现有语义：查看、取消、有界地补充下一阶段输入、预留策略切换、epoch 校验、恢复、在支持时发送成员消息，以及访问任务范围内的版本化记录。

- [ ] 参照现有 task-strategy 测试夹具，新增 `feedbackDuringActiveStageAppliesAtNextBoundary`、`staleBindingEpochIsRejected`、`failedStrategySwitchResumesRetainedStrategy`、`cancelSettlesTaskAndChildren` 和 `memberMessageRequiresNativeExecutor` 测试。
- [ ] 执行 `corepack pnpm exec vitest run packages/policy-extension/tests/task-runtime`，确认测试能暴露尚未抽离的控制器行为。
- [ ] 仅将策略自有控制器和策略代码迁移到 `src/task-runtime/**`；把 workspace 专属导入替换成任务 2 选定的官方公开包导入，不得引用 DSH 私有实现。
- [ ] 运行全部 task-runtime 测试和扩展类型检查；预期反馈只影响后续阶段，且控制器行为测试全部通过。
- [ ] 提交为 `feat: extract policy task controller and feedback`。

## 任务 4：增加官方 Workflow 脚本执行器适配器

**文件：**
- 新建：`packages/policy-extension/src/workflow-executor.ts`
- 新建：`packages/policy-extension/tests/workflow-executor.spec.ts`
- 修改：仅为通过现有执行器接口注册适配器而修改 `packages/policy-extension/src/task-runtime/**`

**接口：**
- 使用锁定 DSH 版本中的官方 `WorkflowEngine`、`WorkflowStartRequest`、`WorkflowRun` 和 `WorkflowResult`。
- 产出 Policy 阶段执行器：使用当前任务的父 Agent 和中止信号启动脚本，等待 `WorkflowRun.result`，将 `completed` 映射为阶段结果，将 `cancelled` 和 `error` 映射为任务结束状态，并在清理时调用幂等的 `dispose()`。
- 需要实时成员消息或 Workflow 不提供的子任务控制句柄时，策略继续选择 DSH 原生成员执行器。

- [ ] 新增 `passesTaskParentAndCancellationSignal`、`returnsWorkflowValueToLaterStage`、`completedResultChangesTheNextStrategyDecision`、`mapsWorkflowErrorAndCancellation`、`disposesRunOnEverySettlement` 和 `doesNotExposeMemberMessagingForWorkflowStages` 测试。
- [ ] 执行 `corepack pnpm exec vitest run packages/policy-extension/tests/workflow-executor.spec.ts`，确认适配器实现前测试失败。
- [ ] 根据锁定官方 Workflow 类型实现适配器；由外层控制器保存任务身份和策略限制，不从 `WorkflowRun` 推断这些状态。
- [ ] 在官方 `0.2.1-rc.2` worktree 上运行适配器测试和扩展类型检查；预期所有测试通过，且没有私有 Workflow 导入。
- [ ] 提交为 `feat: execute policy stages through official workflow`。

## 任务 5：迁移 Policy 客户端并移除桌面端自动注入

**文件：**
- 新建：`packages/policy-extension/src/client/**`
- 新建：`packages/policy-extension/tests/client/**`
- 修改：`apps/desktop/src/project-manager.ts`
- 修改：`apps/desktop/scripts/prepare-dsh.ts`
- 修改：`apps/desktop/scripts/smoke-runtime.ts`
- 修改：当前描述桌面端自动注入的策略与 profile 文档

**接口：**
- 使用任务 2 的扩展宿主端/客户端入口和 Bundle patch，以及任务 3 的控制器事件。
- 产出官方 DSH Web UI 控件，提供策略选择、任务进度、受支持的反馈、取消和策略切换。
- 官方 profile 插件安装是唯一启用路径；桌面端源码准备不得将私有 Policy 包加入内置运行时，也不得复制 `policy-workflows.patch.yml`。

- [ ] 新增 `rendersPolicyControlsWhenBundleIsInstalled` 和 `hidesUnsupportedWorkflowMemberControls` 客户端测试，并更新桌面冒烟断言，要求不存在隐式的 Policy 包注入。
- [ ] 运行定向客户端测试和 `corepack pnpm exec vitest run apps/desktop/scripts`，确认旧自动注入假设已被识别。
- [ ] 将现有 task-strategy 客户端 UI 迁入扩展入口，并从桌面端启动和打包流程中移除 `policy-workflows.patch.yml` 探测及自动 profile 修改。
- [ ] 运行客户端测试、受影响的桌面冒烟测试，并构建扩展和桌面宿主/客户端契约；预期扩展只能通过官方 Bundle 安装启用。
- [ ] 提交为 `refactor: activate policy through official profiles`。

## 任务 6：验证官方干净环境安装和发行兼容性

**文件：**
- 新建：`packages/policy-extension/tests/consumer-install/**`
- 修改：`.github/workflows/**`，增加针对固定上游版本的兼容性任务
- 仅在干净安装暴露出遗漏的发行校验时修改：`scripts/verify-policy-compatibility.ts`
- 修改：`docs/` 下成对维护的 Policy 安装和发行文档

**接口：**
- 使用任务 1 至 5 构建的扩展包，以及官方 DSH `0.2.1-rc.2` tag/提交。
- 产出干净 profile 冒烟结果，证明可在不检出 Policy Edition 源码的情况下完成安装、启用、策略任务创建、Workflow 阶段结束、阶段边界反馈、取消和不兼容运行时拒绝。

- [ ] 新增 `installsIntoCleanOfficialProfile`、`activatesPolicyHostAndClient`、`runsWorkflowStageAndAppliesNextStageFeedback` 和 `rejectsUnmatchedDshVersion` 消费者测试。
- [ ] 在空临时 profile 上执行消费者测试，确认当前扩展在包和启用接线完成前无法安装运行。
- [ ] 通过官方 profile 插件入口安装打包后的扩展，运行策略冒烟场景；CI 将 tag、提交、包 peer 依赖、锁文件和元数据作为一个整体进行校验。
- [ ] 运行 `corepack pnpm run verify-policy-compatibility`、包构建/测试、所有 task-runtime/Workflow/客户端测试和干净 profile 冒烟测试；预期固定版本组合全部通过，故意设置不匹配的 DSH 版本时失败。
- [ ] 提交为 `test: verify policy extension on a clean official dsh profile`。
