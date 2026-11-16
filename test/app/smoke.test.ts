import { afterEach, describe, expect, test } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Starts the app the way `npm start` does: runs the built entry point, which test/buildOnce.ts builds before any test file.
const root = fileURLToPath(new URL('../..', import.meta.url))
const entry = 'dist/app/main.js'

/** The app's one version, as `package.json` sets it. */
const VERSION: unknown = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version

let child: ChildProcess | undefined
let dataDir: string | undefined

afterEach(async () => {
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit')
    child.kill('SIGTERM')
    await exited
  }
  child = undefined
  if (dataDir) rmSync(dataDir, { recursive: true, force: true })
  dataDir = undefined
})

/** Runs the built entry point with the browser opener suppressed and its data in a fresh directory. */
function runEntry(env: Record<string, string>): ChildProcess {
  dataDir = mkdtempSync(join(tmpdir(), 'forecaster-'))
  child = spawn(process.execPath, [entry], {
    cwd: root,
    env: {
      ...process.env,
      FORECASTER_NO_BROWSER: '1',
      FORECASTER_DATA_FILE: join(dataDir, 'forecaster.db'),
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return child
}

/** Resolves with the URL the app prints once it is listening. */
function printedUrl(app: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = ''
    app.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString()
      const match = output.match(/http:\/\/\S+\//)
      if (match) resolve(match[0])
    })
    app.once('exit', (code) => reject(new Error(`app exited with ${code} before printing its URL`)))
  })
}

/** Resolves with the exit code and stderr of an app that is expected to stop by itself. */
async function failure(app: ChildProcess): Promise<{ code: number | null; stderr: string }> {
  let stderr = ''
  app.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
  const [code] = (await once(app, 'exit')) as [number | null]
  return { code, stderr }
}

describe('launch smoke test', () => {
  test('the built entry point serves the Milestone forecast screen in its empty state, with no sample data', async () => {
    const url = await printedUrl(runEntry({ PORT: '0' }))

    const response = await fetch(url)

    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('Milestone forecast')
    expect(html).toContain('No milestone defined yet')
    expect(html).not.toContain('Checkout v2')
  }, 15_000)

  test('the built entry point shows the version in the footer and streams it on /live', async () => {
    const url = await printedUrl(runEntry({ PORT: '0' }))

    const html = await (await fetch(url)).text()
    const live = await fetch(new URL('/live', url))
    const first = await live.body?.getReader().read()

    expect(html).toContain(`<footer class="version">Forecaster ${String(VERSION)}</footer>`)
    expect(new TextDecoder().decode(first?.value)).toBe(`retry: 500\ndata: ${String(VERSION)}\n\n`)
  }, 15_000)

  test('in demo mode, the built entry point starts on the canned connector and serves the Milestone forecast screen', async () => {
    const app = runEntry({ PORT: '0', FORECASTER_DEMO: '1' })
    let output = ''
    app.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()))
    const url = await printedUrl(app)

    const response = await fetch(url)

    expect(output).toContain('Demo mode')
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('Milestone forecast')
  }, 15_000)

  test('in demo mode, setup closes to a summary served from the committed fixture', async () => {
    const url = await printedUrl(runEntry({ PORT: '0', FORECASTER_DEMO: '1' }))
    const post = (path: string, fields: Record<string, string>) =>
      fetch(new URL(path, url), { method: 'POST', body: new URLSearchParams(fields), headers: { origin: new URL(url).origin }, redirect: 'manual' })

    await post('/inputs/connect', { tracker: 'github', repo: 'shop-team/shop', token: 'demo' })
    await post('/inputs/milestone-query/add', { kind: 'epic', name: 'Epic: onboarding 1', query: 'parent-issue:shop-team/shop#200' })
    const used = await post('/inputs/setup/use-these', {})
    const html = await (await fetch(new URL('/inputs', url))).text()

    expect(used.status).toBe(303)
    expect(html).toMatch(/id="setup-summary"[^]*GitHub · <b>shop-team\/shop<\/b>[^]*<span class="read">read /)
  }, 15_000)

  test.each(['abc', '5180.5', '-1', '65536'])(
    'refuses PORT=%j, naming the bad value',
    async (port) => {
      const { code, stderr } = await failure(runEntry({ PORT: port }))

      expect(code).toBe(1)
      expect(stderr).toContain(`PORT must be a whole number from 0 to 65535, not "${port}"`)
    },
    15_000,
  )
})
