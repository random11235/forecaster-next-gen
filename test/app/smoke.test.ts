import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'

// Starts the app the way `npm start` does: build, then run the built entry point.
const root = fileURLToPath(new URL('../..', import.meta.url))
const entry = 'dist/app/main.js'

let child: ChildProcess | undefined

beforeAll(() => {
  execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'ignore' })
}, 60_000)

afterEach(async () => {
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit')
    child.kill('SIGTERM')
    await exited
  }
  child = undefined
})

/** Runs the built entry point with the browser opener suppressed. */
function runEntry(env: Record<string, string>): ChildProcess {
  child = spawn(process.execPath, [entry], {
    cwd: root,
    env: { ...process.env, FORECASTER_NO_BROWSER: '1', ...env },
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
  test('the built entry point serves the Milestone forecast screen in its empty state', async () => {
    const url = await printedUrl(runEntry({ PORT: '0' }))

    const response = await fetch(url)

    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('Milestone forecast')
    expect(html).toContain('No milestone defined yet')
  }, 15_000)

  test.each(['abc', '5180.5', '-1', '65536'])('refuses PORT=%j, naming the bad value', async (port) => {
    const { code, stderr } = await failure(runEntry({ PORT: port }))

    expect(code).toBe(1)
    expect(stderr).toContain(`PORT must be a whole number from 0 to 65535, not "${port}"`)
  }, 15_000)
})
