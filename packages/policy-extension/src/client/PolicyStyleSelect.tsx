import { useCallback, useState, useSyncExternalStore } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { PolicyExtensionConfig } from '../policy-config-types.ts'

interface PolicyStyleForm {
  getSnapshot(): { status: 'loading' | 'ready' | 'unavailable'; value: PolicyExtensionConfig | undefined; writable: boolean }
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<boolean>
}

/** Inputs supplied by the Policy extension's browser entry. */
export interface PolicyStyleSelectProps {
  readonly form: PolicyStyleForm
}

/** Select the profile-wide default style for subsequently accepted Policy jobs. */
export function PolicyStyleSelect({ form, t }: PolicyStyleSelectProps & PropsLocale<'policy.extension'>) {
  const subscribe = useCallback((listener: () => void) => form.subscribe(listener), [form])
  const read = useCallback(() => form.getSnapshot(), [form])
  const snapshot = useSyncExternalStore(subscribe, read, read)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const selected = snapshot.value?.style ?? 'codex-style'
  const choose = (style: string) => {
    setBusy(true)
    setFailed(false)
    void form.set('style', style).then((accepted) => { setFailed(!accepted) }, () => { setFailed(true) })
      .finally(() => { setBusy(false) })
  }
  return <label>
    <span>{t('style')}</span>
    <select aria-label={t('style')} value={selected} disabled={snapshot.status !== 'ready' || !snapshot.writable || busy}
      onChange={(event) => { choose(event.target.value) }}>
      <option value="codex-style">{t('codexStyle')}</option>
      <option value="claude-style">{t('claudeStyle')}</option>
      <option value="zcode-style">{t('zcodeStyle')}</option>
      <option value="superpowers-style">{t('superpowersStyle')}</option>
    </select>
    {failed ? <span role="alert">{t('saveFailed')}</span> : null}
  </label>
}
