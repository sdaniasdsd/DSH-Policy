import { describe, expect, it } from 'vitest'
import { Config } from '../src/config.ts'

describe('Policy extension configuration', () => {
  it('defaults new Policy jobs to Codex style and rejects unknown styles', () => {
    expect(Config({})).toEqual({ style: 'codex-style' })
    expect(() => Config({ style: 'unknown-style' })).toThrow()
  })
})
