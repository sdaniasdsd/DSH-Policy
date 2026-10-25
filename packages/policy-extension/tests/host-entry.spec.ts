import { describe, expect, it } from 'vitest'
import type { JobHandle, JobHooks, JobSpec } from '@deepseek-ai/dsh-jobs'
import type { WorkflowResult, WorkflowRun, WorkflowStartRequest } from '@deepseek-ai/dsh-workflow'
import { registerPolicyHost } from '../src/host-entry.ts'

describe('Policy Host entry', () => {
  it('registers a model-facing policy tool and streams workflow lifecycle into its owned Job', async () => {
    const registered: { name: string; execute: (args: { task: string }, exec: any) => Promise<unknown> }[] = []
    const listeners = new Map<string, ((...args: any[]) => void)[]>()
    let spec: JobSpec | undefined
    let hooks: JobHooks | undefined
    const chunks: { text: string; channel?: string }[] = []
    const progress: string[] = []
    const job: JobHandle = {
      id: 'policy-1234567890abcdef' as JobHandle['id'],
      append(text, options) { chunks.push({ text, channel: options?.channel }) },
      updateProgress(line) { progress.push(line) },
    }
    const result = Promise.withResolvers<WorkflowResult>()
    let workflowRequest: WorkflowStartRequest | undefined
    const owner = { id: 'session-owner' } as WorkflowStartRequest['parent']
    const ctx = {
      inject(_deps: string[], callback: (context: unknown) => void) { callback(this) },
      tools: { register(tool: (typeof registered)[number]) { registered.push(tool) } },
      jobs: { start(input: JobSpec) { spec = input; hooks = input.run(job); return job.id } },
      workflowEngine: { start(input: WorkflowStartRequest) {
        workflowRequest = input
        return { id: 'workflow-1' as WorkflowRun['id'], meta: input.meta, result: result.promise, cancel() {}, dispose: async () => {} }
      } },
      on(name: string, listener: (...args: any[]) => void) {
        listeners.set(name, [...listeners.get(name) ?? [], listener])
        return () => {}
      },
    }

    registerPolicyHost(ctx as never, { style: 'codex-style' })
    expect(registered.map(({ name }) => name)).toEqual(['policy_run'])
    const receipt = await registered[0]!.execute({ task: 'Implement the requested feature' }, {
      agent: owner,
      callId: 'call-1', rootCallId: 'call-1', signal: new AbortController().signal,
    })
    expect(receipt).toMatchObject({ jobId: job.id, strategy: 'codex-style' })
    expect(spec).toMatchObject({ kind: 'policy', label: 'codex-style: Implement the requested feature', owner: owner.id })
    expect(workflowRequest).toMatchObject({
      meta: { name: 'codex-style' },
      args: { prompt: expect.stringContaining('Implement the requested feature') },
      parent: owner,
    })
    expect(workflowRequest?.script).toContain('const result = await agent(args.prompt)')
    expect(workflowRequest?.script).toContain('if (result === null) throw new Error')

    listeners.get('workflow/phase')?.forEach(listener => listener({ id: workflowRequest && 'workflow-1' }, 'Implementation'))
    listeners.get('workflow/log')?.forEach(listener => listener({ id: 'workflow-1' }, 'Reading project files'))
    listeners.get('workflow/agent-start')?.forEach(listener => listener({ id: 'workflow-1' }, { seq: 1, label: 'worker' }))
    expect(chunks.map(({ text }) => text).join('')).toContain('Reading project files')
    expect(chunks.map(({ text }) => text).join('')).toContain('worker started')
    expect(progress).toContain('Implementation')

    result.resolve({ value: 'done', stopReason: 'completed', agentsStarted: 1 })
    expect((await hooks!.done).status).toBe('completed')
  })

  it('uses the selected style for newly accepted policy jobs', async () => {
    const registered: { name: string; execute: (args: { task: string }, exec: any) => Promise<unknown> }[] = []
    const job = { id: 'policy-1234567890abcdef' as JobHandle['id'], append() {}, updateProgress() {} }
    let label = ''
    const result = Promise.withResolvers<WorkflowResult>()
    const started = Promise.withResolvers<void>()
    let workflowRequest: WorkflowStartRequest | undefined
    const owner = { id: 'session-owner' } as WorkflowStartRequest['parent']
    const ctx = {
      inject(_deps: string[], callback: (context: unknown) => void) { callback(this) },
      tools: { register(tool: (typeof registered)[number]) { registered.push(tool) } },
      jobs: { start(input: JobSpec) { label = input.label; input.run(job); return job.id } },
      workflowEngine: { start(input: WorkflowStartRequest) {
        workflowRequest = input
        started.resolve()
        return { id: 'workflow-1' as WorkflowRun['id'], meta: input.meta, result: result.promise, cancel() {}, dispose: async () => {} }
      } },
      on() { return () => {} },
    }
    registerPolicyHost(ctx as never, { style: 'superpowers-style' })
    const receipt = await registered[0]!.execute({ task: 'Implement a verified change' }, {
      agent: owner, callId: 'call-1', rootCallId: 'call-1', signal: new AbortController().signal,
    })
    await started.promise
    expect(receipt).toMatchObject({ jobId: job.id, strategy: 'superpowers-style' })
    expect(label).toContain('superpowers-style')
    expect(workflowRequest?.meta.name).toBe('superpowers-style')
    result.resolve({ value: 'done', stopReason: 'completed', agentsStarted: 1 })
  })
})
