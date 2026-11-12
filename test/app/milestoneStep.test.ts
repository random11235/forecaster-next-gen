import { afterEach, describe, expect, test } from 'vitest'
import { startAppAndOpenBrowser, type RunningApp } from '../../src/app/launch.js'
import { openWebApp } from '../../src/app/webApp.js'
import { cannedConnector, type CannedFixture } from '../../src/connectors/canned/cannedConnector.js'
import type { ChoicesOfKind } from '../../src/connectors/connector.js'
import type { Connecting } from '../../src/forecast/connection.js'
import { openMemorySecrets } from '../../src/secrets/memorySecrets.js'
import { openSqliteStorage, type SqliteStorage } from '../../src/storage/sqliteStorage.js'
import { openWebStorage } from '../../src/storage/webStorage.js'

// The Milestone step on the Inputs screen (#191), through the local server as the EM's browser sees it, on the canned
// connector.

const FIXTURE: CannedFixture = {
  milestoneChoices: [
    {
      kind: 'milestone',
      choices: [
        { kind: 'milestone', name: 'Payments v2', query: 'milestone:"Payments v2"' },
        { kind: 'milestone', name: 'Checkout', query: 'milestone:"Checkout"' },
      ],
      pastLimit: false,
    },
  ],
  reads: {
    'milestone:"Payments v2"': { tickets: [{ id: 'p1' }, { id: 'p2', finishedAt: '2026-10-20T10:00:00Z' }], incomplete: false },
  },
}

let app: RunningApp | undefined
let storage: SqliteStorage | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
  storage?.close()
  storage = undefined
})

async function startConnected(fixture: CannedFixture = FIXTURE): Promise<RunningApp> {
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
  const connected = await post(app, '/inputs/connect', { tracker: 'github', repo: 'shop-team/shop', token: 'token' })
  expect(connected.headers.get('location')).toBe('/inputs#milestone-tickets')
  return app
}

const page = async (running: RunningApp, path = '/inputs'): Promise<string> => (await fetch(new URL(path, running.url))).text()

const post = (running: RunningApp, path: string, fields: Record<string, string>): Promise<Response> =>
  fetch(new URL(path, running.url), { method: 'POST', body: new URLSearchParams(fields), redirect: 'manual' })

/** The Milestone step's section of the Inputs screen. */
function stepOf(html: string): string {
  const start = html.indexOf('id="milestone-tickets"')
  expect(start).toBeGreaterThan(-1)
  return html.slice(start, html.indexOf('</section>', start))
}

describe('the Milestone step', () => {
  test('once connected, follows the Connect step and lists the choices to pick, with the query and its note', async () => {
    const running = await startConnected()

    const html = await page(running)

    expect(html.indexOf('id="milestone-tickets"')).toBeGreaterThan(html.indexOf('id="connect"'))
    const step = stepOf(html)
    expect(step).toContain('Payments v2')
    expect(step).toContain('Checkout')
    expect(step).toContain('Leaf tickets only. Epics include their sub-epics.')
  })

  test('what is typed to find filters the lists', async () => {
    const running = await startConnected()

    const step = stepOf(await page(running, '/inputs?find=pay'))

    expect(step).toContain('Payments v2')
    expect(step).not.toContain('Checkout')
  })

  test('a pick shows as a chip marked with its kind, with the query and the read’s line', async () => {
    const running = await startConnected()

    const picked = await post(running, '/inputs/milestone-query/add', { kind: 'milestone', name: 'Payments v2', query: 'milestone:"Payments v2"' })

    expect(picked.status).toBe(303)
    expect(picked.headers.get('location')).toBe('/inputs#milestone-tickets')
    const step = stepOf(await page(running))
    expect(step).toMatch(/class="chip"[^]*Payments v2[^]*milestone/)
    expect(step).toContain('milestone:&#34;Payments v2&#34;')
    expect(step).toContain('1 open · 1 finished in the last 8 weeks')
  })

  test('a removed chip is gone, and its choice listed again', async () => {
    const running = await startConnected()
    await post(running, '/inputs/milestone-query/add', { kind: 'milestone', name: 'Payments v2', query: 'milestone:"Payments v2"' })

    await post(running, '/inputs/milestone-query/remove', { query: 'milestone:"Payments v2"' })

    const step = stepOf(await page(running))
    expect(step).not.toContain('class="chip"')
    expect(step).not.toContain('open ·')
  })

  describe('with more than 100 epics', () => {
    const epic = (n: number, name = `Epic ${n}`) => ({ kind: 'epic', name, query: `parent-issue:shop-team/shop#${n}` })
    const listed = Array.from({ length: 100 }, (_, i) => epic(i + 1))
    const PAST_LIMIT: CannedFixture = {
      ...FIXTURE,
      milestoneChoices: [{ kind: 'epic', choices: listed, pastLimit: true }, ...(FIXTURE.milestoneChoices as ChoicesOfKind[])],
      searched: { epic: [...listed, epic(140, 'Card payments'), epic(141, 'Payouts')] },
    }

    test('what is typed searches the epics in the tracker, and still filters the milestones', async () => {
      const running = await startConnected(PAST_LIMIT)

      const step = stepOf(await page(running, '/inputs?find=payments'))

      expect(step).toContain('Card payments')
      expect(step).toContain('Payments v2')
      expect(step).not.toContain('Checkout')
      expect(step).not.toContain('Epic 1<')
    })

    test('the epics are marked to be searched as the EM types, the milestones not', async () => {
      const running = await startConnected(PAST_LIMIT)

      const step = stepOf(await page(running))

      expect(step).toContain('<div class="kind-list" data-kind="epic" data-searched>')
      expect(step).toContain('<div class="kind-list" data-kind="milestone">')
    })

    test('the picker asks for one kind searched, and gets its list alone', async () => {
      const running = await startConnected(PAST_LIMIT)

      const response = await fetch(new URL('/inputs/milestone-choices?kind=epic&find=payouts', running.url))
      const list = await response.text()

      expect(response.status).toBe(200)
      expect(list).toMatch(/^\s*<div class="kind-list" data-kind="epic" data-searched>/)
      expect(list).toContain('value="parent-issue:shop-team/shop#141"')
      expect(list).not.toContain('Payments v2')
      expect(list).not.toContain('<html')
    })
  })

  test('before connecting, there is none', async () => {
    storage = openSqliteStorage(':memory:')
    const connecting: Connecting = { connections: storage, reads: storage, milestoneQueries: storage, secrets: openMemorySecrets(), connector: () => cannedConnector(FIXTURE) }
    app = await startAppAndOpenBrowser({ port: 0, openBrowser: () => {}, storage, connecting })

    expect(await page(app)).not.toContain('id="milestone-tickets"')
  })

  test('the browser build has none', () => {
    const web = openWebApp({ storage: openWebStorage(undefined), today: () => '2026-11-12' })

    expect(web.show({ method: 'GET', path: '/inputs' }).html).not.toContain('id="milestone-tickets"')
  })
})
