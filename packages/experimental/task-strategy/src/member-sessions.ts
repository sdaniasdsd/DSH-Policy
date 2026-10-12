/** Local member turns use original activation ownership and retain only task-owned identities. */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { MessageId } from '@deepseek-ai/dsh-llm'
import type { SubagentActivation } from '@deepseek-ai/dsh-subagent'
import { executeDshChild } from './dsh-child.ts'
import { ownActivation } from './subagent-activation.ts'
import { errorText } from './errors.ts'
import type { TaskStep } from './types.ts'
import type { TaskRuntimeRules } from './runtime-types.ts'
import type { TaskMemberSessions, TaskMemberSessionView, TaskMemberTurnOutcome } from './member-session-types.ts'

interface Member {
  readonly id: SessionId
  readonly step: TaskStep
  phase: TaskMemberSessionView['phase']
}

/** Private factory inputs capture authority, deployment rules and admission ownership. */
interface MemberSessionOptions {
  readonly ctx: Pick<Context, 'on' | 'get'> & {
    readonly subagents: Pick<Context['subagents'], 'startActivation' | 'continueActivation'>
  }
  readonly parent: Agent
  readonly rules: TaskRuntimeRules
  readonly route?: Pick<TaskStep, 'model' | 'provider'>
  readonly signal: AbortSignal
  readonly assertOwner: () => void
  readonly checkChild: (step: TaskStep, signal: AbortSignal) => Promise<void>
  readonly admitTurn: () => () => void
  readonly onActive: (id: SessionId, label: string) => () => void
}

/** Create a facade for one executor call; only that call can continue its members. */
export function createMemberSessions(options: MemberSessionOptions): TaskMemberSessions {
  const { ctx, parent, assertOwner, checkChild, admitTurn, onActive } = options
  const rules = structuredClone(options.rules)
  const route = { ...options.route }
  const controller = new AbortController()
  const members = new Map<SessionId, Member>()
  const operations = new Set<Promise<TaskMemberTurnOutcome>>()
  let closing: Promise<void> | undefined

  const run = (member: Member, text: string, signal: AbortSignal, initial: boolean): Promise<TaskMemberTurnOutcome> => {
    if (controller.signal.aborted) throw new Error('Member sessions are closed')
    const combined = AbortSignal.any([signal, options.signal, controller.signal])
    combined.throwIfAborted()
    assertOwner()
    if (operations.size >= rules.maxConcurrent) throw new Error('Member turns exceed captured maxConcurrent')
    if (!text.trim()) throw new Error('Member turn text must not be empty')
    if (Buffer.byteLength(JSON.stringify({ sessionId: member.id, step: member.step, text }), 'utf8') > rules.maxPlanBytes) {
      throw new Error('Member request exceeds captured maxPlanBytes')
    }
    if (member.step.executor !== undefined) throw new Error('Member sessions require a local preset; executor-backed steps are unsupported')
    const releaseTurn = admitTurn()
    const prior = member.phase
    member.phase = 'running'
    members.set(member.id, member)
    const execution = async (): Promise<TaskMemberTurnOutcome> => {
      let accepted: (SubagentActivation & { readonly messageId: MessageId }) | undefined
      try {
        await checkChild(member.step, combined)
        combined.throwIfAborted()
        assertOwner()
        const result = await executeDshChild(ctx, parent, rules.provider, member.step, text, combined, rules.maxResultBytes,
          id => onActive(id, member.step.label), async (spec) => {
            const receipt = initial
              ? await ctx.subagents.startActivation({ ...spec, childId: member.id })
              : await ctx.subagents.continueActivation(parent, member.id, [{ type: 'text', text }], { signal: spec.signal,
                resume: {
                  ...spec.request.agentOptions?.maxTokens === undefined ? {} : { maxTokens: spec.request.agentOptions.maxTokens },
                  ...spec.request.outputSchema === undefined ? {} : { outputSchema: spec.request.outputSchema },
                } })
            accepted = ownActivation(receipt, spec.signal)
            return accepted
          })
        if (accepted === undefined) throw new Error('Member observation completed without an accepted activation')
        const outcome: TaskMemberTurnOutcome = { kind: 'settled', sessionId: member.id, messageId: accepted.messageId, result }
        if (Buffer.byteLength(JSON.stringify(outcome), 'utf8') > rules.maxResultBytes) {
          throw new Error('Captured member outcome exceeds maxResultBytes')
        }
        member.phase = 'settled'
        return outcome
      } catch (error) {
        if (accepted === undefined) {
          if (initial) members.delete(member.id)
          else member.phase = prior
          throw error
        }
        member.phase = 'unobserved'
        const outcome: TaskMemberTurnOutcome = { kind: 'unobserved', sessionId: member.id, messageId: accepted.messageId,
          error: errorText(error) }
        while (Buffer.byteLength(JSON.stringify(outcome), 'utf8') > rules.maxResultBytes && outcome.error.length > 0) {
          Object.assign(outcome, { error: outcome.error.slice(0, Math.floor(outcome.error.length / 2)) })
        }
        if (Buffer.byteLength(JSON.stringify(outcome), 'utf8') > rules.maxResultBytes) {
          throw new Error(`Message ${accepted.messageId} accepted for member ${member.id}; maxResultBytes cannot encode its identity. Do not replay this turn.`)
        }
        return outcome
      } finally {
        releaseTurn()
        if (controller.signal.aborted && members.has(member.id)) member.phase = 'closed'
      }
    }
    const pending = execution()
    operations.add(pending)
    void pending.then(() => { operations.delete(pending) }, () => { operations.delete(pending) })
    return pending
  }

  return {
    async open(step, prompt, signal) {
      const captured = structuredClone({ ...step,
        ...step.model !== undefined || route.model === undefined ? {} : { model: route.model },
        ...step.provider !== undefined || route.provider === undefined ? {} : { provider: route.provider },
      })
      return run({ id: SessionId(randomUUID()), step: captured, phase: 'settled' }, prompt, signal, true)
    },
    async continue(sessionId, text, signal) {
      const member = members.get(sessionId)
      if (member === undefined) throw new Error('Session is not a member of this executor')
      if (member.phase === 'running') throw new Error('Member is already executing')
      return run(member, text, signal, false)
    },
    inspect: () => [...members.values()].map(member => ({ sessionId: member.id, label: member.step.label, phase: member.phase })),
    close: () => {
      if (closing !== undefined) return closing
      controller.abort(new Error('Member sessions are closed'))
      closing = Promise.allSettled([...operations]).then(() => {
        for (const member of members.values()) member.phase = 'closed'
      })
      return closing
    },
  }
}
