/** Browser plugin entry for the Policy extension Bundle. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { PolicyExtensionConfig } from '../policy-config-types.ts'
import { en, zh, type PolicyLocaleKey } from './locales.ts'
import { PolicyStyleSelect } from './PolicyStyleSelect.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'policy.extension': PolicyLocaleKey }
}

const POLICY_CONFIG_NS = 'policy-extension'
const LOCALE_NS = 'policy.extension'

/** Browser services used directly by the composer style selector. */
export const inject = ['slots', 'locale', 'configForms']

/** Browser activation entry: restore the strategy style selector beside the model control. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(LOCALE_NS, { en, zh }), 'policy-extension: locales')
  const form = ctx.configForms.get<PolicyExtensionConfig>(POLICY_CONFIG_NS)
  ctx.inject(['uiConversation'], (owner) => {
    owner.slots.inject('conversation.input.right', () => owner.slots.register({
      name: 'conversation.input.right', id: 'policy.style', order: 950, locale: LOCALE_NS,
      inject: () => ({ form }),
    }, PolicyStyleSelect))
  })
}
