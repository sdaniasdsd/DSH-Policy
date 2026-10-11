import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { runZcode } from '../src/zcode-run.ts'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

function bench(text = JSON.stringify({ sessionId: 'zcode-session', response: 'native answer', projection: { status: 'idle' } }), lossy = false) {
  const terminate = vi.fn(() => {})
  const waitForExit = vi.fn(async () => true)
  const handle: SubprocessHandle = { stdin: undefined, stdout: undefined, stderr: undefined, control: undefined,
    done: Promise.resolve({ exitCode: 0, signal: null }), terminate, waitForExit,
    collected: { stdout: { readFrom: () => ({ text, lossy, nextOffset: Buffer.byteLength(text) }) } } }
  const spawn = vi.fn((_spec: SubprocessSpawnSpec) => handle)
  class Process extends SubprocessRuntime {
    spawn = spawn
    resolveExecutable = async () => 'zcode'
    terminalEnvironment = async () => ({ platform: 'windows' as const, defaultShell: 'pwsh' })
    spawnTerminal = async () => { throw new Error('unused') }
  }
  return { Process, handle, spawn, terminate, waitForExit }
}

const options = { executable: 'zcode', args: [], env: {}, mode: 'plan' as const, enableWorkflow: true,
  timeoutMs: 5000, graceMs: 100, maxPromptBytes: 8192, maxOutputBytes: 8192 }

describe('native ZCode headless integration', () => {
  it('uses verified CLI flags and drains the original managed range', async () => {
    const b = bench()
    const ctx = new Context(); contexts.push(ctx); await ctx.plugin(b.Process)
    expect(await runZcode(ctx.subprocess, options, 'D:/workspace', 'exact task', new AbortController().signal))
      .toEqual({ sessionId: 'zcode-session', output: 'native answer', stopReason: 'completed' })
    expect(b.spawn.mock.calls[0]?.[0].argv).toEqual(['zcode', '--prompt', 'exact task', '--output-format', 'json', '--no-color', '--mode', 'plan', '--enable-workflow'])
    expect(b.terminate).toHaveBeenCalledOnce()
    expect(b.waitForExit).toHaveBeenCalledOnce()
  })
  it.each([
    ['truncated', '{}', true],
    ['invalid', 'not-json', false],
    ['waiting', JSON.stringify({ sessionId: 'native', response: 'permission needed', projection: { status: 'waiting' } }), false],
  ])('refuses %s output rather than reporting completion', async (_name, text, lossy) => {
    const b = bench(text, lossy)
    const ctx = new Context(); contexts.push(ctx); await ctx.plugin(b.Process)
    await expect(runZcode(ctx.subprocess, options, 'D:/workspace', 'task', new AbortController().signal)).rejects.toThrow()
    expect(b.waitForExit).toHaveBeenCalledOnce()
  })
  it('rejects oversized prompts before spawning', async () => {
    const b = bench()
    const ctx = new Context(); contexts.push(ctx); await ctx.plugin(b.Process)
    await expect(runZcode(ctx.subprocess, { ...options, maxPromptBytes: 3 }, 'D:/workspace', '太长', new AbortController().signal)).rejects.toThrow('prompt')
    expect(b.spawn).not.toHaveBeenCalled()
  })
  it.each(['cancel', 'deadline'] as const)('reports %s even when the process exits zero during termination', async (kind) => {
    const b = bench()
    const done = Promise.withResolvers<{ exitCode: number; signal: null }>()
    b.spawn.mockImplementation((spec) => {
      spec.signal!.addEventListener('abort', () => done.resolve({ exitCode: 0, signal: null }), { once: true })
      return { ...b.handle, done: done.promise }
    })
    const ctx = new Context(); contexts.push(ctx); await ctx.plugin(b.Process)
    const controller = new AbortController()
    const pending = runZcode(ctx.subprocess, { ...options, timeoutMs: kind === 'deadline' ? 5 : 5000 }, 'D:/workspace', 'task', controller.signal)
    if (kind === 'cancel') controller.abort(new Error('user cancelled'))
    await expect(pending).rejects.toThrow(kind === 'cancel' ? 'user cancelled' : 'timed out')
    expect(b.terminate).toHaveBeenCalledOnce()
    expect(b.waitForExit).toHaveBeenCalledOnce()
  })
})
