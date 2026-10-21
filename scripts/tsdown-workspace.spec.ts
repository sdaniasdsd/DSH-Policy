import { describe, expect, it } from 'vitest'
import config from '../tsdown.config.ts'

describe('root tsdown workspace', () => {
  it('builds the standalone Policy Bundle in both faces', async () => {
    if (typeof config !== 'function') throw new Error('expected an environment-selected tsdown config')
    const host = await config({ env: { DSH_BUILD_FACE: 'host' } })
    const client = await config({ env: { DSH_BUILD_FACE: 'client' } })
    expect(host.workspace).toContain('packages/policy-extension')
    expect(client.workspace).toContain('packages/policy-extension')
  })
})
