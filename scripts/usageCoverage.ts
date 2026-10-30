// Usage coverage: which source lines the running app uses, as against the lines the tests run.
// Builds the app with source maps, starts it with NODE_V8_COVERAGE on a free port and a throwaway data file, walks
// every screen and form through the cases an EM can reach, stops it, and has c8 map the coverage back to src/.
// Run with `npm run coverage:usage`; the HTML report lands in coverage-usage/.
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const scratch = mkdtempSync(join(tmpdir(), 'forecaster-usage-'))
const rawCoverage = join(scratch, 'v8')

/** One request the EM's browser would make: a screen to show, or a form to submit. */
type Step = { get: string } | { post: string; form?: Record<string, string> }

const milestone = (startDate: string, ticketsRemaining: string, name = 'Checkout v3') => ({
  post: '/inputs/milestone',
  form: { name, startDate, ticketsRemaining },
})
const growth = (lowHigh: string) => {
  const [low = '', high = ''] = lowHigh.split('-')
  return { post: '/inputs/growth', form: { 'low-low': '1', 'low-high': '1.5', 'medium-low': low, 'medium-high': high, 'high-low': '1.5', 'high-high': '3' } }
}
const screens: Step[] = [{ get: '/' }, { get: '/inputs' }]

/** The walk: each case the screens and forms can reach, the screens looked at after each change. */
const WALK: Step[] = [
  // nothing entered
  ...screens,
  { post: '/inputs/pace', form: { low: '4', high: '8' } },
  // the milestone, refused each way, then a past start date
  milestone('2026-09-01', '40', ' '),
  milestone('2026-02-30', '40'),
  milestone('2026-09-01', 'forty'),
  milestone('2026-09-01', '1000000'),
  milestone('2026-09-01', '40'),
  ...screens,
  // the pace range, refused each way, then saved
  { post: '/inputs/pace', form: { low: 'four', high: '8' } },
  { post: '/inputs/pace', form: { low: '9', high: '8' } },
  { post: '/inputs/pace', form: { low: '4', high: '5000' } },
  { post: '/inputs/pace', form: { low: '4', high: '8' } },
  ...screens,
  // cadence
  { post: '/inputs/cadence', form: { cadenceDays: '0' } },
  { post: '/inputs/cadence', form: { cadenceDays: '400' } },
  { post: '/inputs/cadence', form: { cadenceDays: '14' } },
  ...screens,
  // ambiguity and its ranges
  { post: '/inputs/ambiguity', form: { ambiguity: 'huge' } },
  { post: '/inputs/ambiguity', form: { ambiguity: 'high' } },
  growth('a-2'),
  growth('0-2'),
  growth('3-2'),
  growth('1-2.5'),
  ...screens,
  // typed counts: none, one, a few, enough, refused, all zero
  { post: '/inputs/pace-mode', form: { paceMode: 'sideways' } },
  { post: '/inputs/pace-mode', form: { paceMode: 'counts' } },
  ...screens,
  { post: '/inputs/pace-counts/add', form: { count: 'x' } },
  { post: '/inputs/pace-counts/add', form: { count: '5000' } },
  { post: '/inputs/pace-counts/add', form: { count: '5' } },
  ...screens,
  { post: '/inputs/pace-counts/add', form: { count: '7' } },
  ...screens,
  { post: '/inputs/pace-counts', form: { counts: '5, x' } },
  { post: '/inputs/pace-counts', form: { counts: '5 6 7 4 8 6 5 7 9' } },
  { post: '/inputs/pace-counts/remove-last' },
  ...screens,
  { post: '/inputs/pace-counts', form: { counts: '0, 0, 0' } },
  ...screens,
  // back to the range: zero pace, then a pace too slow for the horizon
  { post: '/inputs/pace-mode', form: { paceMode: 'range' } },
  { post: '/inputs/pace', form: { low: '0', high: '0' } },
  ...screens,
  { post: '/inputs/cadence', form: { cadenceDays: '7' } },
  { post: '/inputs/pace', form: { low: '0', high: '1' } },
  milestone('2026-09-01', '500'),
  ...screens,
  // 0 tickets, and a future start date
  milestone('2026-09-01', '0'),
  ...screens,
  { post: '/inputs/pace', form: { low: '4', high: '8' } },
  milestone('2027-03-01', '40'),
  ...screens,
  // what no screen links to
  { get: '/nowhere' },
  { post: '/inputs/nowhere' },
  { post: '/inputs/milestone' },
]

try {
  execFileSync('npx', ['tsc', '-p', 'tsconfig.build.json', '--sourceMap'], { cwd: root, stdio: 'inherit' })
  const app = spawn(process.execPath, ['dist/app/main.js'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: '0',
      FORECASTER_NO_BROWSER: '1',
      FORECASTER_DATA_FILE: join(scratch, 'forecaster.db'),
      NODE_V8_COVERAGE: rawCoverage,
    },
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

  for (const step of WALK) {
    const response =
      'get' in step
        ? await fetch(new URL(step.get, url))
        : await fetch(new URL(step.post, url), { method: 'POST', body: new URLSearchParams(step.form ?? {}), redirect: 'manual' })
    await response.arrayBuffer()
    if (response.status >= 500) throw new Error(`${JSON.stringify(step)} gave a server error: ${response.status}`)
  }

  // the app writes its coverage as it exits
  const exited = once(app, 'exit')
  app.kill('SIGTERM')
  await exited

  execFileSync(
    'npx',
    ['c8', 'report', '--temp-directory', rawCoverage, '--reports-dir', 'coverage-usage', '--src', 'src', '--all', '--include', 'dist/**', '--include', 'src/**', '--exclude', 'dist/**/*.d.ts', '--reporter', 'text', '--reporter', 'html'],
    { cwd: root, stdio: 'inherit' },
  )
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
