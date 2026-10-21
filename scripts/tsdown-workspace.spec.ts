import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseConfigFileTextToJson } from 'typescript'
import config from '../tsdown.config.ts'

describe('root tsdown workspace', () => {
  it('builds the standalone Policy Bundle in both faces', async () => {
    if (typeof config !== 'function') throw new Error('expected an environment-selected tsdown config')
    const host = await config({ env: { DSH_BUILD_FACE: 'host' } })
    const client = await config({ env: { DSH_BUILD_FACE: 'client' } })
    expect(host.workspace).toContain('packages/policy-extension')
    expect(client.workspace).toContain('packages/policy-extension')
  })

  it('includes the standalone Policy Bundle in the Host type program', () => {
    const source = readFileSync(new URL('../tsconfig.host.json', import.meta.url), 'utf8')
    const parsed = parseConfigFileTextToJson('tsconfig.host.json', source)
    expect(parsed.error).toBeUndefined()
    const paths = (parsed.config as { references: { path: string }[] }).references.map(reference => reference.path)
    expect(paths).toContain('./packages/policy-extension')
  })
})
