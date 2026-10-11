import { errorText } from './errors.ts'
import type { OrchestrationMode, OrchestrationState } from './entry-types.ts'

/** Effect-scoped mode registrations and owner-local selections, without changing model routing. */
export class OrchestrationModes {
  private readonly registrations = new Map<string, { mode: OrchestrationMode; check: () => void }>()
  private readonly selections = new WeakMap<object, string>()
  private readonly tiers = new WeakMap<object, 'low' | 'medium' | 'high'>()

  /**
   * Capture live style strategies that declare tier support.
   * @returns strategy ids admitted by their current plugin registrations.
   */
  tierStrategies(): ReadonlySet<string> {
    const strategies = new Set<string>()
    for (const { mode, check } of this.registrations.values()) {
      if (mode.defaultTier === undefined) continue
      try { check(); strategies.add(mode.strategy) }
      catch (error) { /* Unavailable plugins are excluded from autonomous tier choices. */ void error }
    }
    return strategies
  }

  /**
   * Capture optional author preferences before asynchronous routing.
   * @param owner - exact root owner.
   * @returns detached preferences for one intake.
   */
  capturePreferences(owner: object): Readonly<Record<string, string>> {
    const mode = this.registrations.get(this.selections.get(owner) ?? 'dsh')?.mode
    if (this.selections.get(owner) === 'dsh') return { automation: 'auto' }
    return mode?.defaultTier === undefined ? {} : { tier: this.tiers.get(owner) ?? mode.defaultTier }
  }

  /**
   * Validate a tier for future style intakes without modifying an accepted task.
   * @param owner - exact root owner.
   * @param tier - requested low, medium or high tier.
   */
  selectTier(owner: object, tier: string): void {
    if (tier !== 'low' && tier !== 'medium' && tier !== 'high') throw new Error('Strategy tier must be low, medium or high')
    const mode = this.registrations.get(this.selections.get(owner) ?? 'dsh')
    if (mode?.mode.defaultTier === undefined) throw new Error('This mode does not support tier selection')
    mode.check(); this.tiers.set(owner, tier)
  }

  /**
   * Register one removable plugin mode.
   * @param mode - plugin identity.
   * @param check - current admission availability.
   * @returns exact registration disposer.
   */
  register(mode: OrchestrationMode, check: () => void): () => void {
    if (mode.id === 'dsh') throw new Error('DSH orchestration mode is reserved')
    if (![mode.id, mode.label, mode.strategy].every(value => value.trim())) throw new Error('Orchestration fields must not be empty')
    if (this.registrations.has(mode.id)) throw new Error(`Duplicate orchestration mode: ${mode.id}`)
    const registration = { mode: structuredClone(mode), check }
    this.registrations.set(mode.id, registration)
    return () => { if (this.registrations.get(registration.mode.id) === registration) this.registrations.delete(registration.mode.id) }
  }

  /**
   * Describe the retained choice without selecting a replacement.
   * @param owner - exact session owner.
   * @returns detached availability facts and the retained choice.
   */
  read(owner: object): OrchestrationState {
    const tier = this.capturePreferences(owner).tier as 'low' | 'medium' | 'high' | undefined
    return { selected: this.selections.get(owner) ?? 'dsh', ...tier === undefined ? {} : { tier }, options: [
      { id: 'dsh', label: 'DSH', available: true },
      ...[...this.registrations.values()].map(({ mode, check }) => {
        try { check(); return { id: mode.id, label: mode.label, available: true } }
        catch (error) { return { id: mode.id, label: mode.label, available: false, reason: errorText(error) } }
      }),
    ] }
  }

  /**
   * Validate before changing the acknowledged owner choice.
   * @param owner - exact session owner.
   * @param id - requested registered mode.
   */
  select(owner: object, id: string): void {
    if (id !== 'dsh') {
      const registration = this.registrations.get(id)
      if (registration === undefined) throw new Error(`Orchestration mode is unavailable: ${id}`)
      registration.check()
    }
    this.selections.set(owner, id)
  }

  /**
   * Retain the exact registration across later selection and unload.
   * @param owner - exact session owner.
   * @returns immutable intake choice with a live registration fence.
   */
  capture(owner: object): () => string | undefined {
    const id = this.selections.get(owner) ?? 'dsh'
    if (id === 'dsh') return () => undefined
    const registration = this.registrations.get(id)
    return () => {
      if (registration === undefined || this.registrations.get(id) !== registration) throw new Error(`Orchestration mode is unavailable: ${id}`)
      registration.check()
      return registration.mode.strategy
    }
  }
}
