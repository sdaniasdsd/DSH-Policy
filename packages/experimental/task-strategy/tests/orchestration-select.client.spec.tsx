// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationSelect } from '../src/client/OrchestrationSelect.tsx'
import { zh } from '../src/client/locales.ts'
import type { OrchestrationState } from '../src/entry-types.ts'

afterEach(cleanup)
const initial: OrchestrationState = { selected: 'codex', options: [
  { id: 'dsh', label: 'DSH', available: true }, { id: 'codex', label: 'Codex', available: true },
] }
const t = (key: string) => zh[key as keyof typeof zh] ?? key
describe('composer orchestration choice', () => {
  it('keeps liquid lens filters local to each switch and outside accessible content', async () => {
    const faces = { read: async () => ({ ...initial, selected: 'dsh' }), select: async () => initial,
      onReset: () => () => {}, t }
    const { container } = render(<><OrchestrationSelect {...faces} /><OrchestrationSelect {...faces} /></>)
    await vi.waitFor(() => { expect(screen.getAllByRole('switch').every(element => !element.hasAttribute('disabled'))).toBe(true) })
    const filters = [...container.querySelectorAll('filter')]
    expect(filters).toHaveLength(2)
    expect(new Set(filters.map(element => element.id)).size).toBe(2)
    for (const toggle of screen.getAllByRole('switch', { name: '全自动／自己选' })) {
      const lens = toggle.querySelector('[data-glass-lens]')
      expect(lens).not.toBeNull()
      expect(lens?.closest('[aria-hidden="true"]')).not.toBeNull()
      expect(lens?.textContent).toBe('')
      expect(toggle.style.getPropertyValue('--glass-refraction')).toContain(`#${filters[screen.getAllByRole('switch').indexOf(toggle)]?.id}`)
      expect(toggle.textContent).toBe('全自动')
    }
    expect(container.querySelectorAll('svg[aria-hidden="true"][focusable="false"]')).toHaveLength(2)
  })
  it('refreshes plugin availability while the automatic controls are folded', async () => {
    let current: OrchestrationState = { selected: 'dsh', options: [{ id: 'dsh', label: 'DSH', available: true }] }
    render(<OrchestrationSelect read={async () => current} select={async () => ({ ...initial, selected: 'codex' })}
      onReset={() => () => {}} t={t} />)
    const toggle = await screen.findByRole('switch', { name: '全自动／自己选' })
    await vi.waitFor(() => { expect(toggle).toHaveProperty('disabled', false) })
    current = { ...initial, selected: 'dsh' }
    fireEvent.focus(toggle)
    await vi.waitFor(() => { expect(toggle).toHaveProperty('disabled', false) })
    fireEvent.click(toggle)
    await screen.findByRole('combobox', { name: '编排模式' })
  })
  it('shows native modes, disables absent plugins and waits for Host acknowledgment', async () => {
    const pending = Promise.withResolvers<OrchestrationState>()
    const read = vi.fn(async () => initial), select = vi.fn(() => pending.promise)
    render(<OrchestrationSelect read={read} select={select} onReset={() => () => {}} t={t} />)
    const control = await screen.findByRole('combobox', { name: '编排模式' })
    await vi.waitFor(() =>{  expect(control).toHaveProperty('disabled', false) })
    expect(screen.getByRole('option', { name: /Claude/ })).toHaveProperty('disabled', true)
    expect(screen.getByRole('option', { name: /ZCode/ })).toHaveProperty('disabled', true)
    fireEvent.focus(control)
    await vi.waitFor(() =>{  expect(read).toHaveBeenCalledTimes(2) })
    expect(control).toHaveProperty('disabled', false)
    fireEvent.change(control, { target: { value: 'codex' } })
    expect(select).toHaveBeenCalledWith('codex')
    expect(control).toHaveProperty('disabled', true)
    pending.resolve({ ...initial, selected: 'codex' })
    await vi.waitFor(() =>{  expect(control).toHaveProperty('value', 'codex') })
  })
  it('ignores late selection acknowledgments after reset', async () => {
    const pending = Promise.withResolvers<OrchestrationState>()
    let reset = () => {}
    const read = vi.fn(async () => initial), select = vi.fn(() => pending.promise)
    render(<OrchestrationSelect read={read} select={select} onReset={(listener) => { reset = listener; return () => {} }} t={t} />)
    let control = await screen.findByRole('combobox', { name: '编排模式' })
    await vi.waitFor(() =>{  expect(control).toHaveProperty('disabled', false) })
    fireEvent.change(control, { target: { value: 'codex' } })
    reset()
    await vi.waitFor(() => { control = screen.getByRole('combobox', { name: '编排模式' }); expect(control).toHaveProperty('disabled', false) })
    pending.resolve({ ...initial, selected: 'stale-mode' })
    await pending.promise
    expect(control).toHaveProperty('value', 'codex')
  })
  it('defaults to a visible automatic switch with folded manual choices', async () => {
    render(<OrchestrationSelect read={async () => ({ ...initial, selected: 'dsh' })} select={async () => initial}
      onReset={() => () => {}} t={t} />)
    const toggle = await screen.findByRole('switch', { name: '全自动／自己选' })
    await vi.waitFor(() => { expect(toggle).toHaveProperty('disabled', false) })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.getByText('全自动')).toBeTruthy()
  })
  it('unfolds manual settings after Host acceptance and retains high medium low labels', async () => {
    let value: OrchestrationState = { ...initial, selected: 'dsh' }
    render(<OrchestrationSelect read={async () => value} select={async mode => (value = { ...initial, selected: mode, tier: 'medium' })}
      selectTier={async tier => (value = { ...value, tier: tier as 'low' | 'medium' | 'high' })} onReset={() => () => {}} t={t} />)
    const toggle = await screen.findByRole('switch', { name: '全自动／自己选' })
    await vi.waitFor(() => { expect(toggle).toHaveProperty('disabled', false) })
    fireEvent.click(toggle)
    await screen.findByRole('combobox', { name: '编排模式' })
    expect(screen.getByRole('option', { name: '高' })).toBeTruthy()
    expect(screen.getByRole('option', { name: '中' })).toBeTruthy()
    expect(screen.getByRole('option', { name: '低' })).toBeTruthy()
    fireEvent.click(toggle)
    await vi.waitFor(() => { expect(screen.queryByRole('combobox')).toBeNull() })
  })
  it('updates the scenario guidance only after the Host accepts a mode and tier change', async () => {
    let value: OrchestrationState = { selected: 'codex-style', tier: 'low', options: [
      { id: 'dsh', label: 'DSH', available: true }, { id: 'codex-style', label: 'Codex', available: true },
      { id: 'superpowers-style', label: 'Superpowers', available: true },
    ] }
    const pending = Promise.withResolvers<OrchestrationState>()
    const select = vi.fn(async (mode: string) => (value = { ...value, selected: mode }))
    const selectTier = vi.fn(() => pending.promise)
    render(<OrchestrationSelect read={async () => value} select={select} selectTier={selectTier}
      onReset={() => () => {}} t={t} />)
    const mode = await screen.findByRole('combobox', { name: '编排模式' })
    await vi.waitFor(() => { expect(mode).toHaveProperty('disabled', false) })
    const tier = screen.getByRole('combobox', { name: '预算档位' })
    expect(tier.title).toContain('一处范围明确的小修改')
    fireEvent.change(mode, { target: { value: 'superpowers-style' } })
    await vi.waitFor(() => { expect(mode).toHaveProperty('disabled', false) })
    expect(select).toHaveBeenCalledWith('superpowers-style')
    expect(tier.title).toContain('小编程任务')
    fireEvent.change(tier, { target: { value: 'extreme-high' } })
    expect(selectTier).toHaveBeenCalledWith('extreme-high')
    expect(tier).toHaveProperty('value', 'low')
    expect(tier.title).toContain('小编程任务')
    expect(tier).toHaveProperty('disabled', true)
    value = { ...value, tier: 'extreme-high' }
    pending.resolve(value)
    await vi.waitFor(() => { expect(tier).toHaveProperty('value', 'extreme-high') })
    expect(tier.title).toContain('长开发任务')
    expect(mode).toHaveProperty('value', 'superpowers-style')
  })
  it('keeps automatic state when the Host rejects a manual mode', async () => {
    render(<OrchestrationSelect read={async () => ({ ...initial, selected: 'dsh' })}
      select={async () => { throw new Error('unloaded') }} onReset={() => () => {}} t={t} />)
    const toggle = await screen.findByRole('switch', { name: '全自动／自己选' })
    await vi.waitFor(() => { expect(toggle).toHaveProperty('disabled', false) })
    fireEvent.click(toggle)
    await screen.findByRole('alert')
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(screen.queryByRole('combobox')).toBeNull()
  })
})
