import { afterEach, describe, expect, test } from 'vitest'
import type { RunningApp } from '../../src/app/launch.js'
import type { CannedFixture } from '../../src/connectors/canned.js'
import type { Ticket } from '../../src/connectors/connector.js'
import { TEAM } from '../trackerScenario.js'
import { appOnTracker, type AppOnTracker } from './appOnTracker.js'
import { post, redirectedTo } from './forms.js'

// Skipping GitHub's weeks (#213): the forms the browser posts, each repeating `period`, read into what is stored, and
// where the browser lands. What the Inputs screen and the forecast show of it is test/forecast/skippedPeriods.test.ts's
// and test/app/components/inputsScreen.sources.test.ts's.

const CHECKOUT = { kind: 'milestone', name: 'Checkout v2', query: 'milestone:"Checkout v2"' } as const

// Mondays of GitHub's weeks with finished tickets, for a milestone started on Monday 31 Aug.
const WEEKS = ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02']
const COUNTS = [4, 6, 3, 5, 6, 4, 7, 5, 6, 8]

// each on the Tuesday of its week
const tuesday = (monday: string): string => new Date(Date.parse(`${monday}T10:00:00Z`) + 86_400_000).toISOString()

const finished: Ticket[] = COUNTS.flatMap((count, week) =>
  Array.from({ length: count }, (_, i) => ({ id: `w${week}-${i}`, finishedAt: tuesday(WEEKS[week]!) })),
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

/** The app, its milestone entered and following GitHub, its tickets picked. */
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

const periods = (starts: string[]): URLSearchParams => new URLSearchParams(starts.map((start) => ['period', start]))

const skippedPeriods = (): string[] | undefined => app?.storage.milestoneInputs(TEAM)?.paceWindow.skippedPeriods

describe('skipping GitHub’s weeks', () => {
  test('a skip saves each week posted, and lands back on GitHub’s pace', async () => {
    const running = await following()

    const skipped = await post(running, '/inputs/pace-skip', periods(['2026-10-12', '2026-10-19']))

    expect(redirectedTo(skipped)).toBe('/inputs#pace-tracker')
    expect(skippedPeriods()).toEqual(['2026-10-12', '2026-10-19'])
  })

  test('count them again counts each week posted again, and lands back on GitHub’s pace', async () => {
    const running = await following()
    await post(running, '/inputs/pace-skip', periods(['2026-10-12', '2026-10-19']))

    const counted = await post(running, '/inputs/pace-count-again', periods(['2026-10-12', '2026-10-19']))

    expect(redirectedTo(counted)).toBe('/inputs#pace-tracker')
    expect(skippedPeriods()).toEqual([])
  })
})
