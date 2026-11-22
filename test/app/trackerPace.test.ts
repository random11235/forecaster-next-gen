import { afterEach, describe, expect, test } from 'vitest'
import type { RunningApp } from '../../src/app/launch.js'
import type { CannedFixture } from '../../src/connectors/canned.js'
import type { Ticket } from '../../src/connectors/connector.js'
import { TEAM } from '../trackerScenario.js'
import { appOnTracker, type AppOnTracker } from './appOnTracker.js'
import { post } from './forms.js'

// Pace following the tracker (#212): the forms the browser posts, read into what is stored. What the Inputs screen and
// the forecast show of it is test/forecast/trackerPace.test.ts's and test/app/components/inputsScreen.sources.test.ts's.

const CHECKOUT = { kind: 'milestone', name: 'Checkout v2', query: 'milestone:"Checkout v2"' } as const

// The Tuesdays of the 8 weeks the read reaches whole, from 14 Sep, the milestone started on Monday 31 Aug.
const TUESDAYS = ['2026-09-15', '2026-09-22', '2026-09-29', '2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27', '2026-11-03']
const COUNTS = [4, 5, 6, 0, 7, 5, 6, 8]

const finished: Ticket[] = COUNTS.flatMap((count, week) =>
  Array.from({ length: count }, (_, i) => ({ id: `w${week}-${i}`, finishedAt: `${TUESDAYS[week]}T10:00:00Z` })),
)

const FIXTURE: CannedFixture = {
  milestoneChoices: [{ kind: 'milestone', choices: [CHECKOUT], pastLimit: false }],
  reads: { [CHECKOUT.query]: { tickets: [{ id: 'm1' }, { id: 'm2' }, ...finished], incomplete: false } },
}

let app: AppOnTracker | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
})

/** The app, its milestone entered, connected to GitHub with its tickets picked, its pace following GitHub. */
async function following(): Promise<RunningApp> {
  app = await appOnTracker(FIXTURE)
  const { running } = app
  await post(running, '/inputs/milestone', { name: 'Checkout v2', startDate: '2026-08-31', ticketsRemaining: '30' })
  await post(running, '/inputs/connect', { tracker: 'github', repo: 'shop-team/shop', token: 'token' })
  await post(running, '/inputs/milestone-query/add', CHECKOUT)
  await post(running, '/inputs/setup/use-these', {})
  await post(running, '/inputs/pace-mode', { paceMode: 'tracker' })
  return running
}

describe('pace following GitHub', () => {
  test('choosing GitHub is saved', async () => {
    await following()

    expect(app?.storage.milestoneInputs(TEAM)?.paceMode).toBe('tracker')
  })

  test('the weeks typed into, each a repeated `week` field, are saved as typed counts in their order', async () => {
    const running = await following()

    const typed = new URLSearchParams(COUNTS.map((count, week) => ['week', String(week === 7 ? 9 : count)]))
    await post(running, '/inputs/pace-weeks', typed)

    expect(app?.storage.milestoneInputs(TEAM)).toMatchObject({ paceMode: 'counts', paceCounts: [4, 5, 6, 0, 7, 5, 6, 9] })
  })
})
