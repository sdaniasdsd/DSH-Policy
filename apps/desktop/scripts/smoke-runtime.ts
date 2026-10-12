/** Boot the materialized target runtime without access to a user's Harness profile. */

import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { readPrimaryRuntime, workspaceDependencyPaths } from '../../../packages/skill/tool-workspace-dependencies/src/index.ts'
import { DesktopHostProcess } from '../src/host-process.ts'
import { createPluginProfile } from '../src/project-manager.ts'
import type { DesktopRuntimeDescriptor } from '../src/runtime-tree.ts'

/**
 * Check CLI package operations, Host startup, its frontend, external plugins and real Office-to-PDF conversion.
 * @param root - Materialized dsh resources.
 * @param node - Prepared target Electron executable.
 * @param runtime - Verified resource descriptor.
 * @param environment - Credential-scrubbed build environment and private native cache.
 * @param resourcesRuntime - Bundled interpreters outside the application archive.
 * @returns Resolves after checks and teardown; rejects on a check or teardown failure.
 */
export async function smokeDesktopRuntime(
  root: string, node: string, runtime: DesktopRuntimeDescriptor, environment: NodeJS.ProcessEnv, resourcesRuntime: string,
): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), 'dsh-desktop-smoke-'))
  const profile = join(home, 'profiles', 'desktop')
  // The verified descriptor works for both directories and Electron's virtual ASAR tree.
  const policyEdition = runtime.files.some(file => file.path === 'policy-workflows.patch.yml')
  const hostEnvironment = {
    ...Object.fromEntries(Object.entries(environment).filter(([name]) => !/^(?:npm|pnpm|corepack)_/iu.test(name))),
    DSH_HOME: home, HOME: home, USERPROFILE: home,
    XDG_CONFIG_HOME: home, XDG_CACHE_HOME: home, XDG_STATE_HOME: home,
    APPDATA: home, LOCALAPPDATA: home,
    npm_config_userconfig: join(home, 'npmrc'), npm_config_globalconfig: join(home, 'npmrc'),
    npm_config_store_dir: join(home, 'store'), npm_config_enable_global_virtual_store: 'false',
  }
  const host = new DesktopHostProcess(node, root, profile, undefined, hostEnvironment,
    undefined, join(resourcesRuntime, 'primary-runtime'),
    { pnpm: join(resourcesRuntime, 'primary-runtime', 'dependencies', 'pnpm', 'bin', 'pnpm.mjs'), nodeBin: join(resourcesRuntime, 'bin') })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    writeFileSync(join(home, 'npmrc'), '')
    createPluginProfile(profile, root)
    const pluginName = 'desktop-runtime-smoke-plugin'
    const plugin = join(home, pluginName)
    mkdirSync(plugin, { recursive: true })
    const installedName = 'desktop-installed-smoke-plugin'
    const installedPlugin = join(home, installedName)
    mkdirSync(installedPlugin)
    writeFileSync(join(installedPlugin, 'package.json'), JSON.stringify({
      name: installedName, version: '1.0.0', type: 'module', exports: './index.js', dsh: { bundle: { patch: './bundle.yml' } },
    }))
    writeFileSync(join(installedPlugin, 'index.js'), `
export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/desktop-smoke-installed',
    handler(_request, response) { response.end('installed plugin ready') } }))
}
`)
    writeFileSync(join(installedPlugin, 'bundle.yml'), `- insert:\n    - id: ${installedName}\n      name: ${installedName}\n      inject: [webServer]\n`)
    appendFileSync(join(profile, 'pnpm-workspace.yaml'), 'offline: true\nupdateNotifier: false\n')
    const cli = join(root, 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js')
    const runCli = (args: string[]) => promisify(execFile)(node,
      ['--expose-internals', cli, 'plugin', '--profile', 'desktop', ...args],
      { cwd: home, env: { ...hostEnvironment, ELECTRON_RUN_AS_NODE: '1' }, timeout: 120_000, windowsHide: true })
    await runCli(['add', `file:${installedPlugin}`, '--offline', '--ignore-scripts'])
    const installedEntry = join(profile, 'node_modules', installedName, 'index.js')
    if (readFileSync(installedEntry, 'utf8') !== readFileSync(join(installedPlugin, 'index.js'), 'utf8')) {
      throw new Error('desktop runtime: CLI did not install the local plugin')
    }
    await runCli(['remove', installedName])
    if (existsSync(installedEntry)) throw new Error('desktop runtime: CLI did not remove the local plugin')
    console.log('desktop runtime: CLI offline plugin installation and removal passed')
    const primary = join(resourcesRuntime, 'primary-runtime')
    const dependencies = workspaceDependencyPaths(primary, await readPrimaryRuntime(primary))
    await promisify(execFile)(dependencies.python, ['-I', '-B',
      fileURLToPath(new URL('../tests/fixtures/office-conversion-inputs.py', import.meta.url)), home],
    { env: environment, timeout: 120_000, windowsHide: true })
    const inputs = ['docx', 'xlsx', 'pptx'].map(extension => ({ extension,
      bytes: readFileSync(join(home, `input.${extension}`)).toString('base64') }))
    const cordis = runtime.sharedPackages.find(entry => entry.name === '@deepseek-ai/cordis')
    if (cordis === undefined) throw new Error('desktop runtime: missing shared Cordis package')
    writeFileSync(join(plugin, 'package.json'), JSON.stringify({
      name: pluginName, version: '1.0.0', type: 'module', exports: './index.js',
      peerDependencies: { '@deepseek-ai/cordis': cordis.version,
        ...policyEdition ? { '@deepseek-ai/dsh-llm': runtime.sharedPackages.find(entry => entry.name === '@deepseek-ai/dsh-llm')!.version } : {} },
      dsh: { bundle: { patch: './bundle.yml' } },
    }))
    writeFileSync(join(plugin, 'index.js'), `
import { Context } from '@deepseek-ai/cordis'
import { inspect, promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
${policyEdition ? 'import { LlmAdapter, createUserMessage } from \'@deepseek-ai/dsh-llm\'' : ''}
export function apply(ctx) {
  if (!(ctx instanceof Context)) throw new Error('desktop runtime: external plugin loaded another Cordis instance')
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/desktop-smoke',
    handler(_request, response) { response.end('plugin route ready') } }))
  ${policyEdition ? `ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/desktop-smoke-strategies',
    handler(_request, response) { response.end(JSON.stringify({ strategies: ctx.taskStrategies.list({ task: 'Explain 2 + 2' }), entryEnabled: ctx.taskStrategies.catalog().entryEnabled,
      client: ctx.clientModules.graph().entries.some(entry => entry.id === '@deepseek-ai/dsh-experimental-task-strategy') })) } }))` : ''}
  ${policyEdition ? `ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/desktop-smoke-entry',
    async handler(_request, response) {
      let handle
      const requests = []
      class Model extends LlmAdapter {
        async resolveModel(provider, id) { return { provider, id, name: id } }
        async *stream(options) {
          requests.push(options)
          const text = JSON.stringify(options.messages)
          const result = text.includes('Route the original user input') ? { kind: 'new-task' }
            : text.includes('Choose exactly one registered strategy') ? (text.includes('Choose the strategy yourself')
              ? { strategy: 'coding-low', tier: 'default', reason: 'A small smoke task needs one bounded workflow.' }
              : { strategy: 'coding-low' }) : undefined
          const block = result === undefined ? { type: 'text', text: 'Smoke task completed' }
            : { type: 'tool-call', id: 'smoke-' + requests.length, name: 'structured_output', arguments: JSON.stringify(result) }
          yield { type: 'block-start', index: 0, blockType: block.type }
          yield block.type === 'text' ? { type: 'text-delta', index: 0, text: block.text }
            : { type: 'tool-call-delta', index: 0, id: block.id, name: block.name, argumentsDelta: block.arguments }
          yield { type: 'block-end', index: 0, block }
          yield { type: 'finish', reason: { kind: result === undefined ? 'stop' : 'tool-calls' } }
        }
      }
      const unregister = ctx.llm.registerAdapter(['desktop-entry-smoke'], new Model())
      try {
        handle = await ctx.agents.create({ sessionId: 'desktop-entry-smoke', agentOptions: { provider: 'desktop-entry-smoke', model: 'smoke' },
          setup: async owner => { await ctx.agentPresets.mount(owner, 'standard') } })
        const parent = handle.agent
        const input = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Complete the smoke task' }] })
        parent.followup(input)
        await parent.whenIdle()
        const jobs = ctx.jobs.list(parent.id)
        if (jobs.length !== 1) throw new Error('Expected one automatically accepted Job')
        const terminal = await ctx.jobs.wait(jobs[0].id, 10000, parent.id)
        if (terminal.status !== 'completed') throw new Error('Automatic Job did not complete')
        parent.followup(input)
        await parent.whenIdle()
        const views = ctx.taskStrategies.entryState({ sessionId: parent.id })
        if (ctx.jobs.list(parent.id).length !== 1 || views[0]?.receipt?.strategy !== 'coding-low'
          || requests.filter(row => JSON.stringify(row.messages).includes('Route the original user input')).length !== 1) {
          throw new Error('Automatic intake duplicated or lost its strategy binding')
        }
        response.end(JSON.stringify({ jobs: 1, state: views[0].state, strategy: views[0].receipt.strategy }))
      } catch (error) { response.statusCode = 500; response.end(inspect(error)) }
      finally { if (handle !== undefined) await handle.dispose(); unregister() }
    } }))` : ''}
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/desktop-smoke-install',
    async handler(_request, response) {
      try {
        response.end(JSON.stringify(await ctx.pluginManager.installBundle(${JSON.stringify(installedPlugin)})))
      } catch (error) {
        response.statusCode = 500
        response.end(inspect(error, { depth: 5 }))
      }
    } }))
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/desktop-smoke-office-cli',
    async handler(_request, response) {
      try {
        const skill = await ctx.skills.get('office-docx')
        const json = skill?.content.match(/\\n(\\{\\n[\\s\\S]+)$/u)?.[1]
        if (json === undefined) throw new Error('Office skill did not supply CLI paths')
        const { libreofficeKit: { node, cli } } = JSON.parse(json)
        const options = { cwd: ${JSON.stringify(home)}, env: { ...process.env, PATH: '' }, timeout: 120_000 }
        const capabilities = await promisify(execFile)(node, [cli, 'capabilities'], options)
        const output = ${JSON.stringify(join(home, 'cli.pdf'))}
        await promisify(execFile)(node, [cli, 'convert', '--input', ${JSON.stringify(join(home, 'input.docx'))}, '--output', output], options)
        response.end(JSON.stringify({ capabilities: JSON.parse(capabilities.stdout), pdf: (await readFile(output)).toString('base64') }))
      } catch (error) {
        response.statusCode = 500
        response.end(inspect(error, { depth: 5 }))
      }
    } }))
  for (const input of ${JSON.stringify(inputs)}) {
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/desktop-smoke-office/' + input.extension,
      async handler(_request, response) {
        try {
          const bytes = Buffer.from(input.bytes, 'base64')
          const result = await ctx.officeToPdf.convert({ extension: input.extension, priority: 'foreground',
            source: { key: 'desktop-smoke-' + input.extension, version: 'fixture', bytes: bytes.length,
              async read() { return { bytes, version: 'fixture' } } } })
          response.end(Buffer.from(result.pdf))
        } catch (error) {
          response.statusCode = 500
          response.end(inspect(error, { depth: 5 }))
        }
      } }))
  }
}
`)
    writeFileSync(join(plugin, 'bundle.yml'), `- insert:\n    - id: desktop-runtime-smoke-plugin\n      name: desktop-runtime-smoke-plugin\n      inject: [webServer, officeToPdf, skills, pluginManager${policyEdition ? ', taskStrategies, clientModules, llm, agents, agentPresets, jobs' : ''}]\n`)
    cpSync(plugin, join(profile, 'node_modules', pluginName), { recursive: true })
    const manifest = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      dsh: { profile: { bundles: string[] } }
    }
    manifest.dependencies = { ...manifest.dependencies, [pluginName]: `file:${plugin}` }
    if (policyEdition && !manifest.dsh.profile.bundles.includes('@deepseek-ai/dsh-experimental-task-strategy')) {
      manifest.dsh.profile.bundles.push('@deepseek-ai/dsh-experimental-task-strategy')
    }
    manifest.dsh.profile.bundles.push(pluginName)
    writeFileSync(join(profile, 'package.json'), JSON.stringify(manifest))
    writeFileSync(join(profile, 'cordis.patch.yml'), '- id: webserver\n  config:\n    host: 127.0.0.1\n    port: 0\n')
    const ready = await Promise.race([host.start(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { reject(new Error('desktop runtime: Host readiness exceeded 120 seconds')) }, 120_000)
    })])
    clearTimeout(timer)
    const login = await fetch(ready.url, { redirect: 'manual' })
    const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
    const response = await fetch(new URL('/', ready.url), { headers: { cookie } })
    if (response.status !== 200 || !(await response.text()).includes('<html')) {
      throw new Error('desktop runtime: packaged frontend smoke failed')
    }
    const pluginResponse = await fetch(new URL('/desktop-smoke', ready.url), { headers: { cookie } })
    if (await pluginResponse.text() !== 'plugin route ready') throw new Error('desktop runtime: plugin HTTP route failed')
    if (policyEdition) {
      const response = await fetch(new URL('/desktop-smoke-strategies', ready.url), { headers: { cookie } })
      const { strategies, client, entryEnabled } = await response.json() as {
        client: boolean
        entryEnabled: boolean
        strategies: { id: string; cost?: { kind: string; basis?: string } }[]
      }
      const expected = ['coding', 'paper-research', 'problem-research', 'solution-planning']
        .flatMap(domain => ['low', 'medium', 'high'].map(tier => `${domain}-${tier}`))
        .concat(['codex-style', 'claude-style', 'zcode-style', 'superpowers-style'])
      const missing = expected.filter(id => !strategies.some(strategy => strategy.id === id
        && strategy.cost?.kind === 'estimated' && strategy.cost.basis === 'task'))
      if (!client || !entryEnabled || strategies.length !== 16 || missing.length > 0) {
        throw new Error(`desktop runtime: policy workflow smoke failed: ${JSON.stringify({ client, entryEnabled, count: strategies.length, missing })}`)
      }
      console.log('desktop runtime: strategy client, 16 policy workflows and task token estimates passed')
      const intake = await fetch(new URL('/desktop-smoke-entry', ready.url), { headers: { cookie }, signal: AbortSignal.timeout(30000) })
      if (!intake.ok) throw new Error(`desktop runtime: automatic intake failed: ${await intake.text()}`)
      const result = await intake.json() as { jobs: number; state: string; strategy: string }
      if (result.jobs !== 1 || result.state !== 'completed' || result.strategy !== 'coding-low') throw new Error('desktop runtime: automatic intake evidence incomplete')
      console.log('desktop runtime: ordinary input, automatic selection, completed Job and duplicate prevention passed')
    }
    const installation = await fetch(new URL('/desktop-smoke-install', ready.url), {
      headers: { cookie }, signal: AbortSignal.timeout(120_000),
    })
    const installationResult = await installation.text()
    const installed = await fetch(new URL('/desktop-smoke-installed', ready.url), { headers: { cookie } })
    if (!installation.ok || !installed.ok || await installed.text() !== 'installed plugin ready') {
      throw new Error(`desktop runtime: bundled pnpm plugin installation failed: ${installationResult}`)
    }
    for (const { extension } of inputs) {
      const converted = await fetch(new URL(`/desktop-smoke-office/${extension}`, ready.url), {
        headers: { cookie }, signal: AbortSignal.timeout(120_000),
      })
      if (!converted.ok) throw new Error(`desktop runtime: ${extension} conversion failed: ${await converted.text()}`)
      const pdf = Buffer.from(await converted.arrayBuffer())
      if (!/^%PDF-\d\.\d/u.test(pdf.subarray(0, 8).toString())
        || !pdf.subarray(-1024).toString().trimEnd().endsWith('%%EOF')) {
        throw new Error(`desktop runtime: invalid ${extension} PDF output`)
      }
    }
    const cliResponse = await fetch(new URL('/desktop-smoke-office-cli', ready.url), {
      headers: { cookie }, signal: AbortSignal.timeout(120_000),
    })
    if (!cliResponse.ok) throw new Error(`desktop runtime: skill CLI failed: ${await cliResponse.text()}`)
    const cliResult = await cliResponse.json() as { capabilities: { runtime: { cliPath: string } }; pdf: string }
    if (!cliResult.capabilities.runtime.cliPath.endsWith('cli.js') || Buffer.from(cliResult.pdf, 'base64').subarray(0, 5).toString() !== '%PDF-') {
      throw new Error('desktop runtime: skill CLI did not return capabilities and a PDF')
    }
    console.log('desktop runtime: DOCX, XLSX, PPTX to PDF and skill CLI discovery passed')
  } finally {
    clearTimeout(timer)
    try { await host.stop() } finally {
      await rm(home, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 })
    }
  }
}
