# DSH 策略版极端高档与 Superpowers 风格插件实现计划

[English](2026-10-12-dsh-policy-extreme-tier-superpowers.md) | 中文

> **面向代理执行者：**必须使用子技能 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，逐项执行本计划。步骤使用复选框跟踪。

**目标：**为 Codex 风格、Claude 风格和 ZCode 风格策略增加有界的 `extreme-high` 档，并提供可选的 Superpowers 风格 DSH 策略插件。

**架构：**先扩展共享的风格策略档位约定和场景核算，再将 Superpowers 实现为第四个由 DSH 执行、可卸载的风格策略。通过 Host 选择和编排器呈现档位与模式，通过现有可选工作流补丁提供新插件，并使用确定性测试与真实 Loader 组合验证。

**技术栈：**TypeScript、Cordis、Schemastery、React、Vitest、YAML、pnpm workspace 构建和文档配对脚本。

**规格：**`docs/superpowers/specs/2026-10-12-dsh-policy-extreme-tier-superpowers-design.md` 和 `docs/superpowers/specs/2026-10-12-dsh-policy-extreme-tier-superpowers-design.zh.md`

## 全局约束

- 仅为 Codex 风格、Claude 风格、ZCode 风格和 Superpowers 风格策略增加 `extreme-high`；保留现有低、中、高档行为。
- 极端高档默认值：`maxNodes: 12`、`maxRepairs: 4`、`maxTokens: 8192`、`timeoutMs: 600000`，场景假设为 `callsPerTask: 8`、`contextTokensPerCall: 8192`、`outputTokensPerCall: 4096`；遵守现有 schema 上限（`maxNodes: 16`、`maxRepairs: 4`）。
- 场景估算必须与实际观测的子任务用量、账单金额和执行硬上限区分。
- 四种风格插件都保持可选，不改变已发布 profile 默认值。
- 不改变原生 Codex/Claude 提供方生命周期、身份验证、权限行为或运行次数。
- Superpowers 风格仅使用 DSH 现有任务运行时和 preset；不加载第三方技能文件，也不声称官方集成。

## 评审重点

- 无效 `extreme-high` 偏好须在选择状态或任务准入变更前失败；由 orchestration 与 selector 测试固定。
- 极端高档配置拒绝超过 16 的节点数和超过 4 的修订次数；由 schema 测试固定。
- 后续模式或配置变化后，已捕获的极端高档接单仍保留其档位和限制；由 Host adapter 测试固定。
- 超出捕获节点限制的计划须在启动超额子任务前失败；由 style-policy 执行测试固定。
- 取消、子任务错误和未知执行结果不得触发无界修订或重放；由最大路径生命周期测试固定。

---

### 任务 1：增加极端高档约定与有界配置

**文件：**
- 修改：`packages/experimental/task-strategy/src/types.ts`
- 修改：`packages/experimental/task-strategy/src/entry-types.ts`
- 修改：`packages/experimental/task-strategy/src/runtime-types.ts`
- 修改：`packages/experimental/task-strategy/src/selection-types.ts`
- 修改：`packages/experimental/task-strategy/src/orchestration.ts`
- 修改：`packages/experimental/task-strategy/src/selector.ts`
- 修改：`packages/experimental/task-strategy/src/cordis.ts`
- 修改：`packages/experimental/task-strategy/src/style-policy.ts`
- 测试：`packages/experimental/task-strategy/tests/style-policy.spec.ts`
- 测试：`packages/experimental/task-strategy/tests/orchestration.spec.ts`
- 测试：`packages/experimental/task-strategy/tests/selector.spec.ts`

**接口：**
- 产出：共享 `StyleTier = 'low' | 'medium' | 'high' | 'extreme-high'`；Host orchestration state 和 workflow candidates 接受四档；`StyleConfig.extremeHigh` 包含已校验的限制与成本假设。
- `StyleConfig.extremeHigh` 默认 12 个节点、4 次修订、每步 8192 Token、600000 毫秒超时，场景假设为每项任务 8 次调用、每次 8192 个上下文 Token 和 4096 个输出 Token。schema 上限保持为 16 个节点和 4 次修订。
- 现有顶层风格配置以及低、中、高档成本继续保持当前默认值和语义。

- [ ] **步骤 1：为档位约定和配置边界编写失败测试。**确认各 schema 接受默认极端高档配置、拒绝 17 个节点和 5 次修订、接受 `extreme-high`，并拒绝未知档位字符串。
- [ ] **步骤 2：运行针对性失败测试。**

