/** Optional conversation node folded from durable Host entry snapshots. */
import type { Context } from '@deepseek-ai/cordis'
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { EntryView } from '../entry-types.ts'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'

/** Renderer key exported with its Chat payload augmentation for isolated consumers. */
export type TaskEntryNodeKind = 'task-strategy-entry'

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap { 'task-strategy-entry': EntryView }
}

/** Group all snapshots for one original request into one stable chat card. */
export const taskEntryDefinition: ConversationNodeDefinition<EntryView> = {
  kind: 'task-strategy-entry', target: 'chat',
  match: event => event.type === 'task-strategy/entry'
    ? { id: event.data.view.requestId, role: event.data.view.state === 'routing' ? 'start' : 'update' } : null,
  start: (_context, match) => {
    if (match.event.type !== 'task-strategy/entry') throw new Error('Task entry requires an entry snapshot')
    return match.event.data.view
  },
  update: (context, match) => match.event.type === 'task-strategy/entry' ? match.event.data.view : context.state,
  buildViewNode: (context) => {
    const match = context.matches.findLast(item => item.event.type === 'task-strategy/entry')
    const data = context.state ?? (match?.event.type === 'task-strategy/entry' ? match.event.data.view : undefined)
    const anchor = context.start ?? match
    if (data === undefined || anchor === undefined || data.progress === 'conversation' || data.progress?.startsWith('Associated with ')) return null
    return { key: context.key, id: context.id, kind: 'task-strategy-entry', target: 'chat',
      anchorSeq: anchor.event.seq,
      // A Job/proposal may outlive the model turn; keep its controls outside thought/process disclosure.
      location: { kind: 'session' }, visibility: 'visible', data }
  },
}

/**
 * Register the card fold under the client plugin lifetime.
 * @param ctx - owning Client plugin context.
 */
export function registerTaskEntryNode(ctx: Context): void {
  ctx.effect(() => ctx.uiConversation.events.register(taskEntryDefinition))
}
