import { afterEach, describe, expect, test } from 'vitest'
import { startAppAndOpenBrowser, type RunningApp } from '../../src/app/launch.js'
import { cannedConnector, type CannedFixture } from '../../src/connectors/canned/cannedConnector.js'
import type { Connecting } from '../../src/forecast/connection.js'
import { openMemorySecrets } from '../../src/secrets/memorySecrets.js'
import { openSqliteStorage } from '../../src/storage/sqliteStorage.js'
import { CHECKOUT, TODAY, type TeamStorage } from '../trackerScenario.js'
import { page, post } from './appOnTracker.js'

// The Inputs screen's setup steps (#217), through the local server as the EM's browser sees it, on the canned
// connector: one step at a time, Back and Next between them, closing with "Use these" to a summary.

const FIXTURE: CannedFixture = {
  milestoneChoices: [{ kind: 'milestone', choices: [CHECKOUT], pastLimit: false }],
  reads: { [CHECKOUT.query]: { tickets: [{ id: 'o1' }], incomplete: false } },
}

let app: RunningApp | undefined
let storage: TeamStorage | undefined
/** How often the tracker was asked anything, since the app started. */
let asked = 0

afterEach(async () => {
  await app?.close()
  app = undefined
  storage?.close()
  storage = undefined
  asked = 0
})

/** The app, not yet connected, its canned connector counting each thing it is asked. */
async function start(): Promise<RunningApp> {
  storage = openSqliteStorage(':memory:')
  const counted = (): ReturnType<Connecting['connector']> => {
    const canned = cannedConnector(FIXTURE)
    return {
      milestoneChoices: () => (asked++, canned.milestoneChoices()),
      searchChoices: (kind, text) => (asked++, canned.searchChoices(kind, text)),
      read: (query, finishedSince) => (asked++, canned.read(query, finishedSince)),
    }
  }
  const connecting: Connecting = { connections: storage, reads: storage, milestoneQueries: storage, setup: storage, secrets: openMemorySecrets(), connector: counted }
  app = await startAppAndOpenBrowser({ port: 0, openBrowser: () => {}, storage, connecting, today: () => TODAY, now: () => `${TODAY}T09:00:00Z` })
  return app
}

/** The app connected to GitHub, with the milestone picked. */
async function picked(): Promise<RunningApp> {
  const running = await start()
  await post(running, '/inputs/connect', { tracker: 'github', repo: 'shop-team/shop', token: 'token' })
  await post(running, '/inputs/milestone-query/add', { ...CHECKOUT })
  return running
}

/** The setup steps' list on a page: each step's name, and how it is marked. */
function stepsOf(html: string): string {
  const start = html.indexOf('<ol class="setup-steps"')
  expect(start).toBeGreaterThan(-1)
  return html.slice(start, html.indexOf('</ol>', start))
}

describe('the setup steps', () => {
  test('open at Connect, the only step shown, marked as the one of four the EM is on, with Skip', async () => {
    const html = await page(await start(), '/inputs')

    expect(stepsOf(html)).toMatch(/<li aria-current="step">Connect<\/li>\s*<li>Milestone<\/li>\s*<li>Comparable work<\/li>\s*<li>Check<\/li>/)
    expect(html).toContain('id="connect"')
    expect(html).not.toContain('id="milestone-tickets"')
    expect(html).toContain('formaction="/inputs/setup/skip"')
  })

  test('walk forward from Milestone to Comparable work and Check, and back, each step done before marked, linking back to it', async () => {
    const running = await picked()

    const milestone = await page(running, '/inputs')
    expect(stepsOf(milestone)).toMatch(/<li class="done"><a href="\/inputs\?step=connect#connect">Connect<\/a><\/li>\s*<li aria-current="step">Milestone<\/li>/)
    expect(milestone).toContain('id="milestone-tickets"')
    expect(milestone).not.toContain('id="connect"')
    expect(milestone).toMatch(/<a href="\/inputs\?step=connect#connect" class="button">Back<\/a>/)
    expect(milestone).toMatch(/<a href="\/inputs\?step=comparableWork#comparable-work" class="button primary">Next<\/a>/)

    const comparable = await page(running, '/inputs?step=comparableWork')
    expect(comparable).toContain('id="comparable-work"')
    expect(comparable).not.toContain('id="milestone-tickets"')
    expect(comparable).toMatch(/<a href="\/inputs#milestone-tickets" class="button">Back<\/a>/)
    expect(comparable).toMatch(/<a href="\/inputs\?step=check#check" class="button primary">Skip<\/a>/)

    const check = await page(running, '/inputs?step=check')
    expect(stepsOf(check)).toMatch(/<li aria-current="step">Check<\/li>/)
    expect(check).toMatch(/<a href="\/inputs\?step=comparableWork#comparable-work" class="button">Back<\/a>/)
    expect(check).toMatch(/<form method="post" action="\/inputs\/setup\/use-these">\s*<button type="submit" class="primary">Use these<\/button>/)

    const connect = await page(running, '/inputs?step=connect')
    expect(connect).toContain('Connected to GitHub · <b>shop-team/shop</b>')
    expect(connect).toMatch(/<a href="\/inputs#milestone-tickets" class="button primary">Next<\/a>/)
  })

  test('keep the Comparable work step open as its query is edited and picked from', async () => {
    const running = await picked()

    const added = await post(running, '/inputs/comparable-work/add', { ...CHECKOUT })
    expect(added.headers.get('location')).toBe('/inputs?step=comparableWork#comparable-work')
    const comparable = await page(running, '/inputs?step=comparableWork')
    expect(comparable).toMatch(/<a href="\/inputs\?step=check#check" class="button primary">Next<\/a>/)
    expect(comparable).toContain('href="/inputs?step=comparableWork&#38;edit=comparable#comparable-work"')
    expect(comparable).toContain('<input type="hidden" name="step" value="comparableWork">')
  })
})

