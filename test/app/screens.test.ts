import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, test } from 'vitest'
import { SAVE_IN_PLACE } from '../../src/app/inputsScript.js'
import { startAppAndOpenBrowser, type RunningApp } from '../../src/app/launch.js'
import type { MilestoneInputs } from '../../src/model/milestoneInputs.js'
import { openSqliteStorage } from '../../src/storage/sqliteStorage.js'
import type { Storage } from '../../src/storage/storage.js'

// The screens through the local server, as the EM's browser sees them, on a data file from before the MVP: beside the
// milestone's MVP fields, it holds the tables earlier releases wrote (epics, commits, workflow settings, adopted
// measured pace and growth), which the MVP no longer reads.

const TEAM = 'PAY'
const CREATED = '2026-08-31T09:00:00Z'

/** Rows an earlier release left in the file: what the screens must not show. */
const PRE_MVP_ROWS = `
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
const CHECKOUT: MilestoneInputs = {
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

let dir: string | undefined
let app: RunningApp | undefined
let storage: Storage | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
  storage?.close()
  storage = undefined
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

/** Starts the app on 24 Oct 2026 on a data file holding the team, and its milestone unless `milestone` is false. */
async function startOnPreMvpData({ milestone = true } = {}): Promise<RunningApp> {
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
function startWithNoMilestone(): Promise<RunningApp> {
  return startOnPreMvpData({ milestone: false })
}

async function page(path: string): Promise<string> {
  return (await fetch(new URL(path, app!.url))).text()
}

/** The page's visible text, with tags removed and spaces collapsed. */
function text(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
}

/** Posts a form as the browser does, without following the redirect. */
function post(path: string, fields: [string, string][]): Promise<Response> {
  return fetch(new URL(path, app!.url), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
    redirect: 'manual',
  })
}

/** Submits the Inputs screen's milestone form as the browser does. */
function submitMilestone(name: string, startDate: string, ticketsRemaining: string): Promise<Response> {
  return post('/inputs/milestone', [
    ['name', name],
    ['startDate', startDate],
    ['ticketsRemaining', ticketsRemaining],
  ])
}

/** Submits the Inputs screen's pace form as the browser does. */
function submitPace(low: string, high: string): Promise<Response> {
  return post('/inputs/pace', [
    ['low', low],
    ['high', high],
  ])
}

/** Submits the Inputs screen's cadence form as the browser does. */
function submitCadence(cadenceDays: string): Promise<Response> {
  return post('/inputs/cadence', [['cadenceDays', cadenceDays]])
}

/** The date the forecast list gives at `percent`. */
function dateAt(screen: string, percent: number): string {
  return screen.match(new RegExp(`${percent}% confident by (\\d{1,2} [A-Z][a-z]{2} 20\\d\\d)`))![1]!
}

describe('Inputs screen', () => {
  test('asks for the milestone name, start date and tickets remaining, and pace as a low–high range per week', async () => {
    await startOnPreMvpData()

    const html = await page('/inputs')

    expect(html).toMatch(/<input type="text" name="name"[^>]*value="Checkout v2"/)
    expect(html).toMatch(/<input type="date" name="startDate"[^>]*value="2026-09-01"/)
    expect(html).toMatch(/<input type="number" name="ticketsRemaining"[^>]*value="40"/)
    expect(html).toMatch(/<input[^>]*name="low"/)
    expect(html).toMatch(/<input[^>]*name="high"/)
    expect(text(html)).toContain('tickets per week')
  })

  test('offers no committed date, no epics and no measured pace', async () => {
    await startOnPreMvpData()

    const html = await page('/inputs')

    expect(html).not.toMatch(/committedDate|name="rank-|\/inputs\/epics|\/inputs\/pace\/source/)
  })

  test('with nothing entered, pre-fills the start date with today and leaves the rest blank', async () => {
    await startWithNoMilestone()

    const html = await page('/inputs')

    expect(html).toMatch(/name="name"[^>]*value=""/)
    expect(html).toMatch(/name="startDate"[^>]*value="2026-10-24"/)
    expect(html).toMatch(/name="ticketsRemaining"[^>]*value=""/)
    expect(html).not.toContain('class="warning"')
  })

  test('shows no absence or capacity input: capacity is typed beside the forecast', async () => {
    await startOnPreMvpData()

    const html = await page('/inputs')

    expect(html.toLowerCase()).not.toMatch(/absence|\/capacity/)
    expect(html).not.toMatch(/name="(percent|onward)"/)
  })

  test('saving the milestone shows it on the Inputs screen', async () => {
    await startWithNoMilestone()

    const response = await submitMilestone('Checkout v2', '2026-08-03', '25')

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/inputs')
    const html = await page('/inputs')
    expect(html).toMatch(/name="startDate"[^>]*value="2026-08-03"/)
    expect(html).toMatch(/name="ticketsRemaining"[^>]*value="25"/)
  })

  test('saving a pace range goes to the Milestone forecast screen, and the Inputs screen shows the saved range', async () => {
    await startOnPreMvpData()

    const response = await submitPace('3', '6')

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/')
    const inputs = await page('/inputs')
    expect(inputs).toMatch(/name="low"[^>]*value="3"/)
    expect(inputs).toMatch(/name="high"[^>]*value="6"/)
  })

  test.each([
    [['Checkout v2', '', '40'], 'Enter the start date as a calendar date.'],
    [['Checkout v2', '2026-09-01', '-1'], 'Enter tickets remaining as a whole number, 0 or more.'],
    [['Checkout v2', '2026-09-01', '2.5'], 'Enter tickets remaining as a whole number, 0 or more.'],
  ])('refuses the milestone %j, saying why, keeping what was typed and changing nothing', async ([name, startDate, tickets], error) => {
    await startOnPreMvpData()

    const response = await submitMilestone(name!, startDate!, tickets!)

    expect(response.status).toBe(400)
    const html = await response.text()
    expect(text(html)).toContain(error)
    expect(html).toMatch(new RegExp(`name="startDate"[^>]*value="${startDate}"`))
    expect(html).toMatch(new RegExp(`name="ticketsRemaining"[^>]*value="${tickets}"`))
    expect(await page('/inputs')).toMatch(/name="ticketsRemaining"[^>]*value="40"/)
  })

  test('refuses a pace the rules forbid, saying why and keeping what was typed', async () => {
    await startOnPreMvpData()

    const response = await submitPace(' 6 ', '3')

    expect(response.status).toBe(400)
    const html = await response.text()
    expect(text(html)).toContain('The low end must not be above the high end.')
    expect(html).toMatch(/name="low"[^>]*value="6"/)
    expect(text(await page('/'))).toContain('Pace: Enter a pace range.')
  })

  test('every form posts to a fragment naming where it sits, so the browser lands on why, should it be refused', async () => {
    await startOnPreMvpData()

    const html = await page('/inputs')

    const actions = [...html.matchAll(/<form[^>]*action="([^"]+)"/g)].map(([, action]) => action!)
    expect(actions).toHaveLength(9)
    for (const action of actions) {
      const fragment = action.split('#')[1]
      expect(fragment, action).toMatch(/^[a-z-]+$/)
      expect(html.match(new RegExp(`<[a-z]+[^>]*id="${fragment}"[\\s\\S]*?</section>`))![0]).toContain(`action="${action}"`)
    }
    expect(html).toContain('action="/inputs/growth#growth"')
  })

  test('shows a warning beside the input it is about', async () => {
    await startOnPreMvpData()
    await submitPace('0', '0')

    const html = await page('/inputs')

    expect(html).toMatch(/name="high"[^>]*>[\s\S]*?<p class="warning">⚠ At 0 tickets a week, the work never finishes.<\/p>[\s\S]*?Save and forecast/)
  })
})

describe('Inputs screen: a start date in the past', () => {
  test('notes beside the start date how many days before today it is', async () => {
    await startOnPreMvpData()

    const html = await page('/inputs')

    expect(html).toMatch(
      /name="startDate"[^>]*><\/label>\s*<p class="warning">⚠ Start date is 53 days before today; tickets remaining are still today&#39;s count.<\/p>\s*<label>Tickets remaining/,
    )
  })

  test('shows no note for a start date of today', async () => {
    await startOnPreMvpData()
    await submitMilestone('Checkout v2', '2026-10-24', '40')

    expect(text(await page('/inputs'))).not.toContain('before today')
  })
})

describe('Inputs screen: cadence', () => {
  test('offers the cadence length in days, 7 for an untouched milestone', async () => {
    await startOnPreMvpData()

    const html = await page('/inputs')

    expect(html).toMatch(/<input type="number" name="cadenceDays"[^>]*value="7"/)
    expect(text(html)).toContain('Cadence length')
    expect(text(html)).toContain('At 7 days a period is a week, so pace is entered per week; any other length makes it a sprint.')
  })

  test('saving a 14-day cadence shows it, and the pace input and its warning say per sprint', async () => {
    await startOnPreMvpData()
    await submitPace('0', '0')

    const response = await submitCadence('14')

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/inputs')
    const html = await page('/inputs')
    expect(html).toMatch(/name="cadenceDays"[^>]*value="14"/)
    expect(text(html)).toContain('tickets per sprint')
    expect(text(html)).toContain('At 14 days a period is a sprint, so pace is entered per sprint; 7 days makes it a week.')
    expect(text(html)).not.toContain('tickets per week')
    expect(text(html)).toContain('At 0 tickets a sprint, the work never finishes.')
  })

  test.each(['0', '1.5', 'two'])('refuses a cadence of %j, saying why, keeping what was typed and changing nothing', async (typed) => {
    await startOnPreMvpData()

    const response = await submitCadence(typed)

    expect(response.status).toBe(400)
    const html = await response.text()
    expect(text(html)).toContain('Enter the cadence as a whole number of days, 1 or more.')
    expect(html).toMatch(new RegExp(`name="cadenceDays"[^>]*value="${typed}"`))
    expect(await page('/inputs')).toMatch(/name="cadenceDays"[^>]*value="7"/)
  })
})

/** Submits the Inputs screen's typed counts list as the browser does. */
function submitCounts(counts: string): Promise<Response> {
  return post('/inputs/pace-counts', [['counts', counts]])
}

/** Chooses which pace the forecast uses, as the browser does. */
function choosePace(paceMode: string): Promise<Response> {
  return post('/inputs/pace-mode', [['paceMode', paceMode]])
}

describe('Inputs screen: typed counts', () => {
  test('offers pace as a range or as typed counts, the range chosen for an untouched milestone, and says typed counts need 4 for a forecast and 8 to be reliable', async () => {
    await startOnPreMvpData()

    const html = await page('/inputs')

    expect(html).toMatch(/<input type="radio" name="paceMode" value="range" checked/)
    expect(html).toMatch(/<input type="radio" name="paceMode" value="counts"(?! checked)/)
    expect(html).toMatch(/<input type="text" name="counts" value=""/)
    expect(text(html)).toContain('Typed counts need at least 4 for a forecast, and 8 to be reliable.')
  })

  test('saving typed counts keeps them on the Inputs screen, oldest first', async () => {
    await startOnPreMvpData()

    const response = await submitCounts('6 4,9')

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/inputs')
    expect(await page('/inputs')).toMatch(/name="counts" value="6, 4, 9"/)
  })

  test('adding a count puts it last, and removing the last takes it off again', async () => {
    await startOnPreMvpData()
    await submitCounts('6, 4, 9')

    expect((await post('/inputs/pace-counts/add', [['count', '7']])).status).toBe(303)
    expect(await page('/inputs')).toMatch(/name="counts" value="6, 4, 9, 7"/)

    expect((await post('/inputs/pace-counts/remove-last', [])).status).toBe(303)
    expect(await page('/inputs')).toMatch(/name="counts" value="6, 4, 9"/)
  })

  test('refuses typed counts that are not whole numbers, saying why, keeping what was typed and changing nothing', async () => {
    await startOnPreMvpData()
    await submitCounts('6, 4')

    const response = await submitCounts('6, -1')

    expect(response.status).toBe(400)
    const html = await response.text()
    expect(text(html)).toContain('Enter typed counts as whole numbers of tickets, 0 or more.')
    expect(html).toMatch(/name="counts" value="6, -1"/)
    expect(await page('/inputs')).toMatch(/name="counts" value="6, 4"/)
  })

  test('refuses a count to add that is not a whole number, saying why and keeping what was typed', async () => {
    await startOnPreMvpData()
    await submitCounts('6, 4')

    const response = await post('/inputs/pace-counts/add', [['count', '2.5']])

    expect(response.status).toBe(400)
    const html = await response.text()
    expect(text(html)).toContain('Enter typed counts as whole numbers of tickets, 0 or more.')
    expect(html).toMatch(/name="count" [^>]*value="2.5"/)
    expect(await page('/inputs')).toMatch(/name="counts" value="6, 4"/)
  })

  test('choosing typed counts goes to the forecast, keeps the range, and shows typed counts chosen', async () => {
    await startOnPreMvpData()
    await submitPace('4', '8')
    await submitCounts('6, 4, 9')

    const response = await choosePace('counts')

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/')
    const html = await page('/inputs')
    expect(html).toMatch(/<input type="radio" name="paceMode" value="counts" checked/)
    expect(html).toMatch(/name="low"[^>]*value="4"/)
  })

  test('with 3 typed counts in use, notes beside the typed counts that the forecast needs at least 4', async () => {
    await startOnPreMvpData()
    await submitCounts('6, 4, 9')

    await choosePace('counts')

    expect(await page('/inputs')).toMatch(
      /name="counts"[^>]*>[\s\S]*?<p class="warning">⚠ Typed counts: 3 weeks entered. The forecast needs at least 4. Add another count, or switch pace to the range.<\/p>/,
    )
  })

  test('with 4 typed counts in use, notes beside the typed counts that 8 are needed for reliable results', async () => {
    await startOnPreMvpData()
    await submitCounts('6, 4, 9, 7')

    await choosePace('counts')

    expect(await page('/inputs')).toMatch(/name="counts"[^>]*>[\s\S]*?<p class="warning">⚠ 4 of 8 needed for reliable results<\/p>/)
  })
})

/** Posts a form as the Inputs screen's script does when a field changes: it asks to stay on the Inputs screen. */
function saveInPlace(path: string, fields: [string, string][]): Promise<Response> {
  return fetch(new URL(path, app!.url), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', [SAVE_IN_PLACE.header]: SAVE_IN_PLACE.value },
    body: new URLSearchParams(fields).toString(),
    redirect: 'manual',
  })
}

describe('Inputs screen: saving as inputs change', () => {
  test('choosing typed counts saves it and answers with the Inputs screen showing it chosen, not the forecast', async () => {
    await startOnPreMvpData()
    await submitCounts('6, 4, 9')

    const response = await saveInPlace('/inputs/pace-mode', [['paceMode', 'counts']])

    expect(response.status).toBe(200)
    expect(await response.text()).toMatch(/<input type="radio" name="paceMode" value="counts" checked/)
    expect(await page('/inputs')).toMatch(/<input type="radio" name="paceMode" value="counts" checked/)
  })

  test('the Inputs screen carries its own script, which saves in place; the forecast carries none', async () => {
    await startOnPreMvpData()
    // besides the live reload every page the server sends carries (launch.test.ts)
    const ownScripts = async (path: string) =>
      [...(await page(path)).matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].filter(([, , body]) => !body?.includes('EventSource'))

    const scripts = await ownScripts('/inputs')

    expect(scripts).toHaveLength(1)
    expect(scripts[0]![1]).toBe('')
    expect(scripts[0]![2]).toContain(`'${SAVE_IN_PLACE.header}': '${SAVE_IN_PLACE.value}'`)
    expect(await ownScripts('/')).toEqual([])
  })
})

describe('Inputs screen: workflow', () => {
  test('offers no workflow settings, even with a workflow saved before the MVP', async () => {
    await startOnPreMvpData()

    const html = await page('/inputs')

    expect(html).not.toMatch(/\/inputs\/workflow|name="status:|name="startedStatus"|name="commitLabel"|name="blocked/)
    expect(text(html)).not.toMatch(/Workflow|Board status|Commit label/)
    expect((await post('/inputs/workflow', [['startedStatus', 'In Progress']])).status).toBe(404)
  })
})

/** The ambiguity ranges form, with the defaults unless overridden. */
function growthForm(overrides: Record<string, string> = {}): [string, string][] {
  const fields = { 'low-low': '1', 'low-high': '1.5', 'medium-low': '1', 'medium-high': '2', 'high-low': '1.5', 'high-high': '3', ...overrides }
  return Object.entries(fields)
}

describe('Inputs screen: ambiguity', () => {
  test('offers low, medium and high with their ranges, medium chosen, even where an epic was high before the MVP', async () => {
    await startOnPreMvpData()

    const html = await page('/inputs')

    expect(html).toMatch(/<input type="radio" name="ambiguity" value="low"(?![^>]*checked)[^>]*>/)
    expect(html).toMatch(/<input type="radio" name="ambiguity" value="medium"[^>]*checked/)
    expect(html).toMatch(/<input type="radio" name="ambiguity" value="high"(?![^>]*checked)[^>]*>/)
    expect(text(html)).toContain('Low 1–1.5×')
    expect(text(html)).toContain('Medium 1–2×')
    expect(text(html)).toContain('High 1.5–3×')
  })

  test('choosing high shows it chosen, and the forecast says it used high ambiguity and finishes later', async () => {
    await startOnPreMvpData()
    await submitPace('4', '8')
    const before = text(await page('/'))
    expect(before).toContain('Ambiguity: medium, growing 1–2×')

    const response = await post('/inputs/ambiguity', [['ambiguity', 'high']])

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/')
    expect(await page('/inputs')).toMatch(/<input type="radio" name="ambiguity" value="high"[^>]*checked/)
    const after = text(await page('/'))
    expect(after).toContain('Ambiguity: high, growing 1.5–3×')
    expect(Date.parse(dateAt(after, 85))).toBeGreaterThan(Date.parse(dateAt(before, 85)))
  })

  test('refuses a level that is not offered, saying why', async () => {
    await startOnPreMvpData()

    const response = await post('/inputs/ambiguity', [['ambiguity', 'extreme']])

    expect(response.status).toBe(400)
    const html = await response.text()
    expect(text(html)).toContain('Choose low, medium or high ambiguity.')
    expect(html).toMatch(/<input type="radio" name="ambiguity" value="medium"[^>]*checked/)
  })
})

describe('Inputs screen: growth', () => {
  test('shows the default ranges, each as times the tickets remaining', async () => {
    await startOnPreMvpData()

    const html = await page('/inputs')
    for (const [field, value] of Object.entries(Object.fromEntries(growthForm()))) {
      expect(html).toMatch(new RegExp(`name="${field}"[^>]*value="${value}"`))
    }
    expect(text(html)).toContain('× the tickets remaining')
    expect(text(html)).not.toContain('baseline')
  })

  test('explains how a range grows the work: each simulation picks one growth from it, before pace is applied', async () => {
    await startOnPreMvpData()

    expect(text(await page('/inputs'))).toContain(
      'Each simulation picks one growth from the range, every value in it equally likely, and multiplies the tickets remaining by it before working through them at the team’s pace. A wider range spreads the finish dates out.',
    )
  })

  test('saved ranges show on the Inputs screen, and the medium range moves the forecast', async () => {
    await startOnPreMvpData()
    await submitPace('4', '8')
    const before = dateAt(text(await page('/')), 85)

    const response = await post('/inputs/growth', growthForm({ 'medium-high': '3' }))

    expect(response.status).toBe(303)
    expect(await page('/inputs')).toMatch(/name="medium-high"[^>]*value="3"/)
    expect(Date.parse(dateAt(text(await page('/')), 85))).toBeGreaterThan(Date.parse(before))
  })

  test('refused ranges say why, naming the level, keep what was typed, and change nothing', async () => {
    await startOnPreMvpData()
    await submitPace('4', '8')
    const before = text(await page('/'))

    const response = await post('/inputs/growth', growthForm({ 'medium-high': '2.5', 'high-low': '4' }))

    expect(response.status).toBe(400)
    const html = await response.text()
    expect(text(html)).toContain('High ambiguity: the low end must not be above the high end.')
    expect(html).toMatch(/name="medium-high"[^>]*value="2.5"/)
    expect(html).toMatch(/name="high-low"[^>]*value="4"/)
    expect(text(html)).toContain('Medium 1–2×')
    expect(text(await page('/'))).toBe(before)
  })

  test('a refused range lands on the growth section, with why at its top', async () => {
    await startOnPreMvpData()

    const response = await post('/inputs/growth', growthForm({ 'high-low': '4' }))

    expect(response.status).toBe(400)
    const growth = (await response.text()).match(/<section[^>]*id="growth"[\s\S]*?<\/section>/)![0]
    expect(growth).toMatch(/<p class="error" role="alert">High ambiguity: the low end must not be above the high end.<\/p>[\s\S]*<table/)
  })

  test('offers no measured growth, even where it was adopted before the MVP', async () => {
    await startOnPreMvpData()

    const html = await page('/inputs')

    expect(html).not.toMatch(/\/inputs\/growth\/medium|growth sample|measured/i)
    expect((await post('/inputs/growth/medium', [['source', 'measured']])).status).toBe(404)
  })
})

describe('Milestone forecast screen', () => {
  test('with nothing entered, points the EM to the Inputs screen', async () => {
    await startWithNoMilestone()

    const html = await page('/')

    expect(text(html)).toContain('No milestone defined yet.')
    expect(html).toMatch(/on the <a href="\/inputs">Inputs screen<\/a>/)
  })

  test('before pace is entered, lists what to fix on the Inputs screen, naming the input', async () => {
    await startOnPreMvpData()

    const html = await page('/')

    expect(text(html)).toContain('Fix this on the Inputs screen to see a forecast.')
    expect(text(html)).toContain('Pace: Enter a pace range.')
    expect(html).toContain('href="/inputs"')
  })

  test('with more than one thing to fix, asks for them all to be fixed', async () => {
    await startOnPreMvpData()
    storage!.saveMilestoneInputs({ ...CHECKOUT, ticketsRemaining: undefined })

    const screen = text(await page('/'))

    expect(screen).toContain('Fix these on the Inputs screen to see a forecast.')
    expect(screen).toContain('Tickets remaining: Enter how many tickets are left.')
    expect(screen).toContain('Pace: Enter a pace range.')
  })

  test('headlines the 85% date from the start date, with the name and tickets remaining above it', async () => {
    await startOnPreMvpData()
    await submitPace('4', '8')

    const screen = text(await page('/'))

    expect(screen).toContain('Checkout v2 · 40 tickets remaining')
    expect(screen).toContain('Starting 1 Sep 2026: 85% confident of finishing by 1 Dec 2026')
  })

  test('shows the finish dates at 50%, 70%, 85% and 95% and the pace range they come from', async () => {
    await startOnPreMvpData()
    await submitPace('4', '8')

    const screen = text(await page('/'))

    expect(screen).toContain('50% confident by 10 Nov 2026')
    expect(screen).toContain('70% confident by 24 Nov 2026')
    expect(screen).toContain('85% confident by 1 Dec 2026')
    expect(screen).toContain('95% confident by 8 Dec 2026')
    expect(screen).toContain('Pace Change 4–8 tickets per week (range)')
  })

  test('at a 14-day cadence, says the pace is per sprint, and forecasts later than the same pace per week', async () => {
    await startOnPreMvpData()
    await submitPace('4', '8')
    const weekly = dateAt(text(await page('/')), 85)

    await submitCadence('14')

    const screen = text(await page('/'))
    expect(screen).toContain('Pace Change 4–8 tickets per sprint (range)')
    expect(screen).toContain('Pace: cadence length has changed. Please verify that the per period numbers are aligned.')
    expect(screen).not.toContain('tickets per week')
    expect(Date.parse(dateAt(screen, 85))).toBeGreaterThan(Date.parse(weekly))
  })

  test('states the typed counts the forecast used, in weeks', async () => {
    await startOnPreMvpData()
    await submitCounts('6, 4, 9, 7, 5, 8')

    await choosePace('counts')

    expect(text(await page('/'))).toContain('Pace Change typed counts, 6 weeks')
  })

  test('at a 14-day cadence, states the typed counts the forecast used in sprints', async () => {
    await startOnPreMvpData()
    await submitCadence('14')
    await submitCounts('6, 4, 9, 7, 5, 8')

    await choosePace('counts')

    const screen = text(await page('/'))
    expect(screen).toContain('Pace Change typed counts, 6 sprints')
    expect(screen).not.toContain('week')
  })

  test('with 4 typed counts in use, warns on the forecast exactly that it needs 8 to be reliable, named by the typed counts', async () => {
    await startOnPreMvpData()
    await submitCounts('6, 4, 9, 7')

    await choosePace('counts')

    const screen = text(await page('/'))
    expect(screen).toContain('confident')
    expect(screen).toContain('⚠ Typed counts: 4 weeks entered. The forecast needs 8 to be reliable.')
    expect(screen).not.toContain('Pace: Typed counts')
  })

  test('with 8 typed counts in use, gives no warning about the typed counts', async () => {
    await startOnPreMvpData()
    await submitCounts('6, 4, 9, 7, 5, 8, 6, 7')

    await choosePace('counts')

    expect(text(await page('/'))).not.toContain('reliable')
    expect(text(await page('/inputs'))).not.toContain('needed for reliable results')
  })

  test('with 3 typed counts in use, shows no forecast, saying exactly why and pointing to the Inputs screen', async () => {
    await startOnPreMvpData()
    await submitCounts('6, 4, 9')

    await choosePace('counts')

    const html = await page('/')
    expect(text(html)).toContain('Typed counts: 3 weeks entered. The forecast needs at least 4. Add another count, or switch pace to the range.')
    expect(text(html)).not.toContain('confident')
    expect(html).toContain('href="/inputs"')
  })

  test('headlines an 85% date beyond the horizon as not confident by the horizon date, and each date as later than it', async () => {
    await startOnPreMvpData()
    await submitPace('0', '0')

    const screen = text(await page('/'))

    expect(screen).toContain('Starting 1 Sep 2026: not 85% confident of finishing by 28 Aug 2029')
    for (const percent of [50, 70, 85, 95]) expect(screen).toContain(`${percent}% confident: later than 28 Aug 2029`)
    expect(screen).toContain('Pace: At 0 tickets a week, the work never finishes.')
  })

  test('graphs when the simulations finish, a bar per week, marking the 50%, 70%, 85% and 95% dates and stressing the 85% one', async () => {
    await startOnPreMvpData()
    await submitPace('4', '8')

    const html = await page('/')
    const graph = html.match(/<figure class="finish-graph"[\s\S]*?<\/figure>/)![0]

    expect(graph).toContain('aria-label="When the simulations finish, by week"')
    expect(graph.match(/class="bar[ "]/g)!.length).toBeGreaterThan(10)
    expect(text(graph)).toContain('50% 10 Nov 2026')
    expect(text(graph)).toContain('70% 24 Nov 2026')
    expect(text(graph)).toContain('95% 8 Dec 2026')
    expect(graph).toMatch(/<span class="mark headline">85% <span class="date">1 Dec 2026<\/span><\/span>/)
    expect(graph.match(/class="mark headline"/g)).toHaveLength(1)
  })

  test('labels each date of the finish graph once, combining the percents that share it, the 85% one stressed', async () => {
    await startOnPreMvpData()
    await submitMilestone('Checkout v2', '2026-09-01', '2')
    await submitPace('4', '8')

    const graph = (await page('/')).match(/<figure class="finish-graph"[\s\S]*?<\/figure>/)![0]

    expect(graph.match(/class="marker[ "]/g)).toHaveLength(1)
    expect(graph).toMatch(/<span class="mark headline">50% · 70% · 85% · 95% <span class="date">8 Sep 2026<\/span><\/span>/)
  })

  test.each([
    ['4', '8'],
    ['1', '8'],
    ['6', '7'],
  ])("at a pace of %s–%s, runs no marker's label across the line of a marker above it", async (low, high) => {
    await startOnPreMvpData()
    await submitPace(low, high)

    const graph = (await page('/')).match(/<figure class="finish-graph"[\s\S]*?<\/figure>/)![0]
    const markers = [...graph.matchAll(/<div class="marker([^"]*)" style="left: ([\d.]+)%; top: (\d+)px"/g)].map(([, classes, left, top]) => ({
      runsLeft: classes!.split(' ').includes('end'),
      left: Number(left),
      top: Number(top),
    }))

    expect(markers.length).toBeGreaterThan(1)
    for (const marker of markers) {
      for (const above of markers.filter(({ top }) => top < marker.top)) {
        // a label runs away from the lines that come down through its row
        if (marker.runsLeft) expect(above.left).toBeGreaterThan(marker.left)
        else expect(above.left).toBeLessThan(marker.left)
      }
    }
  })

  test('each bar of the finish graph shows its date, the chance of completing by the end of its week and the share of simulations completed within it, on hover or keyboard focus', async () => {
    await startOnPreMvpData()
    await submitPace('4', '8')

    const graph = (await page('/')).match(/<figure class="finish-graph"[\s\S]*?<\/figure>/)![0]
    const bar = graph.match(/<div class="bar[^"]*"[^>]*data-date="2026-12-01"[\s\S]*?<\/div>/)![0]

    expect(bar).toContain('tabindex="0"')
    expect(text(bar)).toContain('1 Dec 2026: 92% chance of completing by the end of this week, 12% of simulations are completed within.')
  })

  test('a bar holding fewer than 1 in 200 simulations says under 1%, not 0%', async () => {
    await startOnPreMvpData()
    await submitPace('4', '8')

    const graph = (await page('/')).match(/<figure class="finish-graph"[\s\S]*?<\/figure>/)![0]
    const bars = graph.match(/<div class="bar[^"]*"[^>]*data-date="[^"]*"[\s\S]*?<\/div>/g)!

    expect(text(bars.at(-1)!)).toContain('under 1% of simulations are completed within.')
  })

  test('at a 14-day cadence, graphs when the simulations finish by sprint', async () => {
    await startOnPreMvpData()
    await submitPace('4', '8')
    await submitCadence('14')

    const graph = (await page('/')).match(/<figure class="finish-graph"[\s\S]*?<\/figure>/)![0]

    expect(text(await page('/'))).toContain('Sprint by sprint')
    expect(graph).toContain('aria-label="When the simulations finish, by sprint"')
    expect(text(graph)).toContain('Share of simulations finishing each sprint')
    expect(text(graph)).toMatch(/\d+% chance of completing by the end of this sprint, \d+% of simulations are completed within\./)
  })

  test('draws no graph when no trial finishes, nor before there is a forecast', async () => {
    await startOnPreMvpData()

    expect(await page('/')).not.toContain('<figure class="finish-graph"')

    await submitPace('0', '0')

    expect(await page('/')).not.toContain('<figure class="finish-graph"')
  })

  test('with 0 tickets remaining, headlines the start date and draws no graph, as every trial finishes on it', async () => {
    await startOnPreMvpData()
    await submitMilestone('Checkout v2', '2026-12-01', '0')
    await submitPace('4', '8')

    const html = await page('/')

    expect(text(html)).toContain('Starting 1 Dec 2026: 85% confident of finishing by 1 Dec 2026')
    expect(html).not.toContain('<figure class="finish-graph"')
  })

  test('states a past start date once, and marks finish dates before today as already past', async () => {
    await startOnPreMvpData()
    await submitMilestone('Checkout v2', '2026-03-02', '40')
    await submitPace('4', '8')

    const screen = text(await page('/'))

    expect(screen).toContain('⚠ Start date is 236 days before today; tickets remaining are still today&#39;s count.')
    expect(screen).not.toContain('Start date: Start date')
    expect(screen).toMatch(/Starting 2 Mar 2026: 85% confident of finishing by \d{1,2} [A-Z][a-z]{2} 2026 \(already past\)/)
    for (const percent of [50, 70, 85, 95]) {
      expect(screen).toMatch(new RegExp(`${percent}% confident by \\d{1,2} [A-Z][a-z]{2} 2026 \\(already past\\)`))
    }
  })

  test('puts the warnings straight under the headline, above the dates and the graph', async () => {
    await startOnPreMvpData()
    await submitMilestone('Checkout v2', '2026-03-02', '40')
    await submitCounts('6, 4, 9, 7')
    await choosePace('counts')

    const screen = text(await page('/'))

    const warnings = [screen.indexOf('⚠ Start date is'), screen.indexOf('⚠ Typed counts: 4 weeks entered.')]
    for (const at of warnings) {
      expect(at).toBeGreaterThan(screen.indexOf('85% confident of finishing by'))
      expect(at).toBeLessThan(screen.indexOf('When it could finish'))
      expect(at).toBeLessThan(screen.indexOf('Week by week'))
    }
  })

  test('does not mark finish dates on or after today', async () => {
    await startOnPreMvpData()
    await submitPace('4', '8')

    expect(text(await page('/'))).not.toContain('already past')
  })

  test('forecasts data from before the MVP from its MVP fields, adding no team and showing none of its epics on either screen', async () => {
    await startOnPreMvpData()
    await submitPace('4', '8')

    const screens = [text(await page('/')), text(await page('/inputs'))]

    expect(screens[0]).toContain('Starting 1 Sep 2026: 85% confident of finishing by 1 Dec 2026')
    for (const screen of screens) expect(screen).not.toMatch(/Card vaulting|Refunds|PAY-\d|epic|commit/i)
    expect(storage!.teams().map((team) => team.id)).toEqual([TEAM])
  })

  test('shows no epics, no committed date, and no input but the capacity sentence', async () => {
    await startOnPreMvpData()
    await submitPace('4', '8')

    const html = await page('/')

    expect(html.replace(/<details class="capacity"[\s\S]*?<\/details>/, '')).not.toMatch(/<input|<table/)
    expect(text(html).toLowerCase()).not.toMatch(/committed|absence/)
  })
})

describe('How it works screen', () => {
  test('every screen links to it from the sidebar, and it is served before a milestone is entered', async () => {
    await startWithNoMilestone()

    const forecast = await page('/')
    const inputs = await page('/inputs')
    const howItWorks = await fetch(new URL('/how-it-works', app!.url))

    expect(forecast).toContain('<a href="/how-it-works">How it works</a>')
    expect(inputs).toContain('<a href="/how-it-works">How it works</a>')
    expect(howItWorks.status).toBe(200)
    expect(await howItWorks.text()).toContain('<a href="/how-it-works" aria-current="page">How it works</a>')
  })

  test('explains the problem, how it works and how to make it better, on the example, with its 50% and 85% weeks', async () => {
    await startWithNoMilestone()

    const screen = text(await page('/how-it-works'))

    expect(screen).toContain('A forecast, not an estimate')
    expect(screen).toContain('30 tickets remaining, medium ambiguity, 4–8 a week')
    expect(screen).toMatch(/The problem .* How it works .* Making it better/)
    expect(screen).toMatch(/50% wk \d+/)
    expect(screen).toMatch(/85% wk \d+/)
    expect(screen).toMatch(/met in \d+% of simulations/)
  })
})

describe('Every screen', () => {
  test('links the favicon in its head, inline as an SVG', async () => {
    await startOnPreMvpData()

    for (const path of ['/', '/inputs']) {
      const head = (await page(path)).match(/<head>[\s\S]*?<\/head>/)![0]
      expect(head).toMatch(/<link rel="icon" type="image\/svg\+xml" href="data:image\/svg\+xml,[^"]*%3Csvg[^"]*">/)
    }
  })

  test('has its fonts, Geist and Geist Mono, inline in its head, so it loads nothing from outside', async () => {
    await startOnPreMvpData()

    for (const path of ['/', '/inputs', '/how-it-works']) {
      const screen = await page(path)
      const head = screen.match(/<head>[\s\S]*?<\/head>/)![0]
      for (const family of ['Geist', 'Geist Mono']) {
        expect(head).toMatch(new RegExp(`@font-face \\{ font-family: '${family}'; src: url\\(data:font/woff2;base64,[A-Za-z0-9+/=]+\\)`))
      }
      expect(screen).not.toMatch(/(?:href=|src=|url\()["']?(?:https?:)?\/\//)
      expect(screen).not.toMatch(/@import/)
    }
  })
})

/** Submits the forecast screen's capacity sentence as the browser does. */
function addCapacity(percent: string, from: string, to: string, note = '', onward = false): Promise<Response> {
  return post('/capacity/add', [['percent', percent], ['from', from], ['to', to], ...(onward ? [['onward', 'on'] as [string, string]] : []), ['note', note]])
}

describe('Milestone forecast screen: pace pattern', () => {
  /** About 4 a week, then 8 for the last four weeks. */
  const STEPPED_UP = '4, 3, 5, 4, 4, 3, 4, 5, 3, 4, 8, 9, 7, 8'

  test('under the pace bars, one folded line names the pattern; opened, it says what it means and what to do, with the 85% date both ways and a button', async () => {
    await startOnPreMvpData()
    await submitCounts(STEPPED_UP)
    await choosePace('counts')

    const html = await page('/')

    expect(html).toMatch(/<figure class="pace-trend"[\s\S]*<details class="pace-pattern"><summary>Stepped up · about 4 a week, then 8 since 22 Sep<\/summary>/)
    const opened = text(html.slice(html.indexOf('class="pace-pattern"')))
    expect(opened).toMatch(
      /^.*About 4 a week, then 8 since 22 Sep\. If that&#39;s lasting, count pace from 22 Sep\. 85% confident by \d{1,2} [A-Z][a-z]{2} 2026 now, \d{1,2} [A-Z][a-z]{2} 2026 from 22 Sep\. Start from 22 Sep/,
    )
    expect(html).toContain(
      '<form method="post" action="/pace-action/apply"><input type="hidden" name="action" value="startFrom"><input type="hidden" name="date" value="2026-09-22"><button>Start from 22 Sep</button></form>',
    )
  })

  test('the button counts pace from the step, saying so with Undo, which brings every count back', async () => {
    await startOnPreMvpData()
    await submitCounts(STEPPED_UP)
    await choosePace('counts')
    const offered = text(await page('/')).match(/(\d{1,2} [A-Z][a-z]{2} 2026) from 22 Sep/)![1]!

    const applied = await post('/pace-action/apply', [
      ['action', 'startFrom'],
      ['date', '2026-09-22'],
    ])

    expect(applied.status).toBe(303)
    expect(applied.headers.get('location')).toBe('/')
    const html = await page('/')
    expect(dateAt(text(html), 85)).toBe(offered)
    expect(text(html)).toContain('Pace Change typed counts, 4 weeks')
    expect(text(html)).toContain('Counting pace from 22 Sep, after it stepped up. Undo')
    expect(html).toContain('<form class="pace-applied" method="post" action="/pace-action/undo">')

    await post('/pace-action/undo', [])

    expect(text(await page('/'))).toContain('Pace Change typed counts, 14 weeks')
  })

  test('an action leaving too few counts to forecast from shows what to fix, with the action said and Undo', async () => {
    await startOnPreMvpData()
    await submitCounts('4, 3, 4, 5, 4, 9, 8, 9')
    await choosePace('counts')
    const date = (await page('/')).match(/name="date" value="(\d{4}-\d{2}-\d{2})"/)![1]!

    await post('/pace-action/apply', [
      ['action', 'startFrom'],
      ['date', date],
    ])

    const html = await page('/')
    expect(text(html)).toMatch(/Typed counts: Counting pace from \d{1,2} [A-Z][a-z]{2} leaves 3 weeks\. The forecast needs at least 4\./)
    expect(text(html)).toMatch(/Counting pace from \d{1,2} [A-Z][a-z]{2}, after it stepped up\. Undo/)
    expect(html).toContain('<form class="pace-applied" method="post" action="/pace-action/undo">')
  })

  test('one odd week posts the period it leaves out, and the forecast says it is left out', async () => {
    await startOnPreMvpData()
    await submitCounts('5, 6, 5, 4, 6, 5, 5, 4, 6, 5, 23, 5, 6, 4')
    await choosePace('counts')
    const period = (await page('/')).match(
      /<input type="hidden" name="action" value="leaveOut"><input type="hidden" name="period" value="(\d{4}-\d{2}-\d{2})">/,
    )![1]!

    await post('/pace-action/apply', [
      ['action', 'leaveOut'],
      ['period', period],
    ])

    expect(text(await page('/'))).toMatch(/Leaving out the week of \d{1,2} [A-Z][a-z]{2}, the odd week\. Undo/)
  })

  test('with too few weeks to read, the line says so, faintly, and opens to nothing', async () => {
    await startOnPreMvpData()
    await submitCounts('5, 4, 6, 5, 5')
    await choosePace('counts')

    expect(await page('/')).toContain('<p class="pace-pattern quiet">No pattern yet · 5 weeks is too few to tell</p>')
  })

  test('with the pace as a range, there is no pattern line', async () => {
    await startOnPreMvpData()
    await submitPace('4', '8')

    expect(await page('/')).not.toContain('class="pace-pattern')
  })
})

describe('Milestone forecast screen: capacity', () => {
  test('beside the forecast, under Pace, every week is at 100% until capacity is typed, as a sentence posting to its section', async () => {
    await startOnPreMvpData()
    await submitPace('4', '8')

    const html = await page('/')

    expect(text(html)).toMatch(/Pace Change 4–8 tickets per week \(range\).*Capacity.*100% = the team’s usual week, as in the pace\. Every week is at 100%\./)
    expect(text(html)).toContain('Weekends don’t count; overlapping entries multiply. Past counts aren’t adjusted.')
    expect(html).toContain('<form method="post" action="/capacity/add?capacity=open#capacity"')
    expect(html).toContain('id="capacity"')
  })

  test('a week off, typed, comes back to the forecast with the entry listed and the 85% date later', async () => {
    await startOnPreMvpData()
    await submitPace('4', '8')
    const before = dateAt(text(await page('/')), 85)

    const response = await addCapacity('0', '2026-11-02', '2026-11-06', 'Offsite')

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/')
    const screen = text(await page('/'))
    expect(screen).toContain('0% 2 Nov 2026 to 6 Nov 2026 Offsite')
    expect(Date.parse(dateAt(screen, 85))).toBeGreaterThan(Date.parse(before))
  })

  test('lists a one-day entry by its day and an onward one from its start', async () => {
    await startOnPreMvpData()
    await submitPace('4', '8')

    await addCapacity('0', '2026-11-16', '', 'Holiday')
    await addCapacity('60', '2026-11-23', '', '', true)

    const screen = text(await page('/'))
    expect(screen).toContain('0% on 16 Nov 2026 Holiday')
    expect(screen).toContain('60% from 23 Nov 2026 onward')
  })

  test('refused, shows the forecast again with the section open, saying why, keeping what was typed', async () => {
    await startOnPreMvpData()
    await submitPace('4', '8')

    const response = await addCapacity('50', '2026-09-14', '2026-09-07', 'Half on <leave>')

    expect(response.status).toBe(400)
    const html = await response.text()
    expect(text(html)).toContain('The end date is before the start.')
    expect(html).toContain('<details class="capacity" id="capacity" data-toggle="/#capacity" open>')
    expect(html).toContain('value="Half on &#60;leave&#62;"')
    expect(html).toContain('value="2026-09-14"')
    expect(text(html)).toContain('Starting 1 Sep 2026: 85% confident of finishing by 1 Dec 2026')
  })

  test('an entry far above usual is warned of beside it', async () => {
    await startOnPreMvpData()
    await submitPace('4', '8')

    await addCapacity('300', '2026-09-07', '', '', true)

    expect(text(await page('/'))).toContain('At 300%, the pace comes from a team about 33% this size, so it’s a weak guide. A pace range may be better.')
  })

  test('removing an entry takes it off the forecast', async () => {
    await startOnPreMvpData()
    await submitPace('4', '8')
    await addCapacity('0', '2026-10-26', '2026-10-30', 'Offsite')

    const response = await post('/capacity/remove', [['id', '1']])

    expect(response.headers.get('location')).toBe('/')
    const screen = text(await page('/'))
    expect(screen).not.toContain('Offsite')
    expect(screen).toContain('Starting 1 Sep 2026: 85% confident of finishing by 1 Dec 2026')
  })

  test('with capacity in use, the dates are compared with usual capacity, and the headline says it includes capacity', async () => {
    await startOnPreMvpData()
    await submitPace('4', '8')
    const usual = dateAt(text(await page('/')), 85)

    await addCapacity('0', '2026-11-16', '2026-11-20', 'Offsite')

    const html = await page('/')
    expect(html).toContain('<th>With capacity</th><th>At usual capacity</th>')
    const screen = text(html)
    expect(screen).toMatch(/: 85% confident of finishing by \d+ \w+ 2026 Includes capacity, which moves the 85% date 1 week later\./)
    expect(screen).toMatch(new RegExp(`85% confident by \\d+ \\w+ 2026 ${usual} 1 week later`))
    expect(screen).toContain('Capacity 1 entry · 85% date 1 week later')
  })

  test('switched off, the forecast is without capacity and says its entries are kept; switched on, it is back', async () => {
    await startOnPreMvpData()
    await submitPace('4', '8')
    await addCapacity('0', '2026-11-16', '2026-11-20', 'Offsite')
    const withCapacity = dateAt(text(await page('/')), 85)
    expect(await page('/')).toContain('<form method="post" action="/capacity/switch?capacity=open#capacity"')

    const response = await post('/capacity/switch', [['on', 'false']])

    expect(response.headers.get('location')).toBe('/')
    const html = await page('/')
    const screen = text(html)
    expect(screen).toContain('Starting 1 Sep 2026: 85% confident of finishing by 1 Dec 2026 Capacity is switched off for this forecast; its entries are kept.')
    expect(screen).toContain('Capacity off · 1 entry')
    expect(screen).toContain('Off: the forecast uses pace alone. Entries are kept, and still count for the next milestone.')
    expect(screen).toContain('0% 16 Nov 2026 to 20 Nov 2026 Offsite')
    expect(html).not.toContain('<th>With capacity</th>')
    expect(html).toContain('role="switch" aria-checked="false"')

    await post('/capacity/switch', [['on', 'true']])

    expect(dateAt(text(await page('/')), 85)).toBe(withCapacity)
  })

  test('the week-by-week chart shades each week capacity changes and labels it with its %, leaving usual weeks plain', async () => {
    await startOnPreMvpData()
    await submitPace('4', '8')
    const plain = (await page('/')).match(/<figure class="finish-graph"[\s\S]*?<\/figure>/)![0]
    expect(plain).not.toContain('capacity')

    // from Tuesday 1 Sep, a week off from Monday 2 Nov takes one working day of five from the week ending 3 Nov, four from the next
    await addCapacity('0', '2026-11-02', '2026-11-06', 'Offsite')

    const html = await page('/')
    const graph = html.match(/<figure class="finish-graph"[\s\S]*?<\/figure>/)![0]
    const bar = (date: string) => graph.match(new RegExp(`<div class="bar[^"]*"[^>]*data-date="${date}"[\\s\\S]*?</div>`))![0]
    expect(text(html)).toContain('Week by week')
    expect(bar('2026-11-03')).toMatch(/class="bar[^"]* changed"/)
    expect(bar('2026-11-03')).toContain('<span class="capacity">80%</span>')
    expect(text(bar('2026-11-10'))).toContain('At 20% capacity.')
    expect(bar('2026-11-17')).not.toContain('changed')
    expect(text(graph)).toContain('Shaded weeks: capacity changes, at the % shown.')
  })

  test('folded, the section gives no entry’s effect; opening it, at its own URL, gives each entry’s effect on the 85% date', async () => {
    await startOnPreMvpData()
    await submitPace('4', '8')
    await addCapacity('0', '2026-11-02', '2026-11-06', 'Offsite')
    await addCapacity('120', '2027-06-01', '', '', true)
    await addCapacity('50', '2026-09-07', '2026-09-11', 'Ended')

    const folded = await page('/')
    expect(folded).toContain('<details class="capacity" id="capacity" data-toggle="/?capacity=open#capacity">')
    expect(text(folded)).not.toContain('85% date +')
    expect(text(folded)).not.toContain('no change to the 85% date')

    const open = await page('/?capacity=open')
    expect(open).toContain('<details class="capacity" id="capacity" data-toggle="/#capacity" open>')
    expect(text(open)).toContain('0% 2 Nov 2026 to 6 Nov 2026 Offsite 85% date +1 wk')
    expect(text(open)).toContain('120% from 1 Jun 2027 onward no change to the 85% date')
    // a past entry isn't used by the forecast, so has no effect to give
    expect(text(open)).toContain('50% 7 Sep 2026 to 11 Sep 2026 Ended Edit')
  })

  test('the section stays open across saves, its effects shown, and across a refusal', async () => {
    await startOnPreMvpData()
    await submitPace('4', '8')
    expect(await page('/?capacity=open')).toContain('<form method="post" action="/capacity/add?capacity=open#capacity"')

    const saved = await post('/capacity/add?capacity=open', [
      ['percent', '0'],
      ['from', '2026-11-02'],
      ['to', '2026-11-06'],
      ['note', 'Offsite'],
    ])

    expect(saved.headers.get('location')).toBe('/?capacity=open')
    const refused = await post('/capacity/add?capacity=open', [
      ['percent', 'half'],
      ['from', '2026-09-14'],
      ['to', ''],
    ])
    const html = await refused.text()
    expect(html).toContain('<details class="capacity" id="capacity" data-toggle="/#capacity" open>')
    expect(text(html)).toContain('Offsite 85% date +1 wk')
  })

  test("the Inputs screen's pace says where capacity is set", async () => {
    await startOnPreMvpData()

    expect(text(await page('/inputs'))).toContain('Capacity is set beside the forecast, under Pace.')
  })
})

