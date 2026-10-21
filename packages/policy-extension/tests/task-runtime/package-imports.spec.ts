import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { load } from 'js-yaml'

const directory = fileURLToPath(new URL('../..', import.meta.url))

function sources(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name)
    return entry.isDirectory() ? sources(child) : entry.name.endsWith('.ts') ? [readFileSync(child, 'utf8')] : []
  })
}

describe('extracted package dependencies', () => {
  it('pinsExactlyTheConsumedPublicDshImports', () => {
    const imports = sources(join(directory, 'src')).flatMap(source => [...source.matchAll(/from\s+['"](@deepseek-ai\/dsh-[^'"]+)['"]/gu)]
      .map(match => match[1]!))
    const consumed = [...new Set(imports)].sort()
    const metadata = JSON.parse(readFileSync(join(directory, 'compatibility.json'), 'utf8')) as {
      dshVersion: string
      requiredDshPeers: string[]
    }
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as {
      peerDependencies: Record<string, string>
      devDependencies: Record<string, string>
    }
    const lockfile = load(readFileSync(join(directory, '../../pnpm-lock.yaml'), 'utf8')) as {
      importers: Record<string, { devDependencies: Record<string, { specifier: string; version: string }> }>
    }
    expect(consumed).toEqual([...metadata.requiredDshPeers].sort())
    expect(Object.keys(manifest.peerDependencies).filter(name => name.startsWith('@deepseek-ai/dsh-')).sort()).toEqual(consumed)
    for (const name of consumed) {
      expect(name.split('/')).toHaveLength(2)
      expect(manifest.peerDependencies[name]).toBe(metadata.dshVersion)
      expect(manifest.devDependencies[name]).toBe(metadata.dshVersion)
      const locked = lockfile.importers['packages/policy-extension']!.devDependencies[name]!
      expect(locked.specifier).toBe(metadata.dshVersion)
      expect(locked.version.split('(')[0]).toBe(metadata.dshVersion)
    }
  })
})
