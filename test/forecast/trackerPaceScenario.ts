import { beforeEach } from 'vitest'
import type { Ticket } from '../../src/connectors/connector.js'
import type { InputsEdit } from '../../src/forecast/index.js'
import { finishedInWeeks as finishedInWeeksOf } from '../trackerScenario.js'
import { checkoutFixture, CONNECTIONS, forecastingForTest, pick, type ForecastingForTest } from './forecastingForTest.js'

// Pace following the tracker (#212): the arrangement shared by the trackerPace.*.test.ts files. A team whose
// milestone query reads three open tickets and 3, 5, 6, 4, 7, 5, 6, 8 finished in the 8 weeks the read reaches.

// Thursday 12 Nov, today; at the weekly cadence, with nothing skipped, the read reaches back 9 weeks, to 09:00 on
// Thursday 10 Sep: the 8 whole weeks pace counts, and the current one.
export const READ_AT = '2026-11-12T09:00:00Z'
// a Monday, long before the read reaches, so the milestone's own pace counts every week the read reaches whole
const START = '2026-08-31'

// The weeks the read reaches whole, from Monday 14 Sep; the current week, of 9 Nov, is left out.
export const WEEKS = ['2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02']

/** Tickets finished `counts[i]` in the week of `WEEKS[i]`, on its Tuesday. */
export const finishedInWeeks = (counts: number[]): Ticket[] => finishedInWeeksOf(WEEKS, counts)

export const OFFLINE = { connected: false }

export const OPEN: Ticket[] = [{ id: 'o1' }, { id: 'o2' }, { id: 'o3' }]

/**
 * Opens the team before each test of the file calling it, and gives what its tests arrange and read with: each as the
 * local server build shows it, with the tracker's reads; `OFFLINE` as the browser build does.
 */
export function trackerPaceScenario() {
  let team: ForecastingForTest

  beforeEach(async () => {
    team = await forecastingForTest({ fixture: checkoutFixture([...OPEN, ...finishedInWeeks([3, 5, 6, 4, 7, 5, 6, 8])]) })
  })

  const build = (shown?: { connected: boolean }) => (shown?.connected === false ? team.browserBuild() : team)
  const submit = (edit: InputsEdit, shown?: { connected: boolean }) => build(shown).submit({ form: 'inputs', edit })

  return {
    /** The team's handle, opened for the running test. */
    get team(): ForecastingForTest {
      return team
    },
    submit,
    inputs: async (shown?: { connected: boolean }) => (await build(shown).inputsScreen()).inputs,
    forecast: (shown?: { connected: boolean }) => build(shown).milestoneForecastView(),
    connectGitHub: () => team.submit({ form: 'connection', edit: CONNECTIONS.github }),
    /** The milestone at `cadenceDays`, with a pace range and typed counts kept, its tickets picked and read. */
    async enterAndPick({ cadenceDays = '7' } = {}): Promise<void> {
      await submit({ kind: 'setMilestone', name: 'Checkout v2', startDate: START, ticketsRemaining: '30' })
      await submit({ kind: 'setCadence', cadenceDays })
      await submit({ kind: 'setPaceRange', low: '4', high: '8' })
      await submit({ kind: 'setPaceCounts', counts: '1, 2, 3, 4' })
      await pick(team, READ_AT)
    },
  }
}
