import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { load } from 'js-yaml'

const directory = fileURLToPath(new URL('../..', import.meta.url))

function sources(path: string): { path: string; source: string }[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name)
    return entry.isDirectory() ? sources(child) : entry.name.endsWith('.ts') ? [{ path: child, source: readFileSync(child, 'utf8') }] : []
  })
}

describe('extracted package dependencies', () => {
  it('pinsExactlyTheConsumedPublicDshImports', () => {
    const files = sources(join(directory, 'src'))
    const importsFrom = (sourceFiles: readonly { source: string }[]): string[] => sourceFiles.flatMap(({ source }) =>
      [...source.matchAll(/from\s+['"](@deepseek-ai\/dsh-[^'"]+)['"]/gu)].map(match => match[1]!))
    const hostFiles = files.filter(file => !file.path.includes(`${join(directory, 'src')}\\client\\`))
    const hostImports = [...new Set(importsFrom(hostFiles))].sort()
    const clientImports = [...new Set(importsFrom(files.filter(file => file.path.includes(`${join(directory, 'src')}\\client\\`))))]
      .map(specifier => specifier.split('/').slice(0, 2).join('/')).sort()
    const clientPackages = [...new Set(clientImports)]
    const metadata = JSON.parse(readFileSync(join(directory, 'compatibility.json'), 'utf8')) as {
      dshVersion: string
      requiredDshPeers: string[]
    }
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as {
      peerDependencies: Record<string, string>
      devDependencies: Record<string, string>
      dsh: { client: { inject: string[] } }
    }
    const lockfile = load(readFileSync(join(directory, '../../pnpm-lock.yaml'), 'utf8')) as {
      importers: Record<string, { devDependencies: Record<string, { specifier: string; version: string }> }>
    }
    expect(hostImports).toEqual([...metadata.requiredDshPeers].sort())
    expect(Object.keys(manifest.peerDependencies).filter(name => name.startsWith('@deepseek-ai/dsh-')).sort()).toEqual(hostImports)
    for (const name of hostImports) {
      expect(name.split('/')).toHaveLength(2)
      expect(manifest.peerDependencies[name]).toBe(metadata.dshVersion)
      expect(manifest.devDependencies[name]).toBe(metadata.dshVersion)
      const locked = lockfile.importers['packages/policy-extension']!.devDependencies[name]!
      expect(locked.specifier).toBe(metadata.dshVersion)
      expect(locked.version.split('(')[0]).toBe(metadata.dshVersion)
    }
    expect(clientPackages).toEqual([
      '@deepseek-ai/dsh-client-locale',
      '@deepseek-ai/dsh-client-ui-conversation',
      '@deepseek-ai/dsh-client-ui-renderer',
      '@deepseek-ai/dsh-client-ui-settings',
      '@deepseek-ai/dsh-client-ui-slots',
    ])
    expect(manifest.dsh.client.inject).toEqual(clientPackages.filter(name => name !== '@deepseek-ai/dsh-client-ui-slots'))
    for (const name of clientPackages) {
      expect(manifest.devDependencies[name]).toBe('workspace:*')
      expect(lockfile.importers['packages/policy-extension']!.devDependencies[name]).toMatchObject({ specifier: 'workspace:*' })
    }
  })
})
