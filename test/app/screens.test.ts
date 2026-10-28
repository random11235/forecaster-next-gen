import { afterEach, describe, expect, test } from 'vitest'
import { startAppAndOpenBrowser, type RunningApp } from '../../src/app/launch.js'
import { openSqliteStorage } from '../../src/storage/sqliteStorage.js'
import type { Storage } from '../../src/storage/storage.js'
import { SAMPLE_DATA } from '../../src/sample/sampleData.js'
import { countingFactReads } from '../storage/countingFactReads.js'

// The screens on the canned sample data, through the local server, as the EM's browser sees them.

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
  app = await startAppAndOpenBrowser({ port: 0, openBrowser: () => {}, storage, today: () => today })
  return app
}

async function page(path: string): Promise<string> {
  return (await fetch(new URL(path, app!.url))).text()
}

/** Submits the Inputs screen's pace form as the browser does. */
function submitPace(low: string, high: string): Promise<Response> {
  return fetch(new URL('/inputs', app!.url), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ low, high }).toString(),
    redirect: 'manual',
  })
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
  const counting = countingFactReads(storage)
  app = await startAppAndOpenBrowser({ port: 0, openBrowser: () => {}, storage: counting.storage, today: () => '2026-10-24' })
  const atLaunch = counting.reads()
  return () => counting.reads() - atLaunch
}

