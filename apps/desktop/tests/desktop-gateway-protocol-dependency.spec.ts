import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const desktopRoot = fileURLToPath(new URL('../', import.meta.url))

describe('Desktop API Gateway protocol dependency', () => {
  it('resolves isRemoteJsonValue from the packaged desktop dependency root', async () => {
    expect(() => execFileSync(process.execPath, ['--input-type=module', '-e', `
      import { isRemoteJsonValue } from '@deepseek-ai/dsh-typert-protocol'
      await import('@deepseek-ai/dsh-api-gateway/stream-protocol')
      if (typeof isRemoteJsonValue !== 'function') throw new Error('isRemoteJsonValue export missing')
    `], { cwd: desktopRoot, stdio: 'pipe' })).not.toThrow()
  })
})
