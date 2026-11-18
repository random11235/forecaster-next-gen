import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Runs scripts/restartLocal.sh, which the restart workflow calls after each merge to main, against the app that
// test/buildOnce.ts builds into dist/. Each test runs on a spare port, with its data in a fresh directory, and with a
// stand-in `open` on PATH that writes down the URL it was asked to open instead of opening a browser tab. The script
// has launchd run the app, so it runs on macOS only, as the runner it's for does: these tests skip elsewhere (CI's
// Linux). The app's launch agent is written to the test's directory, not ~/Library/LaunchAgents, and removed after it.
const root = fileURLToPath(new URL('../..', import.meta.url))
const script = join(root, 'scripts/restartLocal.sh')
/** Beyond the script's own waits: up to 10s for the port to free, then 30s for the app to come up. */
const TIMEOUT = 60_000

/** This test's directory, holding the stand-in `open` and the app's data. */
let dir: string
/** This test's spare port. */
let port: number
/** Pages a test opened, closed after it whether it passed or not. */
const pages: { close: () => void }[] = []

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'forecaster-restart-'))
  port = await sparePort()
  writeFileSync(join(dir, 'open'), `#!/bin/sh\necho "$@" >> "${join(dir, 'opened')}"\n`)
  chmodSync(join(dir, 'open'), 0o755)
})

afterEach(() => {
  for (const page of pages.splice(0)) page.close()
  try {
    execFileSync('launchctl', ['bootout', agent(port)], { stdio: 'ignore' })
  } catch {
    // not loaded
  }
  for (const pid of listeners(port)) process.kill(Number(pid), 'SIGTERM')
  rmSync(dir, { recursive: true, force: true })
})

/** The app's launch agent on a port, in this user's login session: launchd's service target for it. */
function agent(onPort: number): string {
  return `gui/${process.getuid?.()}/forecaster.local-app.${onPort}`
}

/** The pids listening on the port. */
function listeners(onPort: number): string[] {
  try {
    return execFileSync('lsof', ['-tiTCP:' + onPort, '-sTCP:LISTEN'], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
  } catch {
    return []
  }
}

async function sparePort(): Promise<number> {
  const server = createServer().listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  server.close()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return address.port
}

/** The URLs the stand-in `open` was asked to open. */
function opened(): string[] {
  const file = join(dir, 'opened')
  return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : []
}

/** Runs the script to its end, returning its exit code and everything it printed. */
async function restart(env: Record<string, string> = {}): Promise<{ code: number | null; output: string }> {
  const child = spawn('bash', [script], {
    cwd: root,
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      PORT: String(port),
      FORECASTER_DATA_FILE: join(dir, 'forecaster.db'),
      LAUNCH_AGENTS_DIR: dir,
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()))
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()))
  const [code] = (await once(child, 'exit')) as [number | null]
  return { code, output }
}

/** Something else listening on the port, as an app from before the merge would be. */
async function previousApp(): Promise<ChildProcess> {
  const child = spawn(process.execPath, ['-e', `require('node:net').createServer().listen(${port}, '127.0.0.1', () => console.log('up'))`], {
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  if (child.stdout === null) throw new Error('no stdout')
  await once(child.stdout, 'data')
  return child
}

describe.skipIf(process.platform !== 'darwin')('restarting the local app', () => {
  test(
    'stops what listens on the port and leaves the app from this checkout serving it after the script exits',
    async () => {
      const previous = await previousApp()
      const previousExit = once(previous, 'exit')

      const { code, output } = await restart()

      expect(code, output).toBe(0)
      await previousExit
      const page = await fetch(`http://127.0.0.1:${port}/`)
      expect(page.status).toBe(200)
    },
    TIMEOUT,
  )

  test(
    "runs the app as a launch agent in the user's login session, where it can read the keychain, not in the job's (#290)",
    async () => {
      const { code, output } = await restart()

      expect(code, output).toBe(0)
      const [pid] = listeners(port)
      expect(execFileSync('launchctl', ['print', agent(port)], { encoding: 'utf8' })).toMatch(new RegExp(`\\bpid = ${pid}\\b`))
    },
    TIMEOUT,
  )

  test(
    "exits non-zero with the app's output when it doesn't come up, leaving nothing on the port",
    async () => {
      const previous = await previousApp()
      const previousExit = once(previous, 'exit')

      // A directory where the data file should be: the app can't open it, says so and exits.
      const { code, output } = await restart({ FORECASTER_DATA_FILE: dir })

      expect(code).not.toBe(0)
      expect(output).toContain(`Forecaster could not open its data file ${dir}`)
      await previousExit
      expect(listeners(port)).toEqual([])
    },
    TIMEOUT,
  )

  test(
    'opens a tab on the app when no page reconnects to it',
    async () => {
      const { code, output } = await restart()

      expect(code, output).toBe(0)
      expect(opened()).toEqual([`http://127.0.0.1:${port}/`])
    },
    TIMEOUT,
  )

  test(
    'opens no tab when an open page reconnects to the restarted app, as its live stream does',
    async () => {
      expect((await restart()).code).toBe(0)
      openPage()

      const { code, output } = await restart()

      expect(code, output).toBe(0)
      expect(opened()).toEqual([`http://127.0.0.1:${port}/`]) // the first restart's tab, with no page open yet
    },
    TIMEOUT,
  )
})

/** A page open on the app: holds its `/live` stream, reconnecting whenever it drops, until the test ends. */
function openPage(): void {
  const controller = new AbortController()
  void (async () => {
    while (!controller.signal.aborted) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/live`, { signal: controller.signal })
        if (response.body === null) throw new Error('no stream')
        for await (const _ of response.body) {
          // holds the stream open
        }
      } catch {
        // dropped or refused: retry, as EventSource does
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  })()
  pages.push({ close: () => controller.abort() })
}