describe('Inputs screen', () => {
  test("reads the team's facts from storage once", async () => {
    const reads = await startCountingFactReads()

    await page('/inputs')

    expect(reads()).toBe(1)
  })

  test('asks for pace as a low–high range of tickets per week', async () => {
    await startOnSampleData()

    const html = await page('/inputs')

    expect(text(html)).toContain('Pace')
    expect(html).toMatch(/<input[^>]*name="low"/)
    expect(html).toMatch(/<input[^>]*name="high"/)
    expect(text(html)).toContain('tickets per week')
  })

  test('shows no absence input', async () => {
    await startOnSampleData()

    expect((await page('/inputs')).toLowerCase()).not.toMatch(/absence|capacity/)
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

  test('refuses a pace the rules forbid, saying why and keeping what was typed', async () => {
    await startOnSampleData()

    const response = await submitPace(' 6 ', '3')

    expect(response.status).toBe(400)
    const html = await response.text()
    expect(text(html)).toContain('The low end must not be above the high end.')
    expect(html).toMatch(/name="low"[^>]*value="6"/)
    expect(text(await page('/'))).toContain('Enter your pace on the Inputs screen')
  })
})

/** Starts the app on the sample team and its tickets, with no milestone defined yet. */
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

/** The epic names in the Milestone forecast screen's epic table, in rank order. */
async function forecastEpics(): Promise<string[]> {
  const html = await page('/')
  const body = html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? ''
  return [...body.matchAll(/<tr>\s*<td>([^<]*)<\/td>/g)].map((row) => row[1]!)
}

describe('Inputs screen: pace', () => {
  test('below 8 weeks of finished tickets, says how many there are and offers no switch', async () => {
    await startOnSampleData()
    await submitPace('3', '6')

    const html = await page('/inputs')

    expect(text(html)).toContain(
      'Only 7 weeks of finished tickets. Measured pace needs 8. Until then the forecast uses your manual range.',
    )
    expect(text(html)).toContain('KTLO and unparented tickets are left out')
    expect(html).not.toContain('/inputs/pace/source')
  })

  test('at 8 weeks, offers measured pace beside the manual range, and switching uses it', async () => {
    await startOnSampleData('2026-10-31')
    await submitPace('3', '6')

    const html = await page('/inputs')
    expect(html).toMatch(/name="low"[^>]*value="3"/)
    expect(text(html)).toContain('Measured pace: 0–2 tickets a week over 8 weeks. The forecast uses your manual range until you switch.')

    const response = await post('/inputs/pace/source', [['source', 'measured']])
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/inputs')

    const switched = await page('/inputs')
    expect(text(switched)).toContain('The forecast uses measured pace: 0–2 tickets a week over 8 weeks. Your manual range is kept.')
    expect(switched).toMatch(/name="low"[^>]*value="3"/)
    expect(text(await page('/'))).toContain('Pace: measured over 8 weeks.')
  })

  test('the EM can go back to the manual range', async () => {
    await startOnSampleData('2026-10-31')
    await submitPace('3', '6')
    await post('/inputs/pace/source', [['source', 'measured']])

    await post('/inputs/pace/source', [['source', 'manual']])

    expect(text(await page('/'))).toContain('Pace: 3–6 tickets per week (manual)')
  })

  test('below 8 weeks with no manual range, asks for one instead of claiming the forecast uses it', async () => {
    await startOnSampleData()

    const screen = text(await page('/inputs'))

    expect(screen).toContain('Only 7 weeks of finished tickets. Measured pace needs 8. Until then, enter a manual range to forecast.')
    expect(screen).not.toContain('uses your manual range')
  })

  test('refuses switching to measured pace below 8 weeks, saying why', async () => {
    await startOnSampleData()

    const response = await post('/inputs/pace/source', [['source', 'measured']])

    expect(response.status).toBe(400)
    expect(text(await response.text())).toContain('Only 7 weeks of finished tickets. Measured pace needs 8.')
  })
})

describe('Inputs screen: milestone', () => {
  test('refuses a pace sent before the milestone is defined, still offering no pace form', async () => {
    await startWithNoMilestone()

    const response = await post('/inputs', [['low', '3'], ['high', '6']])

    expect(response.status).toBe(400)
    const html = await response.text()
    expect(text(html)).toContain('No milestone defined yet. Define a milestone to enter its pace.')
    expect(html).not.toMatch(/<input[^>]*name="low"/)
  })

  test("with no milestone, offers a form for its name, committed date and a rank for each of the team's epics", async () => {
    await startWithNoMilestone()

    const html = await page('/inputs')

    expect(html).toMatch(/<input[^>]*name="name"/)
    expect(html).toMatch(/<input[^>]*type="date"[^>]*name="committedDate"/)
    for (const epic of ['PAY-1', 'PAY-2', 'PAY-3', 'PAY-4']) {
      expect(html).toMatch(new RegExp(`<input type="number" name="rank-${epic}"`))
    }
    expect(text(html)).toContain('Fraud rules')
  })

  test('creating a milestone holds the ranked epics in rank order, and leaves out epics with no rank', async () => {
    await startWithNoMilestone()

    const response = await post('/inputs/milestone', [
      ['name', 'Checkout v3'],
      ['committedDate', '2027-02-26'],
      ['rank-PAY-1', ''],
      ['rank-PAY-2', '2'],
      ['rank-PAY-3', ''],
      ['rank-PAY-4', '1'],
    ])

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/inputs')
    expect(text(await page('/'))).toContain('Checkout v3 · committed 26 Feb 2027')
    expect(await forecastEpics()).toEqual(['Fraud rules', 'Refunds'])
  })

  test('a milestone with two epics of the same rank is refused, keeping the ranks typed', async () => {
    await startWithNoMilestone()

    const response = await post('/inputs/milestone', [
      ['name', 'Checkout v3'],
      ['committedDate', '2027-02-26'],
      ['rank-PAY-2', '1'],
      ['rank-PAY-4', '1'],
    ])

    expect(response.status).toBe(400)
    const html = await response.text()
    expect(text(html)).toContain('Give each chosen epic a different rank.')
    expect(html).toMatch(/name="rank-PAY-2"[^>]*value="1"/)
    expect(html).toMatch(/name="rank-PAY-4"[^>]*value="1"/)
    expect(html).toMatch(/name="rank-PAY-1"[^>]*value=""/)
  })

  test('a milestone with a rank missing is refused', async () => {
    await startWithNoMilestone()

    const response = await post('/inputs/milestone', [
      ['name', 'Checkout v3'],
      ['committedDate', '2027-02-26'],
      ['rank-PAY-2', '1'],
      ['rank-PAY-4', '3'],
    ])

    expect(response.status).toBe(400)
    expect(text(await response.text())).toContain('Rank the chosen epics 1 to 2, with none missing.')
  })

  test('a refused milestone says why and keeps what was typed', async () => {
    await startWithNoMilestone()

    const response = await post('/inputs/milestone', [
      ['name', 'Checkout v3'],
      ['committedDate', '2027-02-26'],
    ])

    expect(response.status).toBe(400)
    const html = await response.text()
    expect(text(html)).toContain('Choose at least one epic.')
    expect(html).toMatch(/name="name"[^>]*value="Checkout v3"/)
    expect(html).toMatch(/name="committedDate"[^>]*value="2027-02-26"/)
  })

  test("lists the milestone's epics in rank order, and offers the team's other epics to add", async () => {
    await startOnSampleData()

    const html = await page('/inputs')

    expect(text(html)).toMatch(/Card vaulting.*Refunds.*Receipts redesign/)
    expect(html).toMatch(/<option value="PAY-4">PAY-4 Fraud rules<\/option>/)
    expect(html).not.toMatch(/<option value="PAY-1">/)
  })

  test('adding, removing and reordering epics change the milestone the forecast is for', async () => {
    await startOnSampleData()

    const added = await post('/inputs/epics', [['epic', 'PAY-4'], ['action', 'add']])
    expect(added.status).toBe(303)
    expect(added.headers.get('location')).toBe('/inputs')
    expect(await forecastEpics()).toEqual(['Card vaulting', 'Refunds', 'Receipts redesign', 'Fraud rules'])

    await post('/inputs/epics', [['epic', 'PAY-3'], ['action', 'remove']])
    expect(await forecastEpics()).toEqual(['Card vaulting', 'Refunds', 'Fraud rules'])

    await post('/inputs/epics', [['epic', 'PAY-4'], ['action', 'up']])
    await post('/inputs/epics', [['epic', 'PAY-1'], ['action', 'down']])
    expect(await forecastEpics()).toEqual(['Fraud rules', 'Card vaulting', 'Refunds'])
  })

  test("editing the milestone's name and committed date shows them on both screens", async () => {
    await startOnSampleData()
    expect(await page('/inputs')).toMatch(/<form method="post" action="\/inputs\/milestone\/details">/)

    const response = await post('/inputs/milestone/details', [
      ['name', 'Checkout v4'],
      ['committedDate', '2027-03-26'],
    ])

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/inputs')
    const inputs = await page('/inputs')
    expect(inputs).toMatch(/name="name"[^>]*value="Checkout v4"/)
    expect(inputs).toMatch(/name="committedDate"[^>]*value="2027-03-26"/)
    expect(text(await page('/'))).toContain('Checkout v4 · committed 26 Mar 2027')
  })

  test("a refused name and committed date say why and keep what was typed", async () => {
    await startOnSampleData()

    const response = await post('/inputs/milestone/details', [
      ['name', 'Checkout v4'],
      ['committedDate', '2027-02-30'],
    ])

    expect(response.status).toBe(400)
    const html = await response.text()
    expect(text(html)).toContain('Enter the committed date as a calendar date.')
    expect(html).toMatch(/name="name"[^>]*value="Checkout v4"/)
    expect(html).toMatch(/name="committedDate"[^>]*value="2027-02-30"/)
  })

  test('each epic not committed has a commit button; committing shows its baseline on both screens', async () => {
    await startOnSampleData()
    expect((await page('/inputs')).match(/<button type="submit" name="action" value="commit">Commit<\/button>/g)).toHaveLength(2)

    const committed = await post('/inputs/epics', [['epic', 'PAY-2'], ['action', 'commit']])

    expect(committed.status).toBe(303)
    expect(committed.headers.get('location')).toBe('/inputs')
    const inputs = await page('/inputs')
    expect(text(inputs)).toMatch(/Refunds PAY-2 [A-Za-z ]* Up Down Remove Committed at 14 items/)
    expect(inputs.match(/value="commit">Commit</g)).toHaveLength(1)
    const forecast = text(await page('/'))
    expect(forecast).toMatch(/Refunds 14 Committed at 14 items/)
    expect(forecast.match(/Not committed: wide range/g)).toHaveLength(1)
  })

  test('an epic change that names no action says why', async () => {
    await startOnSampleData()

    const response = await post('/inputs/epics', [['epic', 'PAY-1']])

    expect(response.status).toBe(400)
    expect(text(await response.text())).toContain('Choose Add, Remove, Up, Down, Commit or Set.')
  })

  test('a refused epic change says why', async () => {
    await startOnSampleData()

    const response = await post('/inputs/epics', [['epic', 'PAY-1'], ['action', 'add']])

    expect(response.status).toBe(400)
    expect(text(await response.text())).toContain('That epic is already in the milestone.')
  })
})

/** The sample board's workflow form, as the Inputs screen first fills it, with `changes` made. */
function workflowForm(changes: Record<string, string> = {}): [string, string][] {
  const fields: Record<string, string> = {
    'status:To Do': 'notStarted',
    'status:In Progress': 'started',
    'status:Done': 'done',
    'status:Cancelled': 'cancelled',
    startedStatus: 'In Progress',
    commitLabel: '',
    blockedStatuses: '',
    blockedLabels: 'blocked',
    ...changes,
  }
  return Object.entries(fields)
}

describe('Inputs screen: workflow', () => {
  test("shows the sample board's status mapping, started status, commit label and blocked marker, and asks nothing about spikes", async () => {
    await startOnSampleData()

    const html = await page('/inputs')

    for (const [status, category] of [
      ['To Do', 'notStarted'],
      ['In Progress', 'started'],
      ['Done', 'done'],
      ['Cancelled', 'cancelled'],
    ]) {
      expect(html).toMatch(new RegExp(`<select name="status:${status}"[^>]*>[\\s\\S]*?<option value="${category}" selected>`))
    }
    expect(html).toMatch(/<select name="startedStatus"[^>]*>[\s\S]*?<option value="In Progress" selected>/)
    expect(html).toMatch(/name="commitLabel"[^>]*value="committed"/)
    expect(html).toMatch(/name="blockedStatuses"[^>]*value=""/)
    expect(html).toMatch(/name="blockedLabels"[^>]*value="blocked"/)
    expect(html).not.toMatch(/name="spike/)
  })

  test('saving the settings shows them on the Inputs screen', async () => {
    await startOnSampleData()

    const response = await post('/inputs/workflow', workflowForm({ commitLabel: 'committed' }))

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/inputs')
    const html = await page('/inputs')
    expect(html).toMatch(/name="commitLabel"[^>]*value="committed"/)
  })

  test('changing the mapping changes the forecast', async () => {
    await startOnSampleData()
    await submitPace('3', '6')
    expect(text(await page('/'))).toContain('Only 7 weeks of finished tickets.')

    await post('/inputs/workflow', workflowForm({ 'status:Done': 'started' }))

    expect(text(await page('/'))).toContain('No finished tickets yet.')
  })

  test('refused settings say why and keep what was typed', async () => {
    await startOnSampleData()

    const response = await post('/inputs/workflow', workflowForm({ startedStatus: 'Done', commitLabel: 'committed' }))

    expect(response.status).toBe(400)
    const html = await response.text()
    expect(text(html)).toContain('Choose a started status from the statuses mapped to started.')
    expect(html).toMatch(/name="commitLabel"[^>]*value="committed"/)
    expect(html).toMatch(/<select name="startedStatus"[^>]*>[\s\S]*?<option value="Done" selected>/)
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
  test('shows each epic at medium ambiguity and the default ranges, and setting an epic high shows on both screens', async () => {
    await startOnSampleData()

    const html = await page('/inputs')
    expect(html.match(/<select name="ambiguity"[^>]*>[\s\S]*?<option value="medium" selected>/g)).toHaveLength(3)
    for (const [field, value] of Object.entries(Object.fromEntries(growthForm()))) {
      expect(html).toMatch(new RegExp(`name="${field}"[^>]*value="${value}"`))
    }
    expect(text(html)).toContain('0 growth samples so far: one from each finished committed epic that had items when committed.')
    expect(text(await page('/'))).toContain('Medium ambiguity: grows 1–2×')

    const response = await post('/inputs/epics', [['epic', 'PAY-1'], ['ambiguity', 'high'], ['action', 'ambiguity']])

    expect(response.status).toBe(303)
    expect(await page('/inputs')).toMatch(/<select name="ambiguity"[^>]*aria-label="Ambiguity of [^"]*PAY-1[^"]*"[^>]*>[\s\S]*?<option value="high" selected>/)
    expect(text(await page('/'))).toContain('High ambiguity: grows 1.5–3×')
  })

  test('saved ranges show on the Inputs screen and the forecast', async () => {
    await startOnSampleData()

    const response = await post('/inputs/growth', growthForm({ 'medium-high': '2.5' }))

    expect(response.status).toBe(303)
    expect(await page('/inputs')).toMatch(/name="medium-high"[^>]*value="2.5"/)
    expect(text(await page('/'))).toContain('Medium ambiguity: grows 1–2.5×')
  })

  test('refused ranges say why and keep what was typed', async () => {
    await startOnSampleData()

    const response = await post('/inputs/growth', growthForm({ 'high-low': '4' }))

    expect(response.status).toBe(400)
    const html = await response.text()
    expect(text(html)).toContain('The low end must not be above the high end.')
    expect(html).toMatch(/name="high-low"[^>]*value="4"/)
  })

  test('from 7 growth samples, suggests their growth for medium, which the EM can adopt and undo', async () => {
    await startOnSampleData()
    addFinishedEpics(7)

    const html = text(await page('/inputs'))
    expect(html).toContain('Suggested for medium: grow as the measured epics did, roughly 1.5×. Measured from 7 growth samples.')
    expect(text(await page('/'))).toContain('Medium ambiguity: grows 1–2×')

    expect((await post('/inputs/growth/medium', [['source', 'measured']])).status).toBe(303)
    expect(text(await page('/inputs'))).toContain('Medium epics grow as the measured epics did, roughly 1.5×.')
    expect(text(await page('/'))).toContain('Medium ambiguity: grows as measured from 7 growth samples')

    await post('/inputs/growth/medium', [['source', 'range']])
    expect(text(await page('/'))).toContain('Medium ambiguity: grows 1–2×')
  })

  test('says measured growth is paused once too few growth samples are left, and the EM can turn it off', async () => {
    await startOnSampleData()
    addFinishedEpics(7)
    await post('/inputs/growth/medium', [['source', 'measured']])

    storage!.addFacts('sample-team', {
      workItems: [],
      events: [{ itemId: 'DONE-7', at: '2026-09-01T09:00:00Z', kind: 'status', from: 'Done', to: 'In Progress' }],
    })

    expect(text(await page('/inputs'))).toContain(
      'Measured growth is paused: it needs 7 growth samples, and has 6. Medium epics grow 1–2× until there are 7 again.',
    )
    expect(text(await page('/'))).toContain('Medium ambiguity: grows 1–2× (measured growth paused: it needs 7 growth samples, and has 6)')

    expect((await post('/inputs/growth/medium', [['source', 'range']])).status).toBe(303)
    expect(text(await page('/inputs'))).toContain('6 growth samples so far')
    expect(text(await page('/'))).not.toContain('paused')
  })

  test('refuses measured growth before 7 growth samples', async () => {
    await startOnSampleData()
    addFinishedEpics(6)

    const response = await post('/inputs/growth/medium', [['source', 'measured']])

    expect(response.status).toBe(400)
    expect(text(await response.text())).toContain('Measured growth needs 7 growth samples, and has 6.')
  })

  test('the forecast says an epic with no items yet is sized from finished epics', async () => {
    await startOnSampleData()
    addFinishedEpics(2)
    storage!.addFacts('sample-team', {
      workItems: [{ id: 'PAY-9', teamId: 'sample-team', sourceKey: 'PAY-9', type: 'epic', title: 'Refunds', labels: [], createdAt: '2026-10-01T09:00:00Z', lastSyncedAt: '2026-10-01T09:00:00Z' }],
      events: [{ itemId: 'PAY-9', at: '2026-10-01T09:00:00Z', kind: 'status', to: 'To Do' }],
    })
    await post('/inputs/epics', [['epic', 'PAY-9'], ['action', 'add']])

    expect(text(await page('/'))).toContain('No items yet: sized from 2 finished committed epics')
  })
})

describe('Milestone forecast screen', () => {
  test('with no milestone, points the EM to the Inputs screen to define one', async () => {
    await startWithNoMilestone()

    const html = await page('/')

    expect(text(html)).toContain('No milestone defined yet.')
    expect(html).toMatch(/Define a milestone[^<]*on the <a href="\/inputs">Inputs screen<\/a>/)
  })

  test('before pace is entered, points the EM to the Inputs screen', async () => {
    await startOnSampleData()

    const html = await page('/')

    expect(text(html)).toContain('Enter your pace on the Inputs screen to see a forecast.')
    expect(html).toContain('href="/inputs"')
  })

  test('shows the finish dates at 50%, 85% and 95% and the manual pace they come from', async () => {
    await startOnSampleData()
    await submitPace('3', '6')

    const screen = text(await page('/'))

    expect(screen).toMatch(/50% sure by \d{1,2} [A-Z][a-z]{2} 20\d\d/)
    expect(screen).toMatch(/85% sure by \d{1,2} [A-Z][a-z]{2} 20\d\d/)
    expect(screen).toMatch(/95% sure by \d{1,2} [A-Z][a-z]{2} 20\d\d/)
    expect(screen).toContain('Pace: 3–6 tickets per week (manual)')
  })

  test('headlines how far the 85% date falls after the committed date', async () => {
    await startOnSampleData()
    await submitPace('2', '4')

    const screen = text(await page('/'))

    const sure = screen.match(/85% sure by (\d{1,2} [A-Z][a-z]{2} 20\d\d)/)![1]!
    const days = Math.round((Date.parse(sure) - Date.parse('18 Dec 2026')) / 86_400_000)
    expect(days).toBeGreaterThan(1)
    expect(screen).toContain(`Plan for ${sure} to be 85% sure: ${days} days after the committed date.`)
  })

  test('headlines how far the 85% date falls before the committed date', async () => {
    await startOnSampleData()
    await submitPace('20', '30')

    const screen = text(await page('/'))

    const sure = screen.match(/85% sure by (\d{1,2} [A-Z][a-z]{2} 20\d\d)/)![1]!
    const days = Math.round((Date.parse('18 Dec 2026') - Date.parse(sure)) / 86_400_000)
    expect(days).toBeGreaterThan(1)
    expect(screen).toContain(`85% sure of finishing by ${sure}: ${days} days before the committed date.`)
  })

  test('headlines an 85% date beyond the horizon as not sure by the horizon date', async () => {
    await startOnSampleData()
    await submitPace('0', '0')

    const screen = text(await page('/'))

    const horizon = screen.match(/85% sure: later than (\d{1,2} [A-Z][a-z]{2} 20\d\d)/)![1]!
    expect(screen).toContain(`Not 85% sure of finishing by ${horizon}.`)
  })

  test('labels each epic not committed "Not committed: wide range", and one committed by its label with its baseline', async () => {
    await startOnSampleData()
    await submitPace('3', '6')

    const screen = text(await page('/'))

    expect(screen).toMatch(/Card vaulting 6 Committed by label at 5 items/)
    expect(screen.match(/Not committed: wide range/g)).toHaveLength(2)
  })

  test('flags a blocked epic "Blocked", keeping it in the milestone', async () => {
    await startOnSampleData()

    const screen = text(await page('/'))

    expect(screen).toMatch(/Receipts redesign 3 Not committed: wide range · Blocked/)
    expect(screen.match(/Blocked/g)).toHaveLength(1)
  })

  test('warns of an epic in progress but not committed, before any pace is entered', async () => {
    await startOnSampleData()

    const html = await page('/')

    expect(html).toContain('<p class="warning">⚠ Refunds is in progress but isn&#39;t committed</p>')
    expect(text(html).match(/is in progress but/g)).toHaveLength(1)
  })

  test('shows no absence input', async () => {
    await startOnSampleData()
    await submitPace('3', '6')

    const html = await page('/')

    expect(html).not.toMatch(/<input/)
    expect(html.toLowerCase()).not.toMatch(/absence|capacity/)
  })

  test('shows the forecast notes and the pace they come from, for measured pace', async () => {
    await startOnSampleData('2026-10-31')
    await post('/inputs/pace/source', [['source', 'measured']])

    const html = await page('/')

    expect(html).toMatch(/<p class="note">Your weekly pace [^<]+<\/p>/)
    expect(text(html)).toContain('Pace: measured over 8 weeks.')
  })

  test('says pace counts only tickets under the milestone’s epics, leaving out KTLO', async () => {
    await startOnSampleData()
    await submitPace('3', '6')

    expect(text(await page('/'))).toContain(
      'Pace: 3–6 tickets per week (manual). Only tickets under this milestone’s epics count: KTLO and unparented tickets are left out.',
    )
  })

  test('below 8 weeks of finished tickets, says how many there are beside the manual pace', async () => {
    await startOnSampleData()
    await submitPace('3', '6')

    expect(text(await page('/'))).toContain('Only 7 weeks of finished tickets. Measured pace needs 8.')
  })

  test('at 8 weeks, says measured pace is ready to switch to on Inputs', async () => {
    await startOnSampleData('2026-10-31')
    await submitPace('3', '6')

    const screen = text(await page('/'))

    expect(screen).toContain('Pace: 3–6 tickets per week (manual)')
    expect(screen).toContain('Measured pace is ready, from 8 weeks of finished tickets. Switch to it on Inputs.')
  })
})
