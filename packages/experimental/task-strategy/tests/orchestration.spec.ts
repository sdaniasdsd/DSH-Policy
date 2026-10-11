import { describe, expect, it } from 'vitest'
import { OrchestrationModes } from '../src/orchestration.ts'

describe('session orchestration choices', () => {
  it('captures a tier before routing and rejects invalid tiers without changing it', () => {
    const modes = new OrchestrationModes(), owner = {}
    modes.register({ id: 'codex-style', label: 'Codex style', strategy: 'codex-style', defaultTier: 'medium' }, () => {})
    modes.select(owner, 'codex-style')
    expect(modes.capturePreferences(owner)).toEqual({ tier: 'medium' })
    modes.selectTier(owner, 'high')
    const preferences = modes.capturePreferences(owner)
    modes.selectTier(owner, 'low')
    expect(preferences).toEqual({ tier: 'high' })
    expect(() => modes.selectTier(owner, 'bad')).toThrow('tier')
    expect(modes.read(owner).tier).toBe('low')
  })
  it('keeps choices per owner and captures the selected plugin for later admission', () => {
    const modes = new OrchestrationModes(), owner = {}, other = {}
    const dispose = modes.register({ id: 'claude', label: 'Claude', strategy: 'custom-claude' }, () => {})
    modes.select(owner, 'claude')
    const captured = modes.capture(owner)
    modes.select(owner, 'dsh')
    expect(modes.read(other).selected).toBe('dsh')
    expect(captured()).toBe('custom-claude')
    dispose()
    expect(captured).toThrow('unavailable')
  })
  it('rejects unavailable, duplicate and reserved modes without changing selection', () => {
    const modes = new OrchestrationModes(), owner = {}
    expect(() =>{  modes.select(owner, 'codex'); }).toThrow('unavailable')
    modes.register({ id: 'codex', label: 'Codex', strategy: 'native' }, () => { throw new Error('backend missing') })
    expect(modes.read(owner).options[1]?.available).toBe(false)
    expect(modes.read(owner).options[1]?.reason).toContain('backend missing')
    expect(() =>{  modes.select(owner, 'codex'); }).toThrow('backend missing')
    expect(modes.read(owner).selected).toBe('dsh')
    expect(() => modes.register({ id: 'codex', label: 'Codex', strategy: 'other' }, () => {})).toThrow('Duplicate')
    expect(() => modes.register({ id: 'dsh', label: 'DSH', strategy: 'other' }, () => {})).toThrow('reserved')
  })
})
