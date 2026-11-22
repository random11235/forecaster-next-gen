import { afterEach, describe, expect, test } from 'vitest'
import { startAppAndOpenBrowser, type RunningApp } from '../../src/app/launch.js'
import { post, saveInPlace } from './forms.js'
import { cannedConnector, type CannedFixture } from '../../src/connectors/canned.js'
import type { Choice, ChoicesOfKind } from '../../src/connectors/connector.js'
import type { Connecting } from '../../src/forecast/index.js'
import { openMemorySecrets } from '../../src/secrets/memorySecrets.js'
import { openSqliteStorage } from '../../src/storage/sqliteStorage.js'
import type { TeamStorage } from '../trackerScenario.js'

// The Milestone step on the Inputs screen (#191), through the local server, on the canned connector: the query
// parameters and form fields it reads, and where its forms go. What the step shows is Seam B's
// (test/forecast/queryStep.*.test.ts); how it is drawn, the component test's
// (test/app/components/queryStepSection.test.ts).

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
    clock: { now: () => '2026-11-12T09:00:00Z', timeZone: 'UTC' },
  })
  const connected = await post(app, '/inputs/connect', { tracker: 'github', repo: 'shop-team/shop', token: 'token' })
  expect(connected.headers.get('location')).toBe('/inputs#milestone-tickets')
  return app
}

const page = async (running: RunningApp, path = '/inputs'): Promise<string> => (await fetch(new URL(path, running.url))).text()

/** The Milestone step's section of the Inputs screen. */
function stepOf(html: string): string {
  const start = html.indexOf('id="milestone-tickets"')
  expect(start).toBeGreaterThan(-1)
  return html.slice(start, html.indexOf('</section>', start))
}

const PAYMENTS = { kind: 'milestone', name: 'Payments v2', query: 'milestone:"Payments v2"' }

describe('the Milestone step', () => {
  test('what is typed to find, in its query parameter, filters the lists', async () => {
    const running = await startConnected()

    const step = stepOf(await page(running, '/inputs?find=pay'))

    expect(step).toContain('Payments v2')
    expect(step).not.toContain('Checkout')
  })

  test('a pick is read from its form, and a chip removed from its own, each back to the step', async () => {
    const running = await startConnected()

    const picked = await post(running, '/inputs/milestone-query/add', PAYMENTS)
    expect([picked.status, picked.headers.get('location')]).toEqual([303, '/inputs#milestone-tickets'])
    expect(storage?.setupDraft('team')?.milestoneQuery?.query).toBe(PAYMENTS.query)

    const removed = await post(running, '/inputs/milestone-query/remove', { query: PAYMENTS.query })
    expect([removed.status, removed.headers.get('location')]).toEqual([303, '/inputs#milestone-tickets'])
    expect(storage?.setupDraft('team')?.milestoneQuery).toEqual({ picks: [], query: '' })
  })

  describe('with more than 100 epics', () => {
    const epic = (n: number, name = `Epic ${n}`): Choice => ({ kind: 'epic', name, query: `parent-issue:shop-team/shop#${n}` })
    const listed = Array.from({ length: 100 }, (_, i) => epic(i + 1))
    const PAST_LIMIT: CannedFixture = {
      ...FIXTURE,
      milestoneChoices: [{ kind: 'epic', choices: listed, pastLimit: true }, ...(FIXTURE.milestoneChoices as ChoicesOfKind[])],
      searchable: { epic: [...listed, epic(140, 'Card payments'), epic(141, 'Payouts')] },
    }

    test('the picker asks for one kind searched, and gets its list alone; with the find box cleared, its first 100 again', async () => {
      const running = await startConnected(PAST_LIMIT)

      const response = await fetch(new URL('/inputs/milestone-choices?kind=epic&find=payouts', running.url))
      const list = await response.text()

      expect(response.status).toBe(200)
      expect(list).toMatch(/^\s*<div class="kind-list" data-kind="epic" data-searched>/)
      expect(list).toContain('value="parent-issue:shop-team/shop#141"')
      expect(list).not.toContain('Payments v2')
      expect(list).not.toContain('<html')
      const cleared = await (await fetch(new URL('/inputs/milestone-choices?kind=epic&find=', running.url))).text()
      expect(cleared).toContain('value="parent-issue:shop-team/shop#100"')
      expect(cleared).not.toContain('Card payments')
    })
  })

  test('edit=query opens the query for editing; an edit is read from its form, and stays open', async () => {
    const running = await startConnected()
    await post(running, '/inputs/milestone-query/add', PAYMENTS)

    expect(stepOf(await page(running))).not.toContain('id="milestone-query"')
    expect(stepOf(await page(running, '/inputs?edit=query'))).toContain('id="milestone-query"')

    const edited = await post(running, '/inputs/milestone-query/edit', { query: 'milestone:"Checkout"' })
    expect([edited.status, edited.headers.get('location')]).toEqual([303, '/inputs?edit=query#milestone-tickets'])
    expect(storage?.setupDraft('team')?.milestoneQuery?.query).toBe('milestone:"Checkout"')
  })

  test('Back to finding asks first when it will clear a query the picker can’t show: confirm=back asks, confirmed=yes clears it', async () => {
    const running = await startConnected()
    await post(running, '/inputs/milestone-query/edit', { query: 'label:checkout -label:bug' })

    const back = await post(running, '/inputs/milestone-query/back', {})
    expect(back.headers.get('location')).toBe('/inputs?edit=query&confirm=back#milestone-tickets')
    expect(stepOf(await page(running, '/inputs?edit=query'))).not.toContain('name="confirmed"')
    expect(stepOf(await page(running, '/inputs?edit=query&confirm=back'))).toContain('name="confirmed" value="yes"')
    expect(storage?.setupDraft('team')?.milestoneQuery?.query).toBe('label:checkout -label:bug')

    const confirmed = await post(running, '/inputs/milestone-query/back', { confirmed: 'yes' })

    expect(confirmed.headers.get('location')).toBe('/inputs#milestone-tickets')
    expect(storage?.setupDraft('team')?.milestoneQuery).toEqual({ picks: [], query: '' })
  })

  // how the screen numbers its sections after the step: components/inputsScreen.test.ts
  describe('an Inputs form posted while connected', () => {
    test('refused, a 400 showing the screen again with the Milestone step', async () => {
      const running = await startConnected()

      const refused = await post(running, '/inputs/cadence', { cadenceDays: '0' })

      expect(refused.status).toBe(400)
      expect(await refused.text()).toContain('id="milestone-tickets"')
    })

    test('saved in place, a 200 with the screen as saved, the Milestone step still on it', async () => {
      const running = await startConnected()
      await post(running, '/inputs/milestone', { name: 'Payments v2', startDate: '2026-10-01', ticketsRemaining: '20' })

      const saved = await saveInPlace(running, '/inputs/cadence', { cadenceDays: '14' })

      expect(saved.status).toBe(200)
      expect(storage?.milestoneInputs('team')?.cadenceDays).toBe(14)
      expect(await saved.text()).toContain('id="milestone-tickets"')
    })
  })
})
