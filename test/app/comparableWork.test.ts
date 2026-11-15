import { afterEach, describe, expect, test } from 'vitest'
import { startAppAndOpenBrowser, type RunningApp } from '../../src/app/launch.js'
import { cannedConnector, type CannedFixture } from '../../src/connectors/canned/cannedConnector.js'
import type { Connecting } from '../../src/forecast/connection.js'
import { openMemorySecrets } from '../../src/secrets/memorySecrets.js'
import { openSqliteStorage } from '../../src/storage/sqliteStorage.js'
import type { TeamStorage } from '../trackerScenario.js'

// The Comparable work step on the Inputs screen (#201), through the local server as the EM's browser sees it, on the
// canned connector.

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

async function startConnected(): Promise<RunningApp> {
  storage = openSqliteStorage(':memory:')
  const connecting: Connecting = {
    connections: storage,
    queries: storage,
    setup: storage,
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
  await post(app, '/inputs/connect', { tracker: 'github', repo: 'shop-team/shop', token: 'token' })
  // the Comparable work step follows the milestone's: its query, read of nothing here
  storage.saveMilestoneQuery('team', { picks: [], query: 'label:"launch"' })
  return app
}

const page = async (running: RunningApp, path = STEP): Promise<string> => (await fetch(new URL(path, running.url))).text()

const post = (running: RunningApp, path: string, fields: Record<string, string>): Promise<Response> =>
  fetch(new URL(path, running.url), { method: 'POST', body: new URLSearchParams(fields), redirect: 'manual' })

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
  test('follows the Milestone step, the step shown, before the milestone, listing the choices, Skip going on to Check', async () => {
    const running = await startConnected()

    const html = await page(running)

    const numbers = [...html.matchAll(/<section[^>]* id="([^"]+)"[^]*?class="number">(\d+)</g)].map(([, id, n]) => `${id} ${n}`)
    expect(numbers.slice(0, 2)).toEqual(['comparable-work 01', 'milestone 02'])
    const step = stepOf(html)
    expect(step).toContain('<h2>Comparable work</h2>')
    expect(step).toContain('Payments v2')
    expect(step).toContain('Comparable-work query')
    expect(step).toMatch(/<a href="\/inputs\?step=check#check" class="button primary">Skip<\/a>/)
    expect(step).not.toContain('Start afresh')
  })

  test('two picks show as chips, joined with OR, with the finished tickets read, its button reading Next; the Milestone step is left as it was', async () => {
    const running = await startConnected()

    const picked = await post(running, '/inputs/comparable-work/add', payments)
    await post(running, '/inputs/comparable-work/add', checkout)

    expect(picked.status).toBe(303)
    expect(picked.headers.get('location')).toBe('/inputs?step=comparableWork#comparable-work')
    const html = await page(running)
    const step = stepOf(html)
    expect(step.match(/class="chip"/g)).toHaveLength(2)
    expect(step).toContain('milestone:&#34;Payments v2&#34; OR label:&#34;checkout&#34;')
    expect(step).toContain('<p class="read">2 finished in the last 9 weeks</p>')
    expect(step).toMatch(/>Next<\/a>/)
    expect(step).toContain('action="/inputs/comparable-work/afresh#comparable-work"')
    expect(sectionOf(await page(running, '/inputs'), 'milestone-tickets')).not.toContain('class="chip"')
  })

  test('what is typed in its find box filters its lists', async () => {
    const running = await startConnected()

    const html = await page(running, `${STEP}&comparableFind=check`)

    expect(stepOf(html)).not.toContain('Payments v2')
    expect(stepOf(html)).toContain('name="comparableFind" value="check"')
  })

  test('Edit as a query opens its own query in a box', async () => {
    const running = await startConnected()
    await post(running, '/inputs/comparable-work/add', payments)

    expect(stepOf(await page(running))).toContain('href="/inputs?step=comparableWork&#38;edit=comparable#comparable-work"')
    const html = await page(running, `${STEP}&edit=comparable`)

    expect(stepOf(html)).toMatch(
      /<form method="post" action="\/inputs\/comparable-work\/edit#comparable-work"[^]*id="comparable-work-query" name="query" value="milestone:&#34;Payments v2&#34;"/,
    )
  })

  test('a hand-edited query is read once submitted, and the step stays open for editing', async () => {
    const running = await startConnected()

    const edited = await post(running, '/inputs/comparable-work/edit', { query: both })

    expect(edited.headers.get('location')).toBe('/inputs?step=comparableWork&edit=comparable#comparable-work')
    const step = stepOf(await page(running, `${STEP}&edit=comparable`))
    expect(step).toContain('2 finished in the last 9 weeks')
    expect(step).toContain('Start afresh')
  })

  test('Start afresh clears all of comparable work, its button reading Skip again', async () => {
    const running = await startConnected()
    await post(running, '/inputs/comparable-work/add', payments)
    await post(running, '/inputs/comparable-work/add', checkout)

    const afresh = await post(running, '/inputs/comparable-work/afresh', {})

    expect(afresh.headers.get('location')).toBe('/inputs?step=comparableWork#comparable-work')
    const step = stepOf(await page(running))
    expect(step).not.toContain('class="chip"')
    expect(step).toMatch(/>Skip<\/a>/)
  })

  test('its picker asks for one kind searched, less its own picks', async () => {
    const running = await startConnected()
    await post(running, '/inputs/comparable-work/add', checkout)

    const list = await (await fetch(new URL('/inputs/comparable-work-choices?kind=label&comparableFind=', running.url))).text()
    const milestones = await (await fetch(new URL('/inputs/milestone-choices?kind=label&find=', running.url))).text()

    expect(list).not.toContain('value="label:&#34;checkout&#34;"')
    expect(milestones).toContain('value="label:&#34;checkout&#34;"')
  })

  test('leads with the pace in use and how far it is from the milestone’s own, then the two paired per week, each chip with its own (#204)', async () => {
    const running = await startConnected()
    await post(running, '/inputs/milestone', { name: 'Payments v2', startDate: '2026-10-01', ticketsRemaining: '1' })
    await post(running, '/inputs/milestone-query/add', payments)

    const before = stepOf(await page(running))
    await post(running, '/inputs/comparable-work/add', checkout)
    const step = stepOf(await page(running))

    expect(before).toMatch(/<p class="headline">0 a week <small>pace, from the milestone’s own tickets, range 0–1<\/small><\/p>/)
    expect(before).toContain('Add comparable work to measure pace from work like this milestone’s.')
    expect(step).toMatch(/<p class="headline">0 a week <small>pace, from comparable work, range 0–1<\/small><\/p>/)
    expect(step).toContain('<p class="delta aboutTheSame">About the same as the milestone’s own so far (0 a week).</p>')
    // the 8 whole weeks the reads reach, from 17 Sep: those of 17 and 24 Sep before the milestone started
    expect(step.match(/<li class="period/g)).toHaveLength(8)
    expect(step.match(/<li class="period before"/g)).toHaveLength(2)
    expect(step).toMatch(/class="legend"[^]*comparable work[^]*the milestone’s own[^]*before it started/)
    expect(step).toMatch(/class="chip"[^]*class="strip"[^]*1 finished/)
  })
})
