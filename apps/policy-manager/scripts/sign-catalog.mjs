import { createPrivateKey, createPublicKey, randomUUID, sign, verify } from 'node:crypto'
import { open, readFile, rename, unlink } from 'node:fs/promises'

const [catalogPath, signaturePath, option] = process.argv.slice(2)
const signingSeed = process.env.DSH_POLICY_CATALOG_SIGNING_KEY
const configuredPublicKey = process.env.DSH_POLICY_CATALOG_PUBLIC_KEY

function fail(message) {
  throw new Error(message)
}

async function main() {
  if (!catalogPath || !signaturePath || process.argv.length > 5) {
    fail('usage: node sign-catalog.mjs <catalog.json> <signature.sig> [--require-installable-release]')
  }
  if (option && option !== '--require-installable-release') fail('unsupported signing option')
  if (!signingSeed || !/^[0-9a-fA-F]{64}$/.test(signingSeed)) {
    fail('DSH_POLICY_CATALOG_SIGNING_KEY must be a 32-byte hexadecimal Ed25519 seed')
  }
  if (!configuredPublicKey || !/^[0-9a-fA-F]{64}$/.test(configuredPublicKey)) {
    fail('DSH_POLICY_CATALOG_PUBLIC_KEY must be a 32-byte hexadecimal key')
  }

  const seed = Buffer.from(signingSeed, 'hex')
  const privateKey = createPrivateKey({
    key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]),
    format: 'der',
    type: 'pkcs8',
  })
  const publicKeyDer = createPublicKey(privateKey).export({ format: 'der', type: 'spki' })
  const derivedPublicKey = publicKeyDer.subarray(-32)
  if (!derivedPublicKey.equals(Buffer.from(configuredPublicKey, 'hex'))) {
    fail('signing seed does not match the configured public key')
  }

  const catalogBytes = await readFile(catalogPath)
  let catalog
  try {
    catalog = JSON.parse(catalogBytes.toString('utf8'))
  } catch {
    fail('catalog is not valid UTF-8 JSON')
  }
  if (catalog.schemaVersion !== 1
    || !Number.isSafeInteger(catalog.catalogRevision)
    || catalog.catalogRevision <= 0
    || !Number.isSafeInteger(catalog.expiresAt)
    || catalog.expiresAt <= Math.floor(Date.now() / 1000)
    || !Array.isArray(catalog.desktopReleases)) {
    fail('catalog fields are invalid or expired')
  }
  if (option === '--require-installable-release' && catalog.desktopReleases.length === 0) {
    fail('cannot publish a manager release with an empty install catalog')
  }
  const identities = new Set()
  for (const release of catalog.desktopReleases) {
    if (release.os !== 'windows'
      || release.architecture !== 'x86_64'
      || typeof release.desktopVersion !== 'string'
      || !release.desktopVersion.trim()
      || typeof release.runtimeVersion !== 'string'
      || !release.runtimeVersion.trim()
      || !/^[0-9a-fA-F]{40}$/.test(release.runtimeCommit)
      || !/^[0-9a-fA-F]{64}$/.test(release.sha256)
      || release.installerProfile !== 'nsis'
      || !isOfficialInstallerUrl(release.installerUrl)
      || !Array.isArray(release.policies)) {
      fail('catalog contains a release with an unsupported or incomplete installer identity')
    }
    const identity = `${release.os}/${release.architecture}/${release.desktopVersion}`
    if (identities.has(identity)) fail('catalog contains a duplicate Desktop release')
    identities.add(identity)
    const policyVersions = new Set()
    for (const policy of release.policies) {
      if (policy.package !== '@deepseek-ai/dsh-policy-extension'
        || typeof policy.version !== 'string'
        || !policy.version.trim()
        || policy.runtimeVersion !== release.runtimeVersion
        || policy.runtimeCommit !== release.runtimeCommit
        || policyVersions.has(policy.version)) {
        fail('catalog contains an invalid exact Policy compatibility mapping')
      }
      policyVersions.add(policy.version)
    }
  }

  const signature = sign(null, catalogBytes, privateKey)
  const publicKey = createPublicKey(privateKey)
  if (signature.length !== 64 || !verify(null, catalogBytes, publicKey, signature)) {
    fail('catalog signature could not be verified')
  }
  const temporaryPath = `${signaturePath}.${randomUUID()}.tmp`
  try {
    const output = await open(temporaryPath, 'wx', 0o600)
    try {
      await output.writeFile(signature)
      await output.sync()
    } finally {
      await output.close()
    }
    await rename(temporaryPath, signaturePath)
  } catch (error) {
    await unlink(temporaryPath).catch(() => {})
    throw error
  }
  console.log(`Signed and verified catalog revision ${catalog.catalogRevision}.`)
}

main().catch(error => {
  console.error(`Catalog signing failed: ${error instanceof Error ? error.message : 'unknown error'}`)
  process.exitCode = 1
})

function isOfficialInstallerUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
      && url.hostname === 'download.deepseek.com'
      && !url.username
      && !url.password
      && !url.port
      && !url.search
      && !url.hash
  } catch {
    return false
  }
}
