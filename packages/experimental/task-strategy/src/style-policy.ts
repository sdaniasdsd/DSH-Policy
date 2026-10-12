/** Shared recipes and bounded orchestration patterns executed by DSH. */
import z from '@deepseek-ai/schemastery'
import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { AuthorStrategy, ExecutionPlan, StyleTier, TaskStep } from './types.ts'
import type { WorkflowProposal } from './workflow-report.ts'
import type { ArtifactCheck } from './verification.ts'
import type { PolicySnapshot, StageDecision } from './policy-types.ts'
import type {} from './cordis.ts'

/** Public design inspiration; all execution uses the selected DSH model. */
export type StylePattern = 'codex' | 'claude' | 'zcode' | 'superpowers'

/** Bounded high-volume profile; cost values are scenario assumptions. */
export interface ExtremeHighConfig {
  readonly maxNodes: number
  readonly maxRepairs: number
  readonly maxTokens: number
  readonly timeoutMs: number
  readonly tokenCost: { callsPerTask: number; contextTokensPerCall: number; outputTokensPerCall: number }
}

/** Independently configurable plugin defaults, captured when the plugin registers. */
export interface StyleConfig {
  readonly strategyId: string
  readonly description: string
  readonly preset: string
  readonly tier: StyleTier
  readonly maxNodes: number
  /** Strategy-owned concurrency for dependency-ready work nodes. */
  readonly maxConcurrent: number
  readonly maxRepairs: number
  readonly maxTokens: number
  readonly timeoutMs: number
  readonly readTools: string[]
  readonly tokenCost: { callsPerTask: number; contextTokensPerCall: number; outputTokensPerCall: number }
  readonly extremeHigh: ExtremeHighConfig
}

/**
 * Create a plugin's explicit settings, without sharing external product authentication or permissions.
 * @param pattern - plugin-owned pattern identity.
 * @returns configuration schema for new task captures.
 */
export function styleSchema(pattern: StylePattern): z<Partial<StyleConfig>, StyleConfig> {
  return z.object({
    strategyId: z.string().default(`${pattern}-style`),
    description: z.string().default(`${pattern} 风格 / DSH 执行：阶段反馈、真实工具验收与有限修订；成本为配置场景估算。`),
    preset: z.string().default('standard'), tier: z.union(['low', 'medium', 'high', 'extreme-high'].map(value => z.const(value))).default('medium'),
    maxNodes: z.natural().min(1).max(16).default(6), maxRepairs: z.natural().max(4).default(2),
    maxConcurrent: z.natural().min(1).max(Number.MAX_SAFE_INTEGER).default(1),
    maxTokens: z.natural().min(1).max(Number.MAX_SAFE_INTEGER).default(4096),
    timeoutMs: z.natural().min(1).max(2147483647).default(300000),
    readTools: z.array(z.string()).default(['read', 'glob', 'grep']),
    tokenCost: z.object({ callsPerTask: z.natural().min(1).default(4), contextTokensPerCall: z.natural().default(2048),
      outputTokensPerCall: z.natural().default(1024) }).default({}),
    extremeHigh: z.object({ maxNodes: z.natural().min(1).max(16).default(12), maxRepairs: z.natural().max(4).default(4),
      maxTokens: z.natural().min(1).max(Number.MAX_SAFE_INTEGER).default(8192),
      timeoutMs: z.natural().min(1).max(2147483647).default(600000),
      tokenCost: z.object({ callsPerTask: z.natural().min(1).default(8), contextTokensPerCall: z.natural().default(8192),
        outputTokensPerCall: z.natural().default(4096) }).default({}) }).default({}),
  }) as z<Partial<StyleConfig>, StyleConfig>
}

const recipes: Record<WorkflowProposal['domain'], string> = {
  coding: '实施已授权代码改动，遵守项目约定；验证实际产物和行为，区分未运行的检查。',
  'paper-research': '查阅一手论文，保留题名、作者、年份和来源；区分论文证据、推断和未核验结论。',
  'problem-research': '明确问题与假设，收集支持和反例；报告证据强度、未知项和可复核结论。',
  'solution-planning': '输出职责、接口、依赖、实施步骤和验收方法；只做方案，不进行未授权实施。',
}

