import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

const [archiveInput, expectedVersion, outputDirectoryInput] = process.argv.slice(2)
if (!archiveInput || !expectedVersion || !outputDirectoryInput) {
  throw new Error('Usage: node verify-release-package.mjs <archive.tgz> <expected-version> <output-directory>')
}

const archive = resolve(archiveInput)
const outputDirectory = resolve(outputDirectoryInput)
const archiveEntries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' })
  .split(/\r?\n/u)
  .filter(Boolean)
const entries = new Set(archiveEntries)

function readArchiveJson(path) {
  return JSON.parse(execFileSync('tar', ['-xOzf', archive, `package/${path}`], { encoding: 'utf8' }))
}

function requireEntry(path) {
  if (!entries.has(`package/${path}`)) throw new Error(`Packed archive is missing package/${path}`)
}

const manifest = readArchiveJson('package.json')
const compatibility = readArchiveJson('compatibility.json')
if (manifest.name !== '@deepseek-ai/dsh-policy-extension') throw new Error(`Unexpected package name: ${manifest.name}`)
if (manifest.version !== expectedVersion) throw new Error(`Packed version ${manifest.version} differs from tag version ${expectedVersion}`)
if (manifest.engines?.dsh !== compatibility.dshVersion) throw new Error('engines.dsh and compatibility.dshVersion differ')
if (compatibility.policyVersion !== manifest.version) throw new Error('compatibility.policyVersion and package version differ')
if (!/^[0-9a-f]{40}$/i.test(compatibility.runtimeBuildCommit)) throw new Error('Package compatibility metadata has no exact DSH runtime build commit')
if (!/^[0-9a-f]{40}$/i.test(compatibility.dshCommit)) throw new Error('Package compatibility metadata has no upstream DSH source-tag commit')
if (manifest.repository?.url !== 'git+https://github.com/sdaniasdsd/DSH-Policy.git') throw new Error('Package repository metadata does not identify the authorized DSH-Policy repository')
if (!manifest.dsh?.bundle?.patch || !manifest.exports?.['.']?.default || !manifest.exports?.['./client']?.default) {
  throw new Error('Package manifest is missing its official Bundle patch or Host/Client entry points')
}

const requiredFiles = [
  manifest.dsh.bundle.patch.replace(/^\.\//u, ''),
  'compatibility.json',
  manifest.exports['.'].default.replace(/^\.\//u, ''),
  manifest.exports['./client'].default.replace(/^\.\//u, ''),
]
for (const path of requiredFiles) requireEntry(path)
if (!archiveEntries.some(path => path.startsWith('package/lib/types/') && path.endsWith('.d.ts'))) {
  throw new Error('Packed archive is missing generated TypeScript declaration files')
}

const forbiddenLifecycleScripts = new Set([
  'prepublish', 'prepare', 'prepublishOnly', 'prepack', 'postpack', 'publish', 'postpublish',
  'preinstall', 'install', 'postinstall',
])
for (const name of Object.keys(manifest.scripts ?? {})) {
  if (forbiddenLifecycleScripts.has(name)) throw new Error(`Package defines a lifecycle script: ${name}`)
}

const peerDependencies = manifest.peerDependencies ?? {}
const dshPeerNames = Object.keys(peerDependencies).filter(name => name.startsWith('@deepseek-ai/dsh-')).sort()
const expectedPeerNames = [...(compatibility.requiredDshPeers ?? [])].sort()
if (JSON.stringify(dshPeerNames) !== JSON.stringify(expectedPeerNames)) {
  throw new Error('Published DSH peer set differs from compatibility.requiredDshPeers')
}
for (const name of dshPeerNames) {
  if (peerDependencies[name] !== compatibility.dshVersion) {
    throw new Error(`DSH peer ${name} is not pinned exactly to ${compatibility.dshVersion}`)
  }
}
for (const section of [manifest.dependencies ?? {}, manifest.peerDependencies ?? {}, manifest.devDependencies ?? {}]) {
  for (const [name, version] of Object.entries(section)) {
    if (typeof version !== 'string' || version.startsWith('workspace:')) {
      throw new Error(`Invalid published dependency declaration: ${name}@${version}`)
    }
  }
}

mkdirSync(outputDirectory, { recursive: true })
const assetName = `dsh-policy-extension-${manifest.version}.tgz`
const assetPath = join(outputDirectory, assetName)
copyFileSync(archive, assetPath)
console.log(JSON.stringify({
  asset: basename(assetPath),
  version: manifest.version,
  dshVersion: compatibility.dshVersion,
  dshPeers: dshPeerNames,
}))