/** Saves an entry's edit form as the browser does. */
function editCapacity(id: string, percent: string, from: string, to: string, note = ''): Promise<Response> {
  return post('/capacity/edit', [
    ['id', id],
    ['percent', percent],
    ['from', from],
    ['to', to],
    ['note', note],
  ])
}

describe('Milestone forecast screen: editing capacity, and Past', () => {
  test('each entry has an Edit, holding its sentence as saved with Save and Cancel', async () => {
    await startOnPreMvpData()
    await submitPace('4', '8')
    await addCapacity('0', '2026-11-02', '2026-11-06', 'Offsite')

    const html = await page('/')

    const edit = html.match(/<details class="edit">[\s\S]*?<\/details>/)?.[0] ?? ''
    expect(text(edit).trim()).toMatch(/^Edit At % from to or onward , for \. Save Cancel$/)
    expect(edit).toContain('<form method="post" action="/capacity/edit?capacity=open#capacity"')
    expect(edit).toContain('<input type="hidden" name="id" value="1">')
    expect(edit).toContain('value="0"')
    expect(edit).toContain('value="2026-11-06"')
    expect(edit).toContain('value="Offsite"')
    expect(edit).toContain('<a href="/?capacity=open#capacity">Cancel</a>')
  })

  test('an edit saved comes back to the forecast, the entry changed', async () => {
    await startOnPreMvpData()
    await submitPace('4', '8')
    await addCapacity('0', '2026-11-02', '2026-11-06', 'Offsite')

    const response = await editCapacity('1', '50', '2026-11-09', '2026-11-13', 'Offsite, half the team')

    expect(response.headers.get('location')).toBe('/')
    expect(text(await page('/'))).toContain('50% 9 Nov 2026 to 13 Nov 2026 Offsite, half the team')
  })

  test('an edit refused shows the forecast again with that entry’s edit open, as typed, saying why', async () => {
    await startOnPreMvpData()
    await submitPace('4', '8')
    await addCapacity('0', '2026-11-02', '2026-11-06', 'Offsite')

    const response = await editCapacity('1', '50', '2026-11-13', '2026-11-09', 'Moved')

    expect(response.status).toBe(400)
    const html = await response.text()
    expect(html).toContain('<details class="capacity" id="capacity" data-toggle="/#capacity" open>')
    const edit = html.match(/<details class="edit" open>[\s\S]*?<\/details>/)?.[0] ?? ''
    expect(text(edit)).toContain('The end date is before the start.')
    expect(edit).toContain('value="2026-11-13"')
    expect(edit).toContain('value="Moved"')
    expect(text(html)).toContain('0% 2 Nov 2026 to 6 Nov 2026 Offsite')
  })

  test('an entry that has ended is folded under Past, kept, with only its note to edit and no Remove', async () => {
    await startOnPreMvpData()
    await submitPace('4', '8')
    await addCapacity('0', '2026-09-07', '2026-09-11', 'Offsite')

    const html = await page('/')

    const past = html.match(/<details class="capacity-past">[\s\S]*<\/details>\s*<\/li>\s*<\/ul>\s*<\/details>/)?.[0] ?? ''
    expect(text(past).trim()).toMatch(
      /^Past \(1\) · kept, not used by the forecast 0% 7 Sep 2026 to 11 Sep 2026 Offsite Edit Past, so only the note can change\. Note Save Cancel$/,
    )
    expect(past).not.toContain('/capacity/remove')
    expect(text(html)).toContain('Capacity none, every week usual')
    expect(text(html)).toContain('Starting 1 Sep 2026: 85% confident of finishing by 1 Dec 2026')
  })

  test('a past entry’s note saved changes the note alone', async () => {
    await startOnPreMvpData()
    await submitPace('4', '8')
    await addCapacity('0', '2026-09-07', '2026-09-11', 'Offsite')

    await post('/capacity/edit', [
      ['id', '1'],
      ['note', 'Offsite in Lisbon'],
    ])

    expect(text(await page('/'))).toContain('0% 7 Sep 2026 to 11 Sep 2026 Offsite in Lisbon')
  })
})

