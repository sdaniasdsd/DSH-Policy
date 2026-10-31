/** Source-safe registration of the optional catalogue Remote and plugin page. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionFollowFrame } from '@deepseek-ai/dsh-api-session-controller/types'
import type {} from '@deepseek-ai/dsh-experimental-task-strategy/remote'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { TaskStrategyCard } from './TaskStrategyCard.tsx'
import { TASK_STRATEGY_NS, TaskStrategyCardController } from './task-strategy-card-controller.ts'
import { en, zh, type TaskStrategyLocaleKey } from './locales.ts'
import { TaskEntryCard } from './TaskEntryCard.tsx'
import { registerTaskEntryNode } from './task-entry-node.ts'
import type { TaskEntryFace } from './TaskEntryCard.tsx'
import { OrchestrationSelect } from './OrchestrationSelect.tsx'
import type { OrchestrationFace } from './OrchestrationSelect.tsx'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'settings.taskStrategy': TaskStrategyLocaleKey }
}

/** Locale dictionary namespace for the optional strategy page. */
export const NS = 'settings.taskStrategy'
/** Services used by the browser half. */
export const inject = ['remote', 'slots', 'locale', 'configForms']

function registerUi(ctx: Context): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { en, zh }))
  const card = new TaskStrategyCardController(ctx.configForms.get(TASK_STRATEGY_NS), async () => {
    const result = await ctx.remote.taskStrategies.catalog()
    if (!result.ok) throw result.error
    return result.value
  })
  ctx.effect(() => () => { card.dispose() })
  ctx.effect(() => ctx.remote.$on('settings/document-updated', () => { card.refreshCatalog() }))
  ctx.on('connection/reset', () => { card.resetConnection() })
  ctx.effect(() => ctx.configForms.whileServed([TASK_STRATEGY_NS], () => ctx.slots.inject('plugins.item', () => ctx.slots.register({
    name: 'plugins.item', id: 'task-strategy', order: 35, label: () => t('title'), locale: NS,
    inject: () => card.inject(),
  }, TaskStrategyCard))))
  const face: TaskEntryFace = {
    readState: async (view) => {
      const result = await ctx.remote.taskStrategies.entryState({ sessionId: view.sessionId })
      if (!result.ok) throw result.error
      return result.value.find(entry => entry.requestId === view.requestId)
    },
    readCatalog: async () => {
      const result = await ctx.remote.taskStrategies.catalog()
      if (!result.ok) throw result.error
      return result.value.strategies
    },
    followMember: (view, member, signal): AsyncIterable<SessionFollowFrame> => ctx.remote.session.follow({
      address: { kind: 'subagent', parentSessionId: view.sessionId, childSessionId: member.sessionId, mode: 'unknown' },
      assistantStream: true,
    }, signal),
    cancel: async (view) => {
      const result = await ctx.remote.taskStrategies.cancelEntry({ sessionId: view.sessionId, requestId: view.requestId })
      if (!result.ok) throw result.error
    },
    acceptProposal: async (view) => {
      if (view.proposal === undefined) throw new Error('Proposal is unavailable')
      const result = await ctx.remote.taskStrategies.acceptProposal({ sessionId: view.sessionId, proposalId: view.proposal.id })
      if (!result.ok) throw result.error
    },
    switchStrategy: async (view, strategy, epoch) => {
      const result = await ctx.remote.taskStrategies.switchEntry({ sessionId: view.sessionId, requestId: view.requestId,
        request: { commandId: globalThis.crypto.randomUUID(), strategy, expectedBindingEpoch: epoch } })
      if (!result.ok) throw result.error
    },
    resume: async (view) => {
      if (view.run === undefined) throw new Error('Task binding is unavailable')
      const result = await ctx.remote.taskStrategies.resumeEntry({
        sessionId: view.sessionId, requestId: view.requestId, commandId: globalThis.crypto.randomUUID(), epoch: view.run.binding.epoch,
      })
      if (!result.ok) throw result.error
    },
    onReset: listener => ctx.on('connection/reset', listener),
    onConnectionLoss: (listener) => {
      const scope = ctx.inject(['connection'], (owner) => {
        const connection = owner.get('connection') as ConnectionHandle
        owner.effect(() => connection.generation.subscribe(() => {
          if (connection.generation.getSnapshot() === undefined) listener()
        }))
      })
      return () => { void scope.dispose() }
    },
  }
  ctx.inject(['uiConversation'], (owner) => {
    owner.slots.inject('conversation.input.right', () => owner.slots.register({
      name: 'conversation.input.right', id: 'task-strategy.orchestration', order: 1000, locale: NS,
      inject: (sessionId): OrchestrationFace => ({
        read: async () => {
          const result = await ctx.remote.taskStrategies.orchestration({ sessionId })
          if (!result.ok) throw result.error
          return result.value
        },
        select: async (mode) => {
          const result = await ctx.remote.taskStrategies.selectOrchestration({ sessionId, mode })
          if (!result.ok) throw result.error
          return result.value
        },
        selectTier: async (tier) => {
          const result = await ctx.remote.taskStrategies.selectWorkflowTier({ sessionId, tier })
          if (!result.ok) throw result.error
          return result.value
        },
        onReset: listener => ctx.on('connection/reset', listener),
      }),
    }, OrchestrationSelect))
    registerTaskEntryNode(owner)
    owner.slots.inject('conversation.chat.node', () => owner.slots.register({ name: 'conversation.chat.node',
      key: 'task-strategy-entry', locale: NS, inject: () => face }, TaskEntryCard))
  })
}

/**
 * Mount only this experimental Remote namespace beside the original plugin UI.
 * @param ctx - Client runtime and effect owner.
 * @param contribution - generated read-only strategy Remote.
 * @returns disposer withdrawing UI before its Remote definitions.
 */
export async function mountTaskStrategyUi(ctx: Context, contribution: TypertRemoteContribution): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(contribution)
  const ui = ctx.inject(['remote.taskStrategies', 'slots', 'locale', 'configForms'], registerUi)
  try { await ui } catch (error) { await ui.dispose(); await disposeRemote(); throw error }
  return async () => { await ui.dispose(); await disposeRemote() }
}
