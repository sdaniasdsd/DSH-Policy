/** Host-backed task orchestration progress and versioned controls. */
import { useEffect, useRef, useState } from 'react'
import type { EntryView } from '../entry-types.ts'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { StrategyCatalog } from './task-strategy-card-controller.ts'
import type { TaskEntryNodeKind } from './task-entry-node.ts'
import css from './TaskEntryCard.module.css'
import { entryCopy, entryStates } from './locales.ts'

/** Injected Remote adapters, independent of the original chat components. */
export interface TaskEntryFace {
  readState: (view: EntryView) => Promise<EntryView | undefined>
  readCatalog: () => Promise<StrategyCatalog['strategies']>
  cancel: (view: EntryView) => Promise<void>
  switchStrategy: (view: EntryView, strategy: string, epoch: number) => Promise<void>
  resume: (view: EntryView) => Promise<void>
  acceptProposal?: (view: EntryView) => Promise<void>
  onReset: (listener: () => void) => () => void
  onConnectionLoss?: (listener: () => void) => () => void
}



/** Pure card body; success reflects Host facts rather than a button click. */
export function TaskEntryPanel(props: {
  view: EntryView
  language: string
  connected: boolean
  strategies: StrategyCatalog['strategies']
  cancel: () => Promise<void>
  switchStrategy: (id: string, epoch: number) => Promise<void>
  resume: () => Promise<void>
  acceptProposal?: () => Promise<void>
}) {
  const { view, connected } = props
  const acceptProposal = props.acceptProposal
  const zh = props.language === 'zh'
  const copy = entryCopy[zh ? 'zh' : 'en']
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [target, setTarget] = useState('')
  const active = ['routing', 'selecting', 'running', 'waiting'].includes(view.state)
  const action = (perform: () => Promise<void>) => {
    if (busy || !connected) return
    setBusy(true); setError('')
    void perform().catch((failure: unknown) => {
      setError(failure instanceof Error ? failure.message : String(failure))
    }).finally(() => { setBusy(false) })
  }
  const cost = view.cost
  const run = view.run
  return <section className={css.card} aria-label={copy.progressLabel}>
    <header><strong>{entryStates[view.state][zh ? 1 : 0]}</strong><span>{view.receipt?.name}</span></header>
    {view.receipt ? <p><code>{view.run?.binding.id ?? view.receipt.strategy}</code> · <code>{view.receipt.jobId}</code></p> : null}
    {view.receipt?.selection ? <div>
      <p>{view.receipt.selection.kind === 'fallback' ? copy.fallbackChoice : copy.automaticChoice}
        {view.receipt.selection.tier ? ` · ${copy.initialTier}: ${view.receipt.selection.tier === 'low' ? copy.tierLow : view.receipt.selection.tier === 'medium' ? copy.tierMedium : copy.tierHigh}` : ''}</p>
      <p>{view.receipt.selection.kind === 'auto' ? `${copy.choiceReason}: ` : ''}{view.receipt.selection.reason}</p>
    </div> : null}
    {view.progress ? <p>{view.progress}</p> : null}
    {view.proposal ? <p><code>{view.proposal.id}</code> · {view.proposal.task}</p> : null}
    {view.run ? <p>{copy.completedCounts}: {view.run.completedStages} / {view.run.completedTasks}</p> : null}
    {run ? <div>
      {run.execution ? <details><summary>{copy.executionConfig}: <code>{run.execution.revision.slice(0, 12)}</code></summary>
        <p>{copy.inheritedModel}: <code>{run.execution.modelProvider ?? copy.unknown} / {run.execution.model ?? copy.unknown}</code></p>
        <p>{copy.permissionAuthority}: <code>{run.execution.permissionAuthority}</code></p>
        <p className={css.note}>{copy.permissionNote}</p>
      </details> : null}
      <p>{copy.verification}: {copy[run.verification?.status ?? 'unverified']}</p>
      {run.verification?.checks.map(check => <p key={check.id}><code>{check.id}</code> · {copy[check.status]}</p>)}
      {run.review ? <p>{copy.review}: {run.review.status === 'passed' ? copy.reviewPassed : run.review.status === 'issues' ? copy.reviewIssues : copy.reviewUnverified}</p> : null}
      {run.review?.issues.map((issue, index) => <p key={index}><code>{issue.path}</code> · {issue.description}</p>)}
      {run.usage ? <p>{copy.usage}: {run.usage.reportedCalls === 0 ? copy.unknown : run.usage.observedTokens.toLocaleString()}
        {run.usage.unknownChildren > 0 || run.usage.reportedCalls < run.usage.modelCalls ? ` · ${copy.usagePartial}` : ''}</p> : null}
      {run.usage ? <p className={css.note}>{copy.usageNote}</p> : null}
    </div> : null}
    {cost?.kind === 'estimated' ? <div>
      <p>{copy.knownInput}: {cost.knownInputTokens.toLocaleString()} · {copy.tasksStages}: {cost.tasks} / {cost.stages}</p>
      <p>{copy.scenarioTokens}: {cost.estimatedTotalTokens?.toLocaleString() ?? (copy.unknown)}</p>
      {cost.maximumScenarioTokens === undefined ? null : <p>{copy.maximumScenario}: {cost.maximumScenarioTokens.toLocaleString()}</p>}
      {cost.assumptions ? <p>{copy.assumptions}: {cost.assumptions.callsPerTask}
        {' / '}{cost.assumptions.contextTokensPerCall}{' / '}{cost.assumptions.outputTokensPerCall}</p> : null}
      <p className={css.note}>{copy.estimateNote}</p>
    </div> : view.receipt ? <p>{copy.costUnknown}</p> : null}
    {view.error ? <p role="alert">{view.error}</p> : null}
    {!connected ? <p role="status">{copy.offline}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {active ? <div className={css.controls}>
      {view.proposal && view.state === 'waiting' && !view.receipt && acceptProposal ? <button disabled={!connected || busy}
        onClick={() => { action(acceptProposal) }}>{copy.acceptProposal}</button> : null}
      <button disabled={!connected || busy} onClick={() => { action(props.cancel) }}>{copy.cancel}</button>
      {run && view.receipt ? <>
        <select aria-label={copy.switchLabel} value={target} disabled={!connected || busy || run.pendingSwitch !== undefined}
          onChange={(event) => { setTarget(event.target.value) }}>
          <option value="">{copy.nextStrategy}</option>
          {props.strategies.map(strategy => <option key={strategy.id} value={strategy.id}>{strategy.id}</option>)}
        </select>
        <button disabled={!connected || busy || !target || run.pendingSwitch !== undefined}
          onClick={() => { action(() => props.switchStrategy(target, run.binding.epoch)) }}>{copy.switchAction}</button>
        {view.state === 'waiting' ? <button disabled={!connected || busy} onClick={() => { action(props.resume) }}>{copy.resume}</button> : null}
      </> : null}
    </div> : null}
  </section>
}

/** Framework-derived node with Remote callbacks contributed by the strategy plugin. */
export type TaskEntryCardProps = { node: Pick<PropsRuntime<'conversation.chat.node', TaskEntryNodeKind>['node'], 'data'> }
  & PropsLocale<'settings.taskStrategy'> & InjectFace<TaskEntryFace>

/** Read current Host state on mount, updates and reconnection; never resubmit. */
export function TaskEntryCard(props: TaskEntryCardProps) {
  const acceptProposal = props.acceptProposal
  const original = props.node.data
  const [view, setView] = useState(original)
  const [connected, setConnected] = useState(false)
  const [strategies, setStrategies] = useState<StrategyCatalog['strategies']>([])
  const generation = useRef(0)
  useEffect(() => {
    const refresh = () => {
      const current = ++generation.current
      setConnected(false)
      void Promise.all([props.readState(original), props.readCatalog()]).then(([state, catalog]) => {
        if (generation.current !== current) return
        setView(state ?? { ...original,
          state: ['routing', 'selecting', 'running', 'waiting'].includes(original.state) ? 'interrupted' : original.state })
        setStrategies(catalog); setConnected(state !== undefined)
      }, () => { if (generation.current === current) { setView(original); setConnected(false) } })
    }
    refresh()
    const dispose = props.onReset(refresh)
    const disposeLoss = props.onConnectionLoss?.(() => { generation.current++; setConnected(false) })
    return () => { generation.current++; dispose(); disposeLoss?.() }
  }, [original, props.readState, props.readCatalog, props.onReset, props.onConnectionLoss])
  return <TaskEntryPanel view={view} language={props.t('entryLanguage')} connected={connected} strategies={strategies}
    cancel={() => props.cancel(view)} switchStrategy={(id, epoch) => props.switchStrategy(view, id, epoch)}
    resume={() => props.resume(view)} {...acceptProposal === undefined ? {} : { acceptProposal: () => acceptProposal(view) }} />
}
