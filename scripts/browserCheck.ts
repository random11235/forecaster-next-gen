// The browser check: drives each build of the app in Chrome as the EM would, with agent-browser
// (docs/agents/browser.md), and fails unless it opens empty, takes a milestone and pace on its Inputs screen, and then
// shows their forecast, with no error in the page. It checks the local app, on a free port with a throwaway data
// file, and the web build's one file, whose bugs only a browser running its script can see (#280).
// Run with `npm run check:browser`, which builds both first; CI runs it in a job of its own. A failed check leaves a
// screenshot of the page it failed on in reports/browser/.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const scratch = mkdtempSync(join(tmpdir(), 'forecaster-browser-'))
const screenshots = join(root, 'reports', 'browser')
/** A session of its own: a fresh browser profile, and a dev's own agent-browser session left alone. */
const session = `forecaster-check-${process.pid}`

/**
 * Runs one agent-browser command and returns what it prints. A failure throws with the command and its output. A
 * command the daemon didn't answer ("it may or may not have run") is run once more: each one here can run twice.
 */
function browser(...args: string[]): string {
  const run = (): string =>
    execFileSync(join(root, 'node_modules', '.bin', 'agent-browser'), ['--session', session, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  try {
    return run()
  } catch (error) {
    const { stdout, stderr } = error as { stdout?: string; stderr?: string }
    const output = `${stdout ?? ''}${stderr ?? ''}`
    if (output.includes('may or may not have run')) return run()
    throw new Error(`agent-browser ${args.join(' ')} failed:\n${output}`)
  }
}

/** The milestone and pace typed on Inputs, and what the forecast screen must then say. */
const TYPED = { name: 'Launch', ticketsRemaining: '30', low: '5', high: '10' }
const SHOWN = ['Launch · 30 tickets remaining', /85% confident of finishing by \d{1,2} \w{3} \d{4}/] as const

/** The errors the page's script has thrown since the last `errors --clear`, each with its stack. */
function pageErrors(): string[] {
  const { data } = JSON.parse(browser('errors', '--json')) as { data: { errors: { text: string }[] } }
  return data.errors.map((error) => error.text)
}

/** Checks one build, opened at `home`, the Milestone forecast screen. */
function check(build: string, home: string): void {
  const started = Date.now()
  try {
    browser('open', home)
    browser('wait', '--text', 'No milestone defined yet')
    browser('errors', '--clear')

    browser('find', 'role', 'link', 'click', '--name', 'Inputs', '--exact')
    browser('wait', '--text', 'how many tickets are left')
    browser('find', 'label', 'Name', 'fill', TYPED.name, '--exact')
    browser('find', 'label', 'Tickets remaining', 'fill', TYPED.ticketsRemaining, '--exact')
    browser('find', 'label', 'Low', 'fill', TYPED.low, '--exact')
    browser('find', 'label', 'High', 'fill', TYPED.high, '--exact')
    // Inputs saves a field as it changes or loses focus: the last one saves on leaving it
    browser('press', 'Tab')
    browser('wait', '--load', 'networkidle')

    browser('find', 'role', 'link', 'click', '--name', 'Milestone forecast', '--exact')
    browser('wait', '--text', 'confident of finishing by')
    const text = browser('get', 'text', 'main')
    for (const expected of SHOWN) {
      const shown = typeof expected === 'string' ? text.includes(expected) : expected.test(text)
      if (!shown) throw new Error(`The forecast screen doesn't show ${String(expected)}. It shows:\n${text}`)
    }

    const errors = pageErrors()
    if (errors.length > 0) throw new Error(`The page has errors:\n${errors.join('\n')}`)
  } catch (error) {
    // a step that timed out waiting often did so because the page's script threw: say what it threw
    try {
      const errors = pageErrors()
      if (errors.length > 0) console.error(`The ${build}'s page errors:\n${errors.join('\n')}`)
    } catch {
      // the check's own failure is the one to report
    }
    mkdirSync(screenshots, { recursive: true })
    const screenshot = join(screenshots, `${build.replaceAll(' ', '-')}.png`)
    try {
      browser('screenshot', screenshot)
      console.error(`The page it failed on: ${screenshot}`)
    } catch {
      // the check's own failure is the one to report
    }
    throw new Error(`The ${build} failed the browser check.`, { cause: error })
  }
  console.log(`✓ ${build}: typed a milestone and pace, shown their forecast, no page errors (${Date.now() - started} ms)`)
}

/** Starts the built app on a free port and a throwaway data file, and resolves once it prints its URL. */
async function startApp(): Promise<{ app: ChildProcess; url: string }> {
  const app = spawn(process.execPath, ['dist/app/main.js'], {
    cwd: root,
    env: { ...process.env, PORT: '0', FORECASTER_NO_BROWSER: '1', FORECASTER_DATA_FILE: join(scratch, 'forecaster.db') },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  const url = await new Promise<string>((resolve, reject) => {
    let output = ''
    app.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString()
      const match = output.match(/http:\/\/\S+\//)
      if (match) resolve(match[0])
    })
    app.once('exit', (code) => reject(new Error(`the app exited with ${code} before printing its URL`)))
  })
  return { app, url }
}

let app: ChildProcess | undefined
// a screenshot left by an earlier run would pass for this one's
rmSync(screenshots, { recursive: true, force: true })
try {
  const started = await startApp()
  app = started.app
  check('local app', started.url)
  check('web build', pathToFileURL(join(root, 'dist', 'web', 'forecaster.html')).href)
} finally {
  try {
    browser('close')
  } catch {
    // a browser that never opened has nothing to close
  }
  if (app) {
    const exited = once(app, 'exit')
    app.kill('SIGTERM')
    await exited
  }
  rmSync(scratch, { recursive: true, force: true })
}
