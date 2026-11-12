import { afterEach, describe, expect, test } from 'vitest'
import { startAppAndOpenBrowser, type RunningApp } from '../../src/app/launch.js'
import { openWebApp } from '../../src/app/webApp.js'
import { cannedConnector, type CannedFixture } from '../../src/connectors/canned/cannedConnector.js'
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

async function startConnected(): Promise<RunningApp> {
  storage = openSqliteStorage(':memory:')
  const connecting: Connecting = {
    connections: storage,
    reads: storage,
    milestoneQueries: storage,
    secrets: openMemorySecrets(),
    connector: () => cannedConnector(FIXTURE),
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

  test('Edit as a query opens the query in a box, read within the connected repo', async () => {
    const running = await startConnected()
    await post(running, '/inputs/milestone-query/add', { kind: 'milestone', name: 'Payments v2', query: 'milestone:"Payments v2"' })

    expect(stepOf(await page(running))).toContain('href="/inputs?edit=query#milestone-tickets"')
    const step = stepOf(await page(running, '/inputs?edit=query'))

    expect(step).toMatch(/<form method="post" action="\/inputs\/milestone-query\/edit#milestone-tickets"[^]*name="query" value="milestone:&#34;Payments v2&#34;"/)
    expect(step).toContain('shop-team/shop')
    expect(step).not.toContain('class="chip"')
    expect(step).not.toContain('type="search"')
  })

  test('a hand-edited query is read once submitted, and the step stays open for editing', async () => {
    const running = await startConnected()

    const edited = await post(running, '/inputs/milestone-query/edit', { query: 'milestone:"Payments v2"' })

    expect(edited.status).toBe(303)
    expect(edited.headers.get('location')).toBe('/inputs?edit=query#milestone-tickets')
    expect(stepOf(await page(running, '/inputs?edit=query'))).toContain('1 open · 1 finished in the last 8 weeks')
  })

  test('free text is refused: the step shows again with the query as typed and why', async () => {
    const running = await startConnected()

    const refused = await post(running, '/inputs/milestone-query/edit', { query: 'payments' })

    expect(refused.status).toBe(400)
    const step = stepOf(await refused.text())
    expect(step).toContain('name="query" value="payments"')
    expect(step).toContain('“payments” is free text, which isn’t read.')
  })

  test('Back to finding warns when it will clear a query the picker can’t show, and going back clears it', async () => {
    const running = await startConnected()
    await post(running, '/inputs/milestone-query/edit', { query: 'label:checkout -label:bug' })

    const editing = stepOf(await page(running))
    const back = await post(running, '/inputs/milestone-query/back', {})

    expect(editing).toContain('The picker can’t show this query, so going back to finding clears it.')
    expect(editing).toContain('action="/inputs/milestone-query/back#milestone-tickets"')
    expect(back.headers.get('location')).toBe('/inputs#milestone-tickets')
    const finding = stepOf(await page(running))
    expect(finding).toContain('Nothing picked yet.')
    expect(finding).toContain('type="search"')
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
