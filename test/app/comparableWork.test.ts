import { afterEach, describe, expect, test } from 'vitest'
import { startAppAndOpenBrowser, type RunningApp } from '../../src/app/launch.js'
import { all, one, render } from './dom.js'
import { post, redirectedTo } from './forms.js'
import { cannedConnector, type CannedFixture } from '../../src/connectors/canned.js'
import type { Connecting } from '../../src/forecast/index.js'
import { openMemorySecrets } from '../../src/secrets/memorySecrets.js'
import { openSqliteStorage } from '../../src/storage/sqliteStorage.js'
import type { TeamStorage } from '../trackerScenario.js'

// The Comparable work step on the Inputs screen (#201), through the local server, on the canned connector: the query
// parameters and form fields it reads, and where its forms go. What the step shows is Seam B's
// (test/forecast/queryStep.*.test.ts, comparableWorkPace.test.ts); how it is drawn, the component tests'.

const payments = { kind: 'milestone', name: 'Payments v2', query: 'milestone:"Payments v2"' }
const checkout = { kind: 'label', name: 'checkout', query: 'label:"checkout"' }
const both = 'milestone:"Payments v2" OR label:"checkout"'

const FIXTURE: CannedFixture = {
  milestoneChoices: [
    { kind: 'milestone', choices: [{ kind: 'milestone', name: 'Payments v2', query: payments.query }], pastLimit: false },
    { kind: 'label', choices: [{ kind: 'label', name: 'checkout', query: checkout.query }], pastLimit: false },
  ],
  reads: {
    [payments.query]: { tickets: [{ id: 'p1' }, { id: 'p2', finishedAt: '2026-10-20T10:00:00Z' }], incomplete: false },
    [checkout.query]: { tickets: [{ id: 'c1', finishedAt: '2026-11-02T10:00:00Z' }], incomplete: false },
    [both]: {
      tickets: [{ id: 'p1' }, { id: 'p2', finishedAt: '2026-10-20T10:00:00Z' }, { id: 'c1', finishedAt: '2026-11-02T10:00:00Z' }],
      incomplete: false,
    },
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

/** The app connected to GitHub, the canned connector answering from `fixture`. */
async function startConnected(fixture = FIXTURE): Promise<RunningApp> {
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
  await post(app, '/inputs/connect', { tracker: 'github', repo: 'shop-team/shop', token: 'token' })
  // the Comparable work step follows the milestone's: its query, read of nothing here
  storage.saveMilestoneQuery('team', { picks: [], query: 'label:"launch"' })
  return app
}

const page = async (running: RunningApp, path = STEP): Promise<string> => (await fetch(new URL(path, running.url))).text()

/** The Inputs screen at the Comparable work step (#217). */
const STEP = '/inputs?step=comparableWork'

/** The section of the Inputs screen with this id. */
function sectionOf(html: string, id: string): string {
  const start = html.indexOf(`id="${id}"`)
  expect(start).toBeGreaterThan(-1)
  return html.slice(start, html.indexOf('</section>', start))
}

const stepOf = (html: string): string => sectionOf(html, 'comparable-work')

describe('the Comparable work step', () => {
  test('a pick is read from its form, back to the step, the milestone’s query left as it was; Start afresh clears them', async () => {
    const running = await startConnected()

    const picked = await post(running, '/inputs/comparable-work/add', payments)
    await post(running, '/inputs/comparable-work/add', checkout)

    expect(redirectedTo(picked)).toBe('/inputs?step=comparableWork#comparable-work')
    expect(storage?.setupDraft('team')?.comparableWorkQuery?.query).toBe(both)
    expect(storage?.setupDraft('team')?.milestoneQuery).toBeUndefined()

    const afresh = await post(running, '/inputs/comparable-work/afresh', {})

    expect(redirectedTo(afresh)).toBe('/inputs?step=comparableWork#comparable-work')
    expect(storage?.setupDraft('team')?.comparableWorkQuery?.query ?? '').toBe('')
  })

  test('what is typed in its find box, in its own query parameter, filters its lists', async () => {
    const running = await startConnected()

    const step = stepOf(await page(running, `${STEP}&comparableFind=check`))

    expect(step).not.toContain('Payments v2')
    expect(step).toContain('name="comparableFind" value="check"')
  })

  test('edit=comparable opens its own query for editing; an edit is read from its form, and stays open', async () => {
    const running = await startConnected()
    await post(running, '/inputs/comparable-work/add', payments)

    expect(stepOf(await page(running))).not.toContain('id="comparable-work-query"')
    expect(stepOf(await page(running, `${STEP}&edit=comparable`))).toContain('id="comparable-work-query"')

    const edited = await post(running, '/inputs/comparable-work/edit', { query: both })

    expect(redirectedTo(edited)).toBe('/inputs?step=comparableWork&edit=comparable#comparable-work')
    expect(storage?.setupDraft('team')?.comparableWorkQuery?.query).toBe(both)
  })

  test('its picker asks for the kind searched, each choice posting to its own step, as the Milestone step’s to that', async () => {
    const running = await startConnected()

    /** The list a step's picker is answered with: its status, the kind it lists, and where its choices post. */
    const asked = async (path: string) => {
      const response = await fetch(new URL(path, running.url))
      const list = one(render(await response.text()), '.kind-list')
      return {
        status: response.status,
        kind: list.getAttribute('data-kind'),
        posts: [...new Set(all(list, 'form').map((form) => form.getAttribute('action')))],
      }
    }

    expect(await asked('/inputs/comparable-work-choices?kind=label&comparableFind=')).toEqual({
      status: 200,
      kind: 'label',
      posts: ['/inputs/comparable-work/add#comparable-work'],
    })
    expect(await asked('/inputs/milestone-choices?kind=label&find=')).toEqual({
      status: 200,
      kind: 'label',
      posts: ['/inputs/milestone-query/add#milestone-tickets'],
    })
  })
})
