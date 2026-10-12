/** Live user-context compatibility before messages enter the durable session log. */
import { freezeMessage } from '@deepseek-ai/dsh-llm'
import type { ContextFormed } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { validateSessionMessageSources } from '@deepseek-ai/dsh-session/surface'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Compatibility attribution for explicitly enabled external legacy producers. */
    [kind: `plugin:${string}`]: { kind: `plugin:${string}` } & ContextFormed
  }
}

/**
 * Convert explicitly allowed legacy plugin sources and reject other invalid sources.
 * This is a live-input adapter; persisted events and restored seeds are never rewritten.
 * @param message - context supplied by a producer.
 * @param allowed - exact legacy source.plugin identifiers enabled by the composition.
 * @param subject - ingress location used in rejection diagnostics.
 * @returns the original native message or a detached immutable compatibility message.
 * @throws when the resulting message lacks a producer-owned source kind.
 */
export function admitUserMessage(message: UserMessage, allowed: readonly string[], subject: string): UserMessage {
  const source: unknown = message.source
  if (source !== null && typeof source === 'object' && !Array.isArray(source)) {
    const record = source as Record<string, unknown>
    if (record['kind'] === 'plugin' && typeof record['plugin'] === 'string'
      && record['plugin'].length > 0 && allowed.includes(record['plugin'])) {
      const { plugin, ...metadata } = record
      const kind: `plugin:${string}` = `plugin:${plugin}`
      const converted = { ...structuredClone(message),
        source: { ...structuredClone(metadata), kind } }
      validateSessionMessageSources({ type: 'user/message', data: converted }, subject)
      return freezeMessage(converted)
    }
  }
  validateSessionMessageSources({ type: 'user/message', data: message }, subject)
  return message
}
