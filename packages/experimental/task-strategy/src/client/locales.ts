/** Locale-owned copy for the task strategy plugin page. */
import type { SettingsFormLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { EntryView } from '../entry-types.ts'
import type { StyleTier, TokenCostUnknown } from '../types.ts'

/** Copy rendered by this page. */
export type TaskStrategyLocaleKey =
  | 'entryLanguage' | 'entryEnabled' | 'orchestration' | 'modeUnconfigured' | 'modeScope' | 'modeLoadFailed'
  | 'automation' | 'fullyAutomatic' | 'chooseManually' | 'automaticHint'
  | 'codexStyle' | 'claudeStyle' | 'zcodeStyle' | 'superpowersStyle' | 'costMaximum' | 'tier' | 'tierLow' | 'tierMedium' | 'tierHigh' | 'tierExtremeHigh'
  | 'title' | 'description' | 'mode' | 'auto' | 'named' | 'noReply' | 'strategy' | 'unknown'
  | 'model' | 'provider' | 'inherit' | 'timeout' | 'timeoutHint' | 'catalog' | 'loading' | 'catalogError' | 'empty' | 'retry'
  | 'overridden' | 'reset' | 'readOnly' | 'unavailable' | 'save' | 'saving' | 'saveFailed' | 'invalid'
  | 'costKnown' | 'costTotal' | 'costTasks' | 'costUnknown' | 'costNote' | 'costAssumptions'
  | 'costDynamic' | 'costUnavailable' | 'costUnknowns' | 'costTaskBody' | 'costSystemTools' | 'costTurns'
  | 'costOutputs' | 'costToolVariance' | 'costReasoning' | 'costTokenizerCache' | 'costParent' | 'costMetadata'
  | 'codexLowScope' | 'codexMediumScope' | 'codexHighScope' | 'codexExtremeHighScope'
  | 'claudeLowScope' | 'claudeMediumScope' | 'claudeHighScope' | 'claudeExtremeHighScope'
  | 'zcodeLowScope' | 'zcodeMediumScope' | 'zcodeHighScope' | 'zcodeExtremeHighScope'
  | 'superpowersLowScope' | 'superpowersMediumScope' | 'superpowersHighScope' | 'superpowersExtremeHighScope'

/** Scenario guidance for each registered style and acknowledged tier. */
export const tierHintKeys: Readonly<Record<string, Readonly<Record<StyleTier, TaskStrategyLocaleKey>> | undefined>> = {
  'codex-style': { low: 'codexLowScope', medium: 'codexMediumScope', high: 'codexHighScope', 'extreme-high': 'codexExtremeHighScope' },
  'claude-style': { low: 'claudeLowScope', medium: 'claudeMediumScope', high: 'claudeHighScope', 'extreme-high': 'claudeExtremeHighScope' },
  'zcode-style': { low: 'zcodeLowScope', medium: 'zcodeMediumScope', high: 'zcodeHighScope', 'extreme-high': 'zcodeExtremeHighScope' },
  'superpowers-style': { low: 'superpowersLowScope', medium: 'superpowersMediumScope', high: 'superpowersHighScope', 'extreme-high': 'superpowersExtremeHighScope' },
}

/** Localized uncertainty labels keyed by the Host discriminants. */
export const costUnknownKeys: Record<TokenCostUnknown, TaskStrategyLocaleKey> = {
  'task-body': 'costTaskBody', 'system-and-tools': 'costSystemTools', 'model-turns': 'costTurns',
  'outputs-and-transfer': 'costOutputs', 'tool-output-variance': 'costToolVariance', 'reasoning': 'costReasoning',
  'tokenizer-and-cache': 'costTokenizerCache', 'selector-and-parent': 'costParent', 'result-metadata-variance': 'costMetadata',
}

/** English copy. */
export const en: Record<TaskStrategyLocaleKey, string> = {
  automation: 'Fully automatic / Choose manually', fullyAutomatic: 'Fully automatic', chooseManually: 'Choose manually',
  automaticHint: 'Describe your task. The Agent chooses a registered strategy and its budget tier; no selection reply is needed.',
  tier: 'Budget tier', tierLow: 'Low', tierMedium: 'Medium', tierHigh: 'High', tierExtremeHigh: 'Extreme high',
  codexLowScope: 'One localized change with direct evidence.',
  codexMediumScope: 'One feature implemented and checked step by step.',
  codexHighScope: 'Changes across files with checks of callers and regression risks.',
  codexExtremeHighScope: 'Changes across modules with detailed compatibility, edge-case and integration review.',
  claudeLowScope: 'A change with a known target and location.',
  claudeMediumScope: 'A local issue or feature requiring context gathering.',
  claudeHighScope: 'Changes involving multiple modules, constraints and unknowns, with overall review.',
  claudeExtremeHighScope: 'Complex dependencies or designs requiring deeper investigation and multiple review perspectives.',
  zcodeLowScope: 'One work item with a clear outcome.',
  zcodeMediumScope: 'A feature organized into a few dependent milestones.',
  zcodeHighScope: 'Development or migration across multiple milestones and handoffs.',
  zcodeExtremeHighScope: 'Changes across modules and milestones with detailed dependencies and integration checks.',
  superpowersLowScope: 'A small coding task with brief understanding, planning and acceptance checks.',
  superpowersMediumScope: 'One feature following the complete development process.',
  superpowersHighScope: 'Refactoring or complex features requiring detailed planning and acceptance criteria.',
  superpowersExtremeHighScope: 'Long development work with detailed task breakdown, handoffs and multiple review perspectives.',
  orchestration: 'Orchestration mode', modeUnconfigured: 'Plugin/backend not enabled', modeLoadFailed: 'Mode unavailable',
  modeScope: 'Style modes use DSH models, tools and permissions. Applies to new tasks in this session; resets on restart.',
  codexStyle: 'Codex style', claudeStyle: 'Claude style', zcodeStyle: 'ZCode style', superpowersStyle: 'Superpowers style', costMaximum: 'Maximum configured repair scenario (not a token limit)',
  entryLanguage: 'en', entryEnabled: 'Route new tasks through strategies automatically',
  title: 'Task strategies', description: 'Choose how each task is planned and executed.',
  mode: 'Default choice', auto: 'Automatic', named: 'Use a strategy', noReply: 'Automatic choice can continue without a user reply. Each task can override this default.',
  strategy: 'Strategy id', unknown: 'This strategy is not in the current catalogue. New submissions will refuse it.',
  model: 'Selection model', provider: 'Model provider', inherit: 'Leave blank to inherit the task Agent’s route.',
  timeout: 'Selection deadline (ms)', timeoutHint: 'Selection errors or deadline expiry stop submission before an execution task is created.',
  catalog: 'Available strategies', loading: 'Loading strategies…', catalogError: 'Could not load strategies.', empty: 'No strategies registered.', retry: 'Refresh strategies',
  overridden: 'Overridden', reset: 'Reset to default', readOnly: 'This deployment stores settings read-only.', unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
  save: 'Save', saving: 'Saving…', saveFailed: 'The deployment did not accept these values; the draft is retained. Reload the page if another editor changed the settings.',
  invalid: 'Enter a valid value.',
  costKnown: 'Known input tokens', costTotal: 'Scenario total tokens', costTasks: 'Child tasks / stages',
  costUnknown: 'Cost unknown', costAssumptions: 'Calls per child / extra context per call / output per call',
  costDynamic: 'Dynamic plan has no declared costing plan', costUnavailable: 'No token estimator available', costUnknowns: 'Unpriced or uncertain',
  costTaskBody: 'Task body', costSystemTools: 'System prompt and tool schemas', costTurns: 'Model calls',
  costOutputs: 'Outputs and transfer', costToolVariance: 'Tool results and history growth', costReasoning: 'Reasoning tokens',
  costTokenizerCache: 'Tokenizer and cache effects', costParent: 'Parent and selector', costMetadata: 'Session ids and result JSON escaping',
  costNote: 'Registration estimate excludes the task body. Actual turns, tool results, reasoning and cache vary; parent and selector costs are excluded.',
}

/** Simplified Chinese copy. */
export const zh: Record<TaskStrategyLocaleKey, string> = {
  automation: '全自动／自己选', fullyAutomatic: '全自动', chooseManually: '自己选',
  automaticHint: '说清要做什么，Agent 自主决定策略和档位，无需回复策略选择。',
  tier: '预算档位', tierLow: '低', tierMedium: '中', tierHigh: '高', tierExtremeHigh: '极端高',
  codexLowScope: '一处范围明确的小修改，保留直接证据。',
  codexMediumScope: '一个局部功能，逐步实施并检查结果。',
  codexHighScope: '跨文件改动，逐步检查调用者和回归影响。',
  codexExtremeHighScope: '跨模块改动，细查接口兼容、边界条件与集成影响。',
  claudeLowScope: '目标和位置明确的修改。',
  claudeMediumScope: '需要先读上下文的局部问题或功能。',
  claudeHighScope: '涉及多个模块、约束和未知项的改动，进行整体复核。',
  claudeExtremeHighScope: '复杂依赖或方案，深入调查并从多个角度整体复核。',
  zcodeLowScope: '目标清楚的单个工作项。',
  zcodeMediumScope: '一个功能，按几个有依赖的里程碑推进。',
  zcodeHighScope: '多阶段开发或迁移，明确里程碑与交接。',
  zcodeExtremeHighScope: '跨模块、多里程碑任务，细化依赖、交接与集成检查。',
  superpowersLowScope: '小编程任务，简要理解、规划并验收。',
  superpowersMediumScope: '一个功能的完整开发过程。',
  superpowersHighScope: '重构或复杂功能，细化计划与验收条件。',
  superpowersExtremeHighScope: '长开发任务，细化事务、交接与多个复核角度。',
  orchestration: '编排模式', modeUnconfigured: '插件或后端未启用', modeLoadFailed: '模式暂不可用',
  modeScope: '风格模式借鉴对应编排方式，使用 DSH 模型、工具和权限。作用于本会话后续新任务；重启恢复自动。',
  codexStyle: 'Codex 风格', claudeStyle: 'Claude 风格', zcodeStyle: 'ZCode 风格', superpowersStyle: 'Superpowers 风格', costMaximum: '配置允许的最大修订场景（不是 Token 上限）',
  entryLanguage: 'zh', entryEnabled: '新任务自动进入策略层',
  title: '任务策略', description: '选择每个任务的规划与执行方式。',
  mode: '默认选择方式', auto: '自动选择', named: '指定策略', noReply: '自动选择无需等待用户答复。每个任务仍可单独指定策略。',
  strategy: '策略标识', unknown: '当前目录中没有该策略，新提交会拒绝使用它。',
  model: '选择模型', provider: '模型提供方', inherit: '留空继承任务 Agent 的模型路由。',
  timeout: '选择截止时间（毫秒）', timeoutHint: '选择失败或超时会停止提交，不创建执行任务。',
  catalog: '可用策略', loading: '正在加载策略…', catalogError: '无法加载策略。', empty: '尚未注册策略。', retry: '刷新策略',
  overridden: '已覆盖', reset: '恢复默认', readOnly: '本部署的设置为只读。', unavailable: '该插件当前未加载，暂时无法配置。',
  save: '保存', saving: '保存中…', saveFailed: '本部署未接受这些值，草稿已保留。如果其他编辑者修改了设置，请重新打开页面。',
  invalid: '请输入有效值。',
  costKnown: '已知输入 Token', costTotal: '情景总 Token 估算', costTasks: '子任务数 / 阶段数',
  costUnknown: '成本未知', costAssumptions: '每任务调用数 / 每次额外上下文 / 每次输出',
  costDynamic: '动态策略未声明估算用计划', costUnavailable: '尚无 Token 估算器', costUnknowns: '未计入或不确定项',
  costTaskBody: '任务正文', costSystemTools: '系统提示与工具定义', costTurns: '模型调用数',
  costOutputs: '输出及阶段间传递', costToolVariance: '工具返回与历史增长', costReasoning: '推理 Token',
  costTokenizerCache: '分词与缓存影响', costParent: '父任务与选择器', costMetadata: '会话标识与结果 JSON 转义',
  costNote: '注册估算不含任务正文。实际轮数、工具结果、推理和缓存会变化；不含父任务与选择器成本',
}

/**
 * Supply the original form frame's localized labels.
 * @param t - this page's locale reader.
 * @returns labels for the shared settings form.
 */
export function formLabels(t: (key: TaskStrategyLocaleKey) => string): SettingsFormLabels {
  return { unavailable: t('unavailable'), readOnly: t('readOnly'), saveFailed: t('saveFailed'), save: t('save'), saving: t('saving') }
}


/** State labels shared by recorded task cards. */
export const entryStates: Record<EntryView['state'], readonly [string, string]> = {
  routing: ['Understanding request', '正在理解请求'], selecting: ['Selecting strategy', '正在选择策略'],
  running: ['Executing strategy', '正在执行策略'], waiting: ['Waiting for strategy decision', '等待策略调整'],
  completed: ['Execution ended', '执行结束'], failed: ['Failed', '执行失败'], cancelled: ['Cancelled', '已取消'], interrupted: ['Interrupted', '已中断'],
}

/** Task progress copy owned by the locale dictionary. */
export const entryCopy = {
  en: {
    progressLabel: 'Task strategy progress',
    automaticChoice: 'Agent choice', fallbackChoice: 'Configured fallback (automatic choice failed)',
    choiceReason: 'Selection reason (model judgment)', initialTier: 'Initial tier', tierLow: 'Low', tierMedium: 'Medium', tierHigh: 'High', tierExtremeHigh: 'Extreme high',
    acceptProposal: 'Accept this proposal',
    completedCounts: 'Completed stages / tasks',
    activeMembers: 'Agents currently running',
    liveOutput: 'Live agent output',
    verification: 'Verification', passed: 'Registered checks passed', failed: 'Registered checks failed', unverified: 'Unverified',
    noVerificationResult: 'No verification result yet', noRegisteredChecks: 'No checks registered',
    noVerificationOnCompletionNote: 'Task completed with no registered checks; this does not prove the requirements passed.',
    unverifiedNote: 'Execution ended; this does not mean the requirements were verified.',
    maximumScenario: 'Maximum configured repair scenario (not a token limit)',
    review: 'Model review (not test proof)', reviewPassed: 'No supported issue reported', reviewIssues: 'Supported issues reported', reviewUnverified: 'Insufficient review evidence',
    usage: 'Observed child tokens', usageNote: 'Logged child model responses only; excludes routing, root Agent and provider-internal retries.', usagePartial: 'Some usage unknown',
    executionConfig: 'Initial execution configuration', inheritedModel: 'Inherited model', permissionAuthority: 'Permission authority', permissionNote: 'Tool filters and scopes can restrict this further; this does not grant write access.',
    knownInput: 'Known input tokens',
    tasksStages: 'Tasks / stages',
    scenarioTokens: 'Initial strategy child scenario token estimate',
    unknown: 'Unknown',
    assumptions: 'Assumed calls / context / output per task',
    estimateNote: 'Estimate, not billing. Excludes routing, selection and root Agent usage; actual turns, tool output and reasoning remain unknown.',
    costUnknown: 'Token cost unknown',
    offline: 'Connection unavailable; runtime state needs verification',
    cancel: 'Cancel task',
    switchLabel: 'Switch strategy',
    nextStrategy: 'Choose next strategy',
    switchAction: 'Switch at stage boundary',
    resume: 'Resume strategy',
  },
  zh: {
    progressLabel: '任务策略进度',
    automaticChoice: 'Agent 自主选择', fallbackChoice: '已使用配置兜底（自动选择失败）',
    choiceReason: '选择理由（模型判断）', initialTier: '初始档位', tierLow: '低', tierMedium: '中', tierHigh: '高', tierExtremeHigh: '极端高',
    acceptProposal: '接受这份提议',
    completedCounts: '已完成阶段 / 子任务',
    activeMembers: '正在运行的智能体',
    liveOutput: '智能体实时输出',
    verification: '验收状态', passed: '已登记检查通过', failed: '已登记检查失败', unverified: '未验证',
    noVerificationResult: '尚无验收结果', noRegisteredChecks: '未登记验收项',
    noVerificationOnCompletionNote: '任务完成，但没有登记验收项，无法证明验收通过。',
    unverifiedNote: '执行结束不代表验证通过。',
    maximumScenario: '配置允许的最大修订场景（不是 Token 上限）',
    review: '模型复核（不代表测试通过）', reviewPassed: '未报告有证据的问题', reviewIssues: '报告了有证据的问题', reviewUnverified: '复核证据不足',
    usage: '已观测子任务 Token', usageNote: '仅统计子任务已记录模型响应；不含入口、根 Agent 和供应方内部重试。', usagePartial: '部分用量未知',
    executionConfig: '初始执行配置', inheritedModel: '继承模型', permissionAuthority: '权限来源', permissionNote: '工具过滤与作用域仍可能进一步限制；这不是可写授权声明。',
    knownInput: '已知输入 Token',
    tasksStages: '子任务 / 阶段',
    scenarioTokens: '初始策略子任务场景估算 Token',
    unknown: '未知',
    assumptions: '假设：每任务调用 / 上下文 / 输出',
    estimateNote: '估算不是账单；不含入口判断、策略选择和根 Agent 用量，实际轮数、工具结果和推理用量仍未知。',
    costUnknown: 'Token 成本未知',
    offline: '连接不可用；运行状态待核对',
    cancel: '取消任务',
    switchLabel: '切换策略',
    nextStrategy: '选择下阶段策略',
    switchAction: '阶段结束时切换',
    resume: '继续原策略',
  },
}