describe('"Use these"', () => {
  test('closes setup to a summary naming the tracker, the repo and the read time, above the Milestone and Pace sections', async () => {
    const running = await picked()

    const used = await post(running, '/inputs/setup/use-these', {})
    expect(used.status).toBe(303)
    expect(used.headers.get('location')).toBe('/inputs')
    const html = await page(running, '/inputs')
    const summary = html.indexOf('id="setup-summary"')
    expect(summary).toBeGreaterThan(-1)
    expect(html.slice(summary)).toMatch(/GitHub · <b>shop-team\/shop<\/b><\/span>\s*<span class="read">read 12 Nov \d\d:00<\/span>/)
    expect(summary).toBeLessThan(html.indexOf('id="milestone"'))
    expect(html.indexOf('id="milestone"')).toBeLessThan(html.indexOf('id="pace"'))
    expect(html).not.toContain('class="setup-steps"')
    expect(html).not.toContain('id="milestone-tickets"')
  })

  test('the summary names the milestone’s pick with its kind, says the leaf-and-epics line once, and flags nothing for a working setup', async () => {
    const running = await picked()
    await post(running, '/inputs/setup/use-these', {})

    const html = await page(running, '/inputs')
    const summary = html.slice(html.indexOf('id="setup-summary"'), html.indexOf('id="milestone"'))
    expect(summary).toMatch(/<dt>Milestone<\/dt>\s*<dd>Checkout v2 <span class="kind">\(milestone\)<\/span><\/dd>/)
    expect(summary).not.toContain('<dt>Comparable</dt>')
    expect(html.split('Leaf tickets only. Epics include their sub-epics.')).toHaveLength(2)
    expect(summary).not.toContain('class="note warn flag"')
  })

  test('the summary shows a query written by hand as written, and flags a read that matches nothing beneath it', async () => {
    const running = await picked()
    await post(running, '/inputs/milestone-query/edit', { query: 'milestone:"Checkout v2" -label:wontfix' })
    await post(running, '/inputs/setup/use-these', {})

    const html = await page(running, '/inputs')
    const summary = html.slice(html.indexOf('id="setup-summary"'), html.indexOf('id="milestone"'))
    expect(summary).toMatch(/<dt>Milestone<\/dt>\s*<dd><code>milestone:&#34;Checkout v2&#34; -label:wontfix<\/code><\/dd>/)
    expect(summary).toMatch(/<p class="note warn flag">⚠ Milestone query: This query matches nothing/)
  })

  test('once set up, the Inputs screen reads nothing from the tracker, its choices included', async () => {
    const running = await picked()
    await post(running, '/inputs/setup/use-these', {})
    asked = 0

    await page(running, '/inputs')
    await page(running, '/inputs?step=comparableWork')
    expect(asked).toBe(0)
  })
})

describe('Change', () => {
  test('reopens the steps at Milestone, with the connection and the milestone’s pick as they were', async () => {
    const running = await picked()
    await post(running, '/inputs/setup/use-these', {})

    const changed = await post(running, '/inputs/setup/change', {})
    expect(changed.headers.get('location')).toBe('/inputs#milestone-tickets')
    const html = await page(running, '/inputs')
    expect(stepsOf(html)).toContain('<li aria-current="step">Milestone</li>')
    expect(html).toContain('Checkout v2')
    expect(html).toMatch(/<a href="\/inputs\?step=comparableWork#comparable-work" class="button primary">Next<\/a>/)
  })
})

describe('skipping connecting', () => {
  test('shows the inputs as the MVP has them, with a way to connect a tracker after all', async () => {
    const running = await start()

    const skipped = await post(running, '/inputs/setup/skip', { tracker: 'github', repo: '', token: '' })
    expect(skipped.headers.get('location')).toBe('/inputs')
    const html = await page(running, '/inputs')
    expect(html).not.toContain('class="setup-steps"')
    expect(html).not.toContain('id="connect"')
    expect(html).toMatch(/No tracker connected\.[\s\S]*<form method="post" action="\/inputs\/setup\/change">\s*<button type="submit" class="linkish">Connect a tracker<\/button>/)

    await post(running, '/inputs/setup/change', {})
    expect(stepsOf(await page(running, '/inputs'))).toContain('<li aria-current="step">Connect</li>')
  })
})