运行：`pnpm --filter @deepseek-ai/dsh-experimental-task-strategy exec vitest run tests/style-policy.spec.ts tests/orchestration.spec.ts tests/selector.spec.ts`

预期：因缺少极端高档与配置行为而失败。

- [ ] **步骤 3：扩展共享 Host/selection 档位类型和校验。**更新模式状态、档位捕获、workflow candidate 生成和自动选择器 schema/parser，使其接受 `extreme-high`，同时保留无效选择的既有行为。
- [ ] **步骤 4：在 `style-policy.ts` 实现捕获的极端高档限制与估算。**将选中档位解析为独立且有界的节点、修订、Token、超时和场景假设；保持高档执行不变。加入极端高档基线和最大修订场景。
- [ ] **步骤 5：补充评审重点中的无效偏好与捕获限制测试。**断言选择失败不会改变此前档位；后续模式改变后，已接收运行仍使用捕获的档位。
- [ ] **步骤 6：运行针对性测试。**预期：策略、编排和选择器相关测试全部通过。
- [ ] **步骤 7：提交档位约定及对应测试。**

### 任务 2：新增可卸载的 Superpowers 风格策略

**文件：**
- 修改：`packages/experimental/task-strategy/src/style-policy.ts`
- 新建：`packages/experimental/task-strategy/src/plugin-superpowers-style.ts`
- 测试：`packages/experimental/task-strategy/tests/style-policy.spec.ts`

**接口：**
- 使用：任务 1 提供的 `StyleTier` 与已校验 `StyleConfig.extremeHigh`。
- 产出：函数插件导出 `name`、`inject`、`Config`、`apply`；`apply` 通过 `mountStylePolicy` 和现有 task-strategy registry 注册 `superpowers-style`。
- 工作流阶段：理解任务、制定有界计划、按顺序实施、验证登记产物、只读复核，并在捕获的修订上限内仅修复有证据的问题。

- [ ] **步骤 1：增加失败的确定性策略测试。**断言 Superpowers 风格只使用 DSH preset，依次经过任务理解/规划/工作/验证/复核，使用极端高档限制，估算最大修订路径，并拒绝超出捕获节点限制的计划。
- [ ] **步骤 2：运行新增针对性测试。**

运行：`pnpm --filter @deepseek-ai/dsh-experimental-task-strategy exec vitest run tests/style-policy.spec.ts`

预期：因 pattern 和插件入口尚不存在而失败。

- [ ] **步骤 3：在 `style-policy.ts` 增加 Superpowers pattern。**复用已校验规划、产物检查、复核结果约定、修订边界、取消和 DSH 任务执行。通过阶段标签与指令体现该方法，但不加载外部技能。
- [ ] **步骤 4：创建 `plugin-superpowers-style.ts`。**导出标准命名函数插件约定，并用共享 schema 挂载 `superpowers` 风格。
- [ ] **步骤 5：增加最大路径测试。**使用确定性子任务结果推进产物失败及有证据修订；断言随后重新验证、子任务数量有限，且未知子任务结果不会被重放。
- [ ] **步骤 6：运行针对性测试。**预期：通过 fixture 的 Superpowers 风格任务完成；无效或超限计划快速失败。
- [ ] **步骤 7：提交策略插件和测试。**

### 任务 3：在编排器中显示新模式和档位

**文件：**
- 修改：`packages/experimental/task-strategy/src/client/OrchestrationSelect.tsx`
- 修改：`packages/experimental/task-strategy/src/client/TaskEntryCard.tsx`
- 修改：`packages/experimental/task-strategy/src/client/locales.ts`
- 测试：`packages/experimental/task-strategy/tests/orchestration-select.client.spec.tsx`
- 测试：`packages/experimental/task-strategy/tests/task-entry.client.spec.tsx`

**接口：**
- 使用：任务 1–2 提供的四档 Host 状态和 `superpowers-style` 编排注册。
- 产出：Superpowers 风格和极端高档的本地化标签；模式选择和捕获的任务回执显示四档。

- [ ] **步骤 1：增加失败的客户端测试。**断言新模式标签出现、四个档位均可选择，且运行中/已完成的任务回执在中英文界面显示 `extreme-high`。
- [ ] **步骤 2：运行针对性客户端测试。**

运行：`pnpm --filter @deepseek-ai/dsh-experimental-task-strategy exec vitest run tests/orchestration-select.client.spec.tsx tests/task-entry.client.spec.tsx`

预期：因模式标签和档位文本缺失而失败。

