import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createPrivateKey, createPublicKey, verify } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const signer = path.join(appRoot, 'scripts', 'sign-catalog.mjs')
const workflowPath = path.join(root, '.github', 'workflows', 'policy-manager-windows.yml')
const smokePath = path.join(appRoot, 'tests', 'windows-manager-smoke.ps1')
const capabilityPath = path.join(appRoot, 'src-tauri', 'capabilities', 'default.json')
const fixturePath = path.join(appRoot, 'tests', 'fixtures', 'catalog')

function keyPairFromSeed(seed) {
  const privateKey = createPrivateKey({
    key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]),
    format: 'der',
    type: 'pkcs8',
  })
  const publicDer = createPublicKey(privateKey).export({ format: 'der', type: 'spki' })
  return { privateKey, publicHex: publicDer.subarray(-32).toString('hex') }
}

function runSigner(catalogPath, signaturePath, seedHex, publicHex, extraArgs = [], extraEnv = {}) {
  return spawnSync(process.execPath, [signer, catalogPath, signaturePath, ...extraArgs], {
    encoding: 'utf8',
    env: {
      ...process.env,
      DSH_POLICY_CATALOG_SIGNING_KEY: seedHex,
      DSH_POLICY_CATALOG_PUBLIC_KEY: publicHex,
      ...extraEnv,
    },
  })
}

