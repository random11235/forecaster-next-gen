import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach } from 'vitest'
import { startAppAndOpenBrowser, type RunningApp } from '../../src/app/launch.js'
import type { MilestoneInputs } from '../../src/model/milestoneInputs.js'
import { openSqliteStorage } from '../../src/storage/sqliteStorage.js'
import type { Storage } from '../../src/storage/storage.js'
import { post as postForm, saveInPlace as saveFormInPlace } from './forms.js'
import { found } from './found.js'

// The screens through the local server, as the EM's browser sees them, on a data file written through `Storage`. A file
// from before the MVP, holding the tables earlier releases wrote, is test/storage/migrations.beforeTheMvp.test.ts's case.

export const TEAM = 'PAY'
export const CREATED = '2026-08-31T09:00:00Z'

/** The milestone as the EM entered it: its name, start date and tickets remaining, but no pace yet. */
export const CHECKOUT: MilestoneInputs = {
  teamId: TEAM,
  name: 'Checkout v2',
  startDate: '2026-09-01',
  ticketsRemaining: 40,
  ambiguity: 'medium',
  cadenceDays: 7,
  paceMode: 'range',
  paceRange: undefined,
  paceCounts: [],
  paceCadenceDays: undefined,
  paceWindow: { action: undefined, skippedPeriods: [] },
  ticketsSource: 'typed',
  seenReads: { ticketsRemaining: undefined, pace: undefined },
}

export let dir: string | undefined
let app: RunningApp | undefined
export let storage: Storage | undefined

/** The data file the app started on, by `startOnSavedData` or `startWithNoMilestone`. */
export function stored(): Storage {
  if (storage === undefined) throw new Error('No data file yet: start the app first')
  return storage
}

afterEach(async () => {
  await app?.close()
  app = undefined
  storage?.close()
  storage = undefined
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

/** Starts the app on 24 Oct 2026 on a data file holding the team, and its milestone unless `milestone` is false. */
export async function startOnSavedData({ milestone = true } = {}): Promise<RunningApp> {
  dir = mkdtempSync(join(tmpdir(), 'forecaster-screens-'))
  const file = join(dir, 'forecaster.db')
  storage = openSqliteStorage(file)
  storage.saveTeam({ id: TEAM, name: 'Payments', source: 'jira', sourceRef: TEAM, installedAt: CREATED })
  if (milestone) storage.saveMilestoneInputs(CHECKOUT)
  app = await startAppAndOpenBrowser({ port: 0, openBrowser: () => {}, storage, today: () => '2026-10-24' })
  return app
}

/** Starts the app on the team with no milestone entered yet. */
export function startWithNoMilestone(): Promise<RunningApp> {
  return startOnSavedData({ milestone: false })
}

/** The app the test started; a test that started none has nothing to ask. */
export function running(): RunningApp {
  if (!app) throw new Error('No app is running: start one first.')
  return app
}

export async function page(path: string): Promise<string> {
  return (await fetch(new URL(path, running().url))).text()
}

/** The page's visible text, with tags removed and spaces collapsed. */
export function text(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
}

/** Posts a form as the browser does, without following the redirect. */
export function post(path: string, fields: [string, string][]): Promise<Response> {
  return postForm(running(), path, fields)
}

/** Submits the Inputs screen's milestone form as the browser does. */
export function submitMilestone(name: string, startDate: string, ticketsRemaining: string): Promise<Response> {
  return post('/inputs/milestone', [
    ['name', name],
    ['startDate', startDate],
    ['ticketsRemaining', ticketsRemaining],
  ])
}

/** Submits the Inputs screen's pace form as the browser does. */
export function submitPace(low: string, high: string): Promise<Response> {
  return post('/inputs/pace', [
    ['low', low],
    ['high', high],
  ])
}

/** Submits the Inputs screen's cadence form as the browser does. */
export function submitCadence(cadenceDays: string): Promise<Response> {
  return post('/inputs/cadence', [['cadenceDays', cadenceDays]])
}

/** The date the forecast list gives at `percent`. */
export function dateAt(screen: string, percent: number): string {
  return found(screen, new RegExp(`${percent}% confident by (\\d{1,2} [A-Z][a-z]{2} 20\\d\\d)`), 1)
}

/** Submits the Inputs screen's typed counts list as the browser does. */
export function submitCounts(counts: string): Promise<Response> {
  return post('/inputs/pace-counts', [['counts', counts]])
}

/** Chooses which pace the forecast uses, as the browser does. */
export function choosePace(paceMode: string): Promise<Response> {
  return post('/inputs/pace-mode', [['paceMode', paceMode]])
}

/** Posts a form as the Inputs screen's script does when a field changes: it asks to stay on the Inputs screen. */
export function saveInPlace(path: string, fields: [string, string][]): Promise<Response> {
  return saveFormInPlace(running(), path, fields)
}

/** The ambiguity ranges form, with the defaults unless overridden. */
export function growthForm(overrides: Record<string, string> = {}): [string, string][] {
  const fields = { 'low-low': '1', 'low-high': '1.5', 'medium-low': '1', 'medium-high': '2', 'high-low': '1.5', 'high-high': '3', ...overrides }
  return Object.entries(fields)
}

/** Submits the forecast screen's capacity sentence as the browser does. */
export function addCapacity(percent: string, from: string, to: string, note = '', onward = false): Promise<Response> {
  return post('/capacity/add', [['percent', percent], ['from', from], ['to', to], ...(onward ? [['onward', 'on'] as [string, string]] : []), ['note', note]])
}

/** Saves an entry's edit form as the browser does. */
export function editCapacity(id: string, percent: string, from: string, to: string, note = ''): Promise<Response> {
  return post('/capacity/edit', [
    ['id', id],
    ['percent', percent],
    ['from', from],
    ['to', to],
    ['note', note],
  ])
}