- [ ] **步骤 3：添加英文和中文 locale 项及 Superpowers 风格选项。**保留现有模式次序和标签。
- [ ] **步骤 4：添加极端高档选项和回执展示。**仅当所选模式声明支持档位时显示档位选择器。
- [ ] **步骤 5：运行针对性客户端测试。**预期：本地化的模式/档位选项和任务回执正确显示。
- [ ] **步骤 6：提交编排器改动及测试。**

### 任务 4：发布插件入口、加入可选组合并验证真实 Loader 路径

**文件：**
- 修改：`packages/experimental/task-strategy/package.json`
- 修改：`packages/experimental/task-strategy/tsdown.config.ts`
- 修改：`strategies/workflows.patch.yml`
- 修改：`packages/experimental/task-strategy/tests/adapter.spec.ts`
- 修改：`packages/experimental/task-strategy/README.md`
- 修改：`packages/experimental/task-strategy/README.zh.md`
- 修改：`strategies/README.md`
- 修改：`strategies/README.zh.md`

**接口：**
- 使用：任务 1–3 提供的 Superpowers 风格插件入口和 UI/Host 模式。
- 产出：公开包入口 `@deepseek-ai/dsh-experimental-task-strategy/plugins/superpowers-style`；workflow patch 中可选的 `strategy-superpowers-style` 项；中英双语包文档和工作流文档。

- [ ] **步骤 1：增加失败的真实 Loader 组合测试。**在真实 task-strategy carrier 旁加载 Superpowers 风格函数插件；断言策略和模式已注册、任务通过 DSH preset 执行，并在插件 dispose 后从 registry 移除。
- [ ] **步骤 2：运行针对性 Loader 测试。**

运行：`pnpm --filter @deepseek-ai/dsh-experimental-task-strategy exec vitest run tests/adapter.spec.ts -t 'Superpowers-style'`

预期：因包入口未导出或未组合而失败。

- [ ] **步骤 3：添加 package export 和 tsdown companion entry。**确认构建后的公开入口解析为新函数插件。
- [ ] **步骤 4：将 Superpowers 风格项添加到 `strategies/workflows.patch.yml`。**保持该 patch 为可选配置，不修改已发布 profile 默认值。
- [ ] **步骤 5：更新两组 README。**说明四档、极端高档限制与估算注意事项、Superpowers 风格行为，以及非官方/不依赖外部技能的边界。通用的 12 条工作流配方继续保持三档。
- [ ] **步骤 6：运行包构建和针对性 Loader 验证。**

运行：`pnpm --filter @deepseek-ai/dsh-experimental-task-strategy build`

运行：`pnpm --filter @deepseek-ai/dsh-experimental-task-strategy exec vitest run tests/adapter.spec.ts -t 'Superpowers-style'`

预期：公开入口构建成功；真实 Loader 的注册、preset 执行和 dispose 使用确定性模型响应通过。

- [ ] **步骤 7：运行针对性 lint 与文档检查。**检查两组 README、workflow patch、包入口元数据和 `git diff --check`。
- [ ] **步骤 8：提交包组合和文档。**

### 任务 5：运行最大路径回归与最终验证

**文件：**
- 测试：`packages/experimental/task-strategy/tests/style-policy.spec.ts`
- 测试：`packages/experimental/task-strategy/tests/adapter.spec.ts`

**接口：**
- 使用：全部四种风格策略和四档 UI/Host 约定。
- 产出：极端高档工作流、取消清理及现有档位回归安全性的确定性验证证据。

- [ ] **步骤 1：增加一个受控的最大场景回归测试。**通过确定性子任务结果覆盖 12 节点/4 次修订的极端高档配置，并断言精确且有限的任务数、写入串行行为以及取消后的清理。
- [ ] **步骤 2：运行回归和针对性包测试。**

运行：`pnpm --filter @deepseek-ai/dsh-experimental-task-strategy exec vitest run tests/style-policy.spec.ts tests/adapter.spec.ts tests/orchestration.spec.ts tests/selector.spec.ts tests/orchestration-select.client.spec.tsx tests/task-entry.client.spec.tsx`

预期：无需提供方凭据，所有针对性用例通过；原低/中/高档测试仍通过。

- [ ] **步骤 3：构建包并运行 typecheck。**预期：Host、Client、公开入口和生成类型面全部编译通过。
- [ ] **步骤 4：对照源码行为与规格复核包文档。**重录两组双语配对，并按仓库文档规则运行 `pnpm run test:docs`、`pnpm run doc-sync` 和 `git diff --check`。
- [ ] **步骤 5：提交最终回归证据和文档。**
