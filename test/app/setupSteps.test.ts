import { afterEach, describe, expect, test } from 'vitest'
import { startAppAndOpenBrowser, type RunningApp } from '../../src/app/launch.js'
import { cannedConnector, type CannedFixture } from '../../src/connectors/canned/cannedConnector.js'
import type { Connecting } from '../../src/forecast/connection.js'
import { openMemorySecrets } from '../../src/secrets/memorySecrets.js'
import { openSqliteStorage } from '../../src/storage/sqliteStorage.js'
import { CHECKOUT, TODAY, type TeamStorage } from '../trackerScenario.js'
import { appOnTracker, page, post, type AppOnTracker } from './appOnTracker.js'

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
  const connecting: Connecting = { connections: storage, queries: storage, setup: storage, secrets: openMemorySecrets(), connector: counted }
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
    expect(summary).toMatch(/<dt>Milestone<\/dt>\s*<dd>Checkout v2 <span class="kind">\(milestone\)<\/span> · 1<\/dd>/)
    expect(summary).not.toContain('<dt>Comparable</dt>')
    expect(html.split('Leaf tickets only. Epics include their sub-epics.')).toHaveLength(2)
    expect(summary).not.toContain('class="note warn flag"')
  })

  test('the summary gives each pick its count, a pick of several read once Check opens', async () => {
    const SEARCH = { kind: 'epic', name: '#57 Search revamp', query: 'parent-issue:shop-team/shop#57' }
    FIXTURE.reads[SEARCH.query] = { tickets: [{ id: 's1' }, { id: 's2', finishedAt: `${TODAY}T08:00:00Z` }], incomplete: false }
    const running = await picked()
    await post(running, '/inputs/milestone-query/add', SEARCH)
    const rowOf = async () => {
      const html = await page(running, '/inputs')
      return html.slice(html.indexOf('<dt>Milestone</dt>'), html.indexOf('</dd>', html.indexOf('<dt>Milestone</dt>')))
    }

    await post(running, '/inputs/setup/use-these', {})
    delete FIXTURE.reads[SEARCH.query]
    expect(await rowOf()).toMatch(/#57 Search revamp <span class="kind">\(epic\)<\/span>$/)
    await post(running, '/inputs/setup/change', {})
    FIXTURE.reads[SEARCH.query] = { tickets: [{ id: 's1' }, { id: 's2', finishedAt: `${TODAY}T08:00:00Z` }], incomplete: false }
    await page(running, '/inputs?step=check')
    delete FIXTURE.reads[SEARCH.query]
    await post(running, '/inputs/setup/use-these', {})
    expect(await rowOf()).toMatch(/Checkout v2 <span class="kind">\(milestone\)<\/span> · 1, #57 Search revamp <span class="kind">\(epic\)<\/span> · 2$/)
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

describe('Read again', () => {
  let onTracker: AppOnTracker | undefined
  afterEach(async () => {
    await onTracker?.close()
    onTracker = undefined
  })

  /** The app connected to GitHub, the milestone picked and read at 09:00 (3 open), and "Use these". */
  async function setUp(): Promise<{ fixture: CannedFixture; onTracker: AppOnTracker }> {
    const fixture: CannedFixture = { ...FIXTURE, reads: { [CHECKOUT.query]: { tickets: [{ id: 'o1' }, { id: 'o2' }, { id: 'o3' }], incomplete: false } } }
    onTracker = await appOnTracker(fixture)
    await post(onTracker.running, '/inputs/connect', { tracker: 'github', repo: 'shop-team/shop', token: 'token' })
    await post(onTracker.running, '/inputs/milestone-query/add', { ...CHECKOUT })
    await post(onTracker.running, '/inputs/setup/use-these', {})
    onTracker.readAt(`${TODAY}T14:30:00Z`)
    return { fixture, onTracker }
  }
  const summaryOf = (html: string) => html.slice(html.indexOf('id="setup-summary"'), html.indexOf('id="milestone"'))

  test('sits beside Change in the summary’s head, and reads again, the read time updating', async () => {
    const { fixture, onTracker } = await setUp()
    const before = summaryOf(await page(onTracker.running, '/inputs'))
    expect(before).toMatch(
      /<div class="setup-head">[\s\S]*<form method="post" action="\/inputs\/setup\/read-again">\s*<button type="submit" class="linkish">Read again<\/button>[\s\S]*<\/div>\s*<dl/,
    )
    fixture.reads[CHECKOUT.query] = { tickets: [{ id: 'o1' }], incomplete: false }

    const read = await post(onTracker.running, '/inputs/setup/read-again', {})
    expect(read.status).toBe(303)
    expect(read.headers.get('location')).toBe('/inputs')
    expect(onTracker.storage.savedRead({ teamId: 'team', query: CHECKOUT.query })).toMatchObject({ readAt: `${TODAY}T14:30:00Z`, tickets: [{ id: 'o1' }] })
  })

  test('failing, goes back to the Inputs screen, its summary saying why there on every load, the saved read in use', async () => {
    const { fixture, onTracker } = await setUp()
    fixture.reads[CHECKOUT.query] = { failure: 'unavailable' }

    const failed = await post(onTracker.running, '/inputs/setup/read-again', {})
    expect(failed.status).toBe(303)
    expect(failed.headers.get('location')).toBe('/inputs')
    expect(summaryOf(await page(onTracker.running, '/inputs'))).toContain('⚠ GitHub can’t be reached')
    const summary = summaryOf(await page(onTracker.running, '/inputs'))
    expect(summary).toMatch(
      /<p class="note warn flag">⚠ GitHub can’t be reached just now, or is limiting requests, so the last read stays in use\. Try again in a few minutes\.<\/p>/,
    )
    expect(onTracker.storage.savedRead({ teamId: 'team', query: CHECKOUT.query })).toMatchObject({ readAt: `${TODAY}T09:00:00Z` })
  })

  test('notes once, beneath the rows, that the counts of a row of several picks wait for Check', async () => {
    const SEARCH = { kind: 'epic', name: '#57 Search revamp', query: 'parent-issue:shop-team/shop#57' }
    const fixture: CannedFixture = { ...FIXTURE, reads: { ...FIXTURE.reads, [SEARCH.query]: { tickets: [{ id: 's1' }], incomplete: false } } }
    onTracker = await appOnTracker(fixture)
    await post(onTracker.running, '/inputs/connect', { tracker: 'github', repo: 'shop-team/shop', token: 'token' })
    await post(onTracker.running, '/inputs/milestone-query/add', { ...CHECKOUT })
    await post(onTracker.running, '/inputs/milestone-query/add', SEARCH)
    await page(onTracker.running, '/inputs?step=check')
    await post(onTracker.running, '/inputs/setup/use-these', {})
    onTracker.readAt(`${TODAY}T14:30:00Z`)

    await post(onTracker.running, '/inputs/setup/read-again', {})
    const summary = summaryOf(await page(onTracker.running, '/inputs'))
    expect(summary).toMatch(
      /#57 Search revamp <span class="kind">\(epic\)<\/span><\/dd>\s*<\/dl>\s*<p class="note muted">Read again reads each query whole, so the picks show no counts\. [^<]*<\/p>/,
    )
    expect(summary.match(/Read again reads each query whole/g)).toHaveLength(1)
  })

  test('with the token refused, offers Change, which opens the Connect step', async () => {
    const { fixture, onTracker } = await setUp()
    fixture.reads[CHECKOUT.query] = { failure: 'unauthorised' }

    await post(onTracker.running, '/inputs/setup/read-again', {})
    const summary = summaryOf(await page(onTracker.running, '/inputs'))
    expect(summary).toMatch(
      /⚠ GitHub refused the token\.[^<]*<form method="post" action="\/inputs\/setup\/change-connection">\s*<button type="submit" class="linkish">Change<\/button>/,
    )

    const changed = await post(onTracker.running, '/inputs/setup/change-connection', {})
    expect(changed.headers.get('location')).toBe('/inputs?step=connect#connect')
    const html = await page(onTracker.running, '/inputs?step=connect')
    expect(stepsOf(html)).toContain('<li aria-current="step">Connect</li>')
    expect(html).toContain('id="connect"')
  })
})

describe('the draft (#218)', () => {
  test('a pick in setup leaves the Inputs values alone until "Use these"', async () => {
    const running = await start()
    await post(running, '/inputs/connect', { tracker: 'github', repo: 'shop-team/shop', token: 'token' })

    await post(running, '/inputs/milestone-query/add', { ...CHECKOUT })

    expect(storage!.milestoneQuery('team')).toBeUndefined()
    expect(await page(running, '/inputs')).toContain('Checkout v2')
    await post(running, '/inputs/setup/use-these', {})
    expect(storage!.milestoneQuery('team')?.query).toBe(CHECKOUT.query)
  })

  test('Cancel is offered on every step of a first setup, and throws away what was started there', async () => {
    const cancelForm = /<form method="post" action="\/inputs\/setup\/cancel">\s*<button type="submit">Cancel<\/button>/
    const running = await start()
    expect(await page(running, '/inputs')).toMatch(cancelForm)
    await post(running, '/inputs/connect', { tracker: 'github', repo: 'shop-team/shop', token: 'token' })
    await post(running, '/inputs/milestone-query/add', { ...CHECKOUT })
    expect(await page(running, '/inputs?step=check')).toMatch(cancelForm)

    const cancelled = await post(running, '/inputs/setup/cancel', {})

    expect(cancelled.headers.get('location')).toBe('/inputs')
    expect(storage!.connection('team')).toBeUndefined()
    expect(storage!.setupDraft('team')).toBeUndefined()
  })

  test('Cancel, offered once Change reopens the steps, throws the draft away, back to the summary', async () => {
    const running = await picked()
    await post(running, '/inputs/setup/use-these', {})
    expect(await page(running, '/inputs')).not.toContain('/inputs/setup/cancel')
    await post(running, '/inputs/setup/change', {})
    await post(running, '/inputs/milestone-query/remove', { query: CHECKOUT.query })

    const html = await page(running, '/inputs')
    expect(html).toMatch(/<form method="post" action="\/inputs\/setup\/cancel">\s*<button type="submit">Cancel<\/button>/)
    const cancelled = await post(running, '/inputs/setup/cancel', {})

    expect(cancelled.headers.get('location')).toBe('/inputs')
    expect(await page(running, '/inputs')).toContain('id="setup-summary"')
    expect(storage!.milestoneQuery('team')?.query).toBe(CHECKOUT.query)
  })

  test('once the connection is changed in steps Change reopened, says why in place of Cancel', async () => {
    const running = await picked()
    await post(running, '/inputs/setup/use-these', {})
    await post(running, '/inputs/setup/change', {})
    await post(running, '/inputs/connect', { tracker: 'github', repo: 'shop-team/payments', token: 'token' })

    const html = await page(running, '/inputs')
    expect(html).not.toContain('/inputs/setup/cancel')
    expect(html).toMatch(/<p class="note">The connection changed in these steps, so they can’t be cancelled: [^<]*<\/p>\s*<div class="actions setup-nav">/)
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
    expect(html).toMatch(
      /No tracker connected\.[\s\S]*<form method="post" action="\/inputs\/setup\/change">\s*<button type="submit" class="linkish">Connect a tracker<\/button>/,
    )

    await post(running, '/inputs/setup/change', {})
    expect(stepsOf(await page(running, '/inputs'))).toContain('<li aria-current="step">Connect</li>')
  })
})
