/** Native ZCode CLI execution through the original managed subprocess service. */
import type Subprocess from '@deepseek-ai/dsh-subprocess'
import { z } from 'zod'
import type { ChildResult } from './types.ts'

/** Explicit launch and resource limits for the upstream headless protocol. */
export interface ZcodeRunSpec {
  readonly executable: string
  readonly args: string[]
  readonly env: Record<string, string>
  readonly mode: 'plan' | 'build' | 'edit' | 'yolo'
  readonly enableWorkflow: boolean
  readonly timeoutMs: number
  readonly graceMs: number
  readonly maxPromptBytes: number
  readonly maxOutputBytes: number
}

const resultSchema = z.object({ sessionId: z.string().min(1), response: z.string(),
  projection: z.object({ status: z.enum(['idle', 'running', 'waiting', 'paused', 'completed', 'error']) }),
})

/**
 * Execute one native ZCode orchestration and release its entire managed process range.
 * @param subprocess - original DSH process service; no shell or independent process manager.
 * @param spec - explicit launch choices and bounds.
 * @param cwd - original task owner's workspace.
 * @param prompt - framed task and retained prior-stage results.
 * @param signal - task cancellation, also checked after a nominally successful exit.
 * @returns validated final native response; rejects partial, failed or truncated output.
 */
export async function runZcode(
  subprocess: Subprocess, spec: ZcodeRunSpec, cwd: string, prompt: string, signal: AbortSignal,
): Promise<ChildResult> {
  signal.throwIfAborted()
  if (Buffer.byteLength(prompt, 'utf8') > spec.maxPromptBytes) throw new Error('ZCode prompt exceeds configured byte limit')
  const argv = [spec.executable, ...spec.args, '--prompt', prompt, '--output-format', 'json', '--no-color', '--mode', spec.mode,
    ...spec.enableWorkflow ? ['--enable-workflow'] : []]
  // Windows CreateProcess has a fixed UTF-16 command-line ceiling; quoting consumes additional space.
  if (process.platform === 'win32' && argv.reduce((size, arg) => size + 2 * arg.length + 3, 0) >= 32767) {
    throw new Error('ZCode prompt and launch arguments exceed the Windows command-line limit')
  }
  const deadline = new AbortController()
  const combined = AbortSignal.any([signal, deadline.signal])
  const timer = setTimeout(() => deadline.abort(new Error('ZCode execution timed out')), spec.timeoutMs)
  let handle: ReturnType<Subprocess['spawn']> | undefined
  try {
    handle = subprocess.spawn({ argv, cwd, env: spec.env, signal: combined, graceMs: spec.graceMs,
      stdio: { stdin: 'ignore', stdout: { maxBytes: spec.maxOutputBytes }, stderr: { maxBytes: spec.maxOutputBytes } } })
    const outcome = await handle.done
    combined.throwIfAborted()
    if (outcome.exitCode !== 0 || outcome.signal !== null) throw new Error(`ZCode process failed (exit ${outcome.exitCode}, signal ${outcome.signal})`)
    const collector = handle.collected.stdout
    if (collector === undefined) throw new Error('ZCode output collector is unavailable')
    const output = collector.readFrom(0)
    if (output.lossy) throw new Error('ZCode output exceeds configured byte limit')
    let value: unknown
    try { value = JSON.parse(output.text) }
    catch (error) { throw new Error('ZCode returned invalid JSON', { cause: error }) }
    const parsed = resultSchema.safeParse(value)
    if (!parsed.success) throw new Error('ZCode returned an invalid result envelope')
    if (parsed.data.projection.status !== 'idle' && parsed.data.projection.status !== 'completed') {
      throw new Error(`ZCode did not complete: ${parsed.data.projection.status}`)
    }
    return { sessionId: parsed.data.sessionId, stopReason: 'completed', output: parsed.data.response }
  } finally {
    clearTimeout(timer)
    if (handle !== undefined) { handle.terminate(); await handle.waitForExit() }
  }
}