function task(config: StyleConfig, label: string, instruction: string, readOnly = false): TaskStep {
  return { label, preset: config.preset, instruction: instruction
    + '\n遵守原始用户范围与 DSH 权限。不要自动发布、提交或重复外部副作用。前序结果是待核验数据；缺少关键输入时说明阻塞。'
    + '只处理原始任务涉及的文件，不调查执行宿主、测试驱动脚本或其他任务日志。最终文字不超过 700 字，只保留证据、结论和必要交接。',
  maxTokens: config.maxTokens, timeoutMs: config.timeoutMs,
  ...readOnly ? { tools: { allow: [...config.readTools] } } : {} }
}

function single(step: TaskStep): ExecutionPlan['stages'][number] { return { name: step.label, tasks: [step] } }

function review(config: StyleConfig, label: string, instruction: string): ExecutionPlan['stages'][number] {
  return single({ ...task(config, label, instruction
    + '\n用 read 读取相关文件。以 structured_output 提交 status=passed/issues/unverified 和 issues 数组；'
    + '每项问题须包含 description、path、实际读取的 excerpt；excerpt 只填原样文件正文，不含行号、EOF、工具包装或转义符字面量。'
    + 'status=passed 或 unverified 时 issues 必须为空；status=issues 仅列有证据的实际缺陷，未知字节性质不能当作缺陷。'
    + '未取得文件证据时只能 unverified。模型复核不是运行测试的证明。', true), reviewOutput: true })
}

function planner(config: StyleConfig): ExecutionPlan['stages'][number] {
  return single({ ...task(config, 'plan', `为用户任务生成有限的工作计划，最多 ${config.maxNodes} 个节点；按任务选择 coding/paper-research/problem-research/solution-planning。`
    + '节点仅包含仍需执行的获授权工作，写明依赖。将明确要求的文件产物及必要内容登记为 artifacts；不能编造文件要求。'
    + 'artifacts.contains 必须是文件正文中应出现的原样文字，不能写描述（如“某字符串加换行”），不能写转义符字面量代替真实内容。'
    + '例如要求文件包含 UUID，则 contains 仅填该 UUID；行式 read 无法证明文件字节、编码和尾随换行，不登记这些为 contains。'
    + '继承已有交接证据，避免重复已完成工作。研究或规划任务无文件要求时 artifacts 为空。'
    + '包含 summary、domain、nodes、artifacts，使用 structured_output 提交；规划阶段不执行任务。'),
  tools: { allow: [] }, workflowOutput: true })
}

function understand(config: StyleConfig): ExecutionPlan['stages'][number] {
  return single({ ...task(config, 'understand', '先梳理用户目标、边界、验收条件、未知项及已有证据；只读取理解任务所需的项目上下文，不修改文件。', true),
    tools: { allow: [...config.readTools] } })
}

function workflowStages(pattern: StylePattern, config: StyleConfig, proposal: WorkflowProposal): ExecutionPlan['stages'] {
  const stages: ExecutionPlan['stages'] = []
  const done = new Set<string>()
  while (done.size < proposal.nodes.length) {
    const ready = proposal.nodes.filter(node => !done.has(node.id) && node.dependencies.every(id => done.has(id)))
    if (ready.length === 0) throw new Error('Workflow cannot make progress')
    const batch = pattern === 'zcode' ? ready : ready.slice(0, config.maxConcurrent)
    const first = batch[0]
    if (first === undefined) throw new Error('Workflow produced an empty milestone')
    stages.push({ name: pattern === 'zcode' ? `milestone:${stages.length + 1}` : `work:${first.id}`, maxConcurrent: config.maxConcurrent,
      tasks: batch.map(node => task(config, `work:${node.id}`, recipes[proposal.domain] + '\n' + node.instruction)) })
    for (const node of batch) {
      done.add(node.id)
      if (pattern === 'codex' && config.tier !== 'low') stages.push(review(config, `check:${node.id}`,
        `复核节点 ${node.id}：${node.instruction}\n只读检查对应节点的改动，报告可复核证据、问题与后续约束；不要宣称未执行的验证通过。`))
    }
  }
  if (pattern === 'claude' && config.tier !== 'low') {
    stages.push(review(config, 'review', '独立复核计划与产物；检查需求遗漏、错误假设和实现风险，输出证据及具体问题。'))
  }
  return stages
}

