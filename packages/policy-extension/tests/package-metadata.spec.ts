import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import * as yaml from 'js-yaml'

const packageDirectory = fileURLToPath(new URL('..', import.meta.url))
const compatibility = JSON.parse(readFileSync(new URL('../compatibility.json', import.meta.url), 'utf8')) as {
  dshVersion: string
  requiredDshPeers: string[]
}

interface PackageManifest {
  name: string
  version: string
  engines: { dsh: string }
  dsh: { bundle: { patch: string }; client: { platform: string; inject?: string[] } }
  exports: Record<string, { default: string } | string>
  peerDependencies: Record<string, string>
  devDependencies: Record<string, string>
  dependencies?: Record<string, string>
}

function manifest(): PackageManifest {
  return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as PackageManifest
}

describe('Policy extension package', () => {
  it('packageMetadataDeclaresAnOfficialBundle', () => {
    const pkg = manifest()
    expect(pkg.name).toBe('@deepseek-ai/dsh-policy-extension')
    expect(pkg.version).toBe('1.0.4')
    expect(pkg.engines?.dsh).toBe('0.2.1-rc.2')
    expect(pkg.dsh?.bundle?.patch).toBe('./dsh.bundle.patch.yml')
    expect(pkg.dsh?.client?.platform).toBe('web')
    expect(pkg.dsh.client.inject).toEqual([
      '@deepseek-ai/dsh-client-locale',
      '@deepseek-ai/dsh-client-ui-conversation',
      '@deepseek-ai/dsh-client-ui-renderer',
      '@deepseek-ai/dsh-client-ui-settings',
    ])
    expect(pkg.exports['.']).toMatchObject({ default: './lib/index.js' })
    expect(pkg.exports['./client']).toMatchObject({ default: './lib/client.js' })
    const patch = yaml.load(readFileSync(new URL('../dsh.bundle.patch.yml', import.meta.url), 'utf8'), {
      schema: entryListSchema,
    })
    expect(patch).toEqual([{ insert: [
      { id: 'policy-extension', name: '@deepseek-ai/dsh-policy-extension' },
    ] }])
  })

  it('publishedPeersAreExact', () => {
    const pkg = manifest()
    const dshPeers = Object.entries(pkg.peerDependencies ?? {})
      .filter(([name]) => name.startsWith('@deepseek-ai/dsh-'))
    expect(dshPeers.map(([name]) => name).sort()).toEqual([...compatibility.requiredDshPeers].sort())
    for (const [name, version] of dshPeers) {
      expect(version).toBe(compatibility.dshVersion)
      expect(pkg.devDependencies?.[name]).toBe(compatibility.dshVersion)
    }
  })

  it('packedTarballHasNoWorkspacePeerRanges', () => {
    const destination = mkdtempSync(join(tmpdir(), 'dsh policy pack '))
    try {
      const pnpmCli = process.env.npm_execpath
      if (!pnpmCli) throw new Error('run this spec through pnpm exec')
      const packedResult = spawnSync(process.execPath, [pnpmCli, 'pack', '--pack-destination', destination], {
        cwd: packageDirectory,
        encoding: 'utf8',
      })
      expect(packedResult.status, packedResult.stderr || packedResult.stdout).toBe(0)
      const tarballs = readdirSync(destination).filter(name => name.endsWith('.tgz'))
      expect(tarballs).toHaveLength(1)
      const tarball = join(destination, tarballs[0]!)
      const files = execFileSync('tar', ['-tf', tarball], { encoding: 'utf8' }).split(/\r?\n/u)
      expect(files).toContain('package/dsh.bundle.patch.yml')
      expect(files).toContain('package/lib/index.js')
      expect(files).toContain('package/lib/client.js')
      const packed = JSON.parse(execFileSync('tar', ['-xOf', tarball, 'package/package.json'], {
        encoding: 'utf8',
      })) as PackageManifest
      const packedCompatibility = JSON.parse(execFileSync('tar', ['-xOf', tarball, 'package/compatibility.json'], {
        encoding: 'utf8',
      })) as typeof compatibility & { policyVersion: string; dshTag: string; dshCommit: string; runtimeBuildCommit: string }
      expect(packed.name).toBe('@deepseek-ai/dsh-policy-extension')
      expect(packed.version).toBe('1.0.4')
      expect(packed.engines.dsh).toBe('0.2.1-rc.2')
      expect(packedCompatibility).toMatchObject({
        policyVersion: '1.0.4',
        dshVersion: '0.2.1-rc.2',
        dshTag: 'dsh-v0.2.1-rc.2',
        dshCommit: '687f282e8625c6b8d11ff58211a90524be2e4317',
        runtimeBuildCommit: '332895e0f7c9d4dbfb29729f5eb367fa263ff986',
      })
      expect(packed.dsh?.bundle?.patch).toBe('./dsh.bundle.patch.yml')
      const client = execFileSync('tar', ['-xOf', tarball, 'package/lib/client.js'], {
        encoding: 'utf8',
      })
      expect(client).toContain('policy.style')
      expect(client).toContain('策略风格')
      expect(client).toContain('superpowers-style')
      expect(client).toContain('exports.inject')
      const packedDshPeers = Object.entries(packed.peerDependencies)
        .filter(([name]) => name.startsWith('@deepseek-ai/dsh-'))
      expect(packedDshPeers.map(([name]) => name).sort()).toEqual([...packedCompatibility.requiredDshPeers].sort())
      expect(packedDshPeers.every(([, version]) => version === '0.2.1-rc.2')).toBe(true)
      for (const section of [packed.peerDependencies, packed.dependencies ?? {}, packed.devDependencies]) {
        expect(Object.values(section).some(version => version.startsWith('workspace:'))).toBe(false)
      }
    } finally {
      rmSync(destination, { recursive: true, force: true })
    }
  })
})
