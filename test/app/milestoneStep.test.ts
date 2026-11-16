import { afterEach, describe, expect, test } from 'vitest'
import { startAppAndOpenBrowser, type RunningApp } from '../../src/app/launch.js'
import { openWebApp } from '../../src/app/webApp.js'
import { cannedConnector, type CannedFixture } from '../../src/connectors/canned/cannedConnector.js'
import type { Choice, ChoicesOfKind } from '../../src/connectors/connector.js'
import type { Connecting } from '../../src/forecast/connection.js'
import { openMemorySecrets } from '../../src/secrets/memorySecrets.js'
import { openSqliteStorage } from '../../src/storage/sqliteStorage.js'
import type { TeamStorage } from '../trackerScenario.js'
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
let storage: TeamStorage | undefined

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
    queries: storage,
    setup: storage,
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
  fetch(new URL(path, running.url), { method: 'POST', body: new URLSearchParams(fields), headers: { origin: new URL(running.url).origin }, redirect: 'manual' })

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
    expect(step).toContain('1 open · 1 finished in the last 9 weeks')
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
    const epic = (n: number, name = `Epic ${n}`): Choice => ({ kind: 'epic', name, query: `parent-issue:shop-team/shop#${n}` })
    const listed = Array.from({ length: 100 }, (_, i) => epic(i + 1))
    const PAST_LIMIT: CannedFixture = {
      ...FIXTURE,
      milestoneChoices: [{ kind: 'epic', choices: listed, pastLimit: true }, ...(FIXTURE.milestoneChoices as ChoicesOfKind[])],
      searchable: { epic: [...listed, epic(140, 'Card payments'), epic(141, 'Payouts')] },
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

    test('the picker asks for one kind searched with the find box cleared, and gets its first 100 again', async () => {
      const running = await startConnected(PAST_LIMIT)

      const list = await (await fetch(new URL('/inputs/milestone-choices?kind=epic&find=', running.url))).text()

      expect(list).toContain('value="parent-issue:shop-team/shop#1"')
      expect(list).toContain('value="parent-issue:shop-team/shop#100"')
      expect(list).not.toContain('Card payments')
    })
  })

  test('Edit as a query opens the query in a box, read within the connected repo', async () => {
    const running = await startConnected()
    await post(running, '/inputs/milestone-query/add', { kind: 'milestone', name: 'Payments v2', query: 'milestone:"Payments v2"' })

    expect(stepOf(await page(running))).toContain('href="/inputs?edit=query#milestone-tickets"')
    const step = stepOf(await page(running, '/inputs?edit=query'))

    expect(step).toMatch(
      /<form method="post" action="\/inputs\/milestone-query\/edit#milestone-tickets"[^]*name="query" value="milestone:&#34;Payments v2&#34;"/,
    )
    expect(step).toContain('shop-team/shop')
    expect(step).not.toContain('class="chip"')
    expect(step).not.toContain('type="search"')
  })

  test('a hand-edited query is read once submitted, and the step stays open for editing', async () => {
    const running = await startConnected()

    const edited = await post(running, '/inputs/milestone-query/edit', { query: 'milestone:"Payments v2"' })

    expect(edited.status).toBe(303)
    expect(edited.headers.get('location')).toBe('/inputs?edit=query#milestone-tickets')
    expect(stepOf(await page(running, '/inputs?edit=query'))).toContain('1 open · 1 finished in the last 9 weeks')
  })

  test('free text is refused: the step shows again with the query as typed and why', async () => {
    const running = await startConnected()

    const refused = await post(running, '/inputs/milestone-query/edit', { query: 'payments' })

    expect(refused.status).toBe(400)
    const step = stepOf(await refused.text())
    expect(step).toContain('name="query" value="payments"')
    expect(step).toContain('“payments” is free text, which isn’t read.')
  })

  test('a query the tracker rejects shows again as typed with the tracker’s message, still reading the last that worked', async () => {
    const running = await startConnected({ ...FIXTURE, reads: { ...FIXTURE.reads, 'closed:>2026-13-45': { failure: 'invalidQuery', message: 'Not a date.' } } })
    await post(running, '/inputs/milestone-query/add', { kind: 'milestone', name: 'Payments v2', query: 'milestone:"Payments v2"' })

    const rejected = await post(running, '/inputs/milestone-query/edit', { query: 'closed:>2026-13-45' })

    expect(rejected.status).toBe(400)
    const step = stepOf(await rejected.text())
    expect(step).toContain('value="closed:&#62;2026-13-45"')
    expect(step).toContain('GitHub rejected this query: Not a date.')
    expect(step).toContain('Still reading <code>milestone:&#34;Payments v2&#34;</code>')
    expect(step).toContain('1 open · 1 finished in the last 9 weeks')
  })

  test('a pick whose query the tracker rejects keeps the step finding, with the chips that worked and the tracker’s message beside them', async () => {
    const joined = 'milestone:"Payments v2" OR milestone:"Checkout"'
    const running = await startConnected({ ...FIXTURE, reads: { ...FIXTURE.reads, [joined]: { failure: 'invalidQuery', message: 'Too many milestones.' } } })
    await post(running, '/inputs/milestone-query/add', { kind: 'milestone', name: 'Payments v2', query: 'milestone:"Payments v2"' })

    const rejected = await post(running, '/inputs/milestone-query/add', { kind: 'milestone', name: 'Checkout', query: 'milestone:"Checkout"' })

    expect(rejected.status).toBe(400)
    const step = stepOf(await rejected.text())
    expect(step).toMatch(/class="chip"[^]*Payments v2[^]*class="error" role="alert">GitHub rejected this query: Too many milestones\./)
    expect(step).toContain('type="search"')
    expect(step).not.toContain('id="milestone-query"')
    expect(step).toContain('1 open · 1 finished in the last 9 weeks')
  })

  test('a read matching nothing is flagged beside its line, while finding and editing', async () => {
    const running = await startConnected()
    await post(running, '/inputs/milestone-query/add', { kind: 'milestone', name: 'Checkout', query: 'milestone:"Checkout"' })

    const flagged = /0 open · 0 finished in the last 9 weeks[^]*class="note warn flag">⚠ This query matches nothing/
    expect(stepOf(await page(running))).toMatch(flagged)
    expect(stepOf(await page(running, '/inputs?edit=query'))).toMatch(flagged)
  })

  test('Back to finding asks first when it will clear a query the picker can’t show, and once confirmed clears it', async () => {
    const running = await startConnected()
    await post(running, '/inputs/milestone-query/edit', { query: 'label:checkout -label:bug' })

    const editing = stepOf(await page(running))
    const back = await post(running, '/inputs/milestone-query/back', {})

    expect(editing).toContain('The picker can’t show this query, so going back to finding clears it.')
    expect(editing).toContain('action="/inputs/milestone-query/back#milestone-tickets"')
    expect(back.headers.get('location')).toBe('/inputs?edit=query&confirm=back#milestone-tickets')
    const asking = stepOf(await page(running, '/inputs?edit=query&confirm=back'))
    expect(asking).toContain('name="confirmed" value="yes"')
    expect(asking).toContain('Clear the query and go back')
    expect(asking).toContain('href="/inputs?edit=query#milestone-tickets"')
    expect(stepOf(await page(running))).toContain('value="label:checkout -label:bug"')

    const confirmed = await post(running, '/inputs/milestone-query/back', { confirmed: 'yes' })

    expect(confirmed.headers.get('location')).toBe('/inputs#milestone-tickets')
    const finding = stepOf(await page(running))
    expect(finding).toContain('Nothing picked yet.')
    expect(finding).toContain('type="search"')
  })

  test('an incomplete read shows no count, only the flag asking to narrow the query', async () => {
    const running = await startConnected({ ...FIXTURE, reads: { 'is:open': { tickets: [{ id: 'o1' }], incomplete: true } } })
    await post(running, '/inputs/milestone-query/edit', { query: 'is:open' })

    const step = stepOf(await page(running))

    expect(step).toContain('class="note warn flag">⚠ GitHub gave only part of what this query matches')
    expect(step).not.toContain('open ·')
  })

  test('the lists show as the step opens, before anything is typed', async () => {
    const running = await startConnected()

    const html = await page(running)

    expect(html).not.toContain('.found:not(.finding)')
    expect(stepOf(html)).toContain('<div class="found">')
  })

  describe('an Inputs form posted while connected', () => {
    const sectionNumbers = (html: string): string[] =>
      [...html.matchAll(/<section[^>]* id="([^"]+)"[^]*?class="number">(\d+)</g)].map(([, id, n]) => `${id} ${n}`)

    test('refused, shows the screen again with the Milestone step, its sections numbered after it', async () => {
      const running = await startConnected()
      await post(running, '/inputs/milestone-query/add', { kind: 'milestone', name: 'Payments v2', query: 'milestone:"Payments v2"' })

      const refused = await post(running, '/inputs/cadence', { cadenceDays: '0' })

      expect(refused.status).toBe(400)
      const html = await refused.text()
      expect(stepOf(html)).toContain('class="chip"')
      expect(stepOf(html)).toContain('Checkout')
      expect(sectionNumbers(html).slice(0, 2)).toEqual(['milestone-tickets 01', 'milestone 02'])
    })

    test('saved in place, answers with its sections numbered after the Milestone step', async () => {
      const running = await startConnected()
      await post(running, '/inputs/milestone', { name: 'Payments v2', startDate: '2026-10-01', ticketsRemaining: '20' })

      const saved = await fetch(new URL('/inputs/cadence', running.url), {
        method: 'POST',
        body: new URLSearchParams({ cadenceDays: '14' }),
        headers: { origin: new URL(running.url).origin, 'forecaster-save': 'in-place' },
      })

      expect(saved.status).toBe(200)
      expect(sectionNumbers(await saved.text()).slice(0, 2)).toEqual(['milestone-tickets 01', 'milestone 02'])
    })
  })

  test('renaming the milestone, as posted or saved in place, moves a query of its tracker milestone to the new name', async () => {
    const running = await startConnected()
    await post(running, '/inputs/milestone', { name: 'Payments v2', startDate: '2026-10-01', ticketsRemaining: '20' })
    await post(running, '/inputs/milestone-query/add', { kind: 'milestone', name: 'Payments v2', query: 'milestone:"Payments v2"' })

    const renamed = await post(running, '/inputs/milestone', { name: 'Checkout', startDate: '2026-10-01', ticketsRemaining: '20' })

    expect(renamed.status).toBe(303)
    expect(stepOf(await page(running))).toMatch(/class="chip"[^]*Checkout[^]*This query matches nothing/)
    const back = await fetch(new URL('/inputs/milestone', running.url), {
      method: 'POST',
      body: new URLSearchParams({ name: 'Payments v2', startDate: '2026-10-01', ticketsRemaining: '20' }),
      headers: { origin: new URL(running.url).origin, 'forecaster-save': 'in-place' },
    })
    expect(back.status).toBe(200)
    expect(stepOf(await page(running))).toContain('1 open · 1 finished in the last 9 weeks')
  })

  test('before connecting, there is none', async () => {
    storage = openSqliteStorage(':memory:')
    const connecting: Connecting = {
      connections: storage,
      queries: storage,
      setup: storage,
      secrets: openMemorySecrets(),
      connector: () => cannedConnector(FIXTURE),
    }
    app = await startAppAndOpenBrowser({ port: 0, openBrowser: () => {}, storage, connecting })

    expect(await page(app)).not.toContain('id="milestone-tickets"')
  })

  test('the browser build has none', () => {
    const web = openWebApp({ storage: openWebStorage(undefined), today: () => '2026-11-12' })

    expect(web.show({ method: 'GET', path: '/inputs' }).html).not.toContain('id="milestone-tickets"')
  })
})
