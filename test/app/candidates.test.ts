import { afterEach, describe, expect, test } from 'vitest'
import { startAppAndOpenBrowser, type RunningApp } from '../../src/app/launch.js'
import { cannedConnector, type CannedFixture } from '../../src/connectors/canned/cannedConnector.js'
import type { Choice, Connector } from '../../src/connectors/connector.js'
import type { Connecting } from '../../src/forecast/connection.js'
import { openMemorySecrets } from '../../src/secrets/memorySecrets.js'
import { openSqliteStorage } from '../../src/storage/sqliteStorage.js'
import type { TeamStorage } from '../trackerScenario.js'

// Candidates for comparable work on the Inputs screen (#205), through the local server, on the canned connector.

const checkout: Choice = { kind: 'milestone', name: 'Checkout v2', query: 'milestone:"Checkout v2"' }
const payments: Choice = { kind: 'label', name: 'payments', query: 'label:"payments"' }
const bug: Choice = { kind: 'label', name: 'bug', query: 'label:"bug"' }
const broken: Choice = { kind: 'label', name: 'broken', query: 'label:"broken"' }

/** A ticket finished on each day in `days`. */
const finishedOn = (prefix: string, days: string[]) => days.map((day, n) => ({ id: `${prefix}${n}`, finishedAt: `${day}T10:00:00Z` }))

const FIXTURE: CannedFixture = {
  milestoneChoices: [
    { kind: 'milestone', choices: [checkout], pastLimit: false },
    { kind: 'label', choices: [payments, bug, broken], pastLimit: false },
  ],
  reads: {
    // 2 a week, every week from its start on 1 Oct; the reads reach whole from the week of 17 Sep, two weeks before
    [checkout.query]: {
      tickets: [
        { id: 'm-open' },
        ...finishedOn('m', ['2026-10-02', '2026-10-03', '2026-10-09', '2026-10-10', '2026-10-16', '2026-10-17', '2026-10-23', '2026-10-24', '2026-10-30', '2026-10-31', '2026-11-06', '2026-11-07']),
      ],
      incomplete: false,
    },
    [payments.query]: { tickets: [{ id: 'p-open' }, ...finishedOn('p', ['2026-10-02', '2026-10-30'])], incomplete: false },
    [broken.query]: { failure: 'unavailable' },
  },
}

let app: RunningApp | undefined
let storage: TeamStorage | undefined
let reads: string[] = []

afterEach(async () => {
  await app?.close()
  app = undefined
  storage?.close()
  storage = undefined
})

async function startConnected(): Promise<RunningApp> {
  storage = openSqliteStorage(':memory:')
  const counted = (connector: Connector): Connector => ({ ...connector, read: (query, since) => (reads.push(query), connector.read(query, since)) })
  const connecting: Connecting = {
    connections: storage,
    queries: storage,
    setup: storage,
    secrets: openMemorySecrets(),
    connector: () => counted(cannedConnector(FIXTURE)),
  }
  app = await startAppAndOpenBrowser({
    port: 0,
    openBrowser: () => {},
    storage,
    connecting,
    today: () => '2026-11-12',
    now: () => '2026-11-12T09:00:00Z',
  })
  await post(app, '/inputs/connect', { tracker: 'github', repo: 'shop-team/shop', token: 'token' })
  await post(app, '/inputs/milestone', { name: 'Checkout v2', startDate: '2026-10-01', ticketsRemaining: '30' })
  await post(app, '/inputs/milestone-query/add', checkout)
  reads = []
  return app
}

const page = async (running: RunningApp, path = '/inputs?step=comparableWork'): Promise<string> => (await fetch(new URL(path, running.url))).text()

const post = (running: RunningApp, path: string, fields: Record<string, string> | Choice): Promise<Response> =>
  fetch(new URL(path, running.url), { method: 'POST', body: new URLSearchParams({ ...fields }), redirect: 'manual' })

/** The Comparable work step. */
function stepOf(html: string): string {
  const start = html.indexOf('id="comparable-work"')
  expect(start).toBeGreaterThan(-1)
  return html.slice(start, html.indexOf('</section>', start))
}

/** The candidates block's opening, as the page names it. */
const openingOf = (html: string): string => /data-opening="([^"]+)"/.exec(stepOf(html))![1]!

/** What the step's script asks for once `choices` are opened, in `opening`. */
function candidatesPath(opening: string, choices: Choice[]): string {
  const params = new URLSearchParams({ opening })
  for (const choice of choices) for (const [field, value] of Object.entries(choice)) params.append(field, value)
  return `/inputs/comparable-work-candidates?${params}`
}

describe('candidates for comparable work', () => {
  test('the step lists them without data, reading none, each with a link to open it', async () => {
    const running = await startConnected()

    const step = stepOf(await page(running))

    expect(reads).toEqual([])
    expect(step).toContain('class="candidates"')
    expect(step).toContain(`href="/inputs?step=comparableWork&#38;comparableOpen=${encodeURIComponent(payments.query)}#comparable-work"`)
    expect(step).not.toContain('Slower than the milestone')
  })

  test('opening one reads it alone, and shows it in its group with its data', async () => {
    const running = await startConnected()

    const step = stepOf(await page(running, `/inputs?step=comparableWork&comparableOpen=${encodeURIComponent(payments.query)}`))

    expect(reads).toEqual([payments.query])
    expect(step).toContain('Slower than the milestone')
    expect(step).toMatch(/payments[^]*2 a week slower/)
    expect(step).toContain('2 finished')
    expect(step).toContain('last finished 30 Oct')
    expect(step).toContain('1 open')
  })

  test('the milestone itself is marked', async () => {
    const running = await startConnected()

    const step = stepOf(await page(running, `/inputs?step=comparableWork&comparableOpen=${encodeURIComponent(checkout.query)}`))

    expect(step).toContain('About the same')
    expect(step).toContain('this milestone: counts its own too')
  })

  test('the milestone itself is marked in the step’s lists, unread', async () => {
    const running = await startConnected()

    const step = stepOf(await page(running))

    expect(reads).toEqual([])
    expect(step).toMatch(/Checkout v2 <span class="kind">milestone<\/span> <span class="this">this milestone<\/span><\/button>/)
  })

  test('narrowing the list to a few by typing reads those', async () => {
    const running = await startConnected()

    const step = stepOf(await page(running, '/inputs?step=comparableWork&comparableFind=pay'))

    expect(reads).toEqual([payments.query])
    expect(step).toContain('Slower than the milestone')
  })

  test('a candidate whose read fails shows why, and can still be picked', async () => {
    const running = await startConnected()

    const step = stepOf(await page(running, `/inputs?step=comparableWork&comparableOpen=${encodeURIComponent(broken.query)}`))

    expect(step).toContain('GitHub couldn’t read it just now.')
    expect(step).toMatch(/<form method="post" action="\/inputs\/comparable-work\/add#comparable-work"[^>]*>[^]*?value="label:&#34;broken&#34;"[^]*?GitHub couldn’t read it/)
  })

  test('the step’s script asks for the candidates opened, each read once in the opening', async () => {
    const running = await startConnected()
    const opening = openingOf(await page(running))

    await page(running, candidatesPath(opening, [payments]))
    const html = await page(running, candidatesPath(opening, [payments, bug]))

    expect(reads).toEqual([payments.query, bug.query])
    expect(html).toContain('Slower than the milestone')
    expect(html).toContain('Nothing finished')
  })
})
