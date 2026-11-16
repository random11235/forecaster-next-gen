import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach } from 'vitest'
import { SAVE_IN_PLACE } from '../../src/app/inputsScript.js'
import { startAppAndOpenBrowser, type RunningApp } from '../../src/app/launch.js'
import type { MilestoneInputs } from '../../src/model/milestoneInputs.js'
import { openSqliteStorage } from '../../src/storage/sqliteStorage.js'
import type { Storage } from '../../src/storage/storage.js'

// The screens through the local server, as the EM's browser sees them, on a data file from before the MVP: beside the
// milestone's MVP fields, it holds the tables earlier releases wrote (epics, commits, workflow settings, adopted
// measured pace and growth), which the MVP no longer reads.

export const TEAM = 'PAY'
export const CREATED = '2026-08-31T09:00:00Z'

/** Rows an earlier release left in the file: what the screens must not show. */
export const PRE_MVP_ROWS = `
INSERT INTO work_items (team_id, id, source_key, type, title, parent_id, labels, created_at, started_at, done_at, cancelled_at, last_synced_at) VALUES
  ('${TEAM}', 'PAY-1', 'PAY-1', 'epic', 'Card vaulting', NULL, '["committed"]', '${CREATED}', NULL, NULL, NULL, '${CREATED}'),
  ('${TEAM}', 'PAY-2', 'PAY-2', 'epic', 'Refunds', NULL, '[]', '${CREATED}', NULL, NULL, NULL, '${CREATED}'),
  ('${TEAM}', 'PAY-11', 'PAY-11', 'story', NULL, 'PAY-1', '[]', '${CREATED}', NULL, NULL, NULL, '${CREATED}');
INSERT INTO milestones (team_id, id, name, committed_date) VALUES ('${TEAM}', 'M1', 'Checkout v2', '2026-12-18');
INSERT INTO milestone_epics (team_id, milestone_id, rank, epic_id) VALUES ('${TEAM}', 'M1', 0, 'PAY-1'), ('${TEAM}', 'M1', 1, 'PAY-2');
INSERT INTO pace_settings (team_id, milestone_id, mode, low, high) VALUES ('${TEAM}', 'M1', 'measured', 2, 9);
INSERT INTO workflow_settings (team_id, statuses, started_status, commit_label, blocked_statuses, blocked_labels) VALUES
  ('${TEAM}', '[{"status":"To Do","category":"notStarted"},{"status":"In Progress","category":"started"},{"status":"Done","category":"done"}]',
   'In Progress', 'committed', '[]', '["blocked"]');
INSERT INTO epic_commits (team_id, epic_id, committed_at, child_count_at_commit) VALUES ('${TEAM}', 'PAY-2', '2026-09-07T10:00:00Z', 1);
INSERT INTO epic_ambiguities (team_id, milestone_id, epic_id, ambiguity) VALUES ('${TEAM}', 'M1', 'PAY-1', 'high');
INSERT INTO ambiguity_ranges (team_id, low_low, low_high, medium_low, medium_high, high_low, high_high, medium_measured) VALUES
  ('${TEAM}', 1, 1.5, 1, 2, 1.5, 3, 1);
`

/** The milestone as the EM entered it after the upgrade: its name, start date and tickets remaining, but no pace yet. */
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
export let app: RunningApp | undefined
export let storage: Storage | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
  storage?.close()
  storage = undefined
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

/** Starts the app on 24 Oct 2026 on a data file holding the team, and its milestone unless `milestone` is false. */
export async function startOnPreMvpData({ milestone = true } = {}): Promise<RunningApp> {
  dir = mkdtempSync(join(tmpdir(), 'forecaster-screens-'))
  const file = join(dir, 'forecaster.db')
  storage = openSqliteStorage(file)
  storage.saveTeam({ id: TEAM, name: 'Payments', source: 'jira', sourceRef: TEAM, installedAt: CREATED })
  const earlierRelease = new DatabaseSync(file)
  earlierRelease.exec(PRE_MVP_ROWS)
  earlierRelease.close()
  if (milestone) storage.saveMilestoneInputs(CHECKOUT)
  app = await startAppAndOpenBrowser({ port: 0, openBrowser: () => {}, storage, today: () => '2026-10-24' })
  return app
}

/** Starts the app on the team with no milestone entered yet. */
export function startWithNoMilestone(): Promise<RunningApp> {
  return startOnPreMvpData({ milestone: false })
}

export async function page(path: string): Promise<string> {
  return (await fetch(new URL(path, app!.url))).text()
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
  return fetch(new URL(path, app!.url), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: new URL(app!.url).origin },
    body: new URLSearchParams(fields).toString(),
    redirect: 'manual',
  })
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
  return screen.match(new RegExp(`${percent}% confident by (\\d{1,2} [A-Z][a-z]{2} 20\\d\\d)`))![1]!
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
  return fetch(new URL(path, app!.url), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: new URL(app!.url).origin, [SAVE_IN_PLACE.header]: SAVE_IN_PLACE.value },
    body: new URLSearchParams(fields).toString(),
    redirect: 'manual',
  })
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
