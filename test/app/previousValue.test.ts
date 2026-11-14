import { afterEach, expect, test } from 'vitest'
import { startAppAndOpenBrowser, type RunningApp } from '../../src/app/launch.js'
import { cannedConnector, type CannedFixture } from '../../src/connectors/canned/cannedConnector.js'
import type { Ticket } from '../../src/connectors/connector.js'
import type { Connecting } from '../../src/forecast/connection.js'
import { finishedSinceFor, readQuery } from '../../src/forecast/finished.js'
import { openMemorySecrets } from '../../src/secrets/memorySecrets.js'
import { openSqliteStorage, type SqliteStorage } from '../../src/storage/sqliteStorage.js'

// The faint previous value on the Inputs screen (#214), through the local server as the EM's browser sees it, on the
// canned connector.

const CHECKOUT = { kind: 'milestone', name: 'Checkout v2', query: 'milestone:"Checkout v2"' } as const

// The Tuesdays of the weeks the reads reach whole, from 22 Sep; the milestone started on Monday 31 Aug
const TUESDAYS = ['2026-09-22', '2026-09-29', '2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27', '2026-11-03']

const finished = (counts: number[]): Ticket[] =>
  counts.flatMap((count, week) => Array.from({ length: count }, (_, i) => ({ id: `w${week}-${i}`, finishedAt: `${TUESDAYS[week]}T10:00:00Z` })))

const open = (count: number): Ticket[] => Array.from({ length: count }, (_, i) => ({ id: `o${i}` }))

let fixture: CannedFixture
let app: RunningApp | undefined
let storage: SqliteStorage | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
  storage?.close()
  storage = undefined
})

/** The app on 12 Nov, both values following GitHub, its first read at 09:05 and a second at 14:30 that reads `then`. */
async function readTwice(then: Ticket[]): Promise<RunningApp> {
  fixture = {
    milestoneChoices: [{ kind: 'milestone', choices: [CHECKOUT], pastLimit: false }],
    reads: { [CHECKOUT.query]: { tickets: [...open(34), ...finished([5, 6, 0, 7, 5, 6, 8])], incomplete: false } },
  }
  storage = openSqliteStorage(':memory:')
  const connecting: Connecting = {
    connections: storage,
    reads: storage,
    milestoneQueries: storage,
    secrets: openMemorySecrets(),
    connector: () => cannedConnector(fixture),
  }
  app = await startAppAndOpenBrowser({
    port: 0,
    openBrowser: () => {},
    storage,
    connecting,
    today: () => '2026-11-12',
    now: () => '2026-11-12T09:05:00Z',
  })
  await post(app, '/inputs/milestone', { name: 'Checkout v2', startDate: '2026-08-31', ticketsRemaining: '30' })
  await post(app, '/inputs/connect', { tracker: 'github', repo: 'shop-team/shop', token: 'token' })
  await post(app, '/inputs/milestone-query/add', CHECKOUT)
  await post(app, '/inputs/tickets-source', { ticketsSource: 'tracker' })
  await post(app, '/inputs/pace-mode', { paceMode: 'tracker' })
  fixture.reads[CHECKOUT.query] = { tickets: then, incomplete: false }
  const readAt = '2026-11-12T14:30:00Z'
  await readQuery(cannedConnector(fixture), storage, { teamId: 'team', query: CHECKOUT.query, finishedSince: finishedSinceFor(readAt), readAt })
  return app
}

const post = (running: RunningApp, path: string, fields: Record<string, string>): Promise<Response> =>
  fetch(new URL(path, running.url), { method: 'POST', body: new URLSearchParams(fields), redirect: 'manual' })

const inputsPage = async (running: RunningApp): Promise<string> => (await fetch(new URL('/inputs', running.url))).text()

test('after a new read, each value following GitHub shows faintly what it replaced, and when that was read', async () => {
  const running = await readTwice([...open(31), ...finished([5, 6, 0, 7, 5, 6, 11])])

  const html = await inputsPage(running)

  expect(html).toContain('<span class="reading-value">31</span>')
  // dated in the EM's time zone, the machine's
  expect(html).toMatch(/<span class="reading-line was">was 34 on \d\d Nov \d\d:\d\d<\/span>/)
  expect(html).toContain('aria-label="Finished tickets per week, oldest first: 5, 6, 0, 7, 5, 6, 11"')
  expect(html).toMatch(/<p class="reading-line was">was 5, 6, 0, 7, 5, 6, 8 on \d\d Nov \d\d:\d\d<\/p>/)
})

test('a read that changed nothing shows no previous value', async () => {
  const running = await readTwice([...open(34), ...finished([5, 6, 0, 7, 5, 6, 8])])

  expect(await inputsPage(running)).not.toContain('class="reading-line was"')
})
