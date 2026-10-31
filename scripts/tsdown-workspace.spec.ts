import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseConfigFileTextToJson } from 'typescript'

interface WorkspaceBuildConfig {
  readonly workspace: {
    readonly include: readonly string[]
    readonly exclude: readonly string[]
  }
}

type WorkspaceBuildConfigFactory = (
  inlineConfig: { readonly env: Record<string, string> },
  context: { readonly ci: boolean },
) => WorkspaceBuildConfig | readonly WorkspaceBuildConfig[] | Promise<WorkspaceBuildConfig | readonly WorkspaceBuildConfig[]>

describe('root tsdown workspace', () => {
  it('keeps the standalone Policy Bundle on its own package build', async () => {
    const configPath = fileURLToPath(new URL('../tsdown.config.ts', import.meta.url))
    const module = await import(configPath) as { default: WorkspaceBuildConfigFactory }
    const hostConfigs = await module.default({ env: { DSH_BUILD_FACE: 'host' } }, { ci: false })
    const clientConfigs = await module.default({ env: { DSH_BUILD_FACE: 'client' } }, { ci: false })
    const host = Array.isArray(hostConfigs) ? hostConfigs[0] : hostConfigs
    const client = Array.isArray(clientConfigs) ? clientConfigs[0] : clientConfigs
    if (host === undefined || client === undefined) throw new Error('expected a workspace build config for both faces')
    expect(host.workspace.exclude).toContain('packages/policy-extension')
    expect(client.workspace.exclude).toContain('packages/policy-extension')
  })

  it('includes the standalone Policy Bundle in the Host type program', () => {
    const source = readFileSync(new URL('../tsconfig.host.json', import.meta.url), 'utf8')
    const parsed = parseConfigFileTextToJson('tsconfig.host.json', source)
    expect(parsed.error).toBeUndefined()
    const paths = (parsed.config as { references: { path: string }[] }).references.map(reference => reference.path)
    expect(paths).toContain('./packages/policy-extension')
  })
})
