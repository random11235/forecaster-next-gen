import { afterEach, describe, expect, test } from 'vitest'
import { startAppAndOpenBrowser, type RunningApp } from '../../src/app/launch.js'
import { openSqliteStorage } from '../../src/storage/sqliteStorage.js'
import type { Storage } from '../../src/storage/storage.js'
import { SAMPLE_DATA } from '../../src/sample/sampleData.js'

// The screens on the canned sample data, through the local server, as the EM's browser sees them.

let app: RunningApp | undefined
let storage: Storage | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
  storage?.close()
  storage = undefined
})

/** Starts the app on the sample data, on 24 Oct 2026. */
async function startOnSampleData(): Promise<RunningApp> {
  storage = openSqliteStorage(':memory:')
  app = await startAppAndOpenBrowser({ port: 0, openBrowser: () => {}, storage, today: () => '2026-10-24' })
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

/** The real storage, counting each time the team's facts are read from it. */
function countingFactReads(real: Storage): { storage: Storage; reads: () => number } {
  let reads = 0
  const storage: Storage = {
    isEmpty: () => real.isEmpty(),
    saveTeam: (team) => real.saveTeam(team),
    teams: () => real.teams(),
    addFacts: (teamId, facts) => real.addFacts(teamId, facts),
    facts: (teamId) => {
      reads++
      return real.facts(teamId)
    },
    saveMilestone: (milestone) => real.saveMilestone(milestone),
    milestones: (teamId) => real.milestones(teamId),
    savePaceSetting: (setting) => real.savePaceSetting(setting),
    paceSetting: (teamId, milestoneId) => real.paceSetting(teamId, milestoneId),
    saveWorkflowSettings: (settings) => real.saveWorkflowSettings(settings),
    workflowSettings: (teamId) => real.workflowSettings(teamId),
    saveEpicCommit: (commit) => real.saveEpicCommit(commit),
    epicCommits: (teamId) => real.epicCommits(teamId),
    close: () => real.close(),
  }
  return { storage, reads: () => reads }
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

  test.each([
    { low: '6', high: '3', message: 'The low end must not be above the high end.' },
    { low: 'two', high: '6', message: 'Enter whole numbers of tickets, 0 or more.' },
    { low: '1.5', high: '6', message: 'Enter whole numbers of tickets, 0 or more.' },
    { low: '-1', high: '6', message: 'Enter whole numbers of tickets, 0 or more.' },
    { low: '', high: '6', message: 'Enter whole numbers of tickets, 0 or more.' },
    { low: '1', high: '1000000', message: 'Enter at most 1000 tickets per week.' },
  ])('refuses $low to $high, saying why and keeping what was typed', async ({ low, high, message }) => {
    await startOnSampleData()

    const response = await submitPace(low, high)

    expect(response.status).toBe(400)
    const html = await response.text()
    expect(text(html)).toContain(message)
    expect(html).toMatch(new RegExp(`name="low"[^>]*value="${low}"`))
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

describe('Inputs screen: milestone', () => {
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

  test('an epic change that names no action says why', async () => {
    await startOnSampleData()

    const response = await post('/inputs/epics', [['epic', 'PAY-1']])

    expect(response.status).toBe(400)
    expect(text(await response.text())).toContain('Choose Add, Remove, Up or Down.')
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
    spikeTypes: 'spike',
    spikeLabels: 'spike',
    commitLabel: '',
    blockedStatuses: '',
    blockedLabels: 'blocked',
    ...changes,
  }
  return Object.entries(fields)
}

describe('Inputs screen: workflow', () => {
  test("saving the settings reads the team's facts from storage once", async () => {
    const reads = await startCountingFactReads()

    const response = await post('/inputs/workflow', workflowForm())

    expect(response.status).toBe(303)
    expect(reads()).toBe(1)
  })

  test("shows the sample board's status mapping, started status, spike rules, commit label and blocked marker", async () => {
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
    expect(html).toMatch(/name="spikeTypes"[^>]*value="spike"/)
    expect(html).toMatch(/name="spikeLabels"[^>]*value="spike"/)
    expect(html).toMatch(/name="commitLabel"[^>]*value=""/)
    expect(html).toMatch(/name="blockedStatuses"[^>]*value=""/)
    expect(html).toMatch(/name="blockedLabels"[^>]*value="blocked"/)
  })

  test('saving the settings shows them on the Inputs screen', async () => {
    await startOnSampleData()

    const response = await post('/inputs/workflow', workflowForm({ commitLabel: 'committed', spikeLabels: 'spike, discovery' }))

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/inputs')
    const html = await page('/inputs')
    expect(html).toMatch(/name="commitLabel"[^>]*value="committed"/)
    expect(html).toMatch(/name="spikeLabels"[^>]*value="spike, discovery"/)
  })

  test('changing the mapping changes the forecast', async () => {
    await startOnSampleData()
    storage!.savePaceSetting({ teamId: 'sample-team', milestoneId: 'sample-milestone', mode: 'measured' })
    expect(text(await page('/'))).toContain('Pace: measured')

    await post('/inputs/workflow', workflowForm({ 'status:Done': 'started' }))

    expect(text(await page('/'))).toContain('are done yet, so there is no measured pace to forecast from')
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

  test('labels each epic "Not committed: wide range"', async () => {
    await startOnSampleData()
    await submitPace('3', '6')

    const screen = text(await page('/'))

    expect(screen.match(/Not committed: wide range/g)).toHaveLength(3)
  })

  test('shows no absence input', async () => {
    await startOnSampleData()
    await submitPace('3', '6')

    const html = await page('/')

    expect(html).not.toMatch(/<input/)
    expect(html.toLowerCase()).not.toMatch(/absence|capacity/)
  })

  test('shows the forecast notes and the pace they come from, for measured pace', async () => {
    await startOnSampleData()
    storage!.savePaceSetting({ teamId: 'sample-team', milestoneId: 'sample-milestone', mode: 'measured' })

    const html = await page('/')

    expect(html).toMatch(/<p class="note">[^<]+<\/p>/)
    expect(text(html)).toContain('Pace: measured')
  })
})
