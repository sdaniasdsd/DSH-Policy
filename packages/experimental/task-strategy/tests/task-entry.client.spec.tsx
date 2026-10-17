// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'
import { MessageId, createUserMessage } from '@deepseek-ai/dsh-llm'
import { JobId } from '@deepseek-ai/dsh-jobs'
import { TaskEntryCard, TaskEntryPanel } from '../src/client/TaskEntryCard.tsx'
import type { TaskEntryCardProps } from '../src/client/TaskEntryCard.tsx'
import type { EntryView } from '../src/entry-types.ts'
import { taskEntryDefinition } from '../src/client/task-entry-node.ts'
import type { ConversationNodeContext } from '@deepseek-ai/dsh-client-ui-conversation/client'

afterEach(cleanup)
const base: EntryView = { sessionId: SessionId('owner'), messageId: MessageId('message'), requestId: 'request', state: 'selecting' }
describe('task entry chat card', () => {
  it.each([
    ['en', 'Extreme high'], ['zh', '极端高'],
  ])('shows the captured extreme-high tier in %s receipts', (language, label) => {
    render(<TaskEntryPanel view={{ ...base, state: 'running', receipt: { jobId: JobId('job'), name: 'Work', strategy: 'superpowers-style',
      selection: { kind: 'auto', tier: 'extreme-high', reason: 'Broad verification requested.' } } }} language={language} connected={true} strategies={[]}
    cancel={async () => {}} switchStrategy={async () => {}} resume={async () => {}} />)
    expect(screen.getByText(new RegExp(label))).toBeTruthy()
  })
  it('shows the initial Agent choice and explanation without claiming verification', () => {
    render(<TaskEntryPanel view={{ ...base, state: 'running', receipt: { jobId: JobId('job'), name: 'Work', strategy: 'codex-style',
      selection: { kind: 'auto', tier: 'high', reason: '涉及多个模块，需要复核。' } } }} language="zh" connected={true} strategies={[]}
    cancel={async () => {}} switchStrategy={async () => {}} resume={async () => {}} />)
    expect(screen.getByText(/Agent 自主选择.*高/)).toBeTruthy()
    expect(screen.getByText(/涉及多个模块，需要复核/)).toBeTruthy()
    expect(screen.queryByText(/已登记检查通过/)).toBeNull()
  })
  it('places owned task progress outside the model turn process disclosure', () => {
    const event = { type: 'task-strategy/entry' as const, seq: SessionSeq(7), time: 0,
      data: { view: base, input: createUserMessage({ source: { kind: 'user' }, content: [] }) } }
    const start = { event, role: 'start' as const, location: { kind: 'unresolved' as const } }
    const context: ConversationNodeContext<EntryView> = { key: 'entry', kind: 'task-strategy-entry', id: base.requestId,
      matches: [start], start, state: base, current: new Map() }
    expect(taskEntryDefinition.buildViewNode?.(context)).toMatchObject({ location: { kind: 'session' }, anchorSeq: 7 })
  })
  it.each(['conversation', 'Associated with message:previous'])('keeps a materialized entry identity hidden after %s', (progress) => {
    const event = { type: 'task-strategy/entry' as const, seq: SessionSeq(7), time: 0,
      data: { view: base, input: createUserMessage({ source: { kind: 'user' }, content: [] }) } }
    const start = { event, role: 'start' as const, location: { kind: 'unresolved' as const } }
    const context: ConversationNodeContext<EntryView> = { key: 'entry', kind: 'task-strategy-entry', id: base.requestId,
      matches: [start], start, state: { ...base, state: 'completed', progress }, current: new Map() }

    expect(taskEntryDefinition.buildViewNode?.(context)).toMatchObject({ key: 'entry', visibility: 'hidden' })
  })
  it('displays unverified execution separately from successful artifact checks', () => {
    render(<TaskEntryPanel view={{ ...base, state: 'completed',
      run: { phase: 'completed', binding: { id: 'codex-style', revision: 'plan', epoch: 0 }, nextStage: 2,
        completedStages: 2, completedTasks: 2, startedTasks: 2,
        verification: { status: 'unverified', checks: [{ id: 'readme-first-line', status: 'unverified', reason: 'No successful scoped read observation' }] } } }}
    language="zh" connected={true} strategies={[]} cancel={async () => {}} switchStrategy={async () => {}} resume={async () => {}} />)
    expect(screen.getAllByText(/未验证/)).toHaveLength(2)
    expect(screen.getByText(/执行结束不代表验证通过/)).toBeTruthy()
    expect(screen.queryByText(/已登记检查通过/)).toBeNull()
  })
  it.each(['running', 'waiting'] as const)('does not call verification final while the task is %s', (state) => {
    render(<TaskEntryPanel view={{ ...base, state,
      run: { phase: state, binding: { id: 'codex-style', revision: 'plan', epoch: 0 }, nextStage: 2,
        completedStages: 1, completedTasks: 1, startedTasks: 2, verification: { status: 'unverified', checks: [] } } }}
    language="zh" connected={true} strategies={[]} cancel={async () => {}} switchStrategy={async () => {}} resume={async () => {}} />)
    expect(screen.queryByText(/执行结束不代表验证通过/)).toBeNull()
  })
  it('shows a blocked task as waiting with its reason, not as a terminal unverified result', () => {
    render(<TaskEntryPanel view={{ ...base, state: 'waiting', error: 'Need a target',
      run: { phase: 'waiting', binding: { id: 'codex-style', revision: 'plan', epoch: 0 }, nextStage: 2,
        completedStages: 1, completedTasks: 1, startedTasks: 2, verification: { status: 'unverified', checks: [] } } }}
    language="zh" connected={true} strategies={[]} cancel={async () => {}} switchStrategy={async () => {}} resume={async () => {}} />)
    expect(screen.getByText('等待策略调整')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe('Need a target')
    expect(screen.getByText(/未登记验收项/)).toBeTruthy()
    expect(screen.queryByText(/执行结束不代表验证通过/)).toBeNull()
  })
  it.each([['failed', '执行失败'], ['cancelled', '已取消']] as const)(
    'labels %s as a distinct terminal state without live controls', (state, label) => {
      render(<TaskEntryPanel view={{ ...base, state }} language="zh" connected={true} strategies={[]}
        cancel={async () => {}} switchStrategy={async () => {}} resume={async () => {}} />)
      expect(screen.getByText(label)).toBeTruthy()
      expect(screen.queryByRole('button', { name: '取消任务' })).toBeNull()
    })
  it('distinguishes an empty check list from checks that remain unverified', () => {
    render(<TaskEntryPanel view={{ ...base, state: 'completed',
      run: { phase: 'completed', binding: { id: 'codex-style', revision: 'plan', epoch: 0 }, nextStage: 2,
        completedStages: 2, completedTasks: 2, startedTasks: 2, verification: { status: 'unverified', checks: [] } } }}
    language="zh" connected={true} strategies={[]} cancel={async () => {}} switchStrategy={async () => {}} resume={async () => {}} />)
    expect(screen.getByText(/未登记验收项/)).toBeTruthy()
  })
  it('does not report unverified when no verification result exists yet', () => {
    render(<TaskEntryPanel view={{ ...base, state: 'running',
      run: { phase: 'running', binding: { id: 'codex-style', revision: 'plan', epoch: 0 }, nextStage: 1,
        completedStages: 0, completedTasks: 0, startedTasks: 1 } }}
    language="zh" connected={true} strategies={[]} cancel={async () => {}} switchStrategy={async () => {}} resume={async () => {}} />)
    expect(screen.getByText(/尚无验收结果/)).toBeTruthy()
    expect(screen.queryByText(/未验证/)).toBeNull()
  })
  it('warns when a completed task has no registered verification checks', () => {
    render(<TaskEntryPanel view={{ ...base, state: 'completed',
      run: { phase: 'completed', binding: { id: 'codex-style', revision: 'plan', epoch: 0 }, nextStage: 1,
        completedStages: 1, completedTasks: 1, startedTasks: 1 } }}
    language="zh" connected={true} strategies={[]} cancel={async () => {}} switchStrategy={async () => {}} resume={async () => {}} />)
    expect(screen.getByText(/未登记验收项/)).toBeTruthy()
    expect(screen.getByText(/任务完成，但没有登记验收项，无法证明验收通过/)).toBeTruthy()
    expect(screen.queryByText(/尚无验收结果/)).toBeNull()
  })
  it('disables live controls on generation loss without a reset event', async () => {
    let lose = () => {}
    const props = { node: { data: base }, t: () => 'zh', readState: async () => base, readCatalog: async () => [], onReset: () => () => {},
      onConnectionLoss: (listener: () => void) => { lose = listener; return () => {} }, cancel: async () => {},
      switchStrategy: async () => {}, resume: async () => {} } satisfies TaskEntryCardProps
    render(<TaskEntryCard {...props} />)
    await vi.waitFor(() => { expect(screen.getByRole<HTMLButtonElement>('button', { name: '取消任务' }).disabled).toBe(false) })
    lose()
    await vi.waitFor(() => { expect(screen.getByRole<HTMLButtonElement>('button', { name: '取消任务' }).disabled).toBe(true) })
    expect(screen.getByRole('status').textContent).toContain('连接')
  })
  it('shows the committed replacement binding instead of the initial receipt strategy', () => {
    render(<TaskEntryPanel view={{ ...base, state: 'running', receipt: { jobId: JobId('job'), name: 'Initial', strategy: 'coding-low' },
      run: { phase: 'running', binding: { id: 'coding-medium', revision: 'replacement', epoch: 1 }, nextStage: 1, completedStages: 1, completedTasks: 1, startedTasks: 2 } }}
    language="zh" connected={true} strategies={[]} cancel={async () => {}} switchStrategy={async () => {}} resume={async () => {}} />)
    expect(screen.getByText('coding-medium')).toBeTruthy()
    expect(screen.queryByText('coding-low')).toBeNull()
  })
  it('renders an interrupted snapshot when the Host has no retained live entry', async () => {
    const props = { node: { data: base }, t: () => 'zh', readState: async () => undefined,
      readCatalog: async () => [], onReset: () => () => {}, cancel: async () => {},
      switchStrategy: async () => {}, resume: async () => {} } satisfies TaskEntryCardProps
    render(<TaskEntryCard {...props} />)
    await vi.waitFor(() => { expect(screen.getByText('已中断')).toBeTruthy() })
    expect(screen.queryByRole('button', { name: '取消任务' })).toBeNull()
  })
  it('ignores stale reads after reconnect and disables controls while disconnected', async () => {
    const old = Promise.withResolvers<EntryView | undefined>()
    let reset = () => {}
    const readState = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue({ ...base, state: 'cancelled' })
    const props = { node: { data: base }, t: () => 'zh', readState, readCatalog: async () => [],
      onReset: (listener: () => void) => { reset = listener; return () => {} },
      cancel: async () => {}, switchStrategy: async () => {}, resume: async () => {} } satisfies TaskEntryCardProps
    render(<TaskEntryCard {...props} />)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '取消任务' }).disabled).toBe(true)
    reset()
    await vi.waitFor(() => { expect(screen.getByText('已取消')).toBeTruthy() })
    old.resolve({ ...base, state: 'running' })
    await old.promise
    expect(screen.getByText('已取消')).toBeTruthy()
  })
  it('shows selection before a Job exists and routes cancellation without resubmitting', async () => {
    const cancel = vi.fn(async () => {})
    render(<TaskEntryPanel view={base} language="zh" connected={true} strategies={[]} cancel={cancel} switchStrategy={async () => {}} resume={async () => {}} />)
    expect(screen.getByText('正在选择策略')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '取消任务' }))
    await vi.waitFor(() => { expect(cancel).toHaveBeenCalledOnce() })
  })
  it('distinguishes child scenario estimates from total billing and hides terminal controls', () => {
    render(<TaskEntryPanel view={{ ...base, state: 'completed', receipt: { jobId: JobId('strategy-1'), name: 'Low', strategy: 'coding-low' },
      cost: { kind: 'estimated', basis: 'task', planName: 'Low', tasks: 1, stages: 1, knownInputTokens: 80,
        estimatedTotalTokens: 3200, unknowns: ['selector-and-parent'] } }} language="zh" connected={true} strategies={[]} cancel={async () => {}} switchStrategy={async () => {}} resume={async () => {}} />)
    expect(screen.getByText('coding-low')).toBeTruthy()
    expect(screen.getByText(/3,200/)).toBeTruthy()
    expect(screen.getByText(/不含入口判断、策略选择和根 Agent 用量/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '取消任务' })).toBeNull()
  })
})