test('catalog signer writes raw Ed25519 bytes and never prints either key', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'dsh-policy-release-test-'))
  try {
    const seed = Buffer.from('81'.repeat(32), 'hex')
    const pair = keyPairFromSeed(seed)
    const catalogPath = path.join(directory, 'manager-catalog.json')
    const signaturePath = path.join(directory, 'manager-catalog.json.sig')
    const catalog = {
      schemaVersion: 1,
      catalogRevision: 9,
      expiresAt: Math.floor(Date.now() / 1000) + 86400,
      desktopReleases: [{
        os: 'windows', architecture: 'x86_64', desktopVersion: '1.2.3',
        runtimeVersion: '0.2.1', runtimeCommit: 'a'.repeat(40),
        installerUrl: 'https://download.deepseek.com/dsh-latest-windows-x64.exe',
        sha256: 'b'.repeat(64), installerProfile: 'nsis', policies: [],
      }],
    }
    const bytes = Buffer.from(JSON.stringify(catalog))
    writeFileSync(catalogPath, bytes)
    const result = runSigner(catalogPath, signaturePath, seed.toString('hex'), pair.publicHex, ['--require-installable-release'])
    assert.equal(result.status, 0, result.stderr)
    const signature = readFileSync(signaturePath)
    assert.equal(signature.length, 64)
    assert.equal(verify(null, bytes, pair.privateKey, signature), true)
    assert.equal(result.stdout.includes(seed.toString('hex')), false)
    assert.equal(result.stdout.includes(pair.publicHex), false)
    assert.equal(result.stderr.includes(seed.toString('hex')), false)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('catalog signer fails closed when the signing seed does not match the embedded key', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'dsh-policy-release-test-'))
  try {
    const seed = Buffer.from('82'.repeat(32), 'hex')
    const wrongSeed = Buffer.from('83'.repeat(32), 'hex')
    const pair = keyPairFromSeed(seed)
    const catalogPath = path.join(directory, 'manager-catalog.json')
    const signaturePath = path.join(directory, 'manager-catalog.json.sig')
    writeFileSync(catalogPath, JSON.stringify({
      schemaVersion: 1,
      catalogRevision: 1,
      expiresAt: Math.floor(Date.now() / 1000) + 86400,
      desktopReleases: [],
    }))
    const result = runSigner(catalogPath, signaturePath, wrongSeed.toString('hex'), pair.publicHex)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /signing seed does not match the configured public key/)
    assert.equal(existsSync(signaturePath), false)
    assert.equal(result.stderr.includes(wrongSeed.toString('hex')), false)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('catalog signer refuses to publish an empty install catalog', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'dsh-policy-release-test-'))
  try {
    const seed = Buffer.from('84'.repeat(32), 'hex')
    const pair = keyPairFromSeed(seed)
    const catalogPath = path.join(directory, 'manager-catalog.json')
    const signaturePath = path.join(directory, 'manager-catalog.json.sig')
    writeFileSync(catalogPath, JSON.stringify({
      schemaVersion: 1,
      catalogRevision: 1,
      expiresAt: Math.floor(Date.now() / 1000) + 86400,
      desktopReleases: [],
    }))
    const result = runSigner(catalogPath, signaturePath, seed.toString('hex'), pair.publicHex, ['--require-installable-release'])
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /empty install catalog/)
    assert.equal(existsSync(signaturePath), false)
    assert.equal(result.stderr.includes(seed.toString('hex')), false)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('catalog signer refuses unsupported installer metadata before signing', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'dsh-policy-release-test-'))
  try {
    const seed = Buffer.from('85'.repeat(32), 'hex')
    const pair = keyPairFromSeed(seed)
    const catalogPath = path.join(directory, 'manager-catalog.json')
    const signaturePath = path.join(directory, 'manager-catalog.json.sig')
    writeFileSync(catalogPath, JSON.stringify({
      schemaVersion: 1,
      catalogRevision: 1,
      expiresAt: Math.floor(Date.now() / 1000) + 86400,
      desktopReleases: [{
        os: 'windows', architecture: 'x86_64', desktopVersion: '1.2.3',
        runtimeVersion: '0.2.1', runtimeCommit: 'a'.repeat(40),
        installerUrl: 'https://attacker.example/setup.exe', sha256: 'b'.repeat(64),
        installerProfile: 'nsis', policies: [],
      }],
    }))
    const result = runSigner(catalogPath, signaturePath, seed.toString('hex'), pair.publicHex)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /unsupported or incomplete installer identity/)
    assert.equal(existsSync(signaturePath), false)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('Windows release workflow requires protected keys and runs manager qualification', () => {
  const workflow = readFileSync(workflowPath, 'utf8')
  assert.match(workflow, /DSH_POLICY_CATALOG_PUBLIC_KEY/)
  assert.match(workflow, /DSH_POLICY_CATALOG_SIGNING_KEY/)
  assert.match(workflow, /contents:\s*write/)
  assert.match(workflow, /cargo test/)
  assert.match(workflow, /windows-manager-smoke\.ps1/)
  assert.match(workflow, /publish:[\s\S]*?needs:\s*verify/)
  assert.match(workflow, /sign-catalog\.mjs/)
  assert.equal(workflow.includes('BEGIN PRIVATE KEY'), false)
})

test('Tauri window receives only the core IPC capability', () => {
  const capability = JSON.parse(readFileSync(capabilityPath, 'utf8'))
  assert.deepEqual(capability.windows, ['main'])
  assert.deepEqual(capability.permissions, ['core:default'])
})

test('packaged smoke test isolates both Harness home and manager data', () => {
  const smoke = readFileSync(smokePath, 'utf8')
  assert.match(smoke, /DSH_HOME/)
  assert.match(smoke, /LOCALAPPDATA/)
  assert.match(smoke, /TEMP|GetTempPath/)
  assert.match(smoke, /cargo test/)
  assert.match(smoke, /--test recovery_descriptor/)
  assert.match(smoke, /finally/i)
})

test('unsigned release fixture contains detached raw signature bytes for rejection tests', () => {
  const unsignedCatalog = readFileSync(path.join(fixturePath, 'unsigned-catalog.json'))
  const unsignedSignature = readFileSync(path.join(fixturePath, 'unsigned-catalog.json.sig'))
  assert.equal(JSON.parse(unsignedCatalog.toString('utf8')).schemaVersion, 1)
  assert.equal(unsignedSignature.length, 64)
  assert.equal(unsignedSignature.every(byte => byte === 0), true)
})
