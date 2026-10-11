/** Effect-owned execution adapters; original providers retain child lifetimes. */
import type { TaskExecutorProvider } from './executor-types.ts'
import type { TaskStep } from './types.ts'

/** Registry used by the task service, independent of product-specific adapters. */
export class ExecutorRegistry {
  private readonly providers = new Map<string, TaskExecutorProvider>()

  /**
   * Contribute one uniquely named execution adapter.
   * @param provider - immutable adapter with synchronous capability checks.
   * @returns idempotent removal for this exact registration.
   */
  register(provider: TaskExecutorProvider): () => void {
    if (!provider.id.trim()) throw new Error('Task executor identity must not be empty')
    if (this.providers.has(provider.id)) throw new Error(`Duplicate task executor: ${provider.id}`)
    if (typeof provider.check !== 'function' || typeof provider.execute !== 'function') {
      throw new Error('Task executor requires check and execute methods')
    }
    const id = provider.id
    const captured: TaskExecutorProvider = Object.freeze({ id, description: provider.description,
      check: provider.check.bind(provider), execute: provider.execute.bind(provider) })
    this.providers.set(id, captured)
    return () => { if (this.providers.get(id) === captured) this.providers.delete(id) }
  }

  /**
   * Admit an external step without discarding native DSH controls.
   * @param step - explicit external execution choice.
   * @param allowed - deployment-approved adapter identities.
   * @returns currently registered adapter after capability validation.
   */
  resolve(step: TaskStep, allowed: readonly string[]): TaskExecutorProvider {
    const id = step.executor
    if (id === undefined || !allowed.includes(id)) throw new Error(`Task executor is not allowed: ${id}`)
    if (step.preset !== undefined || step.tools !== undefined || step.model !== undefined || step.provider !== undefined) {
      throw new Error('External executor does not accept DSH preset, tool or model controls')
    }
    const provider = this.providers.get(id)
    if (provider === undefined) throw new Error(`Unknown task executor: ${id}`)
    provider.check()
    return provider
  }

  /**
   * Describe mounted execution adapters without starting native products.
   * @returns detached identities and descriptions.
   */
  list(): { id: string; description: string }[] {
    return [...this.providers.values()].map(({ id, description }) => ({ id, description }))
  }
}