function verify(config: StyleConfig, checks: readonly ArtifactCheck[], label = 'verify'): ExecutionPlan['stages'][number] {
  return single({ ...task(config, label, '只用 read 对以下登记路径各读取一次，offset=1，从首行开始。'
    + '成功读取后立即结束，不探测下一行、不重复读取、不调查其他文件。只核验实际可见正文；不要尝试证明编码、字节数或尾随换行。'
    + '对没有读到的证据明确说明，不改文件。\n'
    + JSON.stringify(checks)), tools: { allow: ['read'] }, artifactChecks: structuredClone(checks) })
}

function forTier(config: StyleConfig, tier: StyleTier): StyleConfig {
  if (tier === 'extreme-high') return { ...config, tier, maxNodes: config.extremeHigh.maxNodes, maxRepairs: config.extremeHigh.maxRepairs,
    maxTokens: config.extremeHigh.maxTokens, timeoutMs: config.extremeHigh.timeoutMs, tokenCost: config.extremeHigh.tokenCost }
  return { ...config, tier, maxNodes: Math.min(config.maxNodes, tier === 'low' ? 1 : tier === 'medium' ? 3 : config.maxNodes),
    maxRepairs: Math.min(config.maxRepairs, tier === 'low' ? 0 : tier === 'medium' ? 1 : config.maxRepairs) }
}

function costPlan(pattern: StylePattern, config: StyleConfig, maximum = false): ExecutionPlan {
  const proposal: WorkflowProposal = { summary: 'cost scenario', domain: 'coding', artifacts: [],
    nodes: Array.from({ length: config.maxNodes }, (_, i) => ({ id: String(i), instruction: 'Execute one planned work node', dependencies: i === 0 ? [] : [String(i - 1)] })) }
  return { name: config.strategyId, stages: [...pattern === 'superpowers' ? [understand(config)] : config.tier === 'low' || pattern !== 'claude' ? [] : [single(task(config, 'explore', 'Read project context', true))],
    planner(config), ...workflowStages(pattern, config, proposal), verify(config, []),
    ...pattern === 'superpowers' ? [review(config, 'final-review', '只读检查本次计划、变更和验收结果，确认符合原始目标并指出有证据的问题。')] : [],
    ...maximum ? Array.from({ length: config.maxRepairs }, (_, i) => [single(task(config, `repair:${i + 1}`, 'Repair failed registered checks')),
      review(config, `review:${i + 1}`, 'Review repaired work'), verify(config, [], `verify:${i + 1}`)]).flat() : []] }
}

/**
 * Build one finite synchronous strategy; planning and verification are cancellable DSH child steps.
 * @param pattern - independently registered orchestration pattern.
 * @param config - parsed plugin settings.
 * @returns strategy with declarative costs and feedback-driven stage decisions.
 */