describe('Milestone forecast screen: new usual', () => {
  /** Four typed counts, the weeks from 22 Sep to 13 Oct, and a lasting change from `from`. */
  async function lastingChangeOnTypedCounts(from: string): Promise<void> {
    await startOnPreMvpData()
    await submitCounts('4, 6, 5, 7')
    await choosePace('counts')
    await addCapacity('80', from, '', 'Two left', true)
  }

  test('while only some of the weeks the pace comes from are after a lasting change, the entry says how many', async () => {
    await lastingChangeOnTypedCounts('2026-10-01')

    const html = await page('/?capacity=open')

    expect(text(html)).toContain(
      'Remove 2 of the 4 weeks the pace comes from are after the change. Past counts aren’t adjusted. When all of them are, you’ll be asked whether it’s the new usual.',
    )
    expect(html).not.toContain('/capacity/new-usual')
  })

  test('once all of them are, it proposes the new usual, with Make it the new usual and Keep it', async () => {
    await lastingChangeOnTypedCounts('2026-09-22')

    const html = await page('/')

    expect(text(html)).toContain(
      'Every week the pace comes from starts on or after 22 Sep 2026, so it already shows the team at 80%. Make it the new usual ? The change then ends, so it isn’t counted twice. Make it the new usual Keep it',
    )
    expect(html).toContain('<form method="post" action="/capacity/new-usual?capacity=open#capacity"><input type="hidden" name="id" value="1">')
    expect(html).toContain('<form method="post" action="/capacity/keep?capacity=open#capacity"><input type="hidden" name="id" value="1">')
  })

  test('made the new usual, the change ends today and is listed under Past', async () => {
    await lastingChangeOnTypedCounts('2026-09-22')

    const response = await post('/capacity/new-usual?capacity=open', [['id', '1']])

    expect(response.headers.get('location')).toBe('/?capacity=open')
    const html = await page('/?capacity=open')
    expect(text(html)).toContain('80% 22 Sep 2026 to 24 Oct 2026 · new usual from 24 Oct 2026 Two left')
    expect(text(html)).toContain('Capacity none, every week usual')
  })

  test('kept, it is no longer proposed', async () => {
    await lastingChangeOnTypedCounts('2026-09-22')

    await post('/capacity/keep?capacity=open', [['id', '1']])

    const html = await page('/?capacity=open')
    expect(text(html)).toContain('80% from 22 Sep 2026 onward Two left')
    expect(text(html)).not.toContain('new usual')
  })

  test('with a pace range, a lasting change offers End it today, which ends it yesterday', async () => {
    await startOnPreMvpData()
    await submitPace('4', '8')
    await addCapacity('80', '2026-09-22', '', 'Two left', true)

    const html = await page('/?capacity=open')

    expect(text(html)).toContain('Remove With a pace range, end this yourself once the range reflects it. End it today')
    expect(html).toContain('<form method="post" action="/capacity/end-today?capacity=open#capacity"><input type="hidden" name="id" value="1">')
    await post('/capacity/end-today?capacity=open', [['id', '1']])
    expect(text(await page('/'))).toContain('80% 22 Sep 2026 to 23 Oct 2026 Two left')
  })
})
