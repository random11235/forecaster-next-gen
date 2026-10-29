import { afterEach, describe, expect, test } from 'vitest'
import { startAppAndOpenBrowser, type RunningApp } from '../../src/app/launch.js'
import { openSqliteStorage } from '../../src/storage/sqliteStorage.js'
import type { Storage } from '../../src/storage/storage.js'
import { loadSampleDataIfEmpty } from '../../src/sample/loadSampleData.js'
import { SAMPLE_DATA } from '../../src/sample/sampleData.js'
import { countingFactReads } from '../storage/countingFactReads.js'

// The screens through the local server, as the EM's browser sees them, on the canned sample data. The app no longer
// loads it; it stands in for a data file from before the MVP: epics, commits and workflow settings beside the
// milestone's MVP fields.

let app: RunningApp | undefined
let storage: Storage | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
  storage?.close()
  storage = undefined
})

/**
 * Starts the app on the sample data, on 24 Oct 2026 unless `today` says otherwise. On 24 Oct the sample milestone has
 * 7 weeks of finished tickets; from 31 Oct, 8.
 */
async function startOnSampleData(today = '2026-10-24'): Promise<RunningApp> {
  storage = openSqliteStorage(':memory:')
  loadSampleDataIfEmpty(storage)
  app = await startAppAndOpenBrowser({ port: 0, openBrowser: () => {}, storage, today: () => today })
  return app
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

/** Starts the app on the sample data, counting reads of the team's facts from launch on. */
async function startCountingFactReads(): Promise<() => number> {
  storage = openSqliteStorage(':memory:')
  loadSampleDataIfEmpty(storage)
  const counting = countingFactReads(storage)
  app = await startAppAndOpenBrowser({ port: 0, openBrowser: () => {}, storage: counting.storage, today: () => '2026-10-24' })
  const atLaunch = counting.reads()
  return () => counting.reads() - atLaunch
}

/** Starts the app on the sample team and its tickets, with no milestone entered yet. */
async function startWithNoMilestone(): Promise<RunningApp> {
  storage = openSqliteStorage(':memory:')
  storage.saveTeam(SAMPLE_DATA.team)
  storage.addFacts(SAMPLE_DATA.team.id, SAMPLE_DATA.facts)
  app = await startAppAndOpenBrowser({ port: 0, openBrowser: () => {}, storage, today: () => '2026-10-24' })
  return app
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
  return post('/inputs/milestone', [['name', name], ['startDate', startDate], ['ticketsRemaining', ticketsRemaining]])
}

/** Submits the Inputs screen's pace form as the browser does. */
function submitPace(low: string, high: string): Promise<Response> {
  return post('/inputs/pace', [['low', low], ['high', high]])
}

/** The date the forecast list gives at `percent`. */
function dateAt(screen: string, percent: number): string {
  return screen.match(new RegExp(`${percent}% sure by (\\d{1,2} [A-Z][a-z]{2} 20\\d\\d)`))![1]!
}

describe('Inputs screen', () => {
  test("reads the team's facts from storage once", async () => {
    const reads = await startCountingFactReads()

    await page('/inputs')

    expect(reads()).toBe(1)
  })

  test('asks for the milestone name, start date and tickets remaining, and pace as a low–high range per week', async () => {
    await startOnSampleData()

    const html = await page('/inputs')

    expect(html).toMatch(/<input type="text" name="name"[^>]*value="Checkout v2"/)
    expect(html).toMatch(/<input type="date" name="startDate"[^>]*value="2026-09-01"/)
    expect(html).toMatch(/<input type="number" name="ticketsRemaining"[^>]*value="40"/)
    expect(html).toMatch(/<input[^>]*name="low"/)
    expect(html).toMatch(/<input[^>]*name="high"/)
    expect(text(html)).toContain('tickets per week')
  })

  test('offers no committed date, no epics and no measured pace', async () => {
    await startOnSampleData()

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

  test('shows no absence input', async () => {
    await startOnSampleData()

    expect((await page('/inputs')).toLowerCase()).not.toMatch(/absence|capacity/)
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
    await startOnSampleData()

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
    await startOnSampleData()

    const response = await submitMilestone(name!, startDate!, tickets!)

    expect(response.status).toBe(400)
    const html = await response.text()
    expect(text(html)).toContain(error)
    expect(html).toMatch(new RegExp(`name="startDate"[^>]*value="${startDate}"`))
    expect(html).toMatch(new RegExp(`name="ticketsRemaining"[^>]*value="${tickets}"`))
    expect(await page('/inputs')).toMatch(/name="ticketsRemaining"[^>]*value="40"/)
  })

  test('refuses a pace the rules forbid, saying why and keeping what was typed', async () => {
    await startOnSampleData()

    const response = await submitPace(' 6 ', '3')

    expect(response.status).toBe(400)
    const html = await response.text()
    expect(text(html)).toContain('The low end must not be above the high end.')
    expect(html).toMatch(/name="low"[^>]*value="6"/)
    expect(text(await page('/'))).toContain('Pace: Enter a pace range.')
  })

  test('shows a warning beside the input it is about', async () => {
    await startOnSampleData()
    await submitPace('0', '0')

    const html = await page('/inputs')

    expect(html).toMatch(/name="high"[^>]*>[\s\S]*?<p class="warning">⚠ At 0 tickets a week, the work never finishes.<\/p>[\s\S]*?Save and forecast/)
  })
})

describe('Inputs screen: workflow', () => {
  test('offers no workflow settings, even with a workflow saved before the MVP', async () => {
    await startOnSampleData()

    const html = await page('/inputs')

    expect(html).not.toMatch(/\/inputs\/workflow|name="status:|name="startedStatus"|name="commitLabel"|name="blocked/)
    expect(text(html)).not.toMatch(/Workflow|Board status|Commit label/)
    expect((await post('/inputs/workflow', [['startedStatus', 'In Progress']])).status).toBe(404)
  })
})

/** Adds `count` finished epics to the sample team, each committed in the tool at 10 tickets and done at 15 (1.5×). */
function addFinishedEpics(count: number): void {
  const at = '2026-06-01T09:00:00Z'
  for (let i = 1; i <= count; i++) {
    const id = `DONE-${i}`
    const item = (itemId: string, type: string, parentId?: string) => ({
      id: itemId,
      teamId: 'sample-team',
      sourceKey: itemId,
      type,
      labels: [],
      createdAt: at,
      lastSyncedAt: at,
      ...(parentId !== undefined && { parentId }),
    })
    storage!.addFacts('sample-team', {
      workItems: [item(id, 'epic'), ...Array.from({ length: 15 }, (_, n) => item(`${id}-${n}`, 'story', id))],
      events: [
        { itemId: id, at, kind: 'status', to: 'To Do' },
        { itemId: id, at: '2026-08-01T09:00:00Z', kind: 'status', from: 'To Do', to: 'Done' },
      ],
    })
    storage!.saveEpicCommit({ teamId: 'sample-team', epicId: id, committedAt: at, baseline: 10 })
  }
}

/** The ambiguity ranges form, with the defaults unless overridden. */
function growthForm(overrides: Record<string, string> = {}): [string, string][] {
  const fields = { 'low-low': '1', 'low-high': '1.5', 'medium-low': '1', 'medium-high': '2', 'high-low': '1.5', 'high-high': '3', ...overrides }
  return Object.entries(fields)
}

describe('Inputs screen: growth', () => {
  test('shows the default ranges', async () => {
    await startOnSampleData()

    const html = await page('/inputs')
    for (const [field, value] of Object.entries(Object.fromEntries(growthForm()))) {
      expect(html).toMatch(new RegExp(`name="${field}"[^>]*value="${value}"`))
    }
  })

  test('saved ranges show on the Inputs screen, and the medium range moves the forecast', async () => {
    await startOnSampleData()
    await submitPace('4', '8')
    const before = dateAt(text(await page('/')), 85)

    const response = await post('/inputs/growth', growthForm({ 'medium-high': '3' }))

    expect(response.status).toBe(303)
    expect(await page('/inputs')).toMatch(/name="medium-high"[^>]*value="3"/)
    expect(Date.parse(dateAt(text(await page('/')), 85))).toBeGreaterThan(Date.parse(before))
  })

  test('refused ranges say why and keep what was typed', async () => {
    await startOnSampleData()

    const response = await post('/inputs/growth', growthForm({ 'high-low': '4' }))

    expect(response.status).toBe(400)
    const html = await response.text()
    expect(text(html)).toContain('The low end must not be above the high end.')
    expect(html).toMatch(/name="high-low"[^>]*value="4"/)
  })

  test('offers no measured growth, even with 7 growth samples: the milestone grows by the medium range', async () => {
    await startOnSampleData()
    addFinishedEpics(7)

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
    await startOnSampleData()

    const html = await page('/')

    expect(text(html)).toContain('Fix these on the Inputs screen to see a forecast.')
    expect(text(html)).toContain('Pace: Enter a pace range.')
    expect(html).toContain('href="/inputs"')
  })

  test('headlines the 85% date from the start date, with the name and tickets remaining above it', async () => {
    await startOnSampleData()
    await submitPace('4', '8')

    const screen = text(await page('/'))

    expect(screen).toContain('Checkout v2 · 40 tickets remaining')
    expect(screen).toContain('Starting 1 Sep 2026: 85% sure of finishing by 1 Dec 2026')
  })

  test('shows the finish dates at 50%, 70%, 85% and 95% and the pace range they come from', async () => {
    await startOnSampleData()
    await submitPace('4', '8')

    const screen = text(await page('/'))

    expect(screen).toContain('50% sure by 10 Nov 2026')
    expect(screen).toContain('70% sure by 24 Nov 2026')
    expect(screen).toContain('85% sure by 1 Dec 2026')
    expect(screen).toContain('95% sure by 8 Dec 2026')
    expect(screen).toContain('Pace: 4–8 tickets per week (range)')
  })

  test('headlines an 85% date beyond the horizon as not sure by the horizon date, and each date as later than it', async () => {
    await startOnSampleData()
    await submitPace('0', '0')

    const screen = text(await page('/'))

    expect(screen).toContain('Starting 1 Sep 2026: not 85% sure of finishing by 28 Aug 2029')
    for (const percent of [50, 70, 85, 95]) expect(screen).toContain(`${percent}% sure: later than 28 Aug 2029`)
    expect(screen).toContain('Pace: At 0 tickets a week, the work never finishes.')
  })

  test("forecasts data from before the MVP from its MVP fields, adding no team and showing none of its epics on either screen", async () => {
    await startOnSampleData()
    await submitPace('4', '8')

    const screens = [text(await page('/')), text(await page('/inputs'))]

    expect(screens[0]).toContain('Starting 1 Sep 2026: 85% sure of finishing by 1 Dec 2026')
    for (const screen of screens) expect(screen).not.toMatch(/Card vaulting|Refunds|Receipts redesign|PAY-\d|epic|commit/i)
    expect(storage!.teams().map((team) => team.id)).toEqual(['sample-team'])
  })

  test('shows no epics, no committed date and no input', async () => {
    await startOnSampleData()
    await submitPace('4', '8')

    const html = await page('/')

    expect(html).not.toMatch(/<input|<table/)
    expect(text(html).toLowerCase()).not.toMatch(/committed|absence|capacity/)
  })
})
