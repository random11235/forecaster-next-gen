import { afterEach, expect, test } from 'vitest'
import type { RunningApp } from '../../src/app/launch.js'
import type { CannedFixture } from '../../src/connectors/canned/cannedConnector.js'
import type { Ticket } from '../../src/connectors/connector.js'
import { CHECKOUT, finishedInWeeks, open } from '../trackerScenario.js'
import { appOnTracker, page, type AppOnTracker } from './appOnTracker.js'
import { post } from './forms.js'

// The faint previous value on the Inputs screen (#214), through the local server as the EM's browser sees it, on the
// canned connector.

// The Mondays of the weeks the reads reach whole, from 21 Sep; the milestone started on Monday 31 Aug
const WEEKS = ['2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02']

const finished = (counts: number[]): Ticket[] => finishedInWeeks(WEEKS, counts)

let app: AppOnTracker | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
})

/**
 * The app on 12 Nov, both values following GitHub, its first read at 09:05; then, at 14:30, the milestone's pick
 * removed and picked again in the Milestone step, which reads `then`.
 */
async function readTwice(then: Ticket[]): Promise<RunningApp> {
  const fixture: CannedFixture = {
    milestoneChoices: [{ kind: 'milestone', choices: [CHECKOUT], pastLimit: false }],
    reads: { [CHECKOUT.query]: { tickets: [...open(34), ...finished([5, 6, 0, 7, 5, 6, 8])], incomplete: false } },
  }
  app = await appOnTracker(fixture, { now: '2026-11-12T09:05:00Z' })
  const { running } = app
  await post(running, '/inputs/milestone', { name: 'Checkout v2', startDate: '2026-08-31', ticketsRemaining: '30' })
  await post(running, '/inputs/connect', { tracker: 'github', repo: 'shop-team/shop', token: 'token' })
  await post(running, '/inputs/milestone-query/add', { ...CHECKOUT })
  await post(running, '/inputs/setup/use-these', {})
  await post(running, '/inputs/tickets-source', { ticketsSource: 'tracker' })
  await post(running, '/inputs/pace-mode', { paceMode: 'tracker' })
  fixture.reads[CHECKOUT.query] = { tickets: then, incomplete: false }
  app.readAt('2026-11-12T14:30:00Z')
  await post(running, '/inputs/milestone-query/remove', { query: CHECKOUT.query })
  await post(running, '/inputs/milestone-query/add', { ...CHECKOUT })
  return running
}

const inputsPage = (running: RunningApp): Promise<string> => page(running, '/inputs')

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