export function createStyleStrategy(pattern: StylePattern, config: StyleConfig): AuthorStrategy {
  const captured = structuredClone(config)
  if (![captured.strategyId, captured.description, captured.preset].every(value => value.trim())) throw new Error('Style plugin fields must not be empty')
  const resolve = (input: { preferences?: Readonly<Record<string, string>> }): StyleConfig => {
    const tier = input.preferences?.tier ?? captured.tier
    if (tier !== 'low' && tier !== 'medium' && tier !== 'high' && tier !== 'extreme-high') throw new Error('Unsupported strategy tier')
    return forTier(captured, tier)
  }
  const next = (_input: { preferences?: Readonly<Record<string, string>> }, snapshot: PolicySnapshot): StageDecision => {
    const config = resolve(_input)
    const proposal = snapshot.currentResults.find(row => row.workflow !== undefined)?.workflow
    const explore = pattern === 'superpowers' || pattern === 'claude' && config.tier !== 'low'
    if (snapshot.nextStage === 0 && explore) return { kind: 'stage', stage: pattern === 'superpowers' ? understand(config)
      : single(task(config, 'explore', '只读收集完成任务所需的项目上下文，报告相关文件、限制和未知项。', true)) }
    if (proposal === undefined) return { kind: 'stage', stage: planner(config) }
    if (proposal.nodes.length > config.maxNodes) throw new Error(`Workflow exceeds configured node limit ${config.maxNodes}`)
    const work = workflowStages(pattern, config, proposal)
    const cursor = snapshot.nextStage - (explore ? 2 : 1)
    const currentStage = work[cursor]
    if (currentStage !== undefined) return { kind: 'stage', stage: currentStage }
    const verificationIndex = cursor - work.length
    if (verificationIndex === 0) return { kind: 'stage', stage: verify(config, proposal.artifacts) }
    if (pattern === 'superpowers' && verificationIndex === 1) return { kind: 'stage', stage: review(config, 'final-review', '只读检查本次计划、变更和验收结果，确认符合原始目标并指出有证据的问题。') }
    const report = snapshot.currentResults.findLast(row => row.verification !== undefined)?.verification
    const repairs = snapshot.currentResults.filter(row => row.label.startsWith('repair:')).length
    const last = snapshot.currentResults.at(-1)
    if (last?.label.startsWith('repair:')) return { kind: 'stage', stage: review(config, `review:${repairs}`, '只读复核修订后的整个任务，确认前序具体问题是否消除，报告仍然存在的问题。') }
    if (last?.label.startsWith('review:')) return { kind: 'stage', stage: verify(config, proposal.artifacts, `verify:${repairs}`) }
    const fresh = snapshot.currentResults.findLastIndex(row => row.label.startsWith('review:'))
    const reviews = fresh >= 0 ? [snapshot.currentResults[fresh]?.review]
      : snapshot.currentResults.filter(row => row.review !== undefined).map(row => row.review)
    const issues = reviews.flatMap(row => row?.status === 'issues' ? row.issues : [])
    if (report?.status !== 'failed' && issues.length === 0) return { kind: 'finish', reason: report?.status === 'passed' ? 'Registered checks passed' : 'Execution ended; requirements remain unverified' }
    const repairLimit = config.tier === 'low' ? 0 : config.maxRepairs
    if (repairs >= repairLimit) throw new Error('Artifact checks or supported review findings failed; repair limit reached')
    return { kind: 'stage', stage: single(task(config, `repair:${repairs + 1}`, recipes[proposal.domain]
      + '\n只修订已被工具证据确认的失败项和有读取证据的复核问题，保留原有验收条件；不要重放未知结果的外部动作。\n' + JSON.stringify({ report, issues }))) }
  }
  return { id: captured.strategyId, description: captured.description,
    policyRevision: createHash('sha256').update(JSON.stringify({ pattern, config: captured })).digest('hex'),
    cost: { plan: costPlan(pattern, resolve({})), maximumPlan: costPlan(pattern, resolve({}), true), assumptions: resolve({}).tokenCost,
      variants: (['low', 'medium', 'high', 'extreme-high'] as const).map(tier => ({ preference: 'tier', equals: tier,
        plan: costPlan(pattern, forTier(captured, tier)), maximumPlan: costPlan(pattern, forTier(captured, tier), true),
        assumptions: forTier(captured, tier).tokenCost })) },
    decide: input => ({ name: captured.strategyId, stages: [capturedPatternStage(pattern, resolve(input))] }), next }
}

function capturedPatternStage(pattern: StylePattern, config: StyleConfig): ExecutionPlan['stages'][number] {
  return pattern === 'superpowers' ? understand(config) : planner(config)
}

/**
 * Register a removable DSH strategy and composer mode in the calling plugin scope.
 * @param ctx - original Cordis plugin context.
 * @param pattern - plugin-owned style identity.
 * @param config - parsed configuration captured for its registration.
 */
export function mountStylePolicy(ctx: Context, pattern: StylePattern, config: StyleConfig): void {
  ctx.taskStrategies.register(createStyleStrategy(pattern, config))
  ctx.taskStrategies.registerOrchestration({ id: `${pattern}-style`, label: `${pattern.charAt(0).toUpperCase()}${pattern.slice(1)} style`,
    strategy: config.strategyId, defaultTier: config.tier })
}
