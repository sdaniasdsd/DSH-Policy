import { useEffect, useId, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { OrchestrationState } from '../entry-types.ts'
import css from './OrchestrationSelect.module.css'
import { glassLensMap } from './glass-lens-map.ts'
import { tierHintKeys } from './locales.ts'

/** Session-bound Host adapters injected through the original composer extension seat. */
export interface OrchestrationFace {
  read: () => Promise<OrchestrationState>
  select: (mode: string) => Promise<OrchestrationState>
  selectTier?: (tier: string) => Promise<OrchestrationState>
  onReset: (listener: () => void) => () => void
}

/** Render an acknowledged orchestration choice immediately before the model selector. */
export function OrchestrationSelect({ read, select, selectTier, onReset, t }:
  OrchestrationFace & PropsLocale<'settings.taskStrategy'>) {
  const [state, setState] = useState<OrchestrationState>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const generation = useRef(0)
  const selecting = useRef(false)
  const manualMode = useRef<string | undefined>(undefined)
  const lensId = `dsh-strategy-lens-${useId()}`
  const lensStyle: CSSProperties & { '--glass-refraction': string } = { '--glass-refraction': `url("#${lensId}")` }
  const reload = (initial = false) => {
    if (selecting.current) return
    const ticket = ++generation.current
    setBusy(initial || state === undefined)
    void read().then((value) => {
      if (ticket === generation.current) { setState(value); if (value.selected !== 'dsh') manualMode.current = value.selected; setError('') }
    }, (failure: unknown) => {
      if (ticket === generation.current) { setState(undefined); setError(String(failure)) }
    }).finally(() => { if (ticket === generation.current) setBusy(false) })
  }
  useEffect(() => {
    selecting.current = false; manualMode.current = undefined; setState(undefined); reload(true)
    const dispose = onReset(() => { selecting.current = false; manualMode.current = undefined; setState(undefined); reload(true) })
    return () => { ++generation.current; dispose() }
  }, [read, select, onReset])
  const choose = (mode: string | undefined, tier = false) => {
    const ticket = ++generation.current
    selecting.current = true; setBusy(true); setError('')
    const operation = mode === undefined ? read().then((value) => {
      if (ticket !== generation.current) throw new Error('Selection reset')
      const choices = value.options.filter(row => row.id !== 'dsh' && row.available)
      const target = choices.find(row => row.id === manualMode.current)
        ?? choices.find(row => row.id === 'codex-style') ?? choices[0]
      if (target === undefined) throw new Error(t('modeUnconfigured'))
      return select(target.id)
    }) : tier && selectTier !== undefined ? selectTier(mode) : select(mode)
    void operation.then((value) => {
      if (ticket === generation.current) { setState(value); if (value.selected !== 'dsh') manualMode.current = value.selected }
    }, (failure: unknown) => {
      if (ticket === generation.current) setError(String(failure))
    }).finally(() => {
      if (ticket === generation.current) { selecting.current = false; setBusy(false) }
    })
  }
  const options = [...state?.options ?? [{ id: 'dsh', label: 'DSH', available: false }]]
  for (const [id, label] of [['claude-style', t('claudeStyle')], ['codex-style', t('codexStyle')], ['zcode-style', t('zcodeStyle')], ['superpowers-style', t('superpowersStyle')]]) {
    if (id !== undefined && label !== undefined && !options.some(row => row.id === id)) {
      options.push({ id, label, available: false, reason: t('modeUnconfigured') })
    }
  }
  if (state !== undefined && !options.some(row => row.id === state.selected)) {
    options.push({ id: state.selected, label: state.selected, available: false, reason: t('modeUnconfigured') })
  }
  const automatic = state === undefined || state.selected === 'dsh'
  const scopeKey = state?.tier === undefined ? undefined : tierHintKeys[state.selected]?.[state.tier]
  const availableManual = options.filter(row => row.id !== 'dsh' && row.available)
  const manual = availableManual.find(row => row.id === manualMode.current)
    ?? availableManual.find(row => row.id === 'codex-style') ?? availableManual[0]
  return <div className={css.control}>
    <svg className={css.filters} width="0" height="0" aria-hidden="true" focusable="false">
      <defs><filter id={lensId} filterUnits="userSpaceOnUse" x="0" y="0" width="12" height="12" colorInterpolationFilters="sRGB">
        <feImage href={glassLensMap} width="12" height="12" preserveAspectRatio="none" result="edgeMap" />
        <feDisplacementMap in="SourceGraphic" in2="edgeMap" scale="3" xChannelSelector="R" yChannelSelector="G" />
      </filter></defs>
    </svg>
    <button type="button" role="switch" aria-label={t('automation')} aria-checked={automatic}
      className={css.toggle} style={lensStyle} title={automatic ? t('automaticHint') : t('modeScope')}
      disabled={busy || state === undefined} onFocus={() => { reload() }}
      onClick={() => { if (!busy && state !== undefined) choose(automatic ? manual?.id : 'dsh') }}>
      <span className={css.track} data-automatic={automatic} aria-hidden="true"><span className={css.thumb} data-glass-lens="true" /></span>
      <span>{automatic ? t('fullyAutomatic') : t('chooseManually')}</span>
    </button>
    {!automatic ? <select className={css.select} aria-label={t('orchestration')} title={t('modeScope')}
      value={state.selected} disabled={busy}
      onFocus={() => { reload() }} onChange={(event) => { choose(event.target.value) }}>
      {options.filter(row => row.id !== 'dsh').map(row => <option key={row.id} value={row.id} disabled={!row.available}>
        {row.id === 'dsh' ? t('auto') : row.id === 'claude-style' ? t('claudeStyle') : row.id === 'codex-style' ? t('codexStyle')
          : row.id === 'zcode-style' ? t('zcodeStyle') : row.id === 'superpowers-style' ? t('superpowersStyle') : row.label}{row.available ? '' : ` · ${row.reason ?? t('modeUnconfigured')}`}
      </option>)}
    </select> : null}
    {!automatic && state.tier !== undefined && selectTier !== undefined ? <select className={css.select} aria-label={t('tier')}
      title={scopeKey === undefined ? undefined : t(scopeKey)}
      value={state.tier} disabled={busy} onChange={(event) => { choose(event.target.value, true) }}>
      <option value="low">{t('tierLow')}</option><option value="medium">{t('tierMedium')}</option><option value="high">{t('tierHigh')}</option>
      <option value="extreme-high">{t('tierExtremeHigh')}</option>
    </select> : null}
    {error ? <span role="alert" className={css.error} title={error}>{t('modeLoadFailed')}</span> : null}
  </div>
}
