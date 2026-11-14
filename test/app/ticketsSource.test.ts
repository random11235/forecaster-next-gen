import { afterEach, describe, expect, test } from 'vitest'
import { startAppAndOpenBrowser, type RunningApp } from '../../src/app/launch.js'
import { cannedConnector, type CannedFixture } from '../../src/connectors/canned/cannedConnector.js'
import type { Connecting } from '../../src/forecast/connection.js'
import { openMemorySecrets } from '../../src/secrets/memorySecrets.js'
import { openSqliteStorage, type SqliteStorage } from '../../src/storage/sqliteStorage.js'

// Tickets remaining's source on the Inputs screen (#211), through the local server as the EM's browser sees it, on
// the canned connector.

const CHECKOUT = { kind: 'milestone', name: 'Checkout v2', query: 'milestone:"Checkout v2"' } as const

const FIXTURE: CannedFixture = {
  milestoneChoices: [{ kind: 'milestone', choices: [CHECKOUT], pastLimit: false }],
  reads: { [CHECKOUT.query]: { tickets: [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }], incomplete: false } },
}

let app: RunningApp | undefined
let storage: SqliteStorage | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
  storage?.close()
  storage = undefined
})

/** The app, its milestone entered with 30 tickets typed; connected to GitHub with them picked, unless `connect` is false. */
async function start({ connect = true, fixture = FIXTURE } = {}): Promise<RunningApp> {
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
    now: () => '2026-11-12T09:00:00Z',
  })
  await post(app, '/inputs/milestone', { name: 'Checkout v2', startDate: '2026-11-16', ticketsRemaining: '30' })
  if (connect) {
    await post(app, '/inputs/connect', { tracker: 'github', repo: 'shop-team/shop', token: 'token' })
    await post(app, '/inputs/milestone-query/add', CHECKOUT)
  }
  return app
}

const post = (running: RunningApp, path: string, fields: Record<string, string>): Promise<Response> =>
  fetch(new URL(path, running.url), { method: 'POST', body: new URLSearchParams(fields), redirect: 'manual' })

/** The Milestone section of the Inputs screen. */
async function milestoneSection(running: RunningApp): Promise<string> {
  const html = await (await fetch(new URL('/inputs', running.url))).text()
  const start = html.indexOf('id="milestone"')
  expect(start).toBeGreaterThan(-1)
  return html.slice(start, html.indexOf('</section>', start))
}

describe('tickets remaining’s source', () => {
  test('connected, it offers GitHub or typed, typed chosen, with the typed number to type into', async () => {
    const running = await start()

    const section = await milestoneSection(running)

    expect(section).toMatch(/<input type="radio" name="ticketsSource" value="tracker"[^>]*> GitHub/)
    expect(section).toMatch(/<input type="radio" name="ticketsSource" value="typed" checked[^>]*> Typed/)
    expect(section).toContain('name="ticketsRemaining"')
    expect(section).toContain('value="30"')
  })

  test('following GitHub, it shows the latest read’s count and when it was read, with no field to type in', async () => {
    const running = await start()

    const chosen = await post(running, '/inputs/tickets-source', { ticketsSource: 'tracker' })

    expect(chosen.headers.get('location')).toBe('/inputs')
    const section = await milestoneSection(running)
    expect(section).toMatch(/value="tracker" checked/)
    expect(section).toMatch(/<span class="reading-value">3<\/span>/)
    expect(section).toMatch(/tickets remaining · GitHub, read 12 Nov \d\d:00/)
    expect(section).not.toContain('name="ticketsRemaining"')
  })

  test('saving the milestone while following keeps following', async () => {
    const running = await start()
    await post(running, '/inputs/tickets-source', { ticketsSource: 'tracker' })

    await post(running, '/inputs/milestone', { name: 'Checkout v3', startDate: '2026-11-16' })

    const section = await milestoneSection(running)
    expect(section).toContain('value="Checkout v3"')
    expect(section).toMatch(/<span class="reading-value">3<\/span>/)
  })

  test('an incomplete read’s count is marked incomplete beside it', async () => {
    const running = await start({ fixture: { ...FIXTURE, reads: { [CHECKOUT.query]: { tickets: [{ id: 'm1' }], incomplete: true } } } })

    await post(running, '/inputs/tickets-source', { ticketsSource: 'tracker' })

    const section = await milestoneSection(running)
    expect(section).toMatch(/<span class="reading-value">1<\/span>\s*<span class="incomplete">incomplete<\/span>/)
    expect(section).toContain('GitHub gave only part of the milestone’s tickets')
  })

  test('with no connection, there is no source to choose: tickets remaining is typed, as in the MVP', async () => {
    const running = await start({ connect: false })

    const section = await milestoneSection(running)

    expect(section).not.toContain('name="ticketsSource"')
    expect(section).toContain('name="ticketsRemaining"')
  })
})
